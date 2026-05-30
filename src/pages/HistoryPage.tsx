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
  PencilLine,
} from 'lucide-react';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
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
type InsightActionFeedback = { intent: InsightIntent; state: 'loading' | 'done' | 'active' };
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

interface PendingDeleteEntry {
  expense: Expense;
  timeoutId: number;
  startedAt: number;
  deleteToken: number;
}

const HISTORY_VIRTUALIZE_THRESHOLD = 200;
const HISTORY_VIRTUAL_OVERSCAN_PX = 480;
const HISTORY_DELETE_UNDO_MS = 3_000;

function estimateHistoryRowHeight(
  row: HistoryListRow,
  deletingIds: Set<string>,
  pendingDeleteIds: Set<string>,
): number {
  if (row.kind === 'date') return 34;
  if (pendingDeleteIds.has(row.expense.id)) return 92;
  return deletingIds.has(row.expense.id) ? 72 : 92;
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

function getExpenseTypeLabel(type: ExpenseType): string {
  if (type === 'NEED') return 'Need';
  if (type === 'WANT') return 'Want';
  return 'Transfer';
}

function getExpenseTypeColor(type: ExpenseType): string {
  if (type === 'NEED') return '#3B82F6';
  if (type === 'WANT') return '#EC4899';
  return '#FB923C';
}

const QUICK_PROMPTS: Array<{ intent: InsightIntent; label: string; icon: React.ReactNode }> = [
  { intent: 'combined', label: 'Analisis', icon: <Sparkles size={16} strokeWidth={2.5} /> },
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
      return `${MONTH_NAMES[fm - 1]} ${fy} - ${MONTH_NAMES[tm - 1]} ${ty}`;
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

  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
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
  const [insightActionFeedback, setInsightActionFeedback] = useState<InsightActionFeedback | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [isQuickInsightExpanded, setIsQuickInsightExpanded] = useState(false);
  const [selectedSummaryExpenseId, setSelectedSummaryExpenseId] = useState<string | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Record<string, PendingDeleteEntry>>({});
  const listScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const [virtualRowHeights, setVirtualRowHeights] = useState<Record<string, number>>({});
  const pendingDeletesRef = useRef<Record<string, PendingDeleteEntry>>({});
  const deleteTokenSeqRef = useRef(0);
  const activeDeleteTokensRef = useRef<Record<string, number>>({});
  const previousFlowMonthPrefixRef = useRef<string | null>(null);
  const insightFeedbackTimeoutRef = useRef<number | null>(null);
  const summaryEditTimerRef = useRef<number | null>(null);

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
  useEffect(() => {
    if (previousFlowMonthPrefixRef.current === null) {
      previousFlowMonthPrefixRef.current = monthPrefix;
      return;
    }

    if (previousFlowMonthPrefixRef.current !== monthPrefix) {
      previousFlowMonthPrefixRef.current = monthPrefix;
      setSankeyHighlightedCat(null);
    }
  }, [monthPrefix, setSankeyHighlightedCat]);

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

  useEffect(() => {
    pendingDeletesRef.current = pendingDeletes;
  }, [pendingDeletes]);

  useEffect(() => {
    return () => {
      for (const entry of Object.values(pendingDeletesRef.current)) {
        window.clearTimeout(entry.timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (summaryEditTimerRef.current !== null) {
        window.clearTimeout(summaryEditTimerRef.current);
      }
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
  const selectedSummaryExpense = useMemo(
    () => selectedSummaryExpenseId
      ? expenses.find((expense) => expense.id === selectedSummaryExpenseId) ?? null
      : null,
    [expenses, selectedSummaryExpenseId]
  );
  const selectedSummaryCategory = selectedSummaryExpense
    ? categoryBySlug.get(selectedSummaryExpense.category) ?? null
    : null;

  useEffect(() => {
    if (selectedSummaryExpenseId && !selectedSummaryExpense) {
      setSelectedSummaryExpenseId(null);
    }
  }, [selectedSummaryExpenseId, selectedSummaryExpense]);

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
  const pendingDeleteIds = useMemo(() => new Set(Object.keys(pendingDeletes)), [pendingDeletes]);

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
      const height = virtualRowHeights[row.key] ?? estimateHistoryRowHeight(row, deletingIds, pendingDeleteIds);
      heights.push(height);
      runningTop += height;
    }

    return {
      offsets,
      heights,
      totalHeight: runningTop,
    };
  }, [historyRows, virtualRowHeights, deletingIds, pendingDeleteIds]);

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

  const startDeleteConfirm = useCallback((id: string) => {
    setDeletingIds((previous) => {
      if (previous.has(id)) return previous;
      const next = new Set(previous);
      next.add(id);
      return next;
    });
  }, []);

  const cancelDeleteConfirm = useCallback((id: string) => {
    setDeletingIds((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, []);

  const commitDelete = useCallback(async (id: string, deleteToken: number) => {
    if (activeDeleteTokensRef.current[id] !== deleteToken) return;
    delete activeDeleteTokensRef.current[id];

    setPendingDeletes((previous) => {
      const entry = previous[id];
      if (!entry || entry.deleteToken !== deleteToken) return previous;
      window.clearTimeout(entry.timeoutId);
      const next = { ...previous };
      delete next[id];
      return next;
    });

    try {
      await deleteExpense(id);
    } catch {
      // Store-level error handling already surfaces this state.
    }
  }, [deleteExpense]);

  const queueDeleteWithUndo = useCallback((expense: Expense) => {
    haptic();
    setDeletingIds((previous) => {
      if (!previous.has(expense.id)) return previous;
      const next = new Set(previous);
      next.delete(expense.id);
      return next;
    });
    const deleteToken = deleteTokenSeqRef.current + 1;
    deleteTokenSeqRef.current = deleteToken;
    activeDeleteTokensRef.current[expense.id] = deleteToken;

    setPendingDeletes((previous) => {
      const current = previous[expense.id];
      if (current) {
        window.clearTimeout(current.timeoutId);
      }

      const timeoutId = window.setTimeout(() => {
        void commitDelete(expense.id, deleteToken);
      }, HISTORY_DELETE_UNDO_MS);
      const startedAt = Date.now();

      return {
        ...previous,
        [expense.id]: {
          expense,
          timeoutId,
          startedAt,
          deleteToken,
        },
      };
    });
  }, [commitDelete]);

  const undoPendingDelete = useCallback((id: string) => {
    setPendingDeletes((previous) => {
      const entry = previous[id];
      if (!entry) return previous;
      window.clearTimeout(entry.timeoutId);
      if (activeDeleteTokensRef.current[id] === entry.deleteToken) {
        delete activeDeleteTokensRef.current[id];
      }
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    // Prevent stale "armed delete" state when list context changes.
    setDeletingIds(() => new Set());
  }, [viewYear, viewMonth, typeFilter, searchScope, search, catFilter, viewMode]);

  const openExpenseSummary = useCallback((id: string) => {
    setSelectedSummaryExpenseId(id);
  }, []);

  const closeExpenseSummary = useCallback(() => {
    setSelectedSummaryExpenseId(null);
  }, []);

  const editSelectedSummaryExpense = useCallback(() => {
    if (!selectedSummaryExpense) return;

    const expenseId = selectedSummaryExpense.id;
    setSelectedSummaryExpenseId(null);

    if (summaryEditTimerRef.current !== null) {
      window.clearTimeout(summaryEditTimerRef.current);
    }

    summaryEditTimerRef.current = window.setTimeout(() => {
      setActiveExpense(expenseId);
      summaryEditTimerRef.current = null;
    }, 210);
  }, [selectedSummaryExpense, setActiveExpense]);

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
    const isDeleting = deletingIds.has(expense.id);
    const pendingDelete = pendingDeletes[expense.id];
    const pendingElapsedMs = pendingDelete ? Math.max(0, Date.now() - pendingDelete.startedAt) : 0;
    const pendingAnimationDelayMs = Math.min(HISTORY_DELETE_UNDO_MS, pendingElapsedMs);
    const typeEmojiBg =
      expense.type === 'NEED'
        ? '#3B82F6'
        : expense.type === 'WANT'
          ? '#EC4899'
          : '#FB923C';
    const isDeleteState = Boolean(pendingDelete || isDeleting);
    const deleteStateCardStyle = pendingDelete
      ? { backgroundColor: '#EF4444', border: 'none' }
      : isDeleting
        ? { backgroundColor: '#EF4444', border: 'none' }
        : undefined;

    return (
      <div
        className={`neo-card overflow-hidden !shadow-[1.8px_1.8px_0_0_#fafefe99] ${isDeleteState
          ? 'transition-colors duration-150'
          : 'transition-[transform,box-shadow] duration-150 md:hover:-translate-y-0.5 md:hover:!shadow-[3px_4px_0_0_#fafefe99] active:translate-y-[4px] active:translate-x-[4px] active:!shadow-none md:active:!translate-y-[4px] md:active:!translate-x-[4px] md:active:!shadow-none'
          }`}
        style={deleteStateCardStyle}
      >
        {pendingDelete ? (
          <div className="relative flex items-center gap-3 p-3" style={{ backgroundColor: '#EF4444' }}>
            <span
              className="history-delete-card-fill"
              style={{
                animationDuration: `${HISTORY_DELETE_UNDO_MS}ms`,
                animationDelay: `-${pendingAnimationDelayMs}ms`,
              }}
              role="progressbar"
              aria-label={`Waktu urungkan hapus ${expense.name}`}
              aria-valuemin={0}
              aria-valuemax={HISTORY_DELETE_UNDO_MS}
              aria-valuenow={Math.max(0, HISTORY_DELETE_UNDO_MS - pendingElapsedMs)}
            />
            <p className="relative z-10 flex-1 text-sm font-bold text-brutal-black uppercase">
              Hapus "{expense.name}"?
            </p>
            <button
              onClick={() => undoPendingDelete(expense.id)}
              className="relative z-10 px-3 py-1.5 border-2 font-black text-xs uppercase min-h-[36px]"
              style={{ backgroundColor: '#EDE7DD', borderColor: '#EDE7DD', color: '#DC2626' }}
            >
              Undo
            </button>
          </div>
        ) : isDeleting ? (
          <div className="flex items-center gap-3 p-3" style={{ backgroundColor: '#EF4444' }}>
            <p className="flex-1 text-sm font-bold text-brutal-black uppercase">
              Hapus "{expense.name}"?
            </p>
            <button
              onClick={() => queueDeleteWithUndo(expense)}
              className="px-3 py-1.5 border-2 font-black text-xs uppercase min-h-[36px]"
              style={{ backgroundColor: '#B91C1C', color: '#FFFFFF', borderColor: '#B91C1C' }}
            >
              Hapus
            </button>
            <button
              onClick={() => cancelDeleteConfirm(expense.id)}
              className="px-3 py-1.5 border-2 font-black text-xs uppercase min-h-[36px]"
              style={{ backgroundColor: '#EDE7DD', color: '#DC2626', borderColor: '#EDE7DD' }}
            >
              Batal
            </button>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => openExpenseSummary(expense.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openExpenseSummary(expense.id);
              }
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 cursor-pointer md:hover:bg-[rgba(245,240,232,0.04)] active:bg-[rgba(245,240,232,0.06)]"
            style={{ color: '#F5F0E8' }}
          >
            <span
              className="text-[1.7rem] w-[38px] h-[38px] shrink-0 flex items-center justify-center rounded-[4px]"
              style={{
                background: `linear-gradient(rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.18)), ${typeEmojiBg}`,
                textShadow: [
                  '0 0.5px 0 rgba(255, 255, 255, 0.48)',
                  '0 1px 0 rgba(255, 255, 255, 0.22)',
                  '0 1.5px 1.5px rgba(0, 0, 0, 0.5)',
                  '0 3px 3px rgba(0, 0, 0, 0.32)',
                ].join(', '),
                filter: 'drop-shadow(0 1px 0 rgba(255,255,255,0.18)) drop-shadow(0 2px 2px rgba(0,0,0,0.35))',
              }}
            >
              {expense.type === 'TRANSFER' ? '\u{1F4B8}' : (cat?.emoji ?? '\u{1F6CD}\uFE0F')}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-sm font-bold truncate leading-tight">{expense.name}</p>
                {expense.type !== 'TRANSFER' && (
                  <span className="shrink-0 text-[10px] font-bold text-brutal-black/45 truncate">
                    {'\u00B7'} {cat?.label ?? expense.category}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5 min-w-0 flex-nowrap">
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
                onClick={(event) => { event.stopPropagation(); haptic(); startDeleteConfirm(expense.id); }}
                className="p-2 text-brutal-black/40 hover:text-red-50 hover:bg-red-500 active:text-red-50 active:bg-red-600 transition-colors duration-150 min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"
                aria-label={`Hapus ${expense.name}`}
              >
                <Trash2 size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }, [cancelDeleteConfirm, categoryBySlug, currency, deletingIds, openExpenseSummary, pendingDeletes, queueDeleteWithUndo, startDeleteConfirm, undoPendingDelete]);

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
  // Personal top categories - excluding keluarga for accurate personal evaluation
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

  useEffect(() => () => {
    if (insightFeedbackTimeoutRef.current) {
      window.clearTimeout(insightFeedbackTimeoutRef.current);
    }
  }, []);

  const clearInsightActionFeedback = useCallback(() => {
    if (insightFeedbackTimeoutRef.current) {
      window.clearTimeout(insightFeedbackTimeoutRef.current);
      insightFeedbackTimeoutRef.current = null;
    }
    setInsightActionFeedback(null);
  }, []);

  const markInsightActionDone = useCallback((intent: InsightIntent) => {
    if (insightFeedbackTimeoutRef.current) {
      window.clearTimeout(insightFeedbackTimeoutRef.current);
    }

    setInsightActionFeedback({ intent, state: 'done' });
    insightFeedbackTimeoutRef.current = window.setTimeout(() => {
      setInsightActionFeedback((current) => (
        current?.intent === intent && current.state === 'done'
          ? { intent, state: 'active' }
          : current
      ));
      insightFeedbackTimeoutRef.current = null;
    }, 700);
  }, []);

  const runInsight = useCallback(async (
    intent: InsightIntent,
    promptLabel: string
  ) => {
    setAssistantOpen(true);
    setAssistantError(null);
    clearInsightActionFeedback();
    setInsightActionFeedback({ intent, state: 'loading' });
    setAssistantMessages((prev) => [
      ...prev,
      { id: uid('user'), role: 'user', variant: 'prompt', content: `${promptLabel}: ${resolvedScopeLabel}` },
    ]);

    if (!hasSelectedScopeData) {
      setAssistantError('Belum ada transaksi di periode ini, jadi insight belum bisa dibuat.');
      clearInsightActionFeedback();
      return;
    }

    const allScopedExpenses = selectedScopeExpenses;

    if (intent === 'deep_analysis' && !activeAiKey) {
      setAssistantError('AI key belum diatur. Tambahkan dulu di Settings > AI Provider.');
      clearInsightActionFeedback();
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
        markInsightActionDone(intent);
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
      markInsightActionDone(intent);
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
        // deep_analysis - AI-powered
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
      markInsightActionDone(intent);
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : 'Gagal membuat insight.');
      clearInsightActionFeedback();
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
    clearInsightActionFeedback,
    markInsightActionDone,
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
  const activeInsightScopeIndex = Math.max(
    0,
    SCOPE_OPTIONS.findIndex((item) => item.type === insightScope.type)
  );
  const activeInsightScopeColor = SCOPE_OPTIONS[activeInsightScopeIndex]?.color ?? '#B8F55A';


  return (
    <div className="flex h-full min-h-0 w-full max-w-2xl flex-col mx-auto">
      {/* -- Sticky filter bar ------------------------------- */}
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
                  <span className="hidden xs:inline"> {'\u00B7'} {formatCurrency(flowActiveCatStats.total, currency)}</span>
                </p>
                <p className="text-[11px] font-bold text-brutal-black/50 xs:hidden">
                  {formatCurrency(flowActiveCatStats.total, currency)}
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] font-bold text-brutal-black/50 mt-0.5">
                  {filtered.length} transaksi
                  <span className="hidden xs:inline"> {'\u00B7'} {formatCurrency(monthTotal, currency)}</span>
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
                className="group relative isolate shrink-0 border-0 bg-transparent p-0 font-black uppercase text-xs tracking-wider"
                style={{
                  '--chip-accent': f.color,
                } as React.CSSProperties & { '--chip-accent': string }}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 -z-10 border-2 bg-[#1A1A1A] transition-opacity duration-150 ease-out ${
                    isActive ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{ borderColor: f.color }}
                />
                <span
                  className={`relative flex items-center justify-center gap-1.5 border-2 px-2.5 py-1 transition-[transform,border-color,color,background-color] duration-150 ease-out ${
                    isActive
                      ? '-translate-x-[3px] -translate-y-[3px] bg-[#1A1A1A] text-[var(--chip-accent)] border-[var(--chip-accent)] group-active:translate-x-0 group-active:translate-y-0'
                      : 'translate-x-0 translate-y-0 border-[#555555] bg-transparent text-[#A09890] group-active:-translate-x-0.5 group-active:-translate-y-0.5'
                  }`}
                >
                  {f.label}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => setViewMode('flow')}
            className="group relative isolate shrink-0 border-0 bg-transparent p-0 font-black uppercase text-xs tracking-wider"
            style={{
              '--chip-accent': '#2F8FA3',
            } as React.CSSProperties & { '--chip-accent': string }}
          >
            <span
              aria-hidden="true"
              className={`absolute inset-0 -z-10 border-2 bg-[#1A1A1A] transition-opacity duration-150 ease-out ${
                viewMode === 'flow' ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ borderColor: '#2F8FA3' }}
            />
            <span
              className={`relative flex items-center justify-center gap-1.5 border-2 px-2.5 py-1 transition-[transform,border-color,color,background-color] duration-150 ease-out ${
                viewMode === 'flow'
                  ? '-translate-x-[3px] -translate-y-[3px] bg-[#1A1A1A] text-[var(--chip-accent)] border-[var(--chip-accent)] group-active:translate-x-0 group-active:translate-y-0'
                  : 'translate-x-0 translate-y-0 border-[#555555] bg-transparent text-[#A09890] group-active:-translate-x-0.5 group-active:-translate-y-0.5'
              }`}
            >
              Flow
            </span>
          </button>
        </div>

        {/* Category filter + Search - only shown in list mode */}
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

      {/* -- Scrollable content area (scrollbar starts here, below sticky header) -- */}
      <div ref={listScrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">

        {/* -- Flow view (Sankey diagram) -------------------- */}
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

        {/* -- Expense list ------------------------------------ */}
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
        {/* Mobile bottom nav spacer - keeps content clear of the fixed bottom nav/FAB */}
        <div
          className="md:hidden flex-shrink-0"
          style={{ height: 'calc(76px + env(safe-area-inset-bottom, 0px))' }}
          aria-hidden="true"
        />

      </div>{/* end scrollable content */}

      <BottomSheet
        isOpen={Boolean(selectedSummaryExpense)}
        onClose={closeExpenseSummary}
        title="Ringkasan Pengeluaran"
        description={selectedSummaryExpense ? longDate(selectedSummaryExpense.date) : undefined}
        panelClassName="sm:max-w-md"
        containPageOverscroll
      >
        {selectedSummaryExpense && (
          <div className="space-y-4">
            <div
              className="overflow-hidden rounded-md border-2 border-[#3A3A3A] bg-[#151515]"
              style={{ boxShadow: `3px 3px 0 0 ${getExpenseTypeColor(selectedSummaryExpense.type)}` }}
            >
              <div className="flex items-start gap-3 border-b-2 border-[#3A3A3A] p-3">
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[6px] text-3xl"
                  style={{
                    backgroundColor: getExpenseTypeColor(selectedSummaryExpense.type),
                    textShadow: '0 2px 2px rgba(0,0,0,0.35)',
                  }}
                  aria-hidden="true"
                >
                  {selectedSummaryExpense.type === 'TRANSFER'
                    ? '\u{1F4B8}'
                    : (selectedSummaryCategory?.emoji ?? '\u{1F6CD}\uFE0F')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-brutal-black/45">
                    {getExpenseTypeLabel(selectedSummaryExpense.type)}
                  </p>
                  <h4 className="mt-1 text-lg font-black leading-tight text-brutal-white normal-case tracking-normal">
                    {selectedSummaryExpense.name}
                  </h4>
                </div>
              </div>

              <div className="p-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-brutal-black/45">
                  Nominal
                </p>
                <p className="mt-1 break-words text-3xl font-black leading-none text-brutal-yellow">
                  {formatCurrency(selectedSummaryExpense.amount, selectedSummaryExpense.currency)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border-2 border-[#3A3A3A] bg-[#181818] p-3">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-brutal-black/45">
                  {selectedSummaryExpense.type === 'TRANSFER' ? 'Tujuan' : 'Kategori'}
                </p>
                <p className="mt-1 text-sm font-bold leading-snug text-brutal-white">
                  {selectedSummaryExpense.type === 'TRANSFER'
                    ? (selectedSummaryExpense.destination || 'Tanpa tujuan')
                    : (selectedSummaryCategory?.label ?? (selectedSummaryExpense.category || 'Tanpa kategori'))}
                </p>
              </div>

              <div className="rounded-md border-2 border-[#3A3A3A] bg-[#181818] p-3">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-brutal-black/45">
                  Tanggal
                </p>
                <p className="mt-1 text-sm font-bold leading-snug text-brutal-white">
                  {longDate(selectedSummaryExpense.date)}
                </p>
              </div>

              <div className="rounded-md border-2 border-[#3A3A3A] bg-[#181818] p-3">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-brutal-black/45">
                  Recurring
                </p>
                <p className="mt-1 text-sm font-bold leading-snug text-brutal-white">
                  {selectedSummaryExpense.is_recurring ? 'Rutin' : 'Manual'}
                </p>
              </div>

              <div className="rounded-md border-2 border-[#3A3A3A] bg-[#181818] p-3">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-brutal-black/45">
                  Sync
                </p>
                <p className="mt-1 text-sm font-bold leading-snug text-brutal-white">
                  {selectedSummaryExpense.synced ? 'Tersinkron' : 'Belum sync'}
                </p>
              </div>
            </div>

            <div className="rounded-md border-2 border-[#3A3A3A] bg-[#181818] p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-brutal-black/45">
                Catatan
              </p>
              <p className={`mt-1 text-sm font-medium leading-6 ${selectedSummaryExpense.note ? 'text-brutal-white' : 'text-brutal-black/45 italic'}`}>
                {selectedSummaryExpense.note || 'Tidak ada catatan'}
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <Button variant="secondary" fullWidth onClick={closeExpenseSummary}>
                Tutup
              </Button>
              <Button
                variant="primary"
                fullWidth
                onClick={editSelectedSummaryExpense}
                leftIcon={<PencilLine size={16} strokeWidth={2.5} aria-hidden="true" />}
              >
                Edit
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>

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
                              {'\u2022'} {item}
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
                              {'\u2022'} {item}
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
                  <div className="w-full max-w-[92%] rounded-lg border border-[#F5F0E8]/10 bg-[#181818] px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full border-2 border-[#B8F55A]/25 border-t-[#B8F55A] animate-spin" />
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#F5F0E8]/55">
                        Menyiapkan hasil
                      </p>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      <div className="h-2 w-2/3 rounded-full bg-[#F5F0E8]/10 animate-pulse" />
                      <div className="h-2 w-5/6 rounded-full bg-[#F5F0E8]/5 animate-pulse" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:gap-4 shrink-0">
            {/* -- Scope Selector ---------------------------- */}
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

              <div className="relative grid w-full grid-cols-4 rounded-full bg-[#1B1B1B] p-1">
                <span
                  className="pointer-events-none absolute inset-y-1 left-1 rounded-full transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform"
                  style={{
                    width: 'calc((100% - 0.5rem) / 4)',
                    transform: `translateX(${activeInsightScopeIndex * 100}%)`,
                    backgroundColor: activeInsightScopeColor,
                  }}
                  aria-hidden="true"
                />
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
                      className={`relative z-10 min-h-[30px] rounded-full px-1 py-0.5 flex items-center justify-center text-center text-[10px] sm:text-[11px] font-black uppercase leading-none tracking-[0.06em] transition-colors duration-200 ${isActive ? 'text-[#1A1A1A]' : 'text-[#F5F0E8]/45 hover:text-[#F5F0E8]/75'}`}
                    >
                      <span className="inline-block min-w-[42px] text-center leading-none">
                        {opt.label}
                      </span>
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
                    className="neo-input !rounded-lg !py-1 !px-2 !text-[10px] min-w-0"
                    style={{ fontSize: '16px' }}
                  >
                    {SCOPE_MONTH_NAMES_COMPACT.map((name, i) => (
                      <option key={i} value={i + 1}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={insightScope.year ?? viewYear}
                    onChange={(e) => setInsightScope((s) => ({ ...s, year: Number(e.target.value) }))}
                    className="neo-input !rounded-lg !py-1 !px-2 !text-[10px] min-w-0"
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
                    className="neo-input !rounded-lg !py-1 !px-2 !text-[10px] min-w-0"
                    style={{ fontSize: '16px' }}
                  >
                    {SCOPE_MONTH_NAMES_COMPACT.map((name, i) => (
                      <option key={i} value={i + 1}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={insightScope.fromYear ?? viewYear}
                    onChange={(e) => setInsightScope((s) => ({ ...s, fromYear: Number(e.target.value) }))}
                    className="neo-input !rounded-lg !py-1 !px-2 !text-[10px] min-w-0"
                    style={{ fontSize: '16px' }}
                  >
                    {insightCompactYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <select
                    value={insightScope.toMonth ?? 12}
                    onChange={(e) => setInsightScope((s) => ({ ...s, toMonth: Number(e.target.value) }))}
                    className="neo-input !rounded-lg !py-1 !px-2 !text-[10px] min-w-0"
                    style={{ fontSize: '16px' }}
                  >
                    {SCOPE_MONTH_NAMES_COMPACT.map((name, i) => (
                      <option key={i} value={i + 1}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={insightScope.toYear ?? viewYear}
                    onChange={(e) => setInsightScope((s) => ({ ...s, toYear: Number(e.target.value) }))}
                    className="neo-input !rounded-lg !py-1 !px-2 !text-[10px] min-w-0"
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
                    className="neo-input !rounded-lg !py-1 !px-2 !text-[10px] w-full"
                    style={{ fontSize: '16px' }}
                  >
                    {insightCompactYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="relative grid grid-cols-3 rounded-full bg-[#1B1B1B] p-1">
                {QUICK_PROMPTS.map((prompt) => (
                  (() => {
                    const accentColor = insightActionColorMap[prompt.intent];
                    const feedbackState = insightActionFeedback?.intent === prompt.intent
                      ? insightActionFeedback.state
                      : null;
                    const isActionLoading = feedbackState === 'loading';
                    const isActionDone = feedbackState === 'done';
                    const isActionActive = isActionLoading || isActionDone || feedbackState === 'active';
                    const isAnyActionLoading = insightActionFeedback?.state === 'loading';
                    return (
                      <button
                        key={prompt.intent}
                        type="button"
                        onClick={() => void runInsight(prompt.intent, prompt.label)}
                        disabled={isGeneratingInsight || isAnyActionLoading}
                        aria-busy={isActionLoading}
                        className={`min-h-[42px] rounded-full px-2 py-1 flex flex-col items-center justify-center gap-0.5 font-black uppercase text-[7px] sm:text-[8px] leading-[1.05] tracking-[0.1em] text-center transition-[background-color,color,transform,opacity] duration-200 shadow-none [color:var(--insight-idle)] hover:[color:var(--insight-accent)] active:scale-[0.97] active:[background-color:var(--insight-accent)] active:!text-[#111111] disabled:cursor-not-allowed ${isActionActive ? '[background-color:var(--insight-accent)] !text-[#111111] opacity-100' : 'disabled:opacity-45'}`}
                        style={{
                          '--insight-accent': accentColor,
                          '--insight-idle': '#A09890',
                        } as React.CSSProperties & {
                          '--insight-accent': string;
                          '--insight-idle': string;
                        }}
                      >
                        <span className="shrink-0">
                          {isActionLoading ? (
                            <span className="block h-3.5 w-3.5 rounded-full border-2 border-[#111111]/30 border-t-[#111111] animate-spin" />
                          ) : (
                            prompt.icon
                          )}
                        </span>
                        <span>{isActionDone ? 'Selesai' : prompt.label}</span>
                      </button>
                    );
                  })()
                ))}
              </div>

              {insightActionFeedback && insightActionFeedback.state !== 'active' && (
                <p className="px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-[#F5F0E8]/35">
                  {insightActionFeedback.state === 'loading'
                    ? 'Menyiapkan hasil...'
                    : 'Hasil sudah ditambahkan'}
                </p>
              )}
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

