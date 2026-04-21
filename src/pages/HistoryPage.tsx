import React, { useCallback, useEffect, useLayoutEffect, useState, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { create } from 'zustand';
import { SankeyChart } from '../components/ui/SankeyChart';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  PackageOpen,
  ChevronDown,
  Sparkles,
  Bot,
  CalendarRange,
  Layers,
  CalendarDays,
  History,
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { BottomSheet } from '../components/ui/BottomSheet';
import { useExpenseStore } from '../store/useExpenseStore';
import { useUIStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  formatCurrency,
  groupExpensesByDate,
  calcNeedsWantsSplit,
} from '../lib/utils';
import { getExchangeRate, convertAmount, type RateResult } from '../lib/exchangeRate';
import { generateExpenseInsight } from '../lib/ai';
import { getActiveDataScope } from '../lib/dataScope';
import {
  buildQuickInsightLine,
  buildCombinedInsight,
  buildTopCategories,
  getInsightFilterLabel,
  getPreviousScopedExpenses,
  getExpensesForScope,
  getPreviousExpensesForScope,
  computeScopeTotalDays,
  getScopedExpenses,
  isFamilySupportExpense,
  sumDisplayedExpenses,
  type HistoryInsightResponse,
  type HistoryInsightCategory,
  type InsightScope,
  type InsightScopeType,
} from '../lib/historyInsights';
import type { ExpenseType, Expense } from '../types';

// ============================================================
//  HISTORY PAGE
// ============================================================

type TypeFilter = 'ALL' | ExpenseType;
type InsightIntent = 'combined' | 'deep_analysis' | 'breakdown';
type SearchScope = 'month' | 'all';

export interface BreakdownItem {
  expense: Expense;
  convertedAmount: number;
}

export interface BreakdownGroup {
  categoryLabel: string;
  totalAmount: number;
  items: BreakdownItem[];
}

type HistoryListRow =
  | { kind: 'date'; key: string; dateKey: string; dayTotal: number }
  | { kind: 'expense'; key: string; expense: Expense };

interface VirtualLayout {
  offsets: number[];
  heights: number[];
  totalHeight: number;
}

const HISTORY_VIRTUALIZE_THRESHOLD = 200;
const HISTORY_VIRTUAL_OVERSCAN_PX = 480;

function estimateHistoryRowHeight(row: HistoryListRow, deletingId: string | null): number {
  if (row.kind === 'date') return 34;
  return deletingId === row.expense.id ? 72 : 92;
}

type AssistantMessage =
  | { id: string; role: 'assistant'; variant: 'intro'; content: string }
  | { id: string; role: 'user'; variant: 'prompt'; content: string }
  | { id: string; role: 'assistant'; variant: 'insight'; insight: HistoryInsightResponse }
  | { id: string; role: 'assistant'; variant: 'breakdown'; breakdown: BreakdownGroup[] };

interface CachedInsightEntry {
  storedAt: string;
  intent: InsightIntent;
  promptLabel: string;
  insight: HistoryInsightResponse;
}

interface HistoryUIState {
  typeFilter: TypeFilter;
  setTypeFilter: (filter: TypeFilter) => void;
  catFilter: Set<string>;
  setCatFilter: (cats: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  search: string;
  setSearch: (s: string) => void;
  searchScope: SearchScope;
  setSearchScope: (scope: SearchScope | ((prev: SearchScope) => SearchScope)) => void;
  insightScope: InsightScope;
  setInsightScope: (s: InsightScope | ((prev: InsightScope) => InsightScope)) => void;
  viewMode: 'list' | 'flow';
  setViewMode: (mode: 'list' | 'flow') => void;
}

const useHistoryUIStore = create<HistoryUIState>((set) => ({
  typeFilter: 'ALL',
  setTypeFilter: (typeFilter) => set({ typeFilter }),
  catFilter: new Set(),
  setCatFilter: (cats) => set((state) => ({
    catFilter: typeof cats === 'function' ? cats(state.catFilter) : cats
  })),
  search: '',
  setSearch: (search) => set({ search }),
  searchScope: 'month',
  setSearchScope: (searchScope) => set((state) => ({
    searchScope: typeof searchScope === 'function' ? searchScope(state.searchScope) : searchScope
  })),
  insightScope: { type: 'pick_month', label: '' },
  setInsightScope: (insightScope) => set((state) => ({
    insightScope: typeof insightScope === 'function' ? insightScope(state.insightScope) : insightScope
  })),
  viewMode: 'list',
  setViewMode: (viewMode) => set({ viewMode }),
}));

function haptic() { if ('vibrate' in navigator) navigator.vibrate(10); }

function longDate(isoDate: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(isoDate + 'T00:00:00'));
}

const QUICK_PROMPTS: Array<{ intent: InsightIntent; label: string; icon: React.ReactNode }> = [
  { intent: 'combined', label: 'Review', icon: <Sparkles size={16} strokeWidth={2.5} /> },
  { intent: 'breakdown', label: 'Breakdown', icon: <Layers size={16} strokeWidth={2.5} /> },
  { intent: 'deep_analysis', label: 'Analisis AI', icon: <Bot size={16} strokeWidth={2.5} /> },
];

const SCOPE_OPTIONS: Array<{ type: InsightScopeType; label: string; color: string }> = [
  { type: 'pick_month', label: 'Bulan', color: '#B8F55A' },
  { type: 'year', label: 'Tahun', color: '#B8F55A' },
  { type: 'range', label: 'Rentang', color: '#B8F55A' },
  { type: 'all', label: 'Semua', color: '#F5F0E8' },
];

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const SCOPE_MONTH_NAMES_COMPACT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function insightCacheKey(
  ownerScope: string,
  scope: InsightScope,
  intent: InsightIntent,
  dataHash?: string,
): string {
  return `expense-rule-insight:${ownerScope}:${scope.type}:${scope.label}:${intent}${dataHash ? ':' + dataHash : ''}`;
}

function buildScopeLabel(scope: InsightScope, activeYear: number, activeMonth: number): string {
  switch (scope.type) {
    case 'month':
      return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' })
        .format(new Date(activeYear, activeMonth - 1, 1));
    case 'pick_month': {
      const y = scope.year ?? activeYear;
      const m = scope.month ?? activeMonth;
      return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' })
        .format(new Date(y, m - 1, 1));
    }
    case 'range': {
      const fy = scope.fromYear ?? activeYear;
      const fm = scope.fromMonth ?? 1;
      const ty = scope.toYear ?? activeYear;
      const tm = scope.toMonth ?? 12;
      return `${MONTH_NAMES[fm - 1]} ${fy} – ${MONTH_NAMES[tm - 1]} ${ty}`;
    }
    case 'year':
      return `Tahun ${scope.year ?? activeYear}`;
    case 'all':
      return 'Semua transaksi';
    default:
      return 'Periode';
  }
}

function getScopeMonthsCount(scope: InsightScope, expenses: Expense[], viewYear: number): number {
  if (scope.type === 'month' || scope.type === 'pick_month') return 1;
  if (scope.type === 'year') return 12;
  if (scope.type === 'range') {
    const fy = scope.fromYear ?? viewYear;
    const fm = scope.fromMonth ?? 1;
    const ty = scope.toYear ?? viewYear;
    const tm = scope.toMonth ?? 12;
    return (ty - fy) * 12 + (tm - fm) + 1;
  }
  if (scope.type === 'all') {
    if (expenses.length === 0) return 1;
    let minDate = expenses[0].date;
    let maxDate = expenses[0].date;
    for (const e of expenses) {
      if (e.date < minDate) minDate = e.date;
      if (e.date > maxDate) maxDate = e.date;
    }
    const minY = parseInt(minDate.substring(0, 4), 10);
    const minM = parseInt(minDate.substring(5, 7), 10);
    const maxY = parseInt(maxDate.substring(0, 4), 10);
    const maxM = parseInt(maxDate.substring(5, 7), 10);
    const diff = (maxY - minY) * 12 + (maxM - minM) + 1;
    return Math.max(1, diff);
  }
  return 1;
}

function readCachedInsight(
  ownerScope: string,
  scope: InsightScope,
  intent: InsightIntent,
  dataHash?: string
): CachedInsightEntry | null {
  try {
    const raw = localStorage.getItem(insightCacheKey(ownerScope, scope, intent, dataHash));
    if (!raw) return null;
    return JSON.parse(raw) as CachedInsightEntry;
  } catch {
    return null;
  }
}

function writeCachedInsight(
  ownerScope: string,
  scope: InsightScope,
  intent: InsightIntent,
  promptLabel: string,
  insight: HistoryInsightResponse,
  dataHash?: string
): void {
  try {
    const payload: CachedInsightEntry = {
      storedAt: new Date().toISOString(),
      intent,
      promptLabel,
      insight,
    };
    localStorage.setItem(
      insightCacheKey(ownerScope, scope, intent, dataHash),
      JSON.stringify(payload)
    );
  } catch {
    // Ignore cache failures; AI feature should still work without persistence.
  }
}

function introMessage(scopeText: string): AssistantMessage {
  return {
    id: uid('assistant'),
    role: 'assistant',
    variant: 'intro',
    content: `Saya bisa bantu merangkum ${scopeText} atau membaca pola transaksi yang paling menonjol di periode ini.`,
  };
}


const HistoryPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Riwayat - KeuanganKu';
    return () => { document.title = 'KeuanganKu'; };
  }, []);

  const { expenses, categories, currency, deleteExpense } = useExpenseStore();
  const { setActiveExpense, isHistoryInsightOpen, openHistoryInsight, closeHistoryInsight } = useUIStore();
  const {
    aiProvider,
    openaiKey,
    openrouterKey,
    openrouterModel,
    personalMonthlyBudget,
    familySupportMonthlyBudget,
  } = useSettingsStore();
  const activeAiKey = aiProvider === 'openai' ? openaiKey : openrouterKey;

  const { activeYear: viewYear, activeMonth: viewMonth, prevMonth, nextMonth, sankeyHighlightedCat, setSankeyHighlightedCat } = useUIStore();
  const {
    typeFilter,
    setTypeFilter,
    catFilter,
    setCatFilter,
    search,
    setSearch,
    searchScope,
    setSearchScope,
    insightScope,
    setInsightScope,
    viewMode,
    setViewMode,
  } = useHistoryUIStore();

  // viewMode is persistent in useHistoryUIStore, so no reset effect is needed here.

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [catFilterOpen, setCatFilterOpen] = useState(false);
  const [rateInfo, setRateInfo] = useState<RateResult>({ rate: 16000, isFallback: true });
  const assistantOpen = isHistoryInsightOpen;
  const setAssistantOpen = useCallback((v: boolean) => {
    if (v) {
      openHistoryInsight();
    } else {
      closeHistoryInsight();
    }
  }, [openHistoryInsight, closeHistoryInsight]);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [isQuickInsightExpanded, setIsQuickInsightExpanded] = useState(false);
  const listScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const [virtualRowHeights, setVirtualRowHeights] = useState<Record<string, number>>({});

  useEffect(() => {
    getExchangeRate().then((res) => setRateInfo(res));
  }, []);

  const location = useLocation();
  useLayoutEffect(() => {
    if (location.state?.categorySlug && location.state?.fromSankey) {
      // Coming from Dashboard Sankey double-click: apply category filter
      setTypeFilter('ALL');
      setSearch('');
      setCatFilter(new Set([location.state.categorySlug]));
    } else if (location.state?.categorySlug && location.state?.fromDashboardTop) {
      // Coming from Top Kategori Terboros click: go to Flow view and highlight category
      setViewMode('flow');
      setSankeyHighlightedCat(location.state.categorySlug);
      setSearch('');
      setCatFilter(new Set());
    } else if (location.state?.fromDashboardCashout) {
      setTypeFilter('TRANSFER');
      setViewMode('list');
      setSearch('');
      setCatFilter(new Set());
    } else if (location.state?.fromDashboardViewAll) {
      setTypeFilter('ALL');
      setViewMode('list');
      setSearchScope('month');
      setSearch('');
      setCatFilter(new Set());
      setSankeyHighlightedCat(null);
    } else if (!location.state?.categorySlug) {
      // Normal navigation: preserve typeFilter, only reset search & catFilter
      // Also reset the highlighted cat so the chart ref initialises fresh (prevents first-click flicker)
      setSearch('');
      setCatFilter(new Set());
      setSankeyHighlightedCat(null);
    }
    window.history.replaceState({}, document.title);
  }, [location.state, setTypeFilter, setSearch, setCatFilter, setViewMode, setSearchScope, setSankeyHighlightedCat]);

  const toDisplay = useCallback(
    (exp: Expense) => convertAmount(exp.amount, exp.currency, currency, rateInfo.rate),
    [currency, rateInfo.rate]
  );

  const monthPrefix = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;
  const monthLabelStr = new Intl.DateTimeFormat('id-ID', {
    month: 'long', year: 'numeric',
  }).format(new Date(viewYear, viewMonth - 1, 1));
  const normalizedSearch = search.trim().toLowerCase();
  const isAllHistoryMode = searchScope === 'all';
  const isAllHistorySearchActive = isAllHistoryMode && normalizedSearch.length > 0;
  const historyHeaderLabel = isAllHistoryMode ? 'Semua Transaksi' : monthLabelStr;
  const previousMonthDate = useMemo(() => new Date(viewYear, viewMonth - 2, 1), [viewYear, viewMonth]);
  const previousMonthPrefix = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const lastSyncedPickMonthRef = useRef<{ year: number; month: number } | null>(null);

  // Resolve scope label (reactive)
  const resolvedScopeLabel = useMemo(
    () => buildScopeLabel(insightScope, viewYear, viewMonth),
    [insightScope, viewYear, viewMonth]
  );

  useEffect(() => {
    setInsightScope((currentScope) => (
      (() => {
        const lastSynced = lastSyncedPickMonthRef.current;

        if (currentScope.type === 'month') {
          return { type: 'pick_month', label: '', year: viewYear, month: viewMonth };
        }

        if (currentScope.type !== 'pick_month') {
          return currentScope;
        }

        if (
          lastSynced === null ||
          currentScope.year == null ||
          currentScope.month == null ||
          (currentScope.year === lastSynced.year && currentScope.month === lastSynced.month)
        ) {
          return { ...currentScope, year: viewYear, month: viewMonth };
        }

        return currentScope;
      })()
    ));

    lastSyncedPickMonthRef.current = { year: viewYear, month: viewMonth };
  }, [viewYear, viewMonth, setInsightScope]);

  // Hide scrollbar when in flow view to prevent layout shifts/flickering
  useEffect(() => {
    if (viewMode === 'flow') {
      document.body.classList.add('flow-mode-active');
    } else {
      document.body.classList.remove('flow-mode-active');
    }
    return () => document.body.classList.remove('flow-mode-active');
  }, [viewMode]);

  useEffect(() => {
    const container = listScrollContainerRef.current;
    if (!container) return;

    const updateViewport = () => {
      setListScrollTop(container.scrollTop);
      setListViewportHeight(container.clientHeight);
    };

    const onScroll = () => {
      setListScrollTop(container.scrollTop);
    };

    updateViewport();
    container.addEventListener('scroll', onScroll, { passive: true });

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateViewport());
      observer.observe(container);
      return () => {
        container.removeEventListener('scroll', onScroll);
        observer.disconnect();
      };
    }

    window.addEventListener('resize', updateViewport);
    return () => {
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', updateViewport);
    };
  }, []);

  // Filtered
  const filtered = useMemo(() => {
    if (isAllHistoryMode && !normalizedSearch) return [];

    return expenses.filter((e) => {
      if (!isAllHistorySearchActive && !e.date.startsWith(monthPrefix)) return false;
      if (typeFilter !== 'ALL' && e.type !== typeFilter) return false;
      if (catFilter.size > 0 && !catFilter.has(e.category)) return false;
      if (normalizedSearch) {
        const matchDest = (e.destination ?? '').toLowerCase().includes(normalizedSearch);
        if (!e.name.toLowerCase().includes(normalizedSearch) && !(e.note ?? '').toLowerCase().includes(normalizedSearch) && !matchDest) return false;
      }
      return true;
    });
  }, [expenses, monthPrefix, typeFilter, catFilter, normalizedSearch, isAllHistoryMode, isAllHistorySearchActive]);

  const availableCategories = useMemo(() => {
    // We want expenses that match the current month/search scope and typeFilter,
    // ignoring the catFilter so the user can still select/unselect available options.
    const baseExpenses = expenses.filter((e) => {
      if (!isAllHistorySearchActive && !e.date.startsWith(monthPrefix)) return false;
      if (typeFilter !== 'ALL' && e.type !== typeFilter) return false;
      if (normalizedSearch) {
        const matchDest = (e.destination ?? '').toLowerCase().includes(normalizedSearch);
        if (!e.name.toLowerCase().includes(normalizedSearch) && !(e.note ?? '').toLowerCase().includes(normalizedSearch) && !matchDest) return false;
      }
      return true;
    });

    const usedSlugs = new Set(baseExpenses.map(e => e.category).filter(c => c !== ''));
    return categories.filter(c => usedSlugs.has(c.slug));
  }, [expenses, categories, monthPrefix, typeFilter, normalizedSearch, isAllHistorySearchActive]);

  const grouped = useMemo(() => groupExpensesByDate(filtered), [filtered]);
  const dateKeys = Object.keys(grouped);
  const categoryBySlug = useMemo(
    () => new Map(categories.map((category) => [category.slug, category])),
    [categories]
  );
  const historyRows = useMemo<HistoryListRow[]>(() => {
    const rows: HistoryListRow[] = [];

    for (const dateKey of dateKeys) {
      const dayExpenses = grouped[dateKey] ?? [];
      const dayTotal = dayExpenses
        .filter((expense) => (typeFilter === 'TRANSFER' ? true : expense.type !== 'TRANSFER'))
        .reduce((sum, expense) => sum + toDisplay(expense), 0);

      rows.push({
        kind: 'date',
        key: `date-${dateKey}`,
        dateKey,
        dayTotal,
      });

      for (const expense of dayExpenses) {
        rows.push({
          kind: 'expense',
          key: `expense-${expense.id}`,
          expense,
        });
      }
    }

    return rows;
  }, [dateKeys, grouped, typeFilter, toDisplay]);
  const shouldVirtualizeHistory = viewMode === 'list' && filtered.length > HISTORY_VIRTUALIZE_THRESHOLD;

  useEffect(() => {
    if (!shouldVirtualizeHistory) return;

    const rowKeys = new Set(historyRows.map((row) => row.key));
    setVirtualRowHeights((previous) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [key, height] of Object.entries(previous)) {
        if (rowKeys.has(key)) {
          next[key] = height;
        } else {
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [historyRows, shouldVirtualizeHistory]);

  const virtualLayout = useMemo<VirtualLayout>(() => {
    const offsets: number[] = [];
    const heights: number[] = [];
    let runningTop = 0;

    for (const row of historyRows) {
      offsets.push(runningTop);
      const height = virtualRowHeights[row.key] ?? estimateHistoryRowHeight(row, deletingId);
      heights.push(height);
      runningTop += height;
    }

    return {
      offsets,
      heights,
      totalHeight: runningTop,
    };
  }, [historyRows, virtualRowHeights, deletingId]);

  const virtualVisibleRange = useMemo(() => {
    if (!shouldVirtualizeHistory || historyRows.length === 0) {
      return { startIndex: 0, endIndex: Math.max(0, historyRows.length - 1) };
    }

    const minTop = Math.max(0, listScrollTop - HISTORY_VIRTUAL_OVERSCAN_PX);
    const maxTop = listScrollTop + Math.max(listViewportHeight, 1) + HISTORY_VIRTUAL_OVERSCAN_PX;

    let startIndex = 0;
    while (
      startIndex < historyRows.length
      && virtualLayout.offsets[startIndex] + virtualLayout.heights[startIndex] < minTop
    ) {
      startIndex += 1;
    }

    let endIndex = startIndex;
    while (
      endIndex < historyRows.length
      && virtualLayout.offsets[endIndex] < maxTop
    ) {
      endIndex += 1;
    }

    return {
      startIndex,
      endIndex: Math.min(historyRows.length - 1, Math.max(startIndex, endIndex)),
    };
  }, [historyRows.length, listScrollTop, listViewportHeight, shouldVirtualizeHistory, virtualLayout]);

  const measureVirtualRow = useCallback((key: string, node: HTMLDivElement | null) => {
    if (!node) return;
    const measured = Math.ceil(node.getBoundingClientRect().height);
    if (!Number.isFinite(measured) || measured <= 0) return;

    setVirtualRowHeights((previous) => {
      const current = previous[key];
      if (current && Math.abs(current - measured) <= 1) return previous;
      return { ...previous, [key]: measured };
    });
  }, []);

  const monthExpenses = useMemo(
    () => expenses.filter((e) => e.date.startsWith(monthPrefix)),
    [expenses, monthPrefix]
  );
  const spendingMonthExpenses = useMemo(
    () => monthExpenses.filter((e) => e.type !== 'TRANSFER'),
    [monthExpenses]
  );
  const flowExpenses = useMemo(
    () => spendingMonthExpenses
      .filter((e) => e.category !== 'keluarga')
      .map((e) => ({ ...e, amount: toDisplay(e) })),
    [spendingMonthExpenses, toDisplay]
  );
  const flowActiveCatStats = useMemo(() => {
    if (flowExpenses.length === 0) return { count: 0, total: 0 };
    
    // Calculate defaultTop1 matching SankeyChart logic
    const catStats = new Map<string, { rawAmount: number, count: number }>();
    flowExpenses.forEach(e => {
      const s = catStats.get(e.category) ?? { rawAmount: 0, count: 0 };
      s.rawAmount += e.amount;
      s.count += 1;
      catStats.set(e.category, s);
    });
    
    const sortedCats = Array.from(catStats.entries())
      .map(([slug, s]) => ({ slug, ...s }))
      .sort((a, b) => b.rawAmount - a.rawAmount || b.count - a.count);
    
    const defaultTop1 = sortedCats[0]?.slug ?? null;
    const activeCat = sankeyHighlightedCat ?? defaultTop1;
    
    const activeTxns = flowExpenses.filter(e => e.category === activeCat);
    return {
      count: activeTxns.length,
      total: activeTxns.reduce((s, e) => s + e.amount, 0) // raw amount is fine before currency conversion here if it matches toDisplay logic for base currency, wait, toDisplay uses rate.
    };
  }, [flowExpenses, sankeyHighlightedCat]);
  const previousMonthExpenses = useMemo(
    () => expenses.filter((e) => e.date.startsWith(previousMonthPrefix) && e.type !== 'TRANSFER'),
    [expenses, previousMonthPrefix]
  );
  const selectedScopeExpenses = useMemo(
    () => getExpensesForScope(expenses, insightScope, viewYear, viewMonth),
    [expenses, insightScope, viewYear, viewMonth]
  );
  const hasSelectedScopeData = selectedScopeExpenses.length > 0;

  const toggleCat = (slug: string) => {
    setCatFilter((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  const handleDelete = useCallback(async (id: string) => {
    haptic();
    await deleteExpense(id);
    setDeletingId(null);
  }, [deleteExpense]);

  const renderHistoryRow = useCallback((row: HistoryListRow) => {
    if (row.kind === 'date') {
      return (
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-black uppercase text-brutal-black/60 capitalize">
            {longDate(row.dateKey)}
          </p>
          <p className="text-xs font-black text-brutal-black/60">
            {formatCurrency(row.dayTotal, currency)}
          </p>
        </div>
      );
    }

    const expense = row.expense;
    const cat = categoryBySlug.get(expense.category);
    const isDeleting = deletingId === expense.id;
    const badgeVariant = expense.type === 'NEED' ? 'need' : expense.type === 'WANT' ? 'want' : 'transfer';

    return (
      <div className="neo-card overflow-hidden !shadow-[5px_5px_0_0_#000000]">
        {isDeleting ? (
          <div className="flex items-center gap-3 p-3 bg-red-500">
            <p className="flex-1 text-sm font-bold text-white uppercase">
              Hapus "{expense.name}"?
            </p>
            <button
              onClick={() => handleDelete(expense.id)}
              className="px-3 py-1.5 bg-white text-red-500 border-2 border-white font-black text-xs uppercase min-h-[36px]"
            >
              Hapus
            </button>
            <button
              onClick={() => setDeletingId(null)}
              className="px-3 py-1.5 bg-red-500 text-white border-2 border-white font-black text-xs uppercase min-h-[36px]"
            >
              Batal
            </button>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setActiveExpense(expense.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setActiveExpense(expense.id);
              }
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all duration-150 cursor-pointer"
            style={{ color: '#F5F0E8' }}
            onMouseEnter={(event) => (event.currentTarget.style.backgroundColor = 'rgba(245,240,232,0.05)')}
            onMouseLeave={(event) => (event.currentTarget.style.backgroundColor = 'transparent')}
          >
            <span className="text-2xl w-9 shrink-0 text-center">
              {expense.type === 'TRANSFER' ? '💸' : (cat?.emoji ?? '🛍️')}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-sm font-bold truncate leading-tight">{expense.name}</p>
                {expense.type !== 'TRANSFER' && (
                  <span className="shrink-0 text-[10px] font-bold text-brutal-black/45 truncate">
                    · {cat?.label ?? expense.category}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5 min-w-0 flex-nowrap">
                <Badge variant={badgeVariant} size="sm" className="shrink-0">{expense.type}</Badge>
                {expense.type === 'TRANSFER' && expense.destination ? (
                  <span className="shrink-0 text-[10px] text-brutal-black/50 font-medium truncate max-w-[96px]">{'\u25b8'} {expense.destination}</span>
                ) : null}
                {expense.note && (
                  <span className="min-w-0 flex-1 text-[10px] text-brutal-black/40 italic truncate">
                    {expense.note}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <p className="text-sm font-black">{formatCurrency(expense.amount, expense.currency)}</p>
              <button
                onClick={(event) => { event.stopPropagation(); haptic(); setDeletingId(expense.id); }}
                className="p-2 text-brutal-black/40 hover:text-red-500 hover:bg-red-50 transition-colors duration-150 min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"
                aria-label={`Hapus ${expense.name}`}
              >
                <Trash2 size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }, [categoryBySlug, currency, deletingId, handleDelete, setActiveExpense]);

  const monthTotal = useMemo(
    () => filtered
      .filter((e) => typeFilter === 'TRANSFER' ? true : e.type !== 'TRANSFER')
      .reduce((s, e) => s + toDisplay(e), 0),
    [filtered, typeFilter, toDisplay]
  );
  const scopedMonthExpenses = useMemo(
    () => getScopedExpenses(typeFilter, monthExpenses, spendingMonthExpenses),
    [monthExpenses, spendingMonthExpenses, typeFilter]
  );


  const previousScopedExpenses = useMemo(
    () => getPreviousScopedExpenses(typeFilter, expenses, previousMonthPrefix, previousMonthExpenses),
    [expenses, previousMonthExpenses, previousMonthPrefix, typeFilter]
  );
  const scopedTotal = useMemo(
    () => scopedMonthExpenses.reduce((sum, expense) => sum + toDisplay(expense), 0),
    [scopedMonthExpenses, toDisplay]
  );
  const previousScopedTotal = useMemo(
    () => previousScopedExpenses.reduce((sum, expense) => sum + toDisplay(expense), 0),
    [previousScopedExpenses, toDisplay]
  );
  const familySupportExpenses = useMemo(
    () => monthExpenses.filter((expense) => expense.type !== 'TRANSFER' && isFamilySupportExpense(expense)),
    [monthExpenses]
  );
  const familySupportTotal = useMemo(
    () => sumDisplayedExpenses(familySupportExpenses, toDisplay),
    [familySupportExpenses, toDisplay]
  );
  const personalExpenses = useMemo(
    () => spendingMonthExpenses.filter((expense) => !isFamilySupportExpense(expense)),
    [spendingMonthExpenses]
  );
  const personalTotal = useMemo(
    () => sumDisplayedExpenses(personalExpenses, toDisplay),
    [personalExpenses, toDisplay]
  );

  const topCategories = useMemo<HistoryInsightCategory[]>(
    () => buildTopCategories(scopedMonthExpenses, categories, scopedTotal, toDisplay),
    [scopedMonthExpenses, categories, scopedTotal, toDisplay]
  );
  // Personal top categories — excluding keluarga for accurate personal evaluation
  const personalTopCategories = useMemo<HistoryInsightCategory[]>(
    () => buildTopCategories(scopedMonthExpenses, categories, scopedTotal, toDisplay, ['keluarga']),
    [scopedMonthExpenses, categories, scopedTotal, toDisplay]
  );
  const personalNeedsTotal = useMemo(
    () => sumDisplayedExpenses(
      personalExpenses.filter((e) => e.type === 'NEED'), toDisplay
    ),
    [personalExpenses, toDisplay]
  );
  const personalWantsTotal = useMemo(
    () => sumDisplayedExpenses(
      personalExpenses.filter((e) => e.type === 'WANT'), toDisplay
    ),
    [personalExpenses, toDisplay]
  );
  const filterLabel = getInsightFilterLabel(typeFilter);
  const quickInsightLine = useMemo(() => buildQuickInsightLine({
    filterLabel,
    currency,
    scopedExpenses: scopedMonthExpenses,
    scopedTotal,
    topCategories,
    personalTopCategories,
    previousScopedTotal,
    familySupportTotal,
    personalTotal,
    personalNeedsTotal,
    personalWantsTotal,
    personalBudget: personalMonthlyBudget,
  }), [filterLabel, currency, scopedMonthExpenses, scopedTotal, topCategories, personalTopCategories, previousScopedTotal, familySupportTotal, personalTotal, personalNeedsTotal, personalWantsTotal, personalMonthlyBudget]);
  useEffect(() => {
    setAssistantError(null);
    setAssistantMessages((prev) => prev.length === 0 ? [introMessage(resolvedScopeLabel)] : prev);
  }, [resolvedScopeLabel]);

  const runInsight = useCallback(async (
    intent: InsightIntent,
    promptLabel: string
  ) => {
    setAssistantOpen(true);
    setAssistantError(null);
    setAssistantMessages((prev) => [
      ...prev,
      { id: uid('user'), role: 'user', variant: 'prompt', content: `${promptLabel}: ${resolvedScopeLabel}` },
    ]);

    if (!hasSelectedScopeData) {
      setAssistantError('Belum ada transaksi di periode ini, jadi insight belum bisa dibuat.');
      return;
    }

    const allScopedExpenses = selectedScopeExpenses;

    if (intent === 'deep_analysis' && !activeAiKey) {
      setAssistantError('AI key belum diatur. Tambahkan dulu di Settings > AI Provider.');
      return;
    }

    const scopeMonths = getScopeMonthsCount(insightScope, allScopedExpenses, viewYear);
    const scaledPersonalBudget = personalMonthlyBudget ? personalMonthlyBudget * scopeMonths : undefined;
    const scaledFamilySupportBudget = familySupportMonthlyBudget ? familySupportMonthlyBudget * scopeMonths : undefined;

    const dataHash = `${allScopedExpenses.length}-${allScopedExpenses.reduce((s, e) => s + e.amount, 0)}-${scaledPersonalBudget}-${scaledFamilySupportBudget}`;
    const cacheOwnerScope = getActiveDataScope();

    // Use scope-aware cache key for AI calls
    const scopeForCache: InsightScope = { ...insightScope, label: resolvedScopeLabel };
    if (intent === 'deep_analysis') {
      const cached = readCachedInsight(cacheOwnerScope, scopeForCache, intent, dataHash);
      if (cached) {
        setAssistantMessages((prev) => [
          ...prev,
          { id: uid('assistant'), role: 'assistant', variant: 'insight', insight: cached.insight },
        ]);
        return;
      }
    }

    if (intent === 'breakdown') {
      const breakdownExpenses = typeFilter === 'ALL' ? allScopedExpenses : allScopedExpenses.filter((e) => e.type === typeFilter);

      const groupsMap = new Map<string, BreakdownGroup>();
      for (const exp of breakdownExpenses) {
        const isTransfer = exp.type === 'TRANSFER';
        const categoryObj = categories.find((c) => c.slug === exp.category);
        const categoryLabel = isTransfer ? 'Transfer' : (categoryObj?.label || exp.category);

        if (!groupsMap.has(categoryLabel)) {
          groupsMap.set(categoryLabel, { categoryLabel, totalAmount: 0, items: [] });
        }

        const group = groupsMap.get(categoryLabel)!;
        group.totalAmount += toDisplay(exp);
        group.items.push({
          expense: exp,
          convertedAmount: toDisplay(exp),
        });
      }

      const groupsList = Array.from(groupsMap.values());
      groupsList.sort((a, b) => b.totalAmount - a.totalAmount);
      groupsList.forEach((g) => g.items.sort((a, b) => b.convertedAmount - a.convertedAmount));

      setAssistantMessages((prev) => [
        ...prev,
        { id: uid('assistant'), role: 'assistant', variant: 'breakdown', breakdown: groupsList },
      ]);
      haptic();
      return;
    }

    setIsGeneratingInsight(true);
    try {
      // Build scoped data
      const scopeSpendingExpenses = allScopedExpenses.filter((e) => e.type !== 'TRANSFER');
      const scopeTypeFiltered = typeFilter === 'ALL'
        ? scopeSpendingExpenses
        : allScopedExpenses.filter((e) => e.type === typeFilter);
      const scopeTransferTotal = allScopedExpenses
        .filter((e) => e.type === 'TRANSFER')
        .reduce((s, e) => s + toDisplay(e), 0);
      const scopeScopedTotal = scopeTypeFiltered.reduce((s, e) => s + toDisplay(e), 0);
      const scopeTopCategories = buildTopCategories(scopeTypeFiltered, categories, scopeScopedTotal, toDisplay);
      const scopeSplit = calcNeedsWantsSplit(
        scopeSpendingExpenses.map((e) => ({ ...e, amount: toDisplay(e) }))
      );
      const scopeFamilySupport = allScopedExpenses
        .filter((e) => e.type !== 'TRANSFER' && isFamilySupportExpense(e));
      const scopeFamilySupportTotal = sumDisplayedExpenses(scopeFamilySupport, toDisplay);
      const scopePersonalExpenses = scopeSpendingExpenses.filter((e) => !isFamilySupportExpense(e));
      const scopePersonalTotal = sumDisplayedExpenses(scopePersonalExpenses, toDisplay);
      const scopePersonalNeedsTotal = sumDisplayedExpenses(
        scopePersonalExpenses.filter((e) => e.type === 'NEED'), toDisplay
      );
      const scopePersonalWantsTotal = sumDisplayedExpenses(
        scopePersonalExpenses.filter((e) => e.type === 'WANT'), toDisplay
      );

      // Previous period
      const previousExpenses = getPreviousExpensesForScope(expenses, insightScope, viewYear, viewMonth);
      const prevTypeFiltered = typeFilter === 'ALL'
        ? previousExpenses.filter((e) => e.type !== 'TRANSFER')
        : previousExpenses.filter((e) => e.type === typeFilter);
      const scopePreviousScopedTotal = prevTypeFiltered.reduce((s, e) => s + toDisplay(e), 0);

      let insight: HistoryInsightResponse;

      if (intent === 'combined') {
        // Build personal top categories for better evaluation (excl keluarga)
        const scopePersonalTopCategories = buildTopCategories(
          scopeTypeFiltered, categories, scopeScopedTotal, toDisplay, ['keluarga']
        );
        insight = buildCombinedInsight({
          scopeLabel: resolvedScopeLabel,
          currency,
          scopedExpenses: scopeTypeFiltered,
          scopedTotal: scopeScopedTotal,
          transferTotal: scopeTransferTotal,
          previousScopedTotal: scopePreviousScopedTotal,
          topCategories: scopeTopCategories,
          personalTopCategories: scopePersonalTopCategories,
          split: scopeSplit,
          filterLabel,
          familySupportTotal: scopeFamilySupportTotal,
          personalTotal: scopePersonalTotal,
          personalNeedsTotal: scopePersonalNeedsTotal,
          personalWantsTotal: scopePersonalWantsTotal,
          personalBudget: scaledPersonalBudget,
          familySupportBudget: scaledFamilySupportBudget,
        });
      } else {
        // deep_analysis — AI-powered
        const aiResult = await generateExpenseInsight(
          {
            intent: 'deep_analysis',
            context: {
              monthLabel: resolvedScopeLabel,
              currency,
              filterLabel,
              scope: {
                type: insightScope.type === 'pick_month' ? 'month' : insightScope.type as 'month' | 'range' | 'year' | 'all',
                label: resolvedScopeLabel,
                totalDays: computeScopeTotalDays(insightScope, viewYear, viewMonth),
              },
              totals: {
                spending: scopeScopedTotal,
                transfers: scopeTransferTotal,
                transactionCount: scopeTypeFiltered.length,
                needs: scopeSplit.needs,
                wants: scopeSplit.wants,
                needsPct: scopeSplit.needsPct,
                wantsPct: scopeSplit.wantsPct,
              },
              familySupport: {
                total: scopeFamilySupportTotal,
                personalTotal: scopePersonalTotal,
                personalNeedsTotal: scopePersonalNeedsTotal,
                personalWantsTotal: scopePersonalWantsTotal,
                familySupportBudget: scaledFamilySupportBudget,
                personalBudget: scaledPersonalBudget,
              },
              previousMonth: {
                monthLabel: 'Periode sebelumnya',
                spending: scopePreviousScopedTotal,
                delta: scopeScopedTotal - scopePreviousScopedTotal,
                deltaPct: scopePreviousScopedTotal > 0
                  ? Math.round(((scopeScopedTotal - scopePreviousScopedTotal) / scopePreviousScopedTotal) * 100)
                  : null,
              },
              topCategories: scopeTopCategories.map((item) => ({
                slug: item.label.toLowerCase().replace(/\s+/g, '-'),
                label: item.label,
                amount: item.amount,
                pct: item.pct,
              })),
              // Personal top categories (excl keluarga) for AI evaluation
              personalTopCategories: buildTopCategories(
                scopeTypeFiltered, categories, scopeScopedTotal, toDisplay, ['keluarga']
              ).map((item) => ({
                label: item.label,
                amount: item.amount,
                pct: item.pct,
              })),
              // Personal Need/Want ratio (excl keluarga)
              personalNeedWantRatio: (scopePersonalNeedsTotal + scopePersonalWantsTotal) > 0 ? {
                needsPct: Math.round((scopePersonalNeedsTotal / (scopePersonalNeedsTotal + scopePersonalWantsTotal)) * 100),
                wantsPct: Math.round((scopePersonalWantsTotal / (scopePersonalNeedsTotal + scopePersonalWantsTotal)) * 100),
                needsTotal: scopePersonalNeedsTotal,
                wantsTotal: scopePersonalWantsTotal,
              } : undefined,
              recurringExpenses: allScopedExpenses
                .filter((expense) => expense.is_recurring)
                .map((expense) => ({
                  name: expense.name,
                  amount: toDisplay(expense),
                  type: expense.type,
                  category: expense.category,
                })),
              transactions: scopeTypeFiltered.map((expense) => ({
                date: expense.date,
                name: expense.name,
                amount: toDisplay(expense),
                currency,
                type: expense.type,
                category: expense.category,
                destination: expense.destination,
                note: expense.note,
              })),
            },
          },
          {
            provider: aiProvider,
            apiKey: activeAiKey,
            openrouterModel,
          }
        );
        insight = {
          title: aiResult.title,
          summary: aiResult.summary,
          highlights: aiResult.highlights,
          actions: aiResult.actions,
        };
      }

      if (intent === 'deep_analysis') {
        writeCachedInsight(cacheOwnerScope, scopeForCache, intent, promptLabel, insight, dataHash);
      }

      setAssistantMessages((prev) => [
        ...prev,
        { id: uid('assistant'), role: 'assistant', variant: 'insight', insight },
      ]);
      haptic();
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : 'Gagal membuat insight.');
    } finally {
      setIsGeneratingInsight(false);
    }
  }, [
    setAssistantOpen,
    currency,
    expenses,
    viewYear,
    viewMonth,
    insightScope,
    selectedScopeExpenses,
    hasSelectedScopeData,
    resolvedScopeLabel,
    activeAiKey,
    aiProvider,
    openrouterModel,
    typeFilter,
    categories,
    filterLabel,
    personalMonthlyBudget,
    familySupportMonthlyBudget,
    toDisplay,
  ]);

  const TYPE_FILTERS: { value: TypeFilter; label: string; color: string }[] = [
    { value: 'ALL', label: 'Semua', color: '#F5F0E8' },
    { value: 'NEED', label: 'Need', color: '#5B9CF6' },
    { value: 'WANT', label: 'Want', color: '#F472B6' },
    { value: 'TRANSFER', label: 'Transfer', color: '#FB923C' },
  ];
  const activeTypeFilterColor = TYPE_FILTERS.find((item) => item.value === typeFilter)?.color ?? '#F5F0E8';
  const insightActionColorMap: Record<InsightIntent, string> = {
    combined: '#F5F0E8',
    breakdown: '#B8F55A',
    deep_analysis: '#FB923C',
  };
  const insightCompactYears = Array.from({ length: 10 }, (_, i) => viewYear - 5 + i);


  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto w-full">
      {/* ── Sticky filter bar ─────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b-2 flex-shrink-0" style={{ backgroundColor: '#1A1A1A', borderColor: '#F5F0E8' }}>
        {/* Month navigator */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b-4 sm:px-4 sm:py-3" style={{ borderColor: '#3A3A3A' }}>
          <button
            onClick={prevMonth}
            disabled={isAllHistoryMode}
            className="neo-btn neo-btn-primary p-2 min-w-[40px] min-h-[40px] sm:min-w-[44px] sm:min-h-[44px] flex items-center justify-center"
            style={isAllHistoryMode ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            aria-label="Bulan sebelumnya"
          >
            <ChevronLeft size={18} strokeWidth={2.5} />
          </button>
          <div className="text-center flex-1 mx-2">
            <p className="text-sm font-black uppercase tracking-wide leading-tight">{historyHeaderLabel}</p>
            {viewMode === 'flow' ? (
              <>
                <p className="text-[11px] font-bold text-brutal-black/50 mt-0.5">
                  {flowActiveCatStats.count} transaksi
                  <span className="hidden xs:inline"> · {formatCurrency(flowActiveCatStats.total, currency)}</span>
                </p>
                <p className="text-[11px] font-bold text-brutal-black/50 xs:hidden">
                  {formatCurrency(flowActiveCatStats.total, currency)}
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] font-bold text-brutal-black/50 mt-0.5">
                  {filtered.length} transaksi
                  <span className="hidden xs:inline"> · {formatCurrency(monthTotal, currency)}</span>
                </p>
                <p className="text-[11px] font-bold text-brutal-black/50 xs:hidden">
                  {formatCurrency(monthTotal, currency)}
                </p>
              </>
            )}
          </div>
          <button
            onClick={nextMonth}
            disabled={isAllHistoryMode}
            className="neo-btn neo-btn-primary p-2 min-w-[40px] min-h-[40px] sm:min-w-[44px] sm:min-h-[44px] flex items-center justify-center"
            style={isAllHistoryMode ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            aria-label="Bulan berikutnya"
          >
            <ChevronRight size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Type filter chips */}
        {/* Type filter chips + FLOW button */}
        <div className="flex gap-2 px-3 pt-2.5 pb-2 border-b-2 overflow-x-auto sm:px-4" style={{ borderColor: '#3A3A3A' }}>
          {TYPE_FILTERS.map((f) => {
            const isActive = typeFilter === f.value && viewMode === 'list';
            return (
              <button
                key={f.value}
                onClick={() => {
                  setTypeFilter(f.value);
                  setViewMode('list');
                  if (f.value === 'TRANSFER') {
                    setCatFilter(new Set());
                  }
                }}
                className="shrink-0 flex items-center justify-center gap-1.5 px-2.5 py-1 border-2 font-black uppercase text-xs tracking-wider transition-all duration-150 active:translate-y-0.5 active:translate-x-0.5"
                style={{
                  borderColor: isActive ? f.color : '#555555',
                  color: isActive ? f.color : '#A09890',
                  boxShadow: isActive ? `3px 3px 0px 0px ${f.color}` : 'none',
                  backgroundColor: isActive ? '#1A1A1A' : 'transparent',
                }}
              >
                {f.label}
              </button>
            );
          })}
          <button
            onClick={() => setViewMode(viewMode === 'flow' ? 'list' : 'flow')}
            className="shrink-0 flex items-center justify-center gap-1.5 px-2.5 py-1 border-2 font-black uppercase text-xs tracking-wider transition-all duration-150 active:translate-y-0.5 active:translate-x-0.5"
            style={{
              borderColor: viewMode === 'flow' ? '#F87171' : '#555555',
              color: viewMode === 'flow' ? '#F87171' : '#A09890',
              boxShadow: viewMode === 'flow' ? '3px 3px 0px 0px #F87171' : 'none',
              backgroundColor: viewMode === 'flow' ? '#1A1A1A' : 'transparent',
            }}
          >
            Flow
          </button>
        </div>

        {/* Category filter + Search — only shown in list mode */}
        {viewMode === 'list' && (
          <>
            {/* Category Filter Drawer */}
            {availableCategories.length > 0 && (
              <div className="border-b-4" style={{ borderColor: '#3A3A3A' }}>
                <button
                  type="button"
                  onClick={() => setCatFilterOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 sm:px-4 transition-colors duration-150"
                  style={{ backgroundColor: 'transparent' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(245,240,232,0.05)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  aria-expanded={catFilterOpen}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-brutal-black/60">
                    Filter Kategori
                    {catFilter.size > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 text-brutal-yellow text-[9px] font-black">
                        {catFilter.size} dipilih
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {catFilter.size > 0 && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(ev) => { ev.stopPropagation(); setCatFilter(new Set()); }}
                        onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); setCatFilter(new Set()); } }}
                        className="text-[10px] font-bold text-red-500 underline"
                      >
                        Reset
                      </span>
                    )}
                    <ChevronDown
                      size={14}
                      strokeWidth={2.5}
                      className="text-brutal-black/50 transition-transform duration-200"
                      style={{ transform: catFilterOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    />
                  </div>
                </button>
                {catFilterOpen && (
                  <div className="flex flex-wrap gap-1.5 px-3 pb-2.5 pt-1 sm:px-4">
                    {availableCategories.map((cat) => (
                      <button
                        key={cat.slug}
                        onClick={() => toggleCat(cat.slug)}
                        className="shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs font-bold border-[3px] transition-all duration-150 min-h-[28px]"
                        style={catFilter.has(cat.slug)
                          ? { borderColor: '#F5F0E8', backgroundColor: '#F5F0E8', color: '#1A1A1A' }
                          : { borderColor: '#3A3A3A', backgroundColor: '#2A2820', color: '#F5F0E8' }
                        }
                      >
                        <span>{cat.emoji}</span>
                        <span>{cat.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="px-3 py-2 relative sm:px-4">
              <Search size={15} strokeWidth={2.5} className="absolute left-6 top-1/2 -translate-y-1/2 text-brutal-black/40 pointer-events-none sm:left-7" />
              <input
                type="search"
                placeholder="Cari pengeluaran..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="neo-input h-[42px] pl-9 pr-10 placeholder:text-[13px]"
                style={{ fontSize: '16px' }}
                aria-label="Cari transaksi"
              />
              <button
                type="button"
                onClick={() => setSearchScope((current) => current === 'month' ? 'all' : 'month')}
                className="absolute right-5 top-1/2 -translate-y-1/2 h-[28px] min-w-[28px] px-1.5 rounded-full flex items-center justify-center transition-all duration-150 sm:right-6"
                style={{
                  backgroundColor: searchScope === 'all' ? 'rgba(245,240,232,0.16)' : 'rgba(245,240,232,0.08)',
                  color: searchScope === 'all' ? '#F5F0E8' : 'rgba(245,240,232,0.75)',
                  boxShadow: searchScope === 'all'
                    ? 'inset 0 0 0 1px rgba(245,240,232,0.08)'
                    : 'inset 0 0 0 1px rgba(245,240,232,0.04)',
                }}
                aria-label={searchScope === 'all' ? 'Mode pencarian semua transaksi' : 'Mode pencarian bulan aktif'}
                aria-pressed={searchScope === 'all'}
                title={searchScope === 'all' ? 'Semua transaksi' : 'Bulan aktif'}
              >
                {searchScope === 'all' ? <History size={13} strokeWidth={2.5} /> : <CalendarDays size={13} strokeWidth={2.5} />}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Scrollable content area (scrollbar starts here, below sticky header) ── */}
      <div ref={listScrollContainerRef} className="flex-1 overflow-y-auto">

      {/* ── Flow view (Sankey diagram) ──────────────────── */}
      {viewMode === 'flow' && (
        <div className="py-5 md:py-6 px-2 md:px-4">
          <div className="flex justify-between items-center mb-3 px-1 md:px-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-brutal-black/40">
              Pengeluaran
            </p>
            <p className="text-[10px] font-black uppercase tracking-widest text-brutal-black/40">
              Kategori
            </p>
          </div>
          <SankeyChart
            expenses={flowExpenses}
            height={Math.max(560, new Set(flowExpenses.map(e => e.category)).size * 80)}
            onCatDoubleClick={(slug) => {
              setCatFilter(new Set([slug]));
              setTypeFilter('ALL');
              setViewMode('list');
            }}
          />
        </div>
      )}

      {/* ── Expense list ──────────────────────────────────── */}
      {viewMode === 'list' && (
        <div className="flex-1 section-pad">
          {!isAllHistoryMode && (
            <div
              className="neo-card mb-4 overflow-hidden"
              style={{ boxShadow: `3px 3px 0px 0px ${activeTypeFilterColor}` }}
            >
              <button
                type="button"
                onClick={() => setIsQuickInsightExpanded((value) => !value)}
                className="w-full flex items-start justify-between gap-2 px-3.5 py-2 text-left transition-colors duration-150 hover:bg-brutal-bone/5"
                aria-expanded={isQuickInsightExpanded}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brutal-black/55">
                      Insight Cepat
                    </p>
                  </div>
                </div>
                <ChevronDown
                  size={16}
                  strokeWidth={2.5}
                  className="shrink-0 mt-px text-brutal-black/55 transition-transform duration-200"
                  style={{ transform: isQuickInsightExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>

              {isQuickInsightExpanded && (
                <div className="border-t-2 border-[#3A3A3A] px-3.5 py-2">
                  <p className="text-[13px] font-bold leading-[1.35]">
                    {quickInsightLine}
                  </p>
                </div>
              )}
            </div>
          )}

          {dateKeys.length === 0 ? (
            <div className="neo-card p-8 text-center mt-4">
              <PackageOpen size={40} strokeWidth={1.5} className="mx-auto mb-3 text-brutal-black/30" />
              <p className="font-black uppercase text-brutal-black/50">Tidak ada pengeluaran</p>
              <p className="text-sm text-brutal-black/40 font-medium mt-1">
                {isAllHistoryMode && !normalizedSearch
                  ? 'Ketik kata kunci untuk mencari di semua transaksi.'
                  : search
                    ? 'Coba kata kunci lain'
                    : 'Tidak ada pengeluaran yang cocok dengan filter ini.'}
              </p>
            </div>
          ) : (
            shouldVirtualizeHistory ? (
              <div className="relative" style={{ height: `${virtualLayout.totalHeight}px` }}>
                {historyRows
                  .slice(virtualVisibleRange.startIndex, virtualVisibleRange.endIndex + 1)
                  .map((row, localIndex) => {
                    const absoluteIndex = virtualVisibleRange.startIndex + localIndex;
                    const nextRow = historyRows[absoluteIndex + 1];
                    const spacingStyle = row.kind === 'date'
                      ? { paddingTop: absoluteIndex === 0 ? 0 : 20 }
                      : { paddingBottom: nextRow?.kind === 'expense' ? 8 : 0 };

                    return (
                      <div
                        key={row.key}
                        ref={(node) => measureVirtualRow(row.key, node)}
                        className="absolute left-0 right-0"
                        style={{
                          top: virtualLayout.offsets[absoluteIndex],
                          ...spacingStyle,
                        }}
                      >
                        {renderHistoryRow(row)}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="space-y-5">
                {dateKeys.map((dateKey) => {
                  const dayExpenses = grouped[dateKey] ?? [];
                  const dayTotal = dayExpenses
                    .filter((expense) => (typeFilter === 'TRANSFER' ? true : expense.type !== 'TRANSFER'))
                    .reduce((sum, expense) => sum + toDisplay(expense), 0);

                  return (
                    <div key={dateKey}>
                      {renderHistoryRow({ kind: 'date', key: `date-${dateKey}`, dateKey, dayTotal })}
                      <div className="space-y-2">
                        {dayExpenses.map((expense) => (
                          <div key={expense.id}>
                            {renderHistoryRow({ kind: 'expense', key: `expense-${expense.id}`, expense })}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}
      {/* Mobile bottom nav spacer — keeps content clear of the fixed bottom nav/FAB */}
      <div
        className="md:hidden flex-shrink-0"
        style={{ height: 'calc(76px + env(safe-area-inset-bottom, 0px))' }}
        aria-hidden="true"
      />

      </div>{/* end scrollable content */}

      <BottomSheet
        isOpen={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        title="Insight Pengeluaran"
        description={`Analisis untuk: ${resolvedScopeLabel}`}
        panelClassName="history-insight-sheet flex flex-col h-[90dvh] lg:h-auto !overflow-hidden sm:max-w-4xl"
        contentClassName="flex-1 flex flex-col min-h-0 overflow-hidden"
      >
        <div className="flex flex-col flex-1 min-h-0 lg:grid lg:grid-cols-[minmax(0,1.6fr)_320px] gap-3 lg:gap-4 lg:space-y-0">
          <div className="neo-card !bg-[#111111] [box-shadow:3px_3px_0px_0px_#746C62] overflow-hidden min-w-0 flex-1 flex flex-col">
            <div className="overflow-y-auto px-4 py-4 space-y-3 flex-1 lg:max-h-[62vh]">
              {!hasSelectedScopeData && (
                <div className="border-2 border-dashed border-[#3A3A3A] bg-[#161616] p-4">
                  <p className="text-sm font-black uppercase tracking-wide text-brutal-black/55">
                    Belum ada data untuk scope ini
                  </p>
                  <p className="mt-1 text-sm leading-6 text-brutal-bone-dim">
                    Pilih scope yang punya transaksi, lalu insight bisa merangkum pola pengeluaran untuk periode tersebut.
                  </p>
                </div>
              )}

              {assistantMessages.map((message) => (
                <div
                  key={message.id}
                  className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  {message.variant === 'insight' ? (
                    <div className="w-full max-w-[92%] border-2 border-[#3A3A3A] bg-[#1D1D1D] p-3 brutal-shadow-sm">
                      <p className="text-xs font-black uppercase tracking-wider text-brutal-yellow mb-1">
                        {message.insight.title}
                      </p>
                      <p className="text-sm font-medium leading-6">
                        {message.insight.summary}
                      </p>

                      {message.insight.highlights.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          <p className="text-[11px] font-black uppercase tracking-wider text-brutal-black/50">
                            Highlights
                          </p>
                          {message.insight.highlights.map((item, index) => (
                            <p key={index} className="text-sm leading-5 text-brutal-white">
                              • {item}
                            </p>
                          ))}
                        </div>
                      )}

                      {message.insight.actions.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          <p className="text-[11px] font-black uppercase tracking-wider text-brutal-black/50">
                            Aksi
                          </p>
                          {message.insight.actions.map((item, index) => (
                            <p key={index} className="text-sm leading-5 text-brutal-white">
                              • {item}
                            </p>
                          ))}
                        </div>
                      )}

                    </div>
                  ) : message.variant === 'breakdown' ? (
                    <div className="w-full max-w-full space-y-4">
                      {message.breakdown.map((group, gIndex) => (
                        <div key={gIndex} className="neo-card !bg-[#1D1D1D] !p-0 overflow-hidden border-2 border-[#3A3A3A]">
                          <div className="bg-[#262626] border-b-2 border-[#3A3A3A] px-3 py-2 flex items-center justify-between">
                            <h3 className="text-sm font-black text-brutal-white uppercase tracking-wider">{group.categoryLabel}</h3>
                            <span className="text-sm font-black text-brutal-yellow">{formatCurrency(group.totalAmount, currency)}</span>
                          </div>
                          <div className="divide-y-2 divide-[#3A3A3A]">
                            {group.items.map((item, iIndex) => (
                              <div key={iIndex} className="p-3 bg-[#111111] hover:bg-[#1A1A1A] transition-colors">
                                <div className="flex justify-between items-start gap-4">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <span className={`inline-flex shrink-0 items-center justify-center px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest border rounded-sm bg-transparent ${item.expense.type === 'NEED'
                                        ? 'text-[#3B82F6] border-[#3B82F6]'
                                        : item.expense.type === 'WANT'
                                          ? 'text-[#EC4899] border-[#EC4899]'
                                          : 'text-[#FB923C] border-[#FB923C]'
                                        }`}>
                                        {item.expense.type}
                                      </span>
                                      <p className="text-sm font-bold text-brutal-white truncate">{item.expense.name}</p>
                                    </div>
                                    {item.expense.note && (
                                      <p className="text-[10px] text-brutal-black/50 italic truncate">{item.expense.note}</p>
                                    )}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-sm font-black text-brutal-white">{formatCurrency(item.convertedAmount, currency)}</p>
                                    <p className="text-[10px] text-brutal-black/50 font-bold uppercase mt-1">{item.expense.date.substring(8, 10)}/{item.expense.date.substring(5, 7)}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className={`max-w-[88%] p-3 ${message.role === 'user'
                        ? 'bg-[#B8F55A] text-[#1A1A1A] border-[#F5F0E8] font-bold'
                        : 'bg-[#181818] text-[#F5F0E8] border-[#3A3A3A]'
                        }`}
                    >
                      <p className="text-sm leading-5">{message.content}</p>
                    </div>
                  )}
                </div>
              ))}

              {isGeneratingInsight && (
                <div className="flex justify-start">
                  <div className="border-2 border-[#3A3A3A] bg-[#181818] px-3 py-2 text-sm font-medium">
                    Sedang menyusun insight...
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:gap-4 shrink-0">
            {/* ── Scope Selector ──────────────────────────── */}
            <div className="neo-card !bg-[#181818] [box-shadow:3px_3px_0px_0px_#746C62] p-2.5 lg:p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <CalendarRange strokeWidth={2.5} className="text-brutal-yellow shrink-0 w-[12px] h-[12px] lg:w-[14px] lg:h-[14px]" />
                  <p className="text-[9px] lg:text-[10px] font-black uppercase tracking-[0.18em] text-brutal-black/55">
                    Periode
                  </p>
                </div>
                <p className="text-[9px] lg:text-[10px] font-bold text-brutal-white/40 truncate text-right">
                  {resolvedScopeLabel}
                </p>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {SCOPE_OPTIONS.map((opt) => {
                  const isActive = insightScope.type === opt.type;
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => {
                        if (opt.type === 'pick_month') {
                          setInsightScope({
                            type: 'pick_month',
                            label: '',
                            year: viewYear,
                            month: viewMonth,
                          });
                        } else if (opt.type === 'range') {
                          setInsightScope({
                            type: 'range',
                            label: '',
                            fromYear: viewYear,
                            fromMonth: 1,
                            toYear: viewYear,
                            toMonth: viewMonth,
                          });
                        } else if (opt.type === 'year') {
                          setInsightScope({
                            type: 'year',
                            label: '',
                            year: viewYear,
                          });
                        } else {
                          setInsightScope({ type: 'all', label: 'Semua' });
                        }
                      }}
                      className="min-h-[38px] px-1 py-1 flex items-center justify-center text-center text-[8px] sm:text-[9px] font-black uppercase leading-[1.05] tracking-[0.08em] border-2 transition-all duration-150 active:translate-y-0.5 active:translate-x-0.5"
                      style={{
                        borderColor: isActive ? opt.color : '#555555',
                        color: isActive ? opt.color : '#A09890',
                        boxShadow: isActive ? `3px 3px 0px 0px ${opt.color}` : 'none',
                        backgroundColor: isActive ? '#1A1A1A' : 'transparent',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* Conditional pickers */}
              {insightScope.type === 'pick_month' && (
                <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
                  <select
                    value={insightScope.month ?? viewMonth}
                    onChange={(e) => setInsightScope((s) => ({ ...s, month: Number(e.target.value) }))}
                    className="neo-input !py-1 !px-1.5 !text-[10px] min-w-0"
                    style={{ fontSize: '16px' }}
                  >
                    {SCOPE_MONTH_NAMES_COMPACT.map((name, i) => (
                      <option key={i} value={i + 1}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={insightScope.year ?? viewYear}
                    onChange={(e) => setInsightScope((s) => ({ ...s, year: Number(e.target.value) }))}
                    className="neo-input !py-1 !px-1.5 !text-[10px] min-w-0"
                    style={{ fontSize: '16px' }}
                  >
                    {insightCompactYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              )}

              {insightScope.type === 'range' && (
                <div className="grid grid-cols-[minmax(0,1fr)_78px_minmax(0,1fr)_78px] gap-2">
                  <select
                    value={insightScope.fromMonth ?? 1}
                    onChange={(e) => setInsightScope((s) => ({ ...s, fromMonth: Number(e.target.value) }))}
                    className="neo-input !py-1 !px-1.5 !text-[10px] min-w-0"
                    style={{ fontSize: '16px' }}
                  >
                    {SCOPE_MONTH_NAMES_COMPACT.map((name, i) => (
                      <option key={i} value={i + 1}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={insightScope.fromYear ?? viewYear}
                    onChange={(e) => setInsightScope((s) => ({ ...s, fromYear: Number(e.target.value) }))}
                    className="neo-input !py-1 !px-1.5 !text-[10px] min-w-0"
                    style={{ fontSize: '16px' }}
                  >
                    {insightCompactYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <select
                    value={insightScope.toMonth ?? 12}
                    onChange={(e) => setInsightScope((s) => ({ ...s, toMonth: Number(e.target.value) }))}
                    className="neo-input !py-1 !px-1.5 !text-[10px] min-w-0"
                    style={{ fontSize: '16px' }}
                  >
                    {SCOPE_MONTH_NAMES_COMPACT.map((name, i) => (
                      <option key={i} value={i + 1}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={insightScope.toYear ?? viewYear}
                    onChange={(e) => setInsightScope((s) => ({ ...s, toYear: Number(e.target.value) }))}
                    className="neo-input !py-1 !px-1.5 !text-[10px] min-w-0"
                    style={{ fontSize: '16px' }}
                  >
                    {insightCompactYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              )}

              {insightScope.type === 'year' && (
                <div className="grid grid-cols-1">
                  <select
                    value={insightScope.year ?? viewYear}
                    onChange={(e) => setInsightScope((s) => ({ ...s, year: Number(e.target.value) }))}
                    className="neo-input !py-1 !px-1.5 !text-[10px] w-full"
                    style={{ fontSize: '16px' }}
                  >
                    {insightCompactYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                (() => {
                  const accentColor = insightActionColorMap[prompt.intent];
                  return (
                    <button
                      key={prompt.intent}
                      type="button"
                      onClick={() => void runInsight(prompt.intent, prompt.label)}
                      disabled={isGeneratingInsight}
                      className="min-h-[46px] px-1.5 py-1 flex flex-col items-center justify-center gap-0.5 border-2 font-black uppercase text-[7px] sm:text-[8px] leading-[1.05] tracking-[0.1em] text-center transition-all duration-150 shadow-none [border-color:var(--insight-idle)] [color:var(--insight-idle)] active:translate-y-0.5 active:translate-x-0.5 active:[border-color:var(--insight-accent)] active:[color:var(--insight-accent)] active:[box-shadow:3px_3px_0px_0px_var(--insight-accent)] disabled:opacity-50"
                      style={{
                        '--insight-accent': accentColor,
                        '--insight-idle': '#A09890',
                      } as React.CSSProperties & {
                        '--insight-accent': string;
                        '--insight-idle': string;
                      }}
                    >
                      <span className="shrink-0">{prompt.icon}</span>
                      <span>{prompt.label}</span>
                    </button>
                  );
                })()
              ))}
            </div>

            {assistantError && (
              <div className="neo-card !bg-[#2A1515] p-3">
                <p className="text-xs font-bold text-red-300">
                  {assistantError}
                </p>
              </div>
            )}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};

export default HistoryPage;
