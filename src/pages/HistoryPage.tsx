import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
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

export interface BreakdownItem {
  expense: Expense;
  convertedAmount: number;
}

export interface BreakdownGroup {
  categoryLabel: string;
  totalAmount: number;
  items: BreakdownItem[];
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

function haptic() { if ('vibrate' in navigator) navigator.vibrate(10); }

function longDate(isoDate: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(isoDate + 'T00:00:00'));
}

const QUICK_PROMPTS: Array<{ intent: InsightIntent; label: string; icon: React.ReactNode }> = [
  { intent: 'combined', label: 'Ringkas & Analisis', icon: <Sparkles size={14} strokeWidth={2.5} /> },
  { intent: 'breakdown', label: 'Breakdown', icon: <Layers size={14} strokeWidth={2.5} /> },
  { intent: 'deep_analysis', label: 'Analisis AI', icon: <Bot size={14} strokeWidth={2.5} /> },
];

const SCOPE_OPTIONS: Array<{ type: InsightScopeType; label: string }> = [
  { type: 'month', label: 'Bulan aktif' },
  { type: 'pick_month', label: 'Pilih bulan' },
  { type: 'range', label: 'Rentang' },
  { type: 'year', label: 'Tahun' },
  { type: 'all', label: 'Semua' },
];

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function insightCacheKey(scope: InsightScope, intent: InsightIntent): string {
  return `expense-rule-insight:${scope.type}:${scope.label}:${intent}`;
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

function getScopeMonthsCount(scope: InsightScope, expenses: Expense[], viewYear: number, viewMonth: number): number {
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
  scope: InsightScope,
  intent: InsightIntent
): CachedInsightEntry | null {
  try {
    const raw = localStorage.getItem(insightCacheKey(scope, intent));
    if (!raw) return null;
    return JSON.parse(raw) as CachedInsightEntry;
  } catch {
    return null;
  }
}

function writeCachedInsight(
  scope: InsightScope,
  intent: InsightIntent,
  promptLabel: string,
  insight: HistoryInsightResponse
): void {
  try {
    const payload: CachedInsightEntry = {
      storedAt: new Date().toISOString(),
      intent,
      promptLabel,
      insight,
    };
    localStorage.setItem(
      insightCacheKey(scope, intent),
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
    document.title = 'Riwayat — Keuanganku';
    return () => { document.title = 'Keuanganku'; };
  }, []);

  const { expenses, categories, currency, deleteExpense, loadExpenses } = useExpenseStore();
  const { setActiveExpense } = useUIStore();
  const {
    aiProvider,
    openaiKey,
    openrouterKey,
    openrouterModel,
    personalMonthlyBudget,
    familySupportMonthlyBudget,
  } = useSettingsStore();
  const activeAiKey = aiProvider === 'openai' ? openaiKey : openrouterKey;

  const { activeYear: viewYear, activeMonth: viewMonth, prevMonth, nextMonth } = useUIStore();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [catFilter, setCatFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [catFilterOpen, setCatFilterOpen] = useState(false);
  const [rateInfo, setRateInfo] = useState<RateResult>({ rate: 16000, isFallback: true });
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [isQuickInsightExpanded, setIsQuickInsightExpanded] = useState(false);

  // ── Insight scope state ──────────────────────────────────
  const [insightScope, setInsightScope] = useState<InsightScope>({
    type: 'month',
    label: '',
  });

  useEffect(() => {
    loadExpenses();
    getExchangeRate().then((res) => setRateInfo(res));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const location = useLocation();
  useEffect(() => {
    if (location.state?.categorySlug) {
      setCatFilter(new Set([location.state.categorySlug]));
      // Clean up the state so it doesn't persist on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const toDisplay = useCallback(
    (exp: Expense) => convertAmount(exp.amount, exp.currency, currency, rateInfo.rate),
    [currency, rateInfo.rate]
  );

  const monthPrefix = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;
  const monthLabelStr = new Intl.DateTimeFormat('id-ID', {
    month: 'long', year: 'numeric',
  }).format(new Date(viewYear, viewMonth - 1, 1));
  const previousMonthDate = useMemo(() => new Date(viewYear, viewMonth - 2, 1), [viewYear, viewMonth]);
  const previousMonthPrefix = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}`;

  // Resolve scope label (reactive)
  const resolvedScopeLabel = useMemo(
    () => buildScopeLabel(insightScope, viewYear, viewMonth),
    [insightScope, viewYear, viewMonth]
  );

  // Reset scope when active month changes
  useEffect(() => {
    setInsightScope({ type: 'month', label: monthLabelStr });
  }, [viewYear, viewMonth, monthLabelStr]);

  // Filtered
  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (!e.date.startsWith(monthPrefix)) return false;
      if (typeFilter !== 'ALL' && e.type !== typeFilter) return false;
      if (catFilter.size > 0 && !catFilter.has(e.category)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchDest = (e.destination ?? '').toLowerCase().includes(q);
        if (!e.name.toLowerCase().includes(q) && !(e.note ?? '').toLowerCase().includes(q) && !matchDest) return false;
      }
      return true;
    });
  }, [expenses, monthPrefix, typeFilter, catFilter, search]);

  const grouped = useMemo(() => groupExpensesByDate(filtered), [filtered]);
  const dateKeys = Object.keys(grouped);
  const monthExpenses = useMemo(
    () => expenses.filter((e) => e.date.startsWith(monthPrefix)),
    [expenses, monthPrefix]
  );
  const spendingMonthExpenses = useMemo(
    () => monthExpenses.filter((e) => e.type !== 'TRANSFER'),
    [monthExpenses]
  );
  const previousMonthExpenses = useMemo(
    () => expenses.filter((e) => e.date.startsWith(previousMonthPrefix) && e.type !== 'TRANSFER'),
    [expenses, previousMonthPrefix]
  );
  const hasMonthData = monthExpenses.length > 0;

  const toggleCat = (slug: string) => {
    setCatFilter((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    haptic();
    await deleteExpense(id);
    setDeletingId(null);
  };

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
  const filterLabel = getInsightFilterLabel(typeFilter);
  const quickInsightLine = useMemo(() => buildQuickInsightLine({
    filterLabel,
    currency,
    scopedExpenses: scopedMonthExpenses,
    scopedTotal,
    topCategories,
    previousScopedTotal,
    familySupportTotal,
    personalTotal,
    personalBudget: personalMonthlyBudget,
  }), [filterLabel, currency, scopedMonthExpenses, scopedTotal, topCategories, previousScopedTotal, familySupportTotal, personalTotal, personalMonthlyBudget]);
  useEffect(() => {
    setAssistantMessages([introMessage(resolvedScopeLabel)]);
    setAssistantError(null);
  }, [resolvedScopeLabel]);

  const runInsight = useCallback(async (
    intent: InsightIntent,
    promptLabel: string
  ) => {
    setAssistantOpen(true);
    setAssistantError(null);
    setAssistantMessages((prev) => [
      ...prev,
      { id: uid('user'), role: 'user', variant: 'prompt', content: `${promptLabel} — ${resolvedScopeLabel}` },
    ]);

    // Resolve scoped expenses for the selected scope
    const allScopedExpenses = getExpensesForScope(expenses, insightScope, viewYear, viewMonth);
    const hasScopeData = allScopedExpenses.length > 0;

    if (!hasScopeData) {
      setAssistantError('Belum ada transaksi di periode ini, jadi insight belum bisa dibuat.');
      return;
    }

    if (intent === 'deep_analysis' && !activeAiKey) {
      setAssistantError('AI key belum diatur. Tambahkan dulu di Settings > AI Provider.');
      return;
    }

    // Use scope-aware cache key
    const scopeForCache: InsightScope = { ...insightScope, label: resolvedScopeLabel };
    if (intent !== 'breakdown') {
      const cached = readCachedInsight(scopeForCache, intent);
      if (cached) {
        setAssistantMessages((prev) => [
          ...prev,
          { id: uid('assistant'), role: 'assistant', variant: 'insight', insight: cached.insight },
        ]);
        return;
      }
    }

    const scopeMonths = getScopeMonthsCount(insightScope, allScopedExpenses, viewYear, viewMonth);
    const scaledPersonalBudget = personalMonthlyBudget ? personalMonthlyBudget * scopeMonths : undefined;
    const scaledFamilySupportBudget = familySupportMonthlyBudget ? familySupportMonthlyBudget * scopeMonths : undefined;

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
      groupsList.sort((a,b) => b.totalAmount - a.totalAmount);
      groupsList.forEach((g) => g.items.sort((a,b) => b.convertedAmount - a.convertedAmount));

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
        insight = buildCombinedInsight({
          scopeLabel: resolvedScopeLabel,
          currency,
          scopedExpenses: scopeTypeFiltered,
          scopedTotal: scopeScopedTotal,
          transferTotal: scopeTransferTotal,
          previousScopedTotal: scopePreviousScopedTotal,
          topCategories: scopeTopCategories,
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

      writeCachedInsight(scopeForCache, intent, promptLabel, insight);

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
    currency,
    expenses,
    viewYear,
    viewMonth,
    insightScope,
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

  const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
    { value: 'ALL', label: 'Semua' },
    { value: 'NEED', label: 'NEED' },
    { value: 'WANT', label: 'WANT' },
    { value: 'TRANSFER', label: 'TRANSFER' },
  ];


  return (
    <div className="flex flex-col min-h-full max-w-2xl mx-auto w-full">
      {/* ── Sticky filter bar ─────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b-4" style={{ backgroundColor: '#1A1A1A', borderColor: '#F5F0E8' }}>
        {/* Month navigator */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b-4 sm:px-4 sm:py-3" style={{ borderColor: '#3A3A3A' }}>
          <button
            onClick={prevMonth}
            className="neo-btn neo-btn-primary p-2 min-w-[40px] min-h-[40px] sm:min-w-[44px] sm:min-h-[44px] flex items-center justify-center"
            aria-label="Bulan sebelumnya"
          >
            <ChevronLeft size={18} strokeWidth={2.5} />
          </button>
          <div className="text-center flex-1 mx-2">
            <p className="text-sm font-black uppercase tracking-wide leading-tight">{monthLabelStr}</p>
            <p className="text-[11px] font-bold text-brutal-black/50 mt-0.5">
              {filtered.length} transaksi
              <span className="hidden xs:inline"> · {formatCurrency(monthTotal, currency)}</span>
            </p>
            <p className="text-[11px] font-bold text-brutal-black/50 xs:hidden">
              {formatCurrency(monthTotal, currency)}
            </p>
          </div>
          <button
            onClick={nextMonth}
            className="neo-btn neo-btn-primary p-2 min-w-[40px] min-h-[40px] sm:min-w-[44px] sm:min-h-[44px] flex items-center justify-center"
            aria-label="Bulan berikutnya"
          >
            <ChevronRight size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Type filter pills — always in a single scroll row */}
        <div className="flex gap-1.5 px-3 pt-2.5 pb-1.5 border-b-2 overflow-x-auto sm:px-4" style={{ borderColor: '#3A3A3A' }}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`shrink-0 px-3 py-1 text-xs font-bold uppercase tracking-wider border-[3px] transition-all duration-150 min-h-[34px] ${typeFilter === f.value
                ? 'text-[#1A1A1A]'
                : ''
                }`}
              style={typeFilter === f.value
                ? { borderColor: '#F5F0E8', backgroundColor: f.value === 'ALL' ? '#F5F0E8' : f.value === 'NEED' ? '#5B9CF6' : f.value === 'WANT' ? '#F472B6' : '#FBBF24', color: f.value === 'TRANSFER' ? '#1A1A1A' : f.value === 'ALL' ? '#1A1A1A' : '#fff' }
                : { borderColor: '#3A3A3A', backgroundColor: '#2A2820' }
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Category filter — collapsible section */}
        <div className="border-b-4" style={{ borderColor: '#3A3A3A' }}>
          {/* Header row with toggle */}
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

          {/* Expandable pills */}
          {catFilterOpen && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2.5 pt-1 sm:px-4">
              {categories.map((cat) => (
                <button
                  key={cat.slug}
                  onClick={() => toggleCat(cat.slug)}
                  className={`shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-bold border-[3px] transition-all duration-150 min-h-[32px]`}
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

        {/* Search */}
        <div className="px-3 py-2.5 relative sm:px-4">
          <Search size={16} strokeWidth={2.5} className="absolute left-6 top-1/2 -translate-y-1/2 text-brutal-black/40 pointer-events-none sm:left-7" />
          <input
            type="search"
            placeholder="Cari transaksi..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="neo-input pl-9"
            style={{ fontSize: '16px' }}
            aria-label="Cari transaksi"
          />
        </div>
      </div>

      {/* ── Expense list ──────────────────────────────────── */}
      <div className="flex-1 section-pad pb-24">
        <div className="neo-card mb-4 overflow-hidden">
          <button
            type="button"
            onClick={() => setIsQuickInsightExpanded((value) => !value)}
            className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-brutal-bone/5"
            aria-expanded={isQuickInsightExpanded}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brutal-black/55">
                  Insight Cepat
                </p>
                <div className="shrink-0 px-2 py-0.5 border-2 border-[#555555] text-[10px] font-black uppercase leading-none">
                  {filterLabel}
                </div>
              </div>
            </div>
            <ChevronDown
              size={16}
              strokeWidth={2.5}
              className="shrink-0 mt-0.5 text-brutal-black/55 transition-transform duration-200"
              style={{ transform: isQuickInsightExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
          </button>

          {isQuickInsightExpanded && (
            <div className="border-t-2 border-[#3A3A3A] px-4 py-3">
              <p className="text-sm font-bold leading-6">
                {quickInsightLine}
              </p>
            </div>
          )}
        </div>

        {dateKeys.length === 0 ? (
          <div className="neo-card p-8 text-center mt-4">
            <PackageOpen size={40} strokeWidth={1.5} className="mx-auto mb-3 text-brutal-black/30" />
            <p className="font-black uppercase text-brutal-black/50">Tidak ada transaksi</p>
            <p className="text-sm text-brutal-black/40 font-medium mt-1">
              {search ? 'Coba kata kunci lain' : 'Tidak ada transaksi yang cocok dengan filter ini.'}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {dateKeys.map((dateKey) => {
              const dayExpenses = grouped[dateKey];
              const dayTotal = dayExpenses
                .filter((e) => typeFilter === 'TRANSFER' ? true : e.type !== 'TRANSFER')
                .reduce((s, e) => s + toDisplay(e), 0);

              return (
                <div key={dateKey}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-black uppercase text-brutal-black/60 capitalize">
                      {longDate(dateKey)}
                    </p>
                    <p className="text-xs font-black text-brutal-black/60">
                      {formatCurrency(dayTotal, currency)}
                    </p>
                  </div>

                  <div className="space-y-2">
                    {dayExpenses.map((e) => {
                      const cat = categories.find((c) => c.slug === e.category);
                      const isDeleting = deletingId === e.id;
                      const badgeVariant = e.type === 'NEED' ? 'need' : e.type === 'WANT' ? 'want' : 'transfer';

                      return (
                        <div key={e.id} className="neo-card overflow-hidden">
                          {isDeleting ? (
                            <div className="flex items-center gap-3 p-3 bg-red-500">
                              <p className="flex-1 text-sm font-bold text-white uppercase">
                                Hapus "{e.name}"?
                              </p>
                              <button
                                onClick={() => handleDelete(e.id)}
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
                            <button
                              onClick={() => setActiveExpense(e.id)}
                              className="w-full flex items-center gap-3 p-3 text-left transition-all duration-150"
                              style={{ color: '#F5F0E8' }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(245,240,232,0.05)')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                            >
                              <span className="text-2xl w-9 shrink-0 text-center">
                                {e.type === 'TRANSFER' ? '💸' : (cat?.emoji ?? '🛍️')}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold truncate leading-tight">{e.name}</p>
                                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                  <Badge variant={badgeVariant} size="sm">{e.type}</Badge>
                                  {e.type === 'TRANSFER' && e.destination ? (
                                    <span className="text-[10px] text-brutal-black/50 font-medium">→ {e.destination}</span>
                                  ) : (
                                    <Badge variant="neutral" size="sm">
                                      {cat?.emoji} {cat?.label ?? e.category}
                                    </Badge>
                                  )}
                                  {e.note && (
                                    <span className="text-[10px] text-brutal-black/40 italic truncate max-w-[100px]">
                                      {e.note}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <p className="text-sm font-black">{formatCurrency(e.amount, e.currency)}</p>
                                <button
                                  onClick={(ev) => { ev.stopPropagation(); haptic(); setDeletingId(e.id); }}
                                  className="p-2 text-brutal-black/40 hover:text-red-500 hover:bg-red-50 transition-colors duration-150 min-w-[36px] min-h-[36px] flex items-center justify-center"
                                  aria-label={`Hapus ${e.name}`}
                                >
                                  <Trash2 size={16} strokeWidth={2.5} />
                                </button>
                              </div>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => { setAssistantOpen(true); haptic(); }}
        className="fixed z-50 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] right-5 md:bottom-8 md:right-8 neo-btn neo-btn-primary w-16 h-16 rounded-full p-0 flex items-center justify-center"
        aria-label={`Buka insight untuk ${monthLabelStr}`}
      >
        <Bot size={28} strokeWidth={2.5} aria-hidden="true" />
      </button>

      <BottomSheet
        isOpen={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        title="Insight Pengeluaran"
        description={`Analisis untuk: ${resolvedScopeLabel}`}
        panelClassName="history-insight-sheet sm:max-w-4xl"
      >
        <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1.6fr)_320px] lg:gap-4 lg:space-y-0">
          <div className="neo-card !bg-[#111111] overflow-hidden min-w-0">
            <div className="max-h-[44vh] lg:max-h-[62vh] overflow-y-auto px-4 py-4 space-y-3">
              {!hasMonthData && (
                <div className="border-2 border-dashed border-[#3A3A3A] bg-[#161616] p-4">
                  <p className="text-sm font-black uppercase tracking-wide text-brutal-black/55">
                    Belum ada data bulan ini
                  </p>
                  <p className="mt-1 text-sm leading-6 text-brutal-bone-dim">
                    Pilih bulan yang punya transaksi dulu, lalu saya bisa bantu merangkum atau membaca pola transaksi di bulan itu.
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
                                      <span className={`inline-flex shrink-0 items-center justify-center px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest border rounded-sm bg-transparent ${
                                        item.expense.type === 'NEED' 
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
                      className={`max-w-[88%] border-2 p-3 ${message.role === 'user'
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

          <div className="space-y-4">
            {/* ── Scope Selector ──────────────────────────── */}
            <div className="neo-card !bg-[#181818] p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <CalendarRange size={14} strokeWidth={2.5} className="text-brutal-yellow shrink-0" />
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brutal-black/55">
                    Scope
                  </p>
                </div>
                <p className="text-[10px] font-bold text-brutal-white/40 truncate text-right">
                  {resolvedScopeLabel}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {SCOPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => {
                      if (opt.type === 'month') {
                        setInsightScope({ type: 'month', label: monthLabelStr });
                      } else if (opt.type === 'pick_month') {
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
                    className={`px-2 py-1.5 text-[10px] font-black uppercase tracking-wider border-2 transition-all duration-150 ${opt.type === 'all' ? 'col-span-2' : ''}`}
                    style={insightScope.type === opt.type
                      ? { borderColor: '#B8F55A', backgroundColor: '#B8F55A', color: '#1A1A1A' }
                      : { borderColor: '#3A3A3A', backgroundColor: '#222222' }
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Conditional pickers */}
              {insightScope.type === 'pick_month' && (
                <div className="flex gap-1.5">
                  <select
                    value={insightScope.month ?? viewMonth}
                    onChange={(e) => setInsightScope((s) => ({ ...s, month: Number(e.target.value) }))}
                    className="neo-input !py-1 !px-2 !text-xs flex-1 min-w-0"
                    style={{ fontSize: '16px' }}
                  >
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i} value={i + 1}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={insightScope.year ?? viewYear}
                    onChange={(e) => setInsightScope((s) => ({ ...s, year: Number(e.target.value) }))}
                    className="neo-input !py-1 !px-2 !text-xs w-20 shrink-0"
                    style={{ fontSize: '16px' }}
                  >
                    {Array.from({ length: 10 }, (_, i) => viewYear - 5 + i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              )}

              {insightScope.type === 'range' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-brutal-black/40">Dari</span>
                    <div className="flex gap-1.5">
                      <select
                        value={insightScope.fromMonth ?? 1}
                        onChange={(e) => setInsightScope((s) => ({ ...s, fromMonth: Number(e.target.value) }))}
                        className="neo-input !py-1 !px-1.5 !text-xs flex-1 min-w-0"
                        style={{ fontSize: '16px' }}
                      >
                        {MONTH_NAMES.map((name, i) => (
                          <option key={i} value={i + 1}>{name}</option>
                        ))}
                      </select>
                      <select
                        value={insightScope.fromYear ?? viewYear}
                        onChange={(e) => setInsightScope((s) => ({ ...s, fromYear: Number(e.target.value) }))}
                        className="neo-input !py-1 !px-1.5 !text-xs w-16 shrink-0"
                        style={{ fontSize: '16px' }}
                      >
                        {Array.from({ length: 10 }, (_, i) => viewYear - 5 + i).map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-brutal-black/40">Ke</span>
                    <div className="flex gap-1.5">
                      <select
                        value={insightScope.toMonth ?? 12}
                        onChange={(e) => setInsightScope((s) => ({ ...s, toMonth: Number(e.target.value) }))}
                        className="neo-input !py-1 !px-1.5 !text-xs flex-1 min-w-0"
                        style={{ fontSize: '16px' }}
                      >
                        {MONTH_NAMES.map((name, i) => (
                          <option key={i} value={i + 1}>{name}</option>
                        ))}
                      </select>
                      <select
                        value={insightScope.toYear ?? viewYear}
                        onChange={(e) => setInsightScope((s) => ({ ...s, toYear: Number(e.target.value) }))}
                        className="neo-input !py-1 !px-1.5 !text-xs w-16 shrink-0"
                        style={{ fontSize: '16px' }}
                      >
                        {Array.from({ length: 10 }, (_, i) => viewYear - 5 + i).map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {insightScope.type === 'year' && (
                <div className="flex gap-2">
                  <select
                    value={insightScope.year ?? viewYear}
                    onChange={(e) => setInsightScope((s) => ({ ...s, year: Number(e.target.value) }))}
                    className="neo-input !py-1 !px-2 !text-xs w-24"
                    style={{ fontSize: '16px' }}
                  >
                    {Array.from({ length: 10 }, (_, i) => viewYear - 5 + i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt.intent}
                  type="button"
                  onClick={() => void runInsight(prompt.intent, prompt.label)}
                  disabled={isGeneratingInsight}
                  className="inline-flex items-center justify-start gap-2 px-3 py-3 border-2 border-[#555555] bg-[#202020] text-xs font-black uppercase tracking-wide transition-all duration-150 hover:bg-[#2D2D2D] disabled:opacity-50"
                >
                  {prompt.icon}
                  {prompt.label}
                </button>
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
