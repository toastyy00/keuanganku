import { create } from 'zustand';

// ============================================================
//  UI STORE — sheet open state, active expense, prefill data
// ============================================================

/** Partial expense data used to pre-fill the Add Expense sheet */
export interface ExpensePrefill {
  name?: string;
  amount?: number;
  category?: string;
  type?: import('../types').ExpenseType;
  note?: string;
  is_recurring?: boolean;
  recurring_id?: string;
}

interface UIState {
  isAddSheetOpen: boolean;
  /** ID of the expense being edited, null = add mode */
  activeExpenseId: string | null;
  /** Data to pre-fill the form (for recurring quick-log) */
  prefillData: ExpensePrefill | null;

  openAddSheet: (prefill?: ExpensePrefill) => void;
  closeAddSheet: () => void;
  setActiveExpense: (id: string | null) => void;
  clearPrefill: () => void;

  // ── Global FAB signals for page-specific actions ─────────
  isHistoryInsightOpen: boolean;
  openHistoryInsight: () => void;
  closeHistoryInsight: () => void;

  isRecurringSheetOpen: boolean;
  openRecurringSheet: () => void;
  closeRecurringSheet: () => void;

  // ── Shared active month ────────────────────────────────
  activeYear: number;
  activeMonth: number;
  setActiveMonth: (year: number, month: number) => void;
  prevMonth: () => void;
  nextMonth: () => void;
  resetToCurrentMonth: () => void;

  // ── Sankey diagram persistent highlight ───────────────
  sankeyHighlightedCat: string | null;
  setSankeyHighlightedCat: (slug: string | null) => void;
}

const now = new Date();

export const useUIStore = create<UIState>((set, get) => ({
  isAddSheetOpen: false,
  activeExpenseId: null,
  prefillData: null,

  openAddSheet: (prefill) =>
    set({ isAddSheetOpen: true, prefillData: prefill ?? null }),

  closeAddSheet: () =>
    set({ isAddSheetOpen: false, activeExpenseId: null, prefillData: null }),

  setActiveExpense: (id) =>
    set({ activeExpenseId: id, isAddSheetOpen: true, prefillData: null }),

  clearPrefill: () => set({ prefillData: null }),

  // ── Global FAB signals ────────────────────────────────
  isHistoryInsightOpen: false,
  openHistoryInsight: () => set({ isHistoryInsightOpen: true }),
  closeHistoryInsight: () => set({ isHistoryInsightOpen: false }),

  isRecurringSheetOpen: false,
  openRecurringSheet: () => set({ isRecurringSheetOpen: true }),
  closeRecurringSheet: () => set({ isRecurringSheetOpen: false }),

  // ── Active month ─────────────────────────────────────
  activeYear: now.getFullYear(),
  activeMonth: now.getMonth() + 1,

  setActiveMonth: (year, month) => set({ activeYear: year, activeMonth: month }),

  prevMonth: () => {
    const { activeYear, activeMonth } = get();
    if (activeMonth === 1) set({ activeYear: activeYear - 1, activeMonth: 12 });
    else set({ activeMonth: activeMonth - 1 });
  },

  nextMonth: () => {
    const { activeYear, activeMonth } = get();
    if (activeMonth === 12) set({ activeYear: activeYear + 1, activeMonth: 1 });
    else set({ activeMonth: activeMonth + 1 });
  },

  resetToCurrentMonth: () => {
    const n = new Date();
    set({ activeYear: n.getFullYear(), activeMonth: n.getMonth() + 1 });
  },

  // ── Sankey highlight ─────────────────────────────────
  sankeyHighlightedCat: null,
  setSankeyHighlightedCat: (slug) => set({ sankeyHighlightedCat: slug }),
}));
