import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbZustandStorage } from '../lib/idb-storage';
import { GUEST_DATA_SCOPE, getActiveDataScope } from '../lib/dataScope';
import { syncWithSupabaseIfNeeded } from '../lib/sync-engine';
import { getPortfolioActivityLogRepo, getPortfolioAssetRepo, getPortfolioPocketRepo } from '../lib/portfolio-repository';
import { clearCurrentPriceCache, computePortfolioValueSeries, daysForTimeframe, fetchCurrentPrices, fetchHistoricalPricesCached, resolveCoingeckoId } from '../lib/portfolio-prices';
import { aggregateHoldingsByCoingeckoId, buildChartAssetFingerprint } from '../lib/portfolio-aggregation';
import { roundPortfolioAmount } from '../lib/utils';
import type { PortfolioActivityLog, PortfolioAsset, PortfolioPocket } from '../types';

type Timeframe = '24H' | '1W' | '1M' | '1Y' | 'ALL';

interface PortfolioStoreState {
  pockets: PortfolioPocket[];
  assets: PortfolioAsset[];
  activityLogs: PortfolioActivityLog[];
  prices: Record<string, { usd: number }>;
  chartSeriesByPocket: Record<string, { timestamp: number; value: number }[]>;
  isLoading: boolean;
  error: string | null;
  _hasHydrated: boolean;
  cacheScope: string | null;
  hasLoadedOnce: boolean;
  lastLoadedAt: number | null;
}

interface PortfolioStoreActions {
  setHasHydrated: (state: boolean) => void;
  ensureScope: (scope: string) => void;
  clearError: () => void;
  loadPortfolio: (options?: { force?: boolean }) => Promise<void>;
  addPocket: (data: Omit<PortfolioPocket, 'id' | 'created_at'>) => Promise<PortfolioPocket>;
  updatePocket: (id: string, data: Partial<PortfolioPocket>) => Promise<PortfolioPocket>;
  deletePocket: (id: string) => Promise<void>;
  addAsset: (data: Omit<PortfolioAsset, 'id' | 'created_at'>, note?: string) => Promise<PortfolioAsset>;
  addHolding: (baseAsset: Pick<PortfolioAsset, 'pocket_id' | 'ticker' | 'coingecko_id'>, data: Pick<PortfolioAsset, 'amount' | 'location' | 'holding_type'> & Pick<Partial<PortfolioAsset>, 'chain' | 'note'>, activityNote?: string) => Promise<PortfolioAsset>;
  updateAssetMetadata: (id: string, data: Pick<PortfolioAsset, 'location' | 'holding_type'> & Pick<Partial<PortfolioAsset>, 'chain' | 'note'>) => Promise<PortfolioAsset>;
  updateAssetAmount: (id: string, newAmount: number, action: 'ADD' | 'REDUCE', note?: string) => Promise<PortfolioAsset>;
  removeAsset: (id: string) => Promise<void>;
  fetchPrices: (pocketId: string) => Promise<Record<string, { usd: number }>>;
  fetchAllPrices: () => Promise<Record<string, { usd: number }>>;
  refreshPrices: (pocketId?: string) => Promise<Record<string, { usd: number }>>;
  refreshChartSeries: (pocketId: string, timeframe: Timeframe) => Promise<{ timestamp: number; value: number }[]>;
  refreshTotalChartSeries: (timeframe: Timeframe) => Promise<{ timestamp: number; value: number }[]>;
}

type PortfolioStore = PortfolioStoreState & PortfolioStoreActions;

let _loadInflight: Promise<void> | null = null;
const LOAD_STALE_MS = 3 * 60_000;
const PRICE_TTL_MS = 2 * 60_000;
const CHART_TTL_MS = 5 * 60_000;

const _priceMetaByPocket = new Map<string, { fetchedAt: number; idsFingerprint: string }>();
let _allPriceMeta: { fetchedAt: number; idsFingerprint: string } | null = null;
const _chartMetaByPocketFrame = new Map<string, { fetchedAt: number; assetFingerprint: string }>();
const _chartSeriesByPocketFrame = new Map<string, { timestamp: number; value: number }[]>();
export const TOTAL_PORTFOLIO_CHART_KEY = '__total_portfolio__';

function chartMetaKey(pocketId: string, timeframe: Timeframe): string {
  return `${pocketId}::${timeframe}`;
}

function collectPriceIds(assets: PortfolioAsset[]): string[] {
  return Array.from(
    new Set(
      assets
        .map((item) => item.coingecko_id ?? resolveCoingeckoId(item.ticker))
        .filter(Boolean),
    ),
  );
}

function buildPriceIdsFingerprint(ids: string[]): string {
  return ids
    .map((id) => id.trim())
    .filter(Boolean)
    .sort()
    .join('|');
}

function mergePricesIfChanged(
  current: Record<string, { usd: number }>,
  incoming: Record<string, { usd: number }>,
): Record<string, { usd: number }> {
  let changed = false;
  const next = { ...current };

  for (const [id, price] of Object.entries(incoming)) {
    if (current[id]?.usd !== price.usd) {
      next[id] = price;
      changed = true;
    }
  }

  return changed ? next : current;
}

function invalidatePocketCacheMeta(pocketId: string): void {
  _priceMetaByPocket.delete(pocketId);
  for (const key of Array.from(_chartMetaByPocketFrame.keys())) {
    if (key.startsWith(`${pocketId}::`)) _chartMetaByPocketFrame.delete(key);
  }
  for (const key of Array.from(_chartSeriesByPocketFrame.keys())) {
    if (key.startsWith(`${pocketId}::`)) _chartSeriesByPocketFrame.delete(key);
  }
}

function toActivityLogInput(asset: PortfolioAsset, action: 'ADD' | 'REDUCE', amountChange: number, balanceAfter: number, priceAtTime: number, note?: string): Omit<PortfolioActivityLog, 'id' | 'created_at'> {
  return {
    pocket_id: asset.pocket_id,
    asset_id: asset.id,
    ticker: asset.ticker,
    action,
    amount_change: roundPortfolioAmount(Math.abs(amountChange)),
    balance_after: roundPortfolioAmount(balanceAfter),
    price_at_time: priceAtTime,
    location: asset.location,
    note: note?.trim() || undefined,
  };
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => ({
      pockets: [],
      assets: [],
      activityLogs: [],
      prices: {},
      chartSeriesByPocket: {},
      isLoading: false,
      error: null,
      _hasHydrated: false,
      cacheScope: null,
      hasLoadedOnce: false,
      lastLoadedAt: null,

      setHasHydrated: (state) => set({ _hasHydrated: state }),
      ensureScope: (scope) => {
        if (get().cacheScope === scope) return;
        _priceMetaByPocket.clear();
        _allPriceMeta = null;
        _chartMetaByPocketFrame.clear();
        _chartSeriesByPocketFrame.clear();
        set({
          pockets: [],
          assets: [],
          activityLogs: [],
          prices: {},
          chartSeriesByPocket: {},
          hasLoadedOnce: false,
          lastLoadedAt: null,
          cacheScope: scope,
          error: null,
        });
      },
      clearError: () => set({ error: null }),

      loadPortfolio: async (options) => {
        if (_loadInflight) return _loadInflight;

        const force = options?.force ?? false;
        const activeScope = getActiveDataScope();
        const { hasLoadedOnce, lastLoadedAt } = get();
        const isFresh = hasLoadedOnce && lastLoadedAt !== null && Date.now() - lastLoadedAt < LOAD_STALE_MS;
        if (!force && isFresh) return;

        const run = async () => {
          set({ isLoading: true, error: null });
          try {
            const [pockets, assets, activityLogs] = await Promise.all([getPortfolioPocketRepo().getAll(), getPortfolioAssetRepo().getAll(), getPortfolioActivityLogRepo().getAll()]);
            set({
              pockets,
              assets,
              activityLogs,
              hasLoadedOnce: true,
              lastLoadedAt: Date.now(),
              cacheScope: activeScope,
            });

            if (activeScope !== GUEST_DATA_SCOPE) {
              void syncWithSupabaseIfNeeded({ domain: 'portfolio' })
                .then(async (result) => {
                  if (!result.changed) return;
                  if (getActiveDataScope() !== activeScope) return;
                  const [nextPockets, nextAssets, nextLogs] = await Promise.all([getPortfolioPocketRepo().getAll(), getPortfolioAssetRepo().getAll(), getPortfolioActivityLogRepo().getAll()]);
                  if (getActiveDataScope() !== activeScope) return;
                  set({
                    pockets: nextPockets,
                    assets: nextAssets,
                    activityLogs: nextLogs,
                    hasLoadedOnce: true,
                    lastLoadedAt: Date.now(),
                    cacheScope: activeScope,
                  });
                })
                .catch((syncErr) => {
                  const msg = syncErr instanceof Error ? syncErr.message : 'Background portfolio sync gagal';
                  set({ error: msg });
                });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load portfolio';
            set({ error: msg });
          } finally {
            set({ isLoading: false });
            _loadInflight = null;
          }
        };

        _loadInflight = run();
        return _loadInflight;
      },

      addPocket: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const next = await getPortfolioPocketRepo().create(data);
          set((state) => ({ pockets: [next, ...state.pockets] }));
          return next;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to add pocket';
          set({ error: msg });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      updatePocket: async (id, data) => {
        set({ isLoading: true, error: null });
        try {
          const updated = await getPortfolioPocketRepo().update(id, data);
          set((state) => ({
            pockets: state.pockets.map((item) => (item.id === id ? updated : item)),
          }));
          return updated;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to update pocket';
          set({ error: msg });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      deletePocket: async (id) => {
        const stateSnapshot = get();
        const pocketSnapshot = stateSnapshot.pockets;
        const assetSnapshot = stateSnapshot.assets;
        const logSnapshot = stateSnapshot.activityLogs;
        const seriesSnapshot = stateSnapshot.chartSeriesByPocket;
        set((state) => ({
          pockets: state.pockets.filter((item) => item.id !== id),
          assets: state.assets.filter((item) => item.pocket_id !== id),
          activityLogs: state.activityLogs.filter((item) => item.pocket_id !== id),
          chartSeriesByPocket: Object.fromEntries(Object.entries(state.chartSeriesByPocket).filter(([pocketId]) => pocketId !== id)),
        }));
        try {
          invalidatePocketCacheMeta(id);
          await getPortfolioActivityLogRepo().deleteByPocketId(id);
          await getPortfolioAssetRepo().deleteByPocketId(id);
          await getPortfolioPocketRepo().delete(id);
        } catch (err) {
          set({
            pockets: pocketSnapshot,
            assets: assetSnapshot,
            activityLogs: logSnapshot,
            chartSeriesByPocket: seriesSnapshot,
          });
          const msg = err instanceof Error ? err.message : 'Failed to delete pocket';
          set({ error: msg });
          throw err;
        }
      },

      addAsset: async (data, note) => {
        set({ isLoading: true, error: null });
        try {
          const payload = {
            ...data,
            ticker: data.ticker.trim().toUpperCase(),
            coingecko_id: data.coingecko_id ?? resolveCoingeckoId(data.ticker),
            amount: roundPortfolioAmount(data.amount),
            location: data.location.trim() || 'Wallet',
            holding_type: data.holding_type,
            chain: data.chain?.trim() || undefined,
            note: data.note?.trim() || undefined,
          };
          const created = await getPortfolioAssetRepo().create(payload);

          const prices = await fetchCurrentPrices([created.coingecko_id ?? '']);
          const priceAtTime = prices[created.coingecko_id ?? '']?.usd ?? 0;
          const log = await getPortfolioActivityLogRepo().create(toActivityLogInput(created, 'ADD', created.amount, created.amount, priceAtTime, note));

          set((state) => ({
            assets: [created, ...state.assets],
            activityLogs: [log, ...state.activityLogs],
            prices: mergePricesIfChanged(state.prices, prices),
          }));
          invalidatePocketCacheMeta(created.pocket_id);
          return created;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to add asset';
          set({ error: msg });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      addHolding: async (baseAsset, data, activityNote) => {
        return get().addAsset(
          {
            pocket_id: baseAsset.pocket_id,
            ticker: baseAsset.ticker,
            coingecko_id: baseAsset.coingecko_id,
            amount: roundPortfolioAmount(data.amount),
            location: data.location,
            holding_type: data.holding_type,
            chain: data.chain,
            note: data.note,
          },
          activityNote ?? data.note,
        );
      },

      updateAssetMetadata: async (id, data) => {
        set({ isLoading: true, error: null });
        try {
          const asset = get().assets.find((item) => item.id === id);
          if (!asset) throw new Error(`Portfolio asset "${id}" not found.`);
          const updated = await getPortfolioAssetRepo().update(id, {
            location: data.location.trim() || 'Wallet',
            holding_type: data.holding_type,
            chain: data.chain?.trim() || undefined,
            note: data.note?.trim() || undefined,
          });
          set((state) => ({
            assets: state.assets.map((item) => (item.id === id ? updated : item)),
          }));
          invalidatePocketCacheMeta(asset.pocket_id);
          return updated;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to update asset metadata';
          set({ error: msg });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      updateAssetAmount: async (id, newAmount, action, note) => {
        set({ isLoading: true, error: null });
        try {
          const asset = get().assets.find((item) => item.id === id);
          if (!asset) throw new Error(`Portfolio asset "${id}" not found.`);

          const roundedAmount = roundPortfolioAmount(newAmount);
          const updated = await getPortfolioAssetRepo().update(id, { amount: roundedAmount });
          const amountChange = roundPortfolioAmount(Math.abs(roundedAmount - asset.amount));
          const prices = await fetchCurrentPrices([asset.coingecko_id ?? resolveCoingeckoId(asset.ticker)]);
          const coingeckoId = asset.coingecko_id ?? resolveCoingeckoId(asset.ticker);
          const priceAtTime = prices[coingeckoId]?.usd ?? 0;
          const log = await getPortfolioActivityLogRepo().create(toActivityLogInput({ ...asset, coingecko_id: coingeckoId }, action, amountChange, roundedAmount, priceAtTime, note));

          set((state) => ({
            assets: state.assets.map((item) => (item.id === id ? updated : item)),
            activityLogs: [log, ...state.activityLogs],
            prices: mergePricesIfChanged(state.prices, prices),
          }));
          invalidatePocketCacheMeta(asset.pocket_id);
          return updated;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to update asset';
          set({ error: msg });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      removeAsset: async (id) => {
        const stateSnapshot = get();
        const snapshot = stateSnapshot.assets;
        const logSnapshot = stateSnapshot.activityLogs;
        const asset = snapshot.find((item) => item.id === id);
        set((state) => ({
          assets: state.assets.filter((item) => item.id !== id),
        }));
        try {
          let log: PortfolioActivityLog | null = null;
          if (asset) {
            const coingeckoId = asset.coingecko_id ?? resolveCoingeckoId(asset.ticker);
            const prices = await fetchCurrentPrices([coingeckoId]);
            const priceAtTime = prices[coingeckoId]?.usd ?? 0;
            log = await getPortfolioActivityLogRepo().create(toActivityLogInput({ ...asset, coingecko_id: coingeckoId }, 'REDUCE', asset.amount, 0, priceAtTime, `Removed ${asset.chain ? `${asset.chain} · ` : ''}${asset.location}`));
            invalidatePocketCacheMeta(asset.pocket_id);
          }
          await getPortfolioAssetRepo().delete(id);
          if (log) {
            set((state) => ({
              activityLogs: [log, ...state.activityLogs],
            }));
          }
        } catch (err) {
          set({ assets: snapshot, activityLogs: logSnapshot });
          const msg = err instanceof Error ? err.message : 'Failed to remove asset';
          set({ error: msg });
          throw err;
        }
      },

      fetchPrices: async (pocketId) => {
        const now = Date.now();
        const ids = collectPriceIds(get().assets.filter((item) => item.pocket_id === pocketId));
        const idsFingerprint = buildPriceIdsFingerprint(ids);
        if (ids.length === 0) return {};

        const cachedMeta = _priceMetaByPocket.get(pocketId);
        if (cachedMeta && cachedMeta.idsFingerprint === idsFingerprint && now - cachedMeta.fetchedAt < PRICE_TTL_MS) {
          return get().prices;
        }

        const prices = await fetchCurrentPrices(ids);
        const currentPrices = get().prices;
        const nextPrices = mergePricesIfChanged(currentPrices, prices);
        if (nextPrices !== currentPrices) set({ prices: nextPrices });
        _priceMetaByPocket.set(pocketId, { fetchedAt: Date.now(), idsFingerprint });
        return prices;
      },

      fetchAllPrices: async () => {
        const now = Date.now();
        const ids = collectPriceIds(get().assets);
        if (ids.length === 0) return {};
        const idsFingerprint = buildPriceIdsFingerprint(ids);
        if (_allPriceMeta && _allPriceMeta.idsFingerprint === idsFingerprint && now - _allPriceMeta.fetchedAt < PRICE_TTL_MS) {
          return get().prices;
        }

        const prices = await fetchCurrentPrices(ids);
        const currentPrices = get().prices;
        const nextPrices = mergePricesIfChanged(currentPrices, prices);
        if (nextPrices !== currentPrices) set({ prices: nextPrices });
        _allPriceMeta = { fetchedAt: Date.now(), idsFingerprint };
        return prices;
      },

      refreshPrices: async (pocketId) => {
        const assetsToRefresh = pocketId ? get().assets.filter((item) => item.pocket_id === pocketId) : get().assets;
        const ids = collectPriceIds(assetsToRefresh);
        clearCurrentPriceCache(pocketId ? ids : undefined);

        if (pocketId) {
          _priceMetaByPocket.delete(pocketId);
          return get().fetchPrices(pocketId);
        }

        _priceMetaByPocket.clear();
        _allPriceMeta = null;
        if (!pocketId) {
          const prices = await fetchCurrentPrices(ids);
          const now = Date.now();
          const currentPrices = get().prices;
          const nextPrices = mergePricesIfChanged(currentPrices, prices);
          if (nextPrices !== currentPrices) set({ prices: nextPrices });
          const touchedPocketIds = Array.from(new Set(get().assets.map((item) => item.pocket_id)));
          touchedPocketIds.forEach((id) => {
            const pocketIds = collectPriceIds(get().assets.filter((item) => item.pocket_id === id));
            _priceMetaByPocket.set(id, { fetchedAt: now, idsFingerprint: buildPriceIdsFingerprint(pocketIds) });
          });
          _allPriceMeta = { fetchedAt: now, idsFingerprint: buildPriceIdsFingerprint(ids) };
          return prices;
        }
        return {};
      },

      refreshChartSeries: async (pocketId, timeframe) => {
        const scopedAssets = aggregateHoldingsByCoingeckoId(get().assets.filter((item) => item.pocket_id === pocketId));
        const now = Date.now();
        const fingerprint = buildChartAssetFingerprint(scopedAssets);
        const metaKey = chartMetaKey(pocketId, timeframe);
        const cachedMeta = _chartMetaByPocketFrame.get(metaKey);
        const cachedSeries = _chartSeriesByPocketFrame.get(metaKey) ?? [];
        const isChartFresh = cachedMeta && now - cachedMeta.fetchedAt < CHART_TTL_MS && cachedMeta.assetFingerprint === fingerprint && cachedSeries.length > 0;
        if (isChartFresh) {
          set((state) => ({
            chartSeriesByPocket: {
              ...state.chartSeriesByPocket,
              [pocketId]: cachedSeries,
            },
          }));
          return cachedSeries;
        }

        const historicalByAsset: Record<string, [number, number][]> = {};
        const days = daysForTimeframe(timeframe);
        await Promise.all(
          Array.from(new Set(scopedAssets.map((asset) => asset.coingecko_id))).map(async (coingeckoId) => {
            historicalByAsset[coingeckoId] = await fetchHistoricalPricesCached(coingeckoId, days);
          }),
        );

        const series = computePortfolioValueSeries(scopedAssets, historicalByAsset, timeframe);
        set((state) => ({
          chartSeriesByPocket: {
            ...state.chartSeriesByPocket,
            [pocketId]: series,
          },
        }));
        _chartMetaByPocketFrame.set(metaKey, { fetchedAt: now, assetFingerprint: fingerprint });
        _chartSeriesByPocketFrame.set(metaKey, series);
        return series;
      },

      refreshTotalChartSeries: async (timeframe) => {
        const scopedAssets = aggregateHoldingsByCoingeckoId(get().assets);
        const now = Date.now();
        const fingerprint = buildChartAssetFingerprint(scopedAssets);
        const metaKey = chartMetaKey(TOTAL_PORTFOLIO_CHART_KEY, timeframe);
        const cachedMeta = _chartMetaByPocketFrame.get(metaKey);
        const cachedSeries = _chartSeriesByPocketFrame.get(metaKey) ?? [];
        const isChartFresh = cachedMeta && now - cachedMeta.fetchedAt < CHART_TTL_MS && cachedMeta.assetFingerprint === fingerprint && cachedSeries.length > 0;
        if (isChartFresh) {
          set((state) => ({
            chartSeriesByPocket: {
              ...state.chartSeriesByPocket,
              [TOTAL_PORTFOLIO_CHART_KEY]: cachedSeries,
            },
          }));
          return cachedSeries;
        }

        const historicalByAsset: Record<string, [number, number][]> = {};
        const days = daysForTimeframe(timeframe);
        await Promise.all(
          Array.from(new Set(scopedAssets.map((asset) => asset.coingecko_id))).map(async (coingeckoId) => {
            historicalByAsset[coingeckoId] = await fetchHistoricalPricesCached(coingeckoId, days);
          }),
        );

        const series = computePortfolioValueSeries(scopedAssets, historicalByAsset, timeframe);
        set((state) => ({
          chartSeriesByPocket: {
            ...state.chartSeriesByPocket,
            [TOTAL_PORTFOLIO_CHART_KEY]: series,
          },
        }));
        _chartMetaByPocketFrame.set(metaKey, { fetchedAt: now, assetFingerprint: fingerprint });
        _chartSeriesByPocketFrame.set(metaKey, series);
        return series;
      },
    }),
    {
      name: 'keuanganku-portfolio-store',
      storage: createJSONStorage(() => idbZustandStorage),
      partialize: (state) => ({
        pockets: state.pockets,
        assets: state.assets,
        activityLogs: state.activityLogs,
        cacheScope: state.cacheScope,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (!error && state) state.setHasHydrated(true);
      },
    },
  ),
);
