import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Expense, Category, RecurringTemplate, Currency } from '../types';
import {
  getExpenseRepository,
  getCategoryRepository,
  getRecurringRepository,
  runCategorySlugMigrations,
} from '../lib/repository';
import { idbZustandStorage } from '../lib/idb-storage';
import { GUEST_DATA_SCOPE, getActiveDataScope } from '../lib/dataScope';
import { syncWithSupabaseIfNeeded } from '../lib/sync-engine';

// ============================================================
//  STORE STATE SHAPE
// ============================================================

interface ExpenseStoreState {
  // ── Data ──────────────────────────────────────────────────
  expenses: Expense[];
  categories: Category[];
  recurringTemplates: RecurringTemplate[];

  // ── Settings ──────────────────────────────────────────────
  /** Global display currency; affects formatCurrency calls */
  currency: Currency;

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

interface LoadExpensesOptions {
  force?: boolean;
}

interface ExpenseStoreActions {
  // ── Core actions ──────────────────────────────────────────
  /** Loads all data (expenses, categories, recurring) from the active repository */
  loadExpenses: (options?: LoadExpensesOptions) => Promise<void>;

  // ── Expense CRUD ──────────────────────────────────────────
  addExpense: (
    data: Omit<Expense, 'id' | 'created_at' | 'synced'>
  ) => Promise<Expense>;
  updateExpense: (id: string, data: Partial<Expense>) => Promise<Expense>;
  deleteExpense: (id: string) => Promise<void>;

  // ── Category CRUD ─────────────────────────────────────────
  addCategory: (data: Category) => Promise<Category>;
  deleteCategory: (slug: string) => Promise<void>;

  // ── Recurring CRUD ────────────────────────────────────────
  addRecurring: (
    data: Omit<RecurringTemplate, 'id'>
  ) => Promise<RecurringTemplate>;
  updateRecurring: (
    id: string,
    data: Partial<RecurringTemplate>
  ) => Promise<RecurringTemplate>;
  deleteRecurring: (id: string) => Promise<void>;

  // ── Settings ──────────────────────────────────────────────
  setCurrency: (currency: Currency) => void;

  // ── Internal ──────────────────────────────────────────────
  clearError: () => void;
  setHasHydrated: (state: boolean) => void;
  ensureScope: (scope: string) => void;
}

type ExpenseStore = ExpenseStoreState & ExpenseStoreActions;

// ============================================================
//  STORE IMPLEMENTATION
// ============================================================

// In-flight promise guard — prevents concurrent loadExpenses() calls
let _loadInflight: Promise<void> | null = null;
const LOAD_EXPENSES_STALE_MS = 3 * 60_000;

export const useExpenseStore = create<ExpenseStore>()(
  persist(
    (set, get) => ({
      // ── Initial state ──────────────────────────────────────
      expenses: [],
      categories: [],
      recurringTemplates: [],
      currency: 'IDR',
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
          expenses: [],
          categories: [],
          recurringTemplates: [],
          hasLoadedOnce: false,
          lastLoadedAt: null,
          cacheScope: scope,
          error: null,
        });
      },

      // ── Load all data (deduped — concurrent calls share one promise) ──
      loadExpenses: async (options) => {
        // Dedup guard: if already loading, return the in-flight promise
        const existing = _loadInflight;
        if (existing) return existing;

        const force = options?.force ?? false;
        const activeScope = getActiveDataScope();
        const { hasLoadedOnce, lastLoadedAt } = get();
        const isFresh = hasLoadedOnce
          && lastLoadedAt !== null
          && Date.now() - lastLoadedAt < LOAD_EXPENSES_STALE_MS;

        if (!force && isFresh) {
          return;
        }

        const run = async () => {
          set({ isLoading: true, error: null });
          try {
            await runCategorySlugMigrations();

            const [expenses, categories, recurringTemplates] = await Promise.all([
              getExpenseRepository().getAll(),
              getCategoryRepository().getAll(),
              getRecurringRepository().getAll(),
            ]);
            set({
              expenses,
              categories,
              recurringTemplates,
              hasLoadedOnce: true,
              lastLoadedAt: Date.now(),
              cacheScope: activeScope,
            });

            if (activeScope !== GUEST_DATA_SCOPE) {
              void syncWithSupabaseIfNeeded()
                .then(async (result) => {
                  if (!result.changed) return;
                  if (getActiveDataScope() !== activeScope) return;

                  const [nextExpenses, nextCategories, nextRecurringTemplates] = await Promise.all([
                    getExpenseRepository().getAll(),
                    getCategoryRepository().getAll(),
                    getRecurringRepository().getAll(),
                  ]);

                  if (getActiveDataScope() !== activeScope) return;
                  set({
                    expenses: nextExpenses,
                    categories: nextCategories,
                    recurringTemplates: nextRecurringTemplates,
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

      // ── Add expense ────────────────────────────────────────
      addExpense: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const expense = await getExpenseRepository().create(data);
          set((state) => ({ expenses: [expense, ...state.expenses] }));
          return expense;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to add expense';
          set({ error: msg });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      // ── Update expense ─────────────────────────────────────
      updateExpense: async (id, data) => {
        set({ isLoading: true, error: null });
        try {
          const updated = await getExpenseRepository().update(id, data);
          set((state) => ({
            expenses: state.expenses.map((e) => (e.id === id ? updated : e)),
          }));
          return updated;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to update expense';
          set({ error: msg });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      // ── Delete expense ─────────────────────────────────────
      deleteExpense: async (id) => {
        // Optimistic delete: remove from UI immediately, rollback on error
        const snapshot = get().expenses;
        set((state) => ({
          expenses: state.expenses.filter((e) => e.id !== id),
        }));
        try {
          await getExpenseRepository().delete(id);
        } catch (err) {
          // Rollback
          set({ expenses: snapshot });
          const msg = err instanceof Error ? err.message : 'Failed to delete expense';
          set({ error: msg });
          throw err;
        }
      },

      // ── Add category ───────────────────────────────────────
      addCategory: async (data) => {
        set({ error: null });
        try {
          const category = await getCategoryRepository().create(data);
          set((state) => ({ categories: [...state.categories, category] }));
          return category;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to add category';
          set({ error: msg });
          throw err;
        }
      },

      // ── Delete category ────────────────────────────────────
      deleteCategory: async (slug) => {
        const snapshot = get().categories;
        // Optimistic: remove immediately
        set((state) => ({
          categories: state.categories.filter((c) => c.slug !== slug),
        }));
        try {
          await getCategoryRepository().delete(slug);
        } catch (err) {
          set({ categories: snapshot });
          const msg = err instanceof Error ? err.message : 'Failed to delete category';
          set({ error: msg });
          throw err;
        }
      },

      // ── Add recurring ──────────────────────────────────────
      addRecurring: async (data) => {
        set({ error: null });
        try {
          const template = await getRecurringRepository().create(data);
          set((state) => ({
            recurringTemplates: [template, ...state.recurringTemplates],
          }));
          return template;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to add recurring template';
          set({ error: msg });
          throw err;
        }
      },

      // ── Update recurring ───────────────────────────────────
      updateRecurring: async (id, data) => {
        set({ error: null });
        try {
          const updated = await getRecurringRepository().update(id, data);
          set((state) => ({
            recurringTemplates: state.recurringTemplates.map((r) =>
              r.id === id ? updated : r
            ),
          }));
          return updated;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to update recurring template';
          set({ error: msg });
          throw err;
        }
      },

      // ── Delete recurring ───────────────────────────────────
      deleteRecurring: async (id) => {
        const snapshot = get().recurringTemplates;
        set((state) => ({
          recurringTemplates: state.recurringTemplates.filter((r) => r.id !== id),
        }));
        try {
          await getRecurringRepository().delete(id);
        } catch (err) {
          set({ recurringTemplates: snapshot });
          const msg = err instanceof Error ? err.message : 'Failed to delete recurring template';
          set({ error: msg });
          throw err;
        }
      },

      // ── Currency ───────────────────────────────────────────
      setCurrency: (currency) => set({ currency }),

      // ── Clear error ────────────────────────────────────────
      clearError: () => set({ error: null }),
    }),

    {
      name: 'keuanganku-expense-store',
      storage: createJSONStorage(() => idbZustandStorage),
      // Only persist settings — data comes from repository on loadExpenses()
      // Persist data as a warm cache for instant render (stale-while-revalidate).
      // Freshness stays in-memory so re-opening the app still revalidates once.
      partialize: (state) => ({
        currency: state.currency,
        categories: state.categories,
        expenses: state.expenses,
        recurringTemplates: state.recurringTemplates,
        cacheScope: state.cacheScope,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (!error && state) {
          state.setHasHydrated(true);
        }
      },
    }
  )
);

// ============================================================
//  SELECTOR HELPERS (use in components for memoized reads)
// ============================================================

/** Returns expenses filtered to a specific month */
export function selectExpensesByMonth(
  expenses: Expense[],
  year: number,
  month: number
): Expense[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return expenses.filter((e) => e.date.startsWith(prefix));
}

/** Returns the total amount for a given expense type */
export function selectTotalByType(
  expenses: Expense[],
  type: 'NEED' | 'WANT'
): number {
  return expenses
    .filter((e) => e.type === type)
    .reduce((sum, e) => sum + e.amount, 0);
}

/** Returns a category object by its slug */
export function selectCategoryBySlug(
  categories: Category[],
  slug: string
): Category | undefined {
  return categories.find((c) => c.slug === slug);
}
