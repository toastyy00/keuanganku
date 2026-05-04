import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbZustandStorage } from '../lib/idb-storage';
import { GUEST_DATA_SCOPE, getActiveDataScope } from '../lib/dataScope';
import { syncWithSupabaseIfNeeded } from '../lib/sync-engine';
import { getPortfolioActivityLogRepo, getPortfolioAssetRepo, getPortfolioPocketRepo } from '../lib/portfolio-repository';
import { clearCurrentPriceCache, clearHistoricalPriceCache, computePortfolioValueSeries, daysForTimeframe, fetchCurrentAssetPrices, fetchHistoricalPricesForAssets, resolveCoingeckoId } from '../lib/portfolio-prices';
import { aggregateHoldingsByCoingeckoId, buildChartAssetFingerprint } from '../lib/portfolio-aggregation';
import { roundPortfolioAmount } from '../lib/utils';
import type { PortfolioActivityLog, PortfolioAsset, PortfolioPocket } from '../types';

type Timeframe = '24H' | '1W' | '1M' | '1Y' | 'ALL';
type PriceCacheMeta = { fetchedAt: number; idsFingerprint: string };
type ChartCacheMeta = { fetchedAt: number; assetFingerprint: string };
type ChartSeries = { timestamp: number; value: number }[];
type HistoricalPoint = [number, number];
type AssetTimeframeChange = { changePct: number; changeValue: number };
type RefreshOptions = { force?: boolean };

interface PortfolioStoreState {
  pockets: PortfolioPocket[];
  assets: PortfolioAsset[];
  activityLogs: PortfolioActivityLog[];
  prices: Record<string, { usd: number }>;
  chartSeriesByPocket: Record<string, ChartSeries>;
  priceCacheMetaByScope: Record<string, PriceCacheMeta>;
  chartCacheMetaByKey: Record<string, ChartCacheMeta>;
  chartSeriesByCacheKey: Record<string, ChartSeries>;
  assetChangesByScope: Record<string, Record<string, AssetTimeframeChange>>;
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
  refreshPrices: (pocketId?: string, options?: RefreshOptions) => Promise<Record<string, { usd: number }>>;
  refreshChartSeries: (pocketId: string, timeframe: Timeframe, options?: RefreshOptions) => Promise<ChartSeries>;
  refreshTotalChartSeries: (timeframe: Timeframe, options?: RefreshOptions) => Promise<ChartSeries>;
}

type PortfolioStore = PortfolioStoreState & PortfolioStoreActions;

let _loadInflight: Promise<void> | null = null;
const LOAD_STALE_MS = 3 * 60_000;
const PRICE_TTL_MS = 15 * 60_000;
const CHART_TTL_MS = 15 * 60_000;

const TOTAL_PRICE_CACHE_KEY = '__all__';
export const TOTAL_PORTFOLIO_CHART_KEY = '__total_portfolio__';

function chartMetaKey(pocketId: string, timeframe: Timeframe): string {
  return `${pocketId}::${timeframe}`;
}

function assetPriceId(asset: Pick<PortfolioAsset, 'ticker' | 'coingecko_id'>): string {
  return asset.coingecko_id ?? resolveCoingeckoId(asset.ticker);
}

function collectPriceIds(assets: Pick<PortfolioAsset, 'ticker' | 'coingecko_id'>[]): string[] {
  return Array.from(
    new Set(
      assets
        .map((item) => assetPriceId(item))
        .filter(Boolean),
    ),
  );
}

function buildPriceAssetFingerprint(assets: Pick<PortfolioAsset, 'ticker' | 'coingecko_id'>[]): string {
  return assets
    .map((asset) => `${asset.ticker.trim().toUpperCase()}:${assetPriceId(asset)}`)
    .filter(Boolean)
    .sort()
    .join('|');
}

function havePricesForAssets(
  assets: Pick<PortfolioAsset, 'ticker' | 'coingecko_id'>[],
  prices: Record<string, { usd: number }>,
): boolean {
  return assets.every((asset) => {
    const id = assetPriceId(asset);
    return !!id && typeof prices[id]?.usd === 'number' && Number.isFinite(prices[id].usd);
  });
}

function buildPocketPriceMeta(
  assets: Pick<PortfolioAsset, 'pocket_id' | 'ticker' | 'coingecko_id'>[],
  fetchedAt: number,
): Record<string, PriceCacheMeta> {
  const meta: Record<string, PriceCacheMeta> = {};
  const touchedPocketIds = Array.from(new Set(assets.map((item) => item.pocket_id)));
  touchedPocketIds.forEach((id) => {
    const pocketAssets = assets.filter((item) => item.pocket_id === id);
    meta[id] = { fetchedAt, idsFingerprint: buildPriceAssetFingerprint(pocketAssets) };
  });
  return meta;
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

function omitRecordKeys<T>(record: Record<string, T>, shouldOmit: (key: string) => boolean): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !shouldOmit(key)));
}

function omitPocketCacheKeys<T>(record: Record<string, T>, pocketId: string): Record<string, T> {
  return omitRecordKeys(record, (key) => key.startsWith(`${pocketId}::`));
}

function buildAssetTimeframeChanges(
  assets: { coingecko_id: string }[],
  historicalByAsset: Record<string, HistoricalPoint[]>,
): Record<string, AssetTimeframeChange> {
  const changes: Record<string, AssetTimeframeChange> = {};
  const ids = Array.from(new Set(assets.map((asset) => asset.coingecko_id).filter(Boolean)));

  for (const id of ids) {
    const points = historicalByAsset[id] ?? [];
    if (points.length < 2) continue;
    const first = points[0]?.[1];
    const last = points[points.length - 1]?.[1];
    if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) continue;

    const changeValue = last - first;
    changes[id] = {
      changeValue,
      changePct: (changeValue / first) * 100,
    };
  }

  return changes;
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
      priceCacheMetaByScope: {},
      chartCacheMetaByKey: {},
      chartSeriesByCacheKey: {},
      assetChangesByScope: {},
      isLoading: false,
      error: null,
      _hasHydrated: false,
      cacheScope: null,
      hasLoadedOnce: false,
      lastLoadedAt: null,

      setHasHydrated: (state) => set({ _hasHydrated: state }),
      ensureScope: (scope) => {
        if (get().cacheScope === scope) return;
        set({
          pockets: [],
          assets: [],
          activityLogs: [],
          prices: {},
          chartSeriesByPocket: {},
          priceCacheMetaByScope: {},
          chartCacheMetaByKey: {},
          chartSeriesByCacheKey: {},
          assetChangesByScope: {},
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
        const priceMetaSnapshot = stateSnapshot.priceCacheMetaByScope;
        const chartMetaSnapshot = stateSnapshot.chartCacheMetaByKey;
        const chartCacheSnapshot = stateSnapshot.chartSeriesByCacheKey;
        const assetChangesSnapshot = stateSnapshot.assetChangesByScope;
        set((state) => ({
          pockets: state.pockets.filter((item) => item.id !== id),
          assets: state.assets.filter((item) => item.pocket_id !== id),
          activityLogs: state.activityLogs.filter((item) => item.pocket_id !== id),
          chartSeriesByPocket: Object.fromEntries(Object.entries(state.chartSeriesByPocket).filter(([pocketId]) => pocketId !== id)),
          priceCacheMetaByScope: omitRecordKeys(state.priceCacheMetaByScope, (key) => key === id),
          chartCacheMetaByKey: omitPocketCacheKeys(state.chartCacheMetaByKey, id),
          chartSeriesByCacheKey: omitPocketCacheKeys(state.chartSeriesByCacheKey, id),
          assetChangesByScope: omitPocketCacheKeys(state.assetChangesByScope, id),
        }));
        try {
          await getPortfolioActivityLogRepo().deleteByPocketId(id);
          await getPortfolioAssetRepo().deleteByPocketId(id);
          await getPortfolioPocketRepo().delete(id);
        } catch (err) {
          set({
            pockets: pocketSnapshot,
            assets: assetSnapshot,
            activityLogs: logSnapshot,
            chartSeriesByPocket: seriesSnapshot,
            priceCacheMetaByScope: priceMetaSnapshot,
            chartCacheMetaByKey: chartMetaSnapshot,
            chartSeriesByCacheKey: chartCacheSnapshot,
            assetChangesByScope: assetChangesSnapshot,
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

          const prices = await fetchCurrentAssetPrices([created]);
          const priceAtTime = prices[created.coingecko_id ?? '']?.usd ?? 0;
          const log = await getPortfolioActivityLogRepo().create(toActivityLogInput(created, 'ADD', created.amount, created.amount, priceAtTime, note));

          set((state) => ({
            assets: [created, ...state.assets],
            activityLogs: [log, ...state.activityLogs],
            prices: mergePricesIfChanged(state.prices, prices),
          }));
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
          const prices = await fetchCurrentAssetPrices([asset]);
          const coingeckoId = asset.coingecko_id ?? resolveCoingeckoId(asset.ticker);
          const priceAtTime = prices[coingeckoId]?.usd ?? 0;
          const log = await getPortfolioActivityLogRepo().create(toActivityLogInput({ ...asset, coingecko_id: coingeckoId }, action, amountChange, roundedAmount, priceAtTime, note));

          set((state) => ({
            assets: state.assets.map((item) => (item.id === id ? updated : item)),
            activityLogs: [log, ...state.activityLogs],
            prices: mergePricesIfChanged(state.prices, prices),
          }));
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
            const prices = await fetchCurrentAssetPrices([{ ...asset, coingecko_id: coingeckoId }]);
            const priceAtTime = prices[coingeckoId]?.usd ?? 0;
            log = await getPortfolioActivityLogRepo().create(toActivityLogInput({ ...asset, coingecko_id: coingeckoId }, 'REDUCE', asset.amount, 0, priceAtTime, `Removed ${asset.chain ? `${asset.chain} · ` : ''}${asset.location}`));
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
        const assetsToFetch = get().assets.filter((item) => item.pocket_id === pocketId);
        const idsFingerprint = buildPriceAssetFingerprint(assetsToFetch);
        if (assetsToFetch.length === 0) return {};

        const cachedMeta = get().priceCacheMetaByScope[pocketId];
        if (cachedMeta && cachedMeta.idsFingerprint === idsFingerprint && now - cachedMeta.fetchedAt < PRICE_TTL_MS) {
          return get().prices;
        }
        const totalCachedMeta = get().priceCacheMetaByScope[TOTAL_PRICE_CACHE_KEY];
        if (
          totalCachedMeta
          && now - totalCachedMeta.fetchedAt < PRICE_TTL_MS
          && havePricesForAssets(assetsToFetch, get().prices)
        ) {
          set((state) => ({
            priceCacheMetaByScope: {
              ...state.priceCacheMetaByScope,
              [pocketId]: { fetchedAt: totalCachedMeta.fetchedAt, idsFingerprint },
            },
          }));
          return get().prices;
        }

        const prices = await fetchCurrentAssetPrices(assetsToFetch);
        const currentPrices = get().prices;
        const nextPrices = mergePricesIfChanged(currentPrices, prices);
        if (nextPrices !== currentPrices) set({ prices: nextPrices });
        set((state) => ({
          priceCacheMetaByScope: {
            ...state.priceCacheMetaByScope,
            [pocketId]: { fetchedAt: Date.now(), idsFingerprint },
          },
        }));
        return prices;
      },

      fetchAllPrices: async () => {
        const now = Date.now();
        const assetsToFetch = get().assets;
        if (assetsToFetch.length === 0) return {};
        const idsFingerprint = buildPriceAssetFingerprint(assetsToFetch);
        const cachedMeta = get().priceCacheMetaByScope[TOTAL_PRICE_CACHE_KEY];
        if (cachedMeta && cachedMeta.idsFingerprint === idsFingerprint && now - cachedMeta.fetchedAt < PRICE_TTL_MS) {
          return get().prices;
        }

        const prices = await fetchCurrentAssetPrices(assetsToFetch);
        const fetchedAt = Date.now();
        const currentPrices = get().prices;
        const nextPrices = mergePricesIfChanged(currentPrices, prices);
        if (nextPrices !== currentPrices) set({ prices: nextPrices });
        set((state) => ({
          priceCacheMetaByScope: {
            ...state.priceCacheMetaByScope,
            [TOTAL_PRICE_CACHE_KEY]: { fetchedAt, idsFingerprint },
            ...buildPocketPriceMeta(assetsToFetch, fetchedAt),
          },
        }));
        return prices;
      },

      refreshPrices: async (pocketId, options) => {
        const force = options?.force ?? false;
        const assetsToRefresh = pocketId ? get().assets.filter((item) => item.pocket_id === pocketId) : get().assets;
        const ids = collectPriceIds(assetsToRefresh);
        if (force) clearCurrentPriceCache(pocketId ? ids : undefined);

        if (pocketId) {
          if (force) {
            set((state) => ({
              priceCacheMetaByScope: omitRecordKeys(state.priceCacheMetaByScope, (key) => key === pocketId),
            }));
          }
          return get().fetchPrices(pocketId);
        }

        if (force) {
          set({ priceCacheMetaByScope: {} });
        }
        if (!force) return get().fetchAllPrices();
        const prices = await fetchCurrentAssetPrices(assetsToRefresh);
        const now = Date.now();
        const currentPrices = get().prices;
        const nextPrices = mergePricesIfChanged(currentPrices, prices);
        if (nextPrices !== currentPrices) set({ prices: nextPrices });
        const nextMeta: Record<string, PriceCacheMeta> = {
          ...(force ? {} : get().priceCacheMetaByScope),
          [TOTAL_PRICE_CACHE_KEY]: { fetchedAt: now, idsFingerprint: buildPriceAssetFingerprint(assetsToRefresh) },
          ...buildPocketPriceMeta(assetsToRefresh, now),
        };
        set({ priceCacheMetaByScope: nextMeta });
        return prices;
      },

      refreshChartSeries: async (pocketId, timeframe, options) => {
        const force = options?.force ?? false;
        const scopedAssets = aggregateHoldingsByCoingeckoId(get().assets.filter((item) => item.pocket_id === pocketId));
        const now = Date.now();
        const fingerprint = buildChartAssetFingerprint(scopedAssets);
        const metaKey = chartMetaKey(pocketId, timeframe);
        const cachedMeta = get().chartCacheMetaByKey[metaKey];
        const cachedSeries = get().chartSeriesByCacheKey[metaKey] ?? [];
        const isChartFresh = !force && cachedMeta && now - cachedMeta.fetchedAt < CHART_TTL_MS && cachedMeta.assetFingerprint === fingerprint && cachedSeries.length > 0;
        if (isChartFresh) {
          set((state) => ({
            chartSeriesByPocket: {
              ...state.chartSeriesByPocket,
              [pocketId]: cachedSeries,
            },
          }));
          return cachedSeries;
        }

        const days = daysForTimeframe(timeframe);
        const coingeckoIds = Array.from(new Set(scopedAssets.map((asset) => asset.coingecko_id)));
        if (force) clearHistoricalPriceCache(coingeckoIds, days);
        const historicalByAsset = await fetchHistoricalPricesForAssets(scopedAssets, days);
        const assetChanges = buildAssetTimeframeChanges(scopedAssets, historicalByAsset);
        const hasAssetChanges = Object.keys(assetChanges).length > 0;

        const computedSeries = computePortfolioValueSeries(scopedAssets, historicalByAsset, timeframe);
        const series = computedSeries.length > 0 || cachedSeries.length === 0 ? computedSeries : cachedSeries;
        set((state) => ({
          chartSeriesByPocket: {
            ...state.chartSeriesByPocket,
            [pocketId]: series,
          },
          chartSeriesByCacheKey: {
            ...state.chartSeriesByCacheKey,
            [metaKey]: series,
          },
          chartCacheMetaByKey: {
            ...state.chartCacheMetaByKey,
            [metaKey]: { fetchedAt: Date.now(), assetFingerprint: fingerprint },
          },
          assetChangesByScope: hasAssetChanges
            ? {
                ...state.assetChangesByScope,
                [metaKey]: assetChanges,
              }
            : state.assetChangesByScope,
        }));
        return series;
      },

      refreshTotalChartSeries: async (timeframe, options) => {
        const force = options?.force ?? false;
        const scopedAssets = aggregateHoldingsByCoingeckoId(get().assets);
        const now = Date.now();
        const fingerprint = buildChartAssetFingerprint(scopedAssets);
        const metaKey = chartMetaKey(TOTAL_PORTFOLIO_CHART_KEY, timeframe);
        const cachedMeta = get().chartCacheMetaByKey[metaKey];
        const cachedSeries = get().chartSeriesByCacheKey[metaKey] ?? [];
        const isChartFresh = !force && cachedMeta && now - cachedMeta.fetchedAt < CHART_TTL_MS && cachedMeta.assetFingerprint === fingerprint && cachedSeries.length > 0;
        if (isChartFresh) {
          set((state) => ({
            chartSeriesByPocket: {
              ...state.chartSeriesByPocket,
              [TOTAL_PORTFOLIO_CHART_KEY]: cachedSeries,
            },
          }));
          return cachedSeries;
        }

        const days = daysForTimeframe(timeframe);
        const coingeckoIds = Array.from(new Set(scopedAssets.map((asset) => asset.coingecko_id)));
        if (force) clearHistoricalPriceCache(coingeckoIds, days);
        const historicalByAsset = await fetchHistoricalPricesForAssets(scopedAssets, days);

        const computedSeries = computePortfolioValueSeries(scopedAssets, historicalByAsset, timeframe);
        const series = computedSeries.length > 0 || cachedSeries.length === 0 ? computedSeries : cachedSeries;
        set((state) => ({
          chartSeriesByPocket: {
            ...state.chartSeriesByPocket,
            [TOTAL_PORTFOLIO_CHART_KEY]: series,
          },
          chartSeriesByCacheKey: {
            ...state.chartSeriesByCacheKey,
            [metaKey]: series,
          },
          chartCacheMetaByKey: {
            ...state.chartCacheMetaByKey,
            [metaKey]: { fetchedAt: Date.now(), assetFingerprint: fingerprint },
          },
        }));
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
        prices: state.prices,
        chartSeriesByPocket: state.chartSeriesByPocket,
        priceCacheMetaByScope: state.priceCacheMetaByScope,
        chartCacheMetaByKey: state.chartCacheMetaByKey,
        chartSeriesByCacheKey: state.chartSeriesByCacheKey,
        assetChangesByScope: state.assetChangesByScope,
        cacheScope: state.cacheScope,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (!error && state) state.setHasHydrated(true);
      },
    },
  ),
);
