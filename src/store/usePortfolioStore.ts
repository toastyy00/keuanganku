import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbZustandStorage } from '../lib/idb-storage';
import { GUEST_DATA_SCOPE, getActiveDataScope } from '../lib/dataScope';
import { syncWithSupabaseIfNeeded } from '../lib/sync-engine';
import {
  getPortfolioActivityLogRepo,
  getPortfolioAssetRepo,
  getPortfolioPocketRepo,
} from '../lib/portfolio-repository';
import {
  clearCurrentPriceCache,
  computePortfolioValueSeries,
  daysForTimeframe,
  fetchCurrentPrices,
  fetchHistoricalPrices,
  resolveCoingeckoId,
} from '../lib/portfolio-prices';
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
  updateAssetAmount: (
    id: string,
    newAmount: number,
    action: 'ADD' | 'REDUCE',
    note?: string
  ) => Promise<PortfolioAsset>;
  removeAsset: (id: string) => Promise<void>;
  fetchPrices: (pocketId: string) => Promise<Record<string, { usd: number }>>;
  refreshPrices: (pocketId?: string) => Promise<Record<string, { usd: number }>>;
  refreshChartSeries: (pocketId: string, timeframe: Timeframe) => Promise<{ timestamp: number; value: number }[]>;
}

type PortfolioStore = PortfolioStoreState & PortfolioStoreActions;

let _loadInflight: Promise<void> | null = null;
const LOAD_STALE_MS = 3 * 60_000;

function toActivityLogInput(
  asset: PortfolioAsset,
  action: 'ADD' | 'REDUCE',
  amountChange: number,
  balanceAfter: number,
  priceAtTime: number,
  note?: string,
): Omit<PortfolioActivityLog, 'id' | 'created_at'> {
  return {
    pocket_id: asset.pocket_id,
    asset_id: asset.id,
    ticker: asset.ticker,
    action,
    amount_change: Math.abs(amountChange),
    balance_after: balanceAfter,
    price_at_time: priceAtTime,
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
        const isFresh = hasLoadedOnce
          && lastLoadedAt !== null
          && Date.now() - lastLoadedAt < LOAD_STALE_MS;
        if (!force && isFresh) return;

        const run = async () => {
          set({ isLoading: true, error: null });
          try {
            const [pockets, assets, activityLogs] = await Promise.all([
              getPortfolioPocketRepo().getAll(),
              getPortfolioAssetRepo().getAll(),
              getPortfolioActivityLogRepo().getAll(),
            ]);
            set({
              pockets,
              assets,
              activityLogs,
              hasLoadedOnce: true,
              lastLoadedAt: Date.now(),
              cacheScope: activeScope,
            });

            if (activeScope !== GUEST_DATA_SCOPE) {
              void syncWithSupabaseIfNeeded()
                .then(async (result) => {
                  if (!result.changed) return;
                  if (getActiveDataScope() !== activeScope) return;
                  const [nextPockets, nextAssets, nextLogs] = await Promise.all([
                    getPortfolioPocketRepo().getAll(),
                    getPortfolioAssetRepo().getAll(),
                    getPortfolioActivityLogRepo().getAll(),
                  ]);
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
        const snapshot = get().pockets;
        const assetIds = new Set(get().assets.filter((item) => item.pocket_id === id).map((item) => item.id));
        set((state) => ({
          pockets: state.pockets.filter((item) => item.id !== id),
          assets: state.assets.filter((item) => item.pocket_id !== id),
          activityLogs: state.activityLogs.filter((item) => !assetIds.has(item.asset_id)),
        }));
        try {
          await getPortfolioPocketRepo().delete(id);
        } catch (err) {
          set({ pockets: snapshot });
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
          };
          const created = await getPortfolioAssetRepo().create(payload);

          const prices = await fetchCurrentPrices([created.coingecko_id ?? '']);
          const priceAtTime = prices[created.coingecko_id ?? '']?.usd ?? 0;
          const log = await getPortfolioActivityLogRepo().create(
            toActivityLogInput(created, 'ADD', created.amount, created.amount, priceAtTime, note)
          );

          set((state) => ({
            assets: [created, ...state.assets],
            activityLogs: [log, ...state.activityLogs],
            prices: { ...state.prices, ...prices },
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

      updateAssetAmount: async (id, newAmount, action, note) => {
        set({ isLoading: true, error: null });
        try {
          const asset = get().assets.find((item) => item.id === id);
          if (!asset) throw new Error(`Portfolio asset "${id}" not found.`);

          const updated = await getPortfolioAssetRepo().update(id, { amount: newAmount });
          const amountChange = Math.abs(newAmount - asset.amount);
          const prices = await fetchCurrentPrices([asset.coingecko_id ?? resolveCoingeckoId(asset.ticker)]);
          const coingeckoId = asset.coingecko_id ?? resolveCoingeckoId(asset.ticker);
          const priceAtTime = prices[coingeckoId]?.usd ?? 0;
          const log = await getPortfolioActivityLogRepo().create(
            toActivityLogInput({ ...asset, coingecko_id: coingeckoId }, action, amountChange, newAmount, priceAtTime, note)
          );

          set((state) => ({
            assets: state.assets.map((item) => (item.id === id ? updated : item)),
            activityLogs: [log, ...state.activityLogs],
            prices: { ...state.prices, ...prices },
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
        const snapshot = get().assets;
        set((state) => ({
          assets: state.assets.filter((item) => item.id !== id),
        }));
        try {
          await getPortfolioAssetRepo().delete(id);
        } catch (err) {
          set({ assets: snapshot });
          const msg = err instanceof Error ? err.message : 'Failed to remove asset';
          set({ error: msg });
          throw err;
        }
      },

      fetchPrices: async (pocketId) => {
        const ids = Array.from(new Set(
          get().assets
            .filter((item) => item.pocket_id === pocketId)
            .map((item) => item.coingecko_id ?? resolveCoingeckoId(item.ticker))
            .filter(Boolean)
        ));
        const prices = await fetchCurrentPrices(ids);
        set((state) => ({ prices: { ...state.prices, ...prices } }));
        return prices;
      },

      refreshPrices: async (pocketId) => {
        clearCurrentPriceCache();
        if (!pocketId) {
          const ids = Array.from(new Set(
            get().assets
              .map((item) => item.coingecko_id ?? resolveCoingeckoId(item.ticker))
              .filter(Boolean)
          ));
          const prices = await fetchCurrentPrices(ids);
          set((state) => ({ prices: { ...state.prices, ...prices } }));
          return prices;
        }
        return get().fetchPrices(pocketId);
      },

      refreshChartSeries: async (pocketId, timeframe) => {
        const scopedAssets = get().assets
          .filter((item) => item.pocket_id === pocketId)
          .map((item) => ({
            coingecko_id: item.coingecko_id ?? resolveCoingeckoId(item.ticker),
            amount: item.amount,
          }))
          .filter((item) => !!item.coingecko_id);

        const historicalByAsset: Record<string, [number, number][]> = {};
        const days = daysForTimeframe(timeframe);
        await Promise.all(scopedAssets.map(async (asset) => {
          historicalByAsset[asset.coingecko_id] = await fetchHistoricalPrices(asset.coingecko_id, days);
        }));

        const series = computePortfolioValueSeries(scopedAssets, historicalByAsset, timeframe);
        set((state) => ({
          chartSeriesByPocket: {
            ...state.chartSeriesByPocket,
            [pocketId]: series,
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
        cacheScope: state.cacheScope,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (!error && state) state.setHasHydrated(true);
      },
    }
  )
);
