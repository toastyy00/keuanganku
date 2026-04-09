import type { Expense, ExpenseType } from '../types';
import { formatCurrency } from './utils';

// ============================================================
//  Types
// ============================================================

export type InsightScopeType = 'month' | 'pick_month' | 'range' | 'year' | 'all';

export interface InsightScope {
  type: InsightScopeType;
  /** Human label e.g. "April 2026", "Jan–Mar 2026", "2026", "Semua" */
  label: string;
  /** For 'pick_month': specific year */
  year?: number;
  /** For 'pick_month': specific month (1-12) */
  month?: number;
  /** For 'range': start year */
  fromYear?: number;
  /** For 'range': start month (1-12) */
  fromMonth?: number;
  /** For 'range': end year */
  toYear?: number;
  /** For 'range': end month (1-12) */
  toMonth?: number;
}

export type HistoryTypeFilter = 'ALL' | ExpenseType;

export interface HistoryInsightResponse {
  title: string;
  summary: string;
  highlights: string[];
  actions: string[];
}

export interface HistoryInsightCategory {
  label: string;
  amount: number;
  pct: number;
}

export interface HistoryInsightParams {
  scopeLabel: string;
  currency: 'IDR' | 'USD';
  scopedExpenses: Expense[];
  scopedTotal: number;
  transferTotal: number;
  previousScopedTotal: number;
  topCategories: HistoryInsightCategory[];
  split: { needs: number; wants: number; needsPct: number; wantsPct: number };
  filterLabel: string;
  familySupportTotal?: number;
  personalTotal?: number;
  personalNeedsTotal?: number;
  personalWantsTotal?: number;
  personalBudget?: number;
  familySupportBudget?: number;
}

// ============================================================
//  Scope helpers
// ============================================================

/** Filter the full expense list based on the selected insight scope. */
export function getExpensesForScope(
  expenses: Expense[],
  scope: InsightScope,
  activeYear: number,
  activeMonth: number
): Expense[] {
  switch (scope.type) {
    case 'month': {
      const prefix = `${activeYear}-${String(activeMonth).padStart(2, '0')}`;
      return expenses.filter((e) => e.date.startsWith(prefix));
    }
    case 'pick_month': {
      const y = scope.year ?? activeYear;
      const m = scope.month ?? activeMonth;
      const prefix = `${y}-${String(m).padStart(2, '0')}`;
      return expenses.filter((e) => e.date.startsWith(prefix));
    }
    case 'range': {
      const fy = scope.fromYear ?? activeYear;
      const fm = scope.fromMonth ?? 1;
      const ty = scope.toYear ?? activeYear;
      const tm = scope.toMonth ?? 12;
      const fromPrefix = `${fy}-${String(fm).padStart(2, '0')}`;
      const toPrefix = `${ty}-${String(tm).padStart(2, '0')}`;
      return expenses.filter((e) => {
        const monthStr = e.date.slice(0, 7);
        return monthStr >= fromPrefix && monthStr <= toPrefix;
      });
    }
    case 'year': {
      const y = scope.year ?? activeYear;
      const prefix = `${y}-`;
      return expenses.filter((e) => e.date.startsWith(prefix));
    }
    case 'all':
      return [...expenses];
    default:
      return expenses.filter((e) =>
        e.date.startsWith(`${activeYear}-${String(activeMonth).padStart(2, '0')}`)
      );
  }
}

/** Get the previous period's expenses for delta comparison. */
export function getPreviousExpensesForScope(
  expenses: Expense[],
  scope: InsightScope,
  activeYear: number,
  activeMonth: number
): Expense[] {
  switch (scope.type) {
    case 'month':
    case 'pick_month': {
      const y = scope.type === 'pick_month' ? (scope.year ?? activeYear) : activeYear;
      const m = scope.type === 'pick_month' ? (scope.month ?? activeMonth) : activeMonth;
      const prevDate = new Date(y, m - 2, 1);
      const prefix = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
      return expenses.filter((e) => e.date.startsWith(prefix));
    }
    case 'range': {
      const fy = scope.fromYear ?? activeYear;
      const fm = scope.fromMonth ?? 1;
      const ty = scope.toYear ?? activeYear;
      const tm = scope.toMonth ?? 12;
      // Range length in months
      const rangeMonths = (ty - fy) * 12 + (tm - fm) + 1;
      // Previous period = same length before the range start
      const prevEnd = new Date(fy, fm - 2, 1);
      const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth() - rangeMonths + 1, 1);
      const fromPrefix = `${prevStart.getFullYear()}-${String(prevStart.getMonth() + 1).padStart(2, '0')}`;
      const toPrefix = `${prevEnd.getFullYear()}-${String(prevEnd.getMonth() + 1).padStart(2, '0')}`;
      return expenses.filter((e) => {
        const monthStr = e.date.slice(0, 7);
        return monthStr >= fromPrefix && monthStr <= toPrefix;
      });
    }
    case 'year': {
      const y = (scope.year ?? activeYear) - 1;
      const prefix = `${y}-`;
      return expenses.filter((e) => e.date.startsWith(prefix));
    }
    case 'all':
      // No previous period for "all"
      return [];
    default:
      return [];
  }
}

/** Calculate the total number of days the scope covers. */
export function computeScopeTotalDays(scope: InsightScope, activeYear: number, activeMonth: number): number {
  switch (scope.type) {
    case 'month':
      return new Date(activeYear, activeMonth, 0).getDate();
    case 'pick_month': {
      const y = scope.year ?? activeYear;
      const m = scope.month ?? activeMonth;
      return new Date(y, m, 0).getDate();
    }
    case 'range': {
      const fy = scope.fromYear ?? activeYear;
      const fm = scope.fromMonth ?? 1;
      const ty = scope.toYear ?? activeYear;
      const tm = scope.toMonth ?? 12;
      const start = new Date(fy, fm - 1, 1);
      const end = new Date(ty, tm, 0); // last day of toMonth
      return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    }
    case 'year': {
      const y = scope.year ?? activeYear;
      const start = new Date(y, 0, 1);
      const end = new Date(y, 11, 31);
      return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    }
    case 'all':
      return 0; // indeterminate
    default:
      return 30;
  }
}

// ============================================================
//  Family support detection
// ============================================================

export function isFamilySupportExpense(expense: Expense): boolean {
  const category = expense.category.trim().toLowerCase();
  const text = `${expense.name} ${expense.note ?? ''}`.trim().toLowerCase();
  const familyKeywords = [
    'ortu',
    'orang tua',
    'keluarga',
    'ayah',
    'ibu',
    'bapak',
    'mama',
    'papa',
    'bulanan ortu',
    'uang bulanan',
  ];

  return category === 'keluarga'
    || familyKeywords.some((keyword) => text.includes(keyword));
}

// ============================================================
//  Internal helpers
// ============================================================

function formatPct(value: number | null): string {
  if (value === null) return 'belum bisa dibandingkan';
  return `${value > 0 ? '+' : ''}${value}%`;
}

function hasFundingTransferPattern(expenses: Expense[]): boolean {
  return expenses.some((expense) => {
    if (expense.type !== 'TRANSFER') return false;
    const text = `${expense.name} ${expense.destination ?? ''} ${expense.note ?? ''}`.toLowerCase();
    return text.includes('usdt')
      || text.includes('crypto')
      || text.includes('pintu')
      || text.includes('withdraw')
      || text.includes('tarik');
  });
}

function buildBudgetLine(
  actual: number,
  budget: number,
  currency: 'IDR' | 'USD',
  subject: string
): string | null {
  if (budget <= 0) return null;
  if (actual > budget) {
    return `${subject} melewati budget sekitar ${formatCurrency(actual - budget, currency)}.`;
  }
  if (actual === budget) {
    return `${subject} pas di batas budget bulan ini.`;
  }
  return `${subject} masih di bawah budget dengan sisa sekitar ${formatCurrency(budget - actual, currency)}.`;
}

// ── helper: find the single most expensive expense ──────────────
function getLargestExpense(expenses: Expense[]): Expense | null {
  if (!expenses.length) return null;
  return expenses.reduce((max, e) => e.amount > max.amount ? e : max, expenses[0]);
}

// ── helper: find ALL repeated item names ────────────────────────
function getAllRepeatedItems(expenses: Expense[]): Array<{ name: string; count: number; total: number }> {
  const freq: Record<string, { count: number; total: number }> = {};
  for (const e of expenses) {
    const key = e.name.trim().toLowerCase();
    if (!key) continue;
    freq[key] = { count: (freq[key]?.count ?? 0) + 1, total: (freq[key]?.total ?? 0) + e.amount };
  }
  const repeated = Object.entries(freq)
    .filter(([, v]) => v.count > 1)
    .sort(([, a], [, b]) => b.total - a.total);
  if (!repeated.length) return [];
  return repeated.map(([key, v]) => {
    const originalName = expenses.find((e) => e.name.trim().toLowerCase() === key)?.name ?? key;
    return { name: originalName, count: v.count, total: v.total };
  });
}

// ── helper: get the top repeated item (backward compat) ─────────
function getRepeatedItem(expenses: Expense[]): { name: string; count: number; total: number } | null {
  const all = getAllRepeatedItems(expenses);
  return all[0] ?? null;
}

// ── helper: month-over-month change label ───────────────────────
function buildDeltaLabel(delta: number, deltaPct: number | null): string {
  if (deltaPct === null) return '';
  const arrow = delta > 0 ? 'naik' : 'turun';
  const sign = delta > 0 ? '+' : '';
  return `${arrow} ${sign}${formatPct(deltaPct)} dari periode sebelumnya`;
}

// ============================================================
//  buildCombinedInsight  (merged from summary + transaction)
// ============================================================
export function buildCombinedInsight(params: HistoryInsightParams): HistoryInsightResponse {
  const {
    scopeLabel,
    currency,
    scopedExpenses,
    scopedTotal,
    transferTotal,
    previousScopedTotal,
    topCategories,
    split,
    filterLabel,
    familySupportTotal = 0,
    personalTotal = scopedTotal,
    personalNeedsTotal = 0,
    personalWantsTotal = 0,
    personalBudget = 0,
    familySupportBudget = 0,
  } = params;

  const delta = scopedTotal - previousScopedTotal;
  const deltaPct = previousScopedTotal > 0
    ? Math.round((delta / previousScopedTotal) * 100)
    : null;
  const topCategory = topCategories[0];
  const secondCategory = topCategories[1];
  const transactionCount = scopedExpenses.length;
  const scopeNoun = filterLabel === 'Semua' ? 'pengeluaran' : `transaksi ${filterLabel}`;
  const fundingTransferPattern = hasFundingTransferPattern(scopedExpenses);

  const spendingExpenses = scopedExpenses.filter((e) => e.type !== 'TRANSFER');
  
  // If we are looking at ALL and have family support, isolate personal expenses
  // for largest expense & repeated items analysis to avoid redundancy.
  const evaluationExpenses = (filterLabel === 'Semua' && familySupportTotal > 0)
    ? spendingExpenses.filter(e => !isFamilySupportExpense(e))
    : spendingExpenses;

  const largestExpense = getLargestExpense(evaluationExpenses);
  const largestShare = largestExpense && scopedTotal > 0
    ? Math.round((largestExpense.amount / scopedTotal) * 100)
    : 0;
  const repeatedItems = getAllRepeatedItems(evaluationExpenses);
  const topRepeated = repeatedItems[0] ?? null;
  const avgPerTx = transactionCount > 0 ? Math.round(scopedTotal / transactionCount) : 0;

  // Count unique spending days
  const uniqueDays = new Set(spendingExpenses.map((e) => e.date)).size;

  // ── summary paragraph ────────────────────────────────────────
  const summaryParts: string[] = [];

  if (filterLabel === 'NEED') {
    summaryParts.push(
      `Transaksi need di ${scopeLabel}: ${transactionCount} transaksi, total ${formatCurrency(scopedTotal, currency)}.`
    );
    if (familySupportTotal > 0) {
      summaryParts.push(`Sebagian need ini masuk ke bantuan keluarga, sehingga kebutuhan harian pribadimu lebih rendah dari total itu.`);
    } else if (topCategory) {
      summaryParts.push(`Porsi need terbesar ada di ${topCategory.label} (${topCategory.pct}%).`);
    }
    if (deltaPct !== null) {
      summaryParts.push(`Dibanding periode lalu, need ${buildDeltaLabel(delta, deltaPct)}.`);
    } else {
      summaryParts.push('Belum ada data periode lalu sebagai pembanding.');
    }
  } else if (filterLabel === 'WANT') {
    summaryParts.push(
      `Transaksi want di ${scopeLabel}: ${transactionCount} transaksi, total ${formatCurrency(scopedTotal, currency)}.`
    );
    if (topCategory) {
      summaryParts.push(
        secondCategory
          ? `Porsi terbesar dari ${topCategory.label} (${topCategory.pct}%) diikuti ${secondCategory.label} (${secondCategory.pct}%).`
          : `Want paling besar datang dari ${topCategory.label} (${topCategory.pct}%).`
      );
    }
    if (deltaPct !== null) {
      summaryParts.push(`Dibanding periode lalu, want ${buildDeltaLabel(delta, deltaPct)}.`);
    }
  } else if (filterLabel === 'TRANSFER') {
    summaryParts.push(
      `Transfer di ${scopeLabel}: ${transactionCount} transaksi, total ${formatCurrency(scopedTotal, currency)}.`
    );
    summaryParts.push(
      fundingTransferPattern
        ? 'Polanya menunjukkan perpindahan dana (cth. pencairan USDT/crypto), bukan belanja konsumtif langsung.'
        : 'Ini lebih tepat dibaca sebagai perpindahan saldo antar akun, bukan pengeluaran harian.'
    );
    if (deltaPct !== null) {
      summaryParts.push(`Dibanding periode lalu, total transfer ${buildDeltaLabel(delta, deltaPct)}.`);
    }
  } else {
    // ALL
    summaryParts.push(
      `Total ${scopeNoun.toLowerCase()} di ${scopeLabel}: ${transactionCount} transaksi, ${formatCurrency(scopedTotal, currency)}.`
    );
    if (familySupportTotal > 0) {
      summaryParts.push(
        `Dari angka itu, ${formatCurrency(familySupportTotal, currency)} adalah bantuan keluarga — belanja pribadimu sekitar ${formatCurrency(personalTotal, currency)}.`
      );
    }
    if (topCategory) {
      const topCatIsFamily = topCategory.label.toLowerCase().includes('keluarga') || topCategory.label.toLowerCase().includes('ortu');
      if (familySupportTotal > 0 && topCatIsFamily) {
        const secondCat = secondCategory;
        if (secondCat) {
          summaryParts.push(`Porsi pengeluaran terbesar selain itu ada di kategori ${secondCat.label} (${formatCurrency(secondCat.amount, currency)}, ${secondCat.pct}%).`);
        }
      } else if (familySupportTotal > 0) {
        summaryParts.push(
          `Di luar keluarga, kategori terbesarmu adalah ${topCategory.label} (${formatCurrency(topCategory.amount, currency)}, ${topCategory.pct}%).`
        );
      } else {
        summaryParts.push(
          `Kategori terbesar adalah ${topCategory.label} sebesar ${formatCurrency(topCategory.amount, currency)} (${topCategory.pct}%).`
        );
      }
    }
    if (deltaPct !== null) {
      summaryParts.push(`Pengeluaran ${buildDeltaLabel(delta, deltaPct)}.`);
    } else {
      summaryParts.push('Belum ada data periode lalu untuk perbandingan.');
    }
    if (avgPerTx > 0 && transactionCount >= 3) {
      summaryParts.push(`Rata-rata per transaksi sekitar ${formatCurrency(avgPerTx, currency)}.`);
    }
  }

  // Append transaction-level pattern summary
  if (filterLabel !== 'TRANSFER') {
    if (largestExpense && largestShare >= 35) {
      summaryParts.push(
        `"${largestExpense.name}" menyumbang ~${largestShare}% dari total — titik pengeluaran utama.`
      );
    }
    if (topRepeated) {
      summaryParts.push(`"${topRepeated.name}" adalah pengeluaran paling sering berulang.`);
    }
  }

  // ── highlights ───────────────────────────────────────────────
  const highlights: (string | null)[] = [
    // Budget status
    filterLabel === 'Semua' || filterLabel === 'NEED'
      ? buildBudgetLine(personalTotal, personalBudget, currency, 'Belanja pribadimu')
      : null,
    // Family support budget
    filterLabel === 'Semua' && familySupportTotal > 0
      ? buildBudgetLine(familySupportTotal, familySupportBudget, currency, 'Bantuan keluargamu')
      : null,
    // Family support share
    filterLabel === 'Semua' && familySupportTotal > 0
      ? `Bantuan keluarga menyerap ${Math.round((familySupportTotal / scopedTotal) * 100)}% dari total.`
      : null,
    // Top category
    topCategory
      ? filterLabel === 'TRANSFER'
        ? `${topCategory.label} menyerap ${topCategory.pct}% dari total transfer.`
        : `${topCategory.label} menyerap ${topCategory.pct}% dari total ${filterLabel === 'Semua' ? 'pengeluaran' : filterLabel.toLowerCase()}.`
      : null,
    // Largest single expense (non-transfer) with note
    largestExpense && filterLabel !== 'TRANSFER'
      ? `Pengeluaran terbesar: ${largestExpense.name} — ${formatCurrency(largestExpense.amount, largestExpense.currency)}${largestExpense.note ? ` (${largestExpense.note})` : ''}.`
      : null,
    // All repeated items
    ...repeatedItems.slice(0, 3).map((item) =>
      `"${item.name}" muncul ${item.count}× dengan total ${formatCurrency(item.total, currency)}.`
    ),
    // Needs/wants split
    filterLabel === 'Semua'
      ? familySupportTotal > 0
        ? `Di luar bantuan keluarga: kebutuhan pribadi ${formatCurrency(personalNeedsTotal, currency)}, keinginan ${formatCurrency(personalWantsTotal, currency)}.`
        : `Need ${split.needsPct}% · Want ${split.wantsPct}% dari total.`
      : filterLabel === 'NEED'
        ? familySupportTotal > 0
          ? 'Need termasuk bantuan keluarga — pisahkan keduanya saat evaluasi.'
          : `Need rata-rata ${formatCurrency(avgPerTx, currency)} per transaksi.`
        : filterLabel === 'WANT'
          ? (buildBudgetLine(scopedTotal, personalBudget, currency, 'Want-mu') ?? `Want rata-rata ${formatCurrency(avgPerTx, currency)} per transaksi.`)
          : fundingTransferPattern
            ? 'Transfer ini terlihat sebagai pencairan dana, bukan belanja langsung.'
            : 'Transfer lebih tepat dibaca sebagai perpindahan saldo, bukan pengeluaran konsumtif.',
    // Unique spending days
    uniqueDays > 0 && spendingExpenses.length > 0 && filterLabel !== 'TRANSFER'
      ? `Pengeluaran tersebar di ${uniqueDays} hari — rata-rata ${Math.round(spendingExpenses.length / uniqueDays)} transaksi/hari.`
      : null,
    // Transfer note (for non-transfer filter)
    filterLabel !== 'TRANSFER' && transferTotal > 0
      ? `Ada transfer ${formatCurrency(transferTotal, currency)} yang sebaiknya dipisahkan dari evaluasi belanja harian.`
      : null,
  ];

  // ── actions ──────────────────────────────────────────────────
  const actions: (string | null)[] = [
    familySupportTotal > 0 && filterLabel === 'Semua'
      ? 'Pisahkan bantuan keluarga sebagai pos tersendiri agar evaluasi belanja pribadimu tidak terpengaruh setiap bulan.'
      : null,
    personalBudget > 0 && personalTotal > personalBudget && filterLabel === 'Semua'
      ? 'Pengeluaran pribadi sudah melewati budget — cek want terbesar dulu sebelum memangkas kebutuhan yang rutin.'
      : null,
    familySupportBudget > 0 && familySupportTotal > familySupportBudget
      ? 'Bantuan keluarga melebihi budget — catat sebagai insidental agar target bulan depan tetap realistis.'
      : null,
    filterLabel === 'NEED' && familySupportTotal > 0
      ? 'Pisahkan need pribadi dan bantuan keluarga saat evaluasi agar total yang terlihat tidak menyesatkan.'
      : null,
    filterLabel === 'WANT' && personalBudget > 0 && scopedTotal > personalBudget
      ? 'Want sendiri sudah melewati budget — mulai pangkas dari transaksi want terbesar.'
      : null,
    filterLabel === 'TRANSFER'
      ? fundingTransferPattern
        ? 'Kalau transfer ini memang pencairan dana rutin, beri nama/catatan konsisten agar histori lebih mudah dibaca.'
        : 'Bedakan transfer saldo dengan dana yang benar-benar keluar agar insight berikutnya lebih akurat.'
      : null,
    // Repeated item action
    topRepeated && filterLabel !== 'TRANSFER'
      ? `"${topRepeated.name}" muncul berulang — pertimbangkan tetapkan batas bulanan untuk pos ini.`
      : null,
    topCategory && topCategory.pct >= 50
      ? `${topCategory.label} mendominasi >50% — pertimbangkan pisahkan sebagai pos khusus jika ini tidak rutin.`
      : null,
    // Largest expense action
    largestExpense && largestShare >= 35 && filterLabel !== 'TRANSFER'
      ? `Tandai "${largestExpense.name}" sebagai pengeluaran insidental jika ini tidak rutin setiap bulan.`
      : null,
    filterLabel === 'WANT'
      ? 'Tetapkan batas bulanan per kategori want agar belanja tidak bocor tanpa disadari.'
      : split.wantsPct >= 35
        ? 'Porsi want sudah cukup besar — mulai dari situ jika ingin menekan total bulanan.'
        : 'Porsi want masih terkendali, fokus ke pengeluaran besar yang sifatnya kebutuhan.',
    previousScopedTotal > 0 && delta > 0
      ? 'Bandingkan transaksi besar periode ini dengan periode lalu untuk tahu apakah kenaikannya memang wajar.'
      : 'Pantau transaksi besar agar mudah membedakan kebutuhan rutin dan pengeluaran sesaat.',
  ];

  return {
    title: `Ringkasan & analisis ${filterLabel === 'Semua' ? '' : `${filterLabel.toLowerCase()} `}${scopeLabel}`.trim(),
    summary: summaryParts.join(' '),
    highlights: highlights.filter((h): h is string => h !== null && h !== undefined && h !== ''),
    actions: actions.filter((a): a is string => a !== null && a !== undefined && a !== ''),
  };
}

// ============================================================
//  buildQuickInsightLine  (improved — smarter, more specific)
// ============================================================
export function buildQuickInsightLine(params: {
  filterLabel: string;
  currency: 'IDR' | 'USD';
  scopedExpenses: Expense[];
  scopedTotal: number;
  topCategories: HistoryInsightCategory[];
  previousScopedTotal: number;
  familySupportTotal?: number;
  personalTotal?: number;
  personalBudget?: number;
}): string {
  const {
    filterLabel,
    currency,
    scopedExpenses,
    scopedTotal,
    topCategories,
    previousScopedTotal,
    familySupportTotal = 0,
    personalTotal = scopedTotal,
    personalBudget = 0,
  } = params;

  if (scopedExpenses.length === 0) {
    return `Belum ada transaksi ${filterLabel === 'Semua' ? '' : filterLabel.toLowerCase() + ' '}untuk periode ini.`;
  }

  const spendingExpenses = scopedExpenses.filter((e) => e.type !== 'TRANSFER');
  const topCategory = topCategories[0];
  const delta = scopedTotal - previousScopedTotal;
  const deltaPct = previousScopedTotal > 0
    ? Math.round((delta / previousScopedTotal) * 100)
    : null;

  const largest = getLargestExpense(spendingExpenses);
  const largestShare = largest && scopedTotal > 0
    ? Math.round((largest.amount / scopedTotal) * 100)
    : 0;

  const repeatedItem = getRepeatedItem(spendingExpenses);
  const fundingTransferPattern = hasFundingTransferPattern(scopedExpenses);

  // ── TRANSFER filter ─────────────────────────────────────────
  if (filterLabel === 'TRANSFER') {
    const mainDest = topCategories[0];
    if (mainDest) {
      return fundingTransferPattern
        ? `${mainDest.label} adalah jalur transfer utama — ini lebih mirip pencairan dana daripada belanja langsung.`
        : `${mainDest.label} jadi tujuan transfer terbesar (${mainDest.pct}%) — dibaca sebagai perpindahan dana.`;
    }
    return 'Transfer bulan ini lebih tepat dibaca sebagai perpindahan saldo, bukan pengeluaran konsumtif.';
  }

  // ── WANT filter ─────────────────────────────────────────────
  if (filterLabel === 'WANT') {
    if (personalBudget > 0 && scopedTotal > personalBudget) {
      const overby = formatCurrency(scopedTotal - personalBudget, currency);
      return `Want sudah lewat budget sekitar ${overby}. Cek "${largest?.name ?? 'transaksi terbesar'}" dulu.`;
    }
    if (largest && largestShare >= 40) {
      return `"${largest.name}" mendominasi ${largestShare}% want bulan ini — ${formatCurrency(largest.amount, largest.currency)}.`;
    }
    if (topCategory && topCategory.pct >= 45) {
      return `${topCategory.label} paling menyerap want bulan ini (${topCategory.pct}%). Dari sini biasanya kebocoran paling terasa.`;
    }
    if (repeatedItem) {
      return `"${repeatedItem.name}" muncul ${repeatedItem.count}× — total ${formatCurrency(repeatedItem.total, currency)} dari want bulan ini.`;
    }
    if (deltaPct !== null && delta > 0) {
      return `Want naik ${formatPct(deltaPct)} dari bulan lalu. Cek item want baru yang muncul bulan ini.`;
    }
    return `Want bulan ini ${formatCurrency(scopedTotal, currency)} dari ${spendingExpenses.length} transaksi — polanya tersebar.`;
  }

  // ── NEED filter ─────────────────────────────────────────────
  if (filterLabel === 'NEED') {
    if (familySupportTotal > 0) {
      // Show family support context + top personal need signal
      const personalNeedExpenses = spendingExpenses.filter((e) => e.type === 'NEED' && !isFamilySupportExpense(e));
      const topPersonalNeed = getLargestExpense(personalNeedExpenses);
      if (topPersonalNeed) {
        return `Need bulan ini termasuk bantuan keluarga. Di luar itu, kebutuhan pribadi terbesar: "${topPersonalNeed.name}" (${formatCurrency(topPersonalNeed.amount, topPersonalNeed.currency)}).`;
      }
      return 'Need bulan ini termasuk bantuan keluarga — kebutuhan pribadimu perlu dibaca terpisah.';
    }
    if (largest && largestShare >= 40) {
      return `"${largest.name}" mendominasi ${largestShare}% dari total need bulan ini — ${formatCurrency(largest.amount, largest.currency)}.`;
    }
    if (topCategory && topCategory.pct >= 45) {
      return `${topCategory.label} paling besar di need bulan ini (${topCategory.pct}%). Cek apakah ini rutin atau sekali besar.`;
    }
    if (repeatedItem) {
      return `"${repeatedItem.name}" adalah need paling sering berulang (${repeatedItem.count}×, total ${formatCurrency(repeatedItem.total, currency)}).`;
    }
    return `Need bulan ini ${formatCurrency(scopedTotal, currency)} dari ${spendingExpenses.length} transaksi. Polanya cenderung rutin.`;
  }

  // ── ALL filter ──────────────────────────────────────────────

  // 1. Family support + best personal signal
  if (filterLabel === 'Semua' && familySupportTotal > 0) {
    const familyPct = Math.round((familySupportTotal / scopedTotal) * 100);

    // Find the strongest personal spending signal (exclude family support expenses)
    const personalExpenses = spendingExpenses.filter((e) => !isFamilySupportExpense(e));
    const topPersonalItem = getLargestExpense(personalExpenses);
    const topPersonalRepeated = getRepeatedItem(personalExpenses);

    // Priority: budget overage > largest personal item > repeated habit > budget remaining
    if (personalBudget > 0 && personalTotal > personalBudget) {
      const overby = formatCurrency(personalTotal - personalBudget, currency);
      const overbyCtx = topPersonalItem
        ? ` "${topPersonalItem.name}" jadi pengeluaran terbesar.`
        : '';
      return `${familyPct}% total adalah bantuan keluarga, tapi belanja pribadi sudah lewat budget sekitar ${overby}.${overbyCtx}`;
    }

    if (topPersonalItem) {
      const suffix = topPersonalRepeated && topPersonalRepeated.name.toLowerCase() !== topPersonalItem.name.toLowerCase()
        ? ` "${topPersonalRepeated.name}" paling sering berulang.`
        : '';
      return `${familyPct}% total bantuan keluarga. Pengeluaran pribadi terbesar: "${topPersonalItem.name}" (${formatCurrency(topPersonalItem.amount, topPersonalItem.currency)}).${suffix}`;
    }

    if (personalBudget > 0) {
      const remaining = formatCurrency(personalBudget - personalTotal, currency);
      return `${familyPct}% total bantuan keluarga. Belanja pribadi ${formatCurrency(personalTotal, currency)}, sisa budget ${remaining}.`;
    }

    return `${familyPct}% total bulan ini adalah bantuan keluarga. Belanja pribadimu sekitar ${formatCurrency(personalTotal, currency)}.`;
  }

  // 2. Single item dominates
  if (largest && largestShare >= 40) {
    return `Bulan ini terasa berat karena "${largest.name}" mendominasi ~${largestShare}% — ${formatCurrency(largest.amount, largest.currency)}.`;
  }

  // 3. Single category dominates
  if (topCategory && topCategory.pct >= 50) {
    return `${topCategory.label} jadi pusat pengeluaran bulan ini — menyerap ${topCategory.pct}% dari total.`;
  }

  // 4. Repeated habit
  if (repeatedItem && repeatedItem.count >= 2) {
    return `"${repeatedItem.name}" muncul ${repeatedItem.count}× — total ${formatCurrency(repeatedItem.total, currency)} dari pengeluaran bulan ini.`;
  }

  // 5. Month-over-month delta — meaningful change
  if (deltaPct !== null && Math.abs(delta) > 0) {
    const direction = delta > 0 ? 'naik' : 'turun';
    const sign = delta > 0 ? '+' : '';
    if (Math.abs(deltaPct) >= 15) {
      return `Pengeluaran ${direction} signifikan ${sign}${formatPct(deltaPct)} dari bulan lalu. Cek transaksi baru yang mungkin jadi sebabnya.`;
    }
    return `Pengeluaran ${direction} ${sign}${formatPct(deltaPct)} dari bulan lalu — perubahan relatif kecil.`;
  }

  // 6. Budget is set and personal is within range
  if (personalBudget > 0) {
    if (personalTotal > personalBudget) {
      return `Pengeluaran sudah melewati budget sekitar ${formatCurrency(personalTotal - personalBudget, currency)}.`;
    }
    return `Pengeluaran masih dalam budget — sisa sekitar ${formatCurrency(personalBudget - personalTotal, currency)}.`;
  }

  // 7. Fallback — still meaningful
  const txCount = spendingExpenses.length;
  const avgPerTx = txCount > 0 ? Math.round(scopedTotal / txCount) : 0;
  return `Total bulan ini ${formatCurrency(scopedTotal, currency)} dari ${txCount} transaksi${avgPerTx > 0 ? ` — rata-rata ${formatCurrency(avgPerTx, currency)}/transaksi` : ''}.`;
}

// ============================================================
//  buildTopCategories
// ============================================================
export function buildTopCategories(
  scopedMonthExpenses: Expense[],
  categories: Array<{ slug: string; label: string }>,
  scopedTotal: number,
  toDisplay: (expense: Expense) => number
): HistoryInsightCategory[] {
  const totals: Record<string, number> = {};
  scopedMonthExpenses.forEach((expense) => {
    const key = expense.type === 'TRANSFER'
      ? `transfer:${expense.destination ?? 'Tanpa tujuan'}`
      : expense.category;
    totals[key] = (totals[key] ?? 0) + toDisplay(expense);
  });

  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([slug, amount]) => {
      const isTransfer = slug.startsWith('transfer:');
      const category = categories.find((item) => item.slug === slug);
      return {
        label: isTransfer ? slug.replace('transfer:', 'Transfer ke ') : (category?.label ?? slug),
        amount,
        pct: scopedTotal > 0 ? Math.round((amount / scopedTotal) * 100) : 0,
      };
    });
}

// ============================================================
//  Misc helpers
// ============================================================
export function getInsightFilterLabel(typeFilter: HistoryTypeFilter): string {
  return typeFilter === 'ALL' ? 'Semua' : typeFilter;
}

export function getScopedExpenses(
  typeFilter: HistoryTypeFilter,
  monthExpenses: Expense[],
  spendingMonthExpenses: Expense[]
): Expense[] {
  if (typeFilter === 'ALL') return spendingMonthExpenses;
  return monthExpenses.filter((expense) => expense.type === typeFilter);
}

export function getPreviousScopedExpenses(
  typeFilter: HistoryTypeFilter,
  expenses: Expense[],
  previousMonthPrefix: string,
  previousMonthExpenses: Expense[]
): Expense[] {
  if (typeFilter === 'ALL') return previousMonthExpenses;
  return expenses.filter((expense) =>
    expense.date.startsWith(previousMonthPrefix) && expense.type === typeFilter
  );
}

export function sumDisplayedExpenses(
  expenses: Expense[],
  toDisplay: (expense: Expense) => number
): number {
  return expenses.reduce((sum, expense) => sum + toDisplay(expense), 0);
}
