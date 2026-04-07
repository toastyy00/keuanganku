import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  PackageOpen,
  ChevronDown,
  Sparkles,
  Bot,
  ScanSearch,
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
  buildSummaryInsight,
  buildTopCategories,
  buildTransactionInsight,
  getInsightFilterLabel,
  getPreviousScopedExpenses,
  getScopedExpenses,
  isFamilySupportExpense,
  sumDisplayedExpenses,
  type HistoryInsightResponse,
  type HistoryInsightIntent,
  type HistoryInsightCategory,
} from '../lib/historyInsights';
import type { ExpenseType, Expense } from '../types';

// ============================================================
//  HISTORY PAGE
// ============================================================

type TypeFilter = 'ALL' | ExpenseType;
type InsightIntent = HistoryInsightIntent | 'deep_analysis';

type AssistantMessage =
  | { id: string; role: 'assistant'; variant: 'intro'; content: string }
  | { id: string; role: 'user'; variant: 'prompt'; content: string }
  | { id: string; role: 'assistant'; variant: 'insight'; insight: HistoryInsightResponse };

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
  { intent: 'summary', label: 'Ringkas bulan ini', icon: <Sparkles size={14} strokeWidth={2.5} /> },
  { intent: 'transaction_insights', label: 'Insight transaksi', icon: <ScanSearch size={14} strokeWidth={2.5} /> },
  { intent: 'deep_analysis', label: 'Analisis Mendalam (AI)', icon: <Bot size={14} strokeWidth={2.5} /> },
];

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function insightCacheKey(monthPrefix: string, intent: InsightIntent): string {
  return `expense-rule-insight:${monthPrefix}:${intent}`;
}

function readCachedInsight(
  monthPrefix: string,
  intent: InsightIntent
): CachedInsightEntry | null {
  try {
    const raw = localStorage.getItem(insightCacheKey(monthPrefix, intent));
    if (!raw) return null;
    return JSON.parse(raw) as CachedInsightEntry;
  } catch {
    return null;
  }
}

function writeCachedInsight(
  monthPrefix: string,
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
      insightCacheKey(monthPrefix, intent),
      JSON.stringify(payload)
    );
  } catch {
    // Ignore cache failures; AI feature should still work without persistence.
  }
}

function introMessage(monthText: string): AssistantMessage {
  return {
    id: uid('assistant'),
    role: 'assistant',
    variant: 'intro',
    content: `Saya bisa bantu merangkum ${monthText} atau membaca pola transaksi yang paling menonjol di bulan ini.`,
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

  useEffect(() => { 
    loadExpenses(); 
    getExchangeRate().then((res) => setRateInfo(res));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const transferTotal = useMemo(
    () => monthExpenses
      .filter((e) => e.type === 'TRANSFER')
      .reduce((s, e) => s + toDisplay(e), 0),
    [monthExpenses, toDisplay]
  );
  const split = useMemo(() => {
    const converted = spendingMonthExpenses.map((expense) => ({
      ...expense,
      amount: toDisplay(expense),
    }));
    return calcNeedsWantsSplit(converted);
  }, [spendingMonthExpenses, toDisplay]);
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
  const personalNeedsTotal = useMemo(
    () => sumDisplayedExpenses(personalExpenses.filter((expense) => expense.type === 'NEED'), toDisplay),
    [personalExpenses, toDisplay]
  );
  const personalWantsTotal = useMemo(
    () => sumDisplayedExpenses(personalExpenses.filter((expense) => expense.type === 'WANT'), toDisplay),
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
    setAssistantMessages([introMessage(monthLabelStr)]);
    setAssistantError(null);
  }, [monthLabelStr]);

  const runInsight = useCallback(async (
    intent: InsightIntent,
    promptLabel: string
  ) => {
    setAssistantOpen(true);
    setAssistantError(null);
    setAssistantMessages((prev) => [
      ...prev,
      { id: uid('user'), role: 'user', variant: 'prompt', content: promptLabel },
    ]);

    if (!hasMonthData) {
      setAssistantError('Belum ada transaksi di bulan ini, jadi insight belum bisa dibuat.');
      return;
    }

    if (intent === 'deep_analysis' && !activeAiKey) {
      setAssistantError('AI key belum diatur. Tambahkan dulu di Settings > AI Provider.');
      return;
    }

    const cached = readCachedInsight(monthPrefix, intent);
    if (cached) {
      setAssistantMessages((prev) => [
        ...prev,
        { id: uid('assistant'), role: 'assistant', variant: 'insight', insight: cached.insight },
      ]);
      return;
    }

    setIsGeneratingInsight(true);
    try {
      const insight: HistoryInsightResponse = intent === 'summary'
        ? buildSummaryInsight({
            monthLabelStr,
            currency,
            scopedExpenses: scopedMonthExpenses,
            scopedTotal,
            transferTotal,
            previousScopedTotal,
            topCategories,
            split,
            filterLabel,
            familySupportTotal,
            personalTotal,
            personalNeedsTotal,
            personalWantsTotal,
            personalBudget: personalMonthlyBudget,
            familySupportBudget: familySupportMonthlyBudget,
          })
        : intent === 'transaction_insights'
          ? buildTransactionInsight({
              monthLabelStr,
              currency,
              scopedExpenses: scopedMonthExpenses,
              scopedTotal,
              topCategories,
              filterLabel,
            })
          : await generateExpenseInsight(
              {
                intent: 'deep_analysis',
                context: {
                  monthLabel: monthLabelStr,
                  currency,
                  filterLabel,
                  totals: {
                    spending: scopedTotal,
                    transfers: transferTotal,
                    transactionCount: scopedMonthExpenses.length,
                    needs: split.needs,
                    wants: split.wants,
                    needsPct: split.needsPct,
                    wantsPct: split.wantsPct,
                  },
                  familySupport: {
                    total: familySupportTotal,
                    personalTotal,
                    personalNeedsTotal,
                    personalWantsTotal,
                    familySupportBudget: familySupportMonthlyBudget || undefined,
                    personalBudget: personalMonthlyBudget || undefined,
                  },
                  previousMonth: {
                    monthLabel: 'Bulan lalu',
                    spending: previousScopedTotal,
                    delta: scopedTotal - previousScopedTotal,
                    deltaPct: previousScopedTotal > 0
                      ? Math.round(((scopedTotal - previousScopedTotal) / previousScopedTotal) * 100)
                      : null,
                  },
                  topCategories: topCategories.map((item) => ({
                    slug: item.label.toLowerCase().replace(/\s+/g, '-'),
                    label: item.label,
                    amount: item.amount,
                    pct: item.pct,
                  })),
                  recurringExpenses: monthExpenses
                    .filter((expense) => expense.is_recurring)
                    .map((expense) => ({
                      name: expense.name,
                      amount: toDisplay(expense),
                      type: expense.type,
                      category: expense.category,
                    })),
                  recentTransactions: scopedMonthExpenses.slice(0, 8).map((expense) => ({
                    date: expense.date,
                    name: expense.name,
                    amount: toDisplay(expense),
                    type: expense.type,
                    category: expense.category,
                    note: expense.note,
                  })),
                  transactions: scopedMonthExpenses.map((expense) => ({
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
            ).then((aiInsight) => ({
              title: aiInsight.title,
              summary: aiInsight.summary,
              highlights: aiInsight.highlights,
              actions: aiInsight.actions,
            }));

      writeCachedInsight(monthPrefix, intent, promptLabel, insight);

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
    hasMonthData,
    activeAiKey,
    aiProvider,
    monthPrefix,
    monthExpenses,
    monthLabelStr,
    openrouterModel,
    previousScopedTotal,
    scopedMonthExpenses,
    scopedTotal,
    split.needs,
    split.needsPct,
    split.wants,
    split.wantsPct,
    topCategories,
    transferTotal,
    filterLabel,
    familySupportTotal,
    personalNeedsTotal,
    personalTotal,
    personalWantsTotal,
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
                                {e.type === 'TRANSFER' ? '💸' : (cat?.emoji ?? '📦')}
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
        className="fixed bottom-24 right-4 z-30 w-14 h-14 rounded-full border-4 flex items-center justify-center transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0.5 sm:right-6"
        style={{
          backgroundColor: '#0F0F0F',
          borderColor: '#F5F0E8',
          boxShadow: '4px 4px 0px 0px #000000',
          color: '#B8F55A',
        }}
        aria-label={`Buka insight untuk ${monthLabelStr}`}
      >
        <Bot size={24} strokeWidth={2.5} />
      </button>

      <BottomSheet
        isOpen={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        title="Insight Pengeluaran"
        description={`Bacaan cepat untuk ${monthLabelStr}`}
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
            <div className="grid gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt.intent}
                  type="button"
                  onClick={() => void runInsight(prompt.intent, prompt.label)}
                  disabled={isGeneratingInsight || !hasMonthData}
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
