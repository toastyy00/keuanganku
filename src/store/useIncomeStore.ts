import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { IncomeEntry } from '../types';
import { getIncomeRepository } from '../lib/repository';
import { idbZustandStorage } from '../lib/idb-storage';
import { GUEST_DATA_SCOPE, getActiveDataScope } from '../lib/dataScope';
import { syncWithSupabaseIfNeeded } from '../lib/sync-engine';

// ============================================================
//  STORE STATE SHAPE
// ============================================================

interface IncomeStoreState {
  // ── Data ──────────────────────────────────────────────────
  incomes: IncomeEntry[];

  // ── UI ────────────────────────────────────────────────────
  isLoading: boolean;
  /** Stores the last error message from any async action, or null */
  error: string | null;

  // ── Persistence ───────────────────────────────────────────
  /** True when IDB persist hydration has completed */
  _hasHydrated: boolean;
  /** True after the current app session completes its first successful load */
  hasLoadedOnce: boolean;
  /** Timestamp of the last successful load in this app session */
  lastLoadedAt: number | null;
  /** Active cache scope owner (`__guest__` or authenticated user id) */
  cacheScope: string | null;
}

interface LoadIncomesOptions {
  force?: boolean;
}

interface IncomeStoreActions {
  // ── Core actions ──────────────────────────────────────────
  /** Loads all data from the active repository */
  loadIncomes: (options?: LoadIncomesOptions) => Promise<void>;

  // ── Income CRUD ───────────────────────────────────────────
  addIncome: (
    data: Omit<IncomeEntry, 'id' | 'created_at' | 'synced'>
  ) => Promise<IncomeEntry>;
  updateIncome: (id: string, data: Partial<IncomeEntry>) => Promise<IncomeEntry>;
  deleteIncome: (id: string) => Promise<void>;

  // ── Internal ──────────────────────────────────────────────
  clearError: () => void;
  setHasHydrated: (state: boolean) => void;
  ensureScope: (scope: string) => void;
}

type IncomeStore = IncomeStoreState & IncomeStoreActions;

// ============================================================
//  STORE IMPLEMENTATION
// ============================================================

// In-flight promise guard — prevents concurrent loadIncomes() calls
let _loadInflight: Promise<void> | null = null;
const LOAD_INCOMES_STALE_MS = 3 * 60_000;

export const useIncomeStore = create<IncomeStore>()(
  persist(
    (set, get) => ({
      // ── Initial state ──────────────────────────────────────
      incomes: [],
      isLoading: false,
      error: null,
      _hasHydrated: false,
      hasLoadedOnce: false,
      lastLoadedAt: null,
      cacheScope: null,

      setHasHydrated: (state) => set({ _hasHydrated: state }),
      ensureScope: (scope) => {
        const currentScope = get().cacheScope;
        if (currentScope === scope) return;
        set({
          incomes: [],
          hasLoadedOnce: false,
          lastLoadedAt: null,
          cacheScope: scope,
          error: null,
        });
      },

      // ── Load all data ──
      loadIncomes: async (options) => {
        const existing = _loadInflight;
        if (existing) return existing;

        const force = options?.force ?? false;
        const activeScope = getActiveDataScope();
        const { hasLoadedOnce, lastLoadedAt } = get();
        const isFresh = hasLoadedOnce
          && lastLoadedAt !== null
          && Date.now() - lastLoadedAt < LOAD_INCOMES_STALE_MS;

        if (!force && isFresh) {
          return;
        }

        const run = async () => {
          set({ isLoading: true, error: null });
          try {
            const incomes = await getIncomeRepository().getAll();
            set({
              incomes,
              hasLoadedOnce: true,
              lastLoadedAt: Date.now(),
              cacheScope: activeScope,
            });

            if (activeScope !== GUEST_DATA_SCOPE) {
              void syncWithSupabaseIfNeeded({ domain: 'base' })
                .then(async (result) => {
                  if (!result.changed) return;
                  if (getActiveDataScope() !== activeScope) return;

                  const nextIncomes = await getIncomeRepository().getAll();

                  if (getActiveDataScope() !== activeScope) return;
                  set({
                    incomes: nextIncomes,
                    hasLoadedOnce: true,
                    lastLoadedAt: Date.now(),
                    cacheScope: activeScope,
                  });
                })
                .catch((syncErr) => {
                  const msg = syncErr instanceof Error ? syncErr.message : 'Background sync gagal';
                  set({ error: msg });
                });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load data';
            set({ error: msg });
          } finally {
            set({ isLoading: false });
            _loadInflight = null;
          }
        };

        _loadInflight = run();
        return _loadInflight;
      },

      // ── Add income ─────────────────────────────────────────
      addIncome: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const income = await getIncomeRepository().create(data);
          const current = get().incomes;
          set({ incomes: [income, ...current] });
          return income;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to add income';
          set({ error: msg });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      // ── Update income ──────────────────────────────────────
      updateIncome: async (id, data) => {
        set({ isLoading: true, error: null });
        try {
          const updated = await getIncomeRepository().update(id, data);
          const current = get().incomes;
          set({
            incomes: current.map((item) => (item.id === id ? updated : item)),
          });
          return updated;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to update income';
          set({ error: msg });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      // ── Delete income ──────────────────────────────────────
      deleteIncome: async (id) => {
        set({ isLoading: true, error: null });
        try {
          await getIncomeRepository().delete(id);
          const current = get().incomes;
          set({ incomes: current.filter((item) => item.id !== id) });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to delete income';
          set({ error: msg });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      // ── Internal ───────────────────────────────────────────
      clearError: () => set({ error: null }),
    }),
    {
      name: 'keuanganku-income-cache',
      storage: createJSONStorage(() => idbZustandStorage),
      // Only persist data arrays; metadata reloads fresh per session
      partialize: (state) => ({
        incomes: state.incomes,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (!error && state) {
          state.setHasHydrated(true);
        }
      },
    }
  )
);
