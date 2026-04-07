import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Expense, Category, RecurringTemplate, Currency } from '../types';
import {
  getExpenseRepository,
  getCategoryRepository,
  getRecurringRepository,
  runCategorySlugMigrations,
} from '../lib/repository';

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
}

interface ExpenseStoreActions {
  // ── Core actions ──────────────────────────────────────────
  /** Loads all data (expenses, categories, recurring) from the active repository */
  loadExpenses: () => Promise<void>;

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
}

type ExpenseStore = ExpenseStoreState & ExpenseStoreActions;

// ============================================================
//  STORE IMPLEMENTATION
// ============================================================

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

      // ── Load all data ──────────────────────────────────────
      loadExpenses: async () => {
        set({ isLoading: true, error: null });
        try {
          await runCategorySlugMigrations();

          const [expenses, categories, recurringTemplates] = await Promise.all([
            getExpenseRepository().getAll(),
            getCategoryRepository().getAll(),
            getRecurringRepository().getAll(),
          ]);
          set({ expenses, categories, recurringTemplates });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to load data';
          set({ error: msg });
        } finally {
          set({ isLoading: false });
        }
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
      // Only persist settings — data comes from repository on loadExpenses()
      // This prevents stale data from persisting across sessions
      partialize: (state) => ({
        currency: state.currency,
        // We do NOT persist expenses/categories/recurring here;
        // the repository (localStorage or Supabase) is the source of truth.
        // However, we persist categories as a warm cache for instant render.
        categories: state.categories,
      }),
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
