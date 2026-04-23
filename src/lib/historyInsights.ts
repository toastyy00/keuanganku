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
  /** Top categories after excluding family support — for personal evaluation */
  personalTopCategories?: HistoryInsightCategory[];
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
  const name = expense.name.trim().toLowerCase();

  // Category "keluarga" is always family support
  if (category === 'keluarga') return true;

  // For other categories, only match if the NAME itself (not just note) indicates
  // a direct family support payment — avoid false positives like "lem epoxy bapak"
  const familyNameKeywords = [
    'ortu',
    'orang tua',
    'uang bulanan',
    'bulanan ortu',
  ];

  return familyNameKeywords.some((keyword) => name.includes(keyword));
}

// ============================================================
//  Internal helpers
// ============================================================



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



// ── helper: day-of-week spending distribution ───────────────────
const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function getDayOfWeekDistribution(expenses: Expense[]): {
  busiestDay: string;
  busiestDayTotal: number;
  busiestDayCount: number;
} | null {
  if (!expenses.length) return null;
  const dayTotals: Record<number, { total: number; count: number }> = {};
  for (const e of expenses) {
    const day = new Date(e.date + 'T00:00:00').getDay();
    if (!dayTotals[day]) dayTotals[day] = { total: 0, count: 0 };
    dayTotals[day].total += e.amount;
    dayTotals[day].count += 1;
  }
  let maxDay = -1;
  let maxTotal = 0;
  for (const [day, info] of Object.entries(dayTotals)) {
    if (info.total > maxTotal) {
      maxTotal = info.total;
      maxDay = Number(day);
    }
  }
  if (maxDay < 0) return null;
  return {
    busiestDay: DAY_NAMES_ID[maxDay],
    busiestDayTotal: dayTotals[maxDay].total,
    busiestDayCount: dayTotals[maxDay].count,
  };
}

// ── helper: month-over-month change label ───────────────────────
function buildDeltaLabel(delta: number, deltaPct: number | null): string {
  if (deltaPct === null) return '';
  const arrow = delta > 0 ? 'naik' : 'turun';
  return `${arrow} ${Math.abs(deltaPct)}% dari periode sebelumnya`;
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
    personalTopCategories,
    split,
    filterLabel,
    familySupportTotal = 0,
    personalTotal = scopedTotal,
    personalNeedsTotal = 0,
    personalWantsTotal = 0,
    personalBudget = 0,
    familySupportBudget = 0,
  } = params;

  // Use personal top categories for evaluation when available (excl family)
  const evalTopCategories = (filterLabel === 'Semua' && familySupportTotal > 0 && personalTopCategories?.length)
    ? personalTopCategories
    : topCategories;

  const delta = scopedTotal - previousScopedTotal;
  const deltaPct = previousScopedTotal > 0
    ? Math.round((delta / previousScopedTotal) * 100)
    : null;
  const topCategory = evalTopCategories[0];
  const secondCategory = evalTopCategories[1];
  const thirdCategory = evalTopCategories[2];
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
  // Calculate largest share against personal total (not global total) for accurate evaluation
  const evalTotal = (filterLabel === 'Semua' && familySupportTotal > 0) ? personalTotal : scopedTotal;
  const largestShare = largestExpense && evalTotal > 0
    ? Math.round((largestExpense.amount / evalTotal) * 100)
    : 0;
  const repeatedItems = getAllRepeatedItems(evaluationExpenses);
  const topRepeated = repeatedItems[0] ?? null;
  // Use personal expenses for average calculation when family support exists
  const evalTxCount = evaluationExpenses.length;
  const avgPerTx = evalTxCount > 0 ? Math.round(evalTotal / evalTxCount) : 0;

  // Count unique spending days
  const uniqueDays = new Set(evaluationExpenses.map((e) => e.date)).size;
  // Daily spending velocity (personal only)
  const dailyAvg = uniqueDays > 0 ? Math.round(evalTotal / uniqueDays) : 0;

  // Personal Need/Want ratio (excl family)
  const personalSpendingTotal = personalNeedsTotal + personalWantsTotal;
  const personalWantsPct = personalSpendingTotal > 0
    ? Math.round((personalWantsTotal / personalSpendingTotal) * 100)
    : 0;
  const personalNeedsPct = personalSpendingTotal > 0 ? 100 - personalWantsPct : 0;

  // Day-of-week distribution (personal expenses only)
  const dayDist = getDayOfWeekDistribution(evaluationExpenses);

  // ── summary paragraph ────────────────────────────────────────
  const summaryParts: string[] = [];

  if (filterLabel === 'NEED') {
    summaryParts.push(
      `Transaksi need di ${scopeLabel}: ${transactionCount} transaksi, total ${formatCurrency(scopedTotal, currency)}.`
    );
    if (familySupportTotal > 0) {
      const personalNeedOnly = personalNeedsTotal;
      summaryParts.push(`Dari total itu, ${formatCurrency(familySupportTotal, currency)} adalah bantuan keluarga. Kebutuhan pribadi murni sekitar ${formatCurrency(personalNeedOnly, currency)}.`);
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
    // Use personal top categories for summary
    if (topCategory) {
      if (familySupportTotal > 0) {
        summaryParts.push(
          `Kategori pribadi terbesar: ${topCategory.label} (${formatCurrency(topCategory.amount, currency)}, ${topCategory.pct}% dari belanja pribadi).`
        );
      } else {
        summaryParts.push(
          `Kategori terbesar adalah ${topCategory.label} sebesar ${formatCurrency(topCategory.amount, currency)} (${topCategory.pct}%).`
        );
      }
    }
    // Personal Need/Want ratio
    if (familySupportTotal > 0 && personalSpendingTotal > 0) {
      summaryParts.push(
        `Rasio pengeluaran pribadi: Need ${personalNeedsPct}% vs Want ${personalWantsPct}%.`
      );
    }
    if (deltaPct !== null) {
      summaryParts.push(`Pengeluaran ${buildDeltaLabel(delta, deltaPct)}.`);
    } else {
      summaryParts.push('Belum ada data periode lalu untuk perbandingan.');
    }
    if (dailyAvg > 0 && uniqueDays >= 2) {
      summaryParts.push(`Rata-rata belanja harian (pribadi) sekitar ${formatCurrency(dailyAvg, currency)} dari ${uniqueDays} hari aktif.`);
    }
  }

  // Append transaction-level pattern summary
  if (filterLabel !== 'TRANSFER') {
    if (largestExpense && largestShare >= 30) {
      const shareContext = (filterLabel === 'Semua' && familySupportTotal > 0) ? 'belanja pribadi' : 'total';
      summaryParts.push(
        `"${largestExpense.name}" menyumbang ~${largestShare}% dari ${shareContext} — titik pengeluaran utama.`
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
    // Personal Need/Want ratio (excl family) — contextual evaluation
    filterLabel === 'Semua' && familySupportTotal > 0 && personalSpendingTotal > 0
      ? (() => {
        const budgetUsed = personalBudget > 0 ? Math.round((personalTotal / personalBudget) * 100) : 0;
        const nearBudget = personalBudget > 0 && budgetUsed > 75;
        if (personalWantsPct > 60 && nearBudget) {
          return `⚠️ Rasio Want pribadi ${personalWantsPct}% dan budget tinggal ${100 - budgetUsed}%. Kebutuhan: ${formatCurrency(personalNeedsTotal, currency)}, keinginan: ${formatCurrency(personalWantsTotal, currency)}.`;
        }
        return `Rasio pribadi: Need ${personalNeedsPct}% (${formatCurrency(personalNeedsTotal, currency)}) · Want ${personalWantsPct}% (${formatCurrency(personalWantsTotal, currency)}).`;
      })()
      : null,
    // Top personal categories (excl family) — key improvement
    filterLabel === 'Semua' && familySupportTotal > 0 && topCategory
      ? `Top kategori pribadi: ${topCategory.label} (${formatCurrency(topCategory.amount, currency)})${secondCategory ? `, ${secondCategory.label} (${formatCurrency(secondCategory.amount, currency)})` : ''}${thirdCategory ? `, ${thirdCategory.label} (${formatCurrency(thirdCategory.amount, currency)})` : ''}.`
      : filterLabel === 'Semua' && !familySupportTotal && topCategory
        ? `Top kategori: ${topCategory.label} (${topCategory.pct}%)${secondCategory ? `, ${secondCategory.label} (${secondCategory.pct}%)` : ''}${thirdCategory ? `, ${thirdCategory.label} (${thirdCategory.pct}%)` : ''}.`
        : topCategory
          ? `${topCategory.label} menyerap ${topCategory.pct}% dari total ${filterLabel === 'TRANSFER' ? 'transfer' : filterLabel.toLowerCase()}.`
          : null,
    // Largest single expense (non-transfer) with note
    largestExpense && filterLabel !== 'TRANSFER'
      ? `Pengeluaran terbesar: ${largestExpense.name} — ${formatCurrency(largestExpense.amount, largestExpense.currency)} (~${largestShare}% ${(filterLabel === 'Semua' && familySupportTotal > 0) ? 'belanja pribadi' : 'total'})${largestExpense.note ? ` (${largestExpense.note})` : ''}.`
      : null,
    // All repeated items
    ...repeatedItems.slice(0, 3).map((item) =>
      `"${item.name}" muncul ${item.count}× dengan total ${formatCurrency(item.total, currency)}.`
    ),
    // Needs/wants split (when no family support)
    filterLabel === 'Semua' && !familySupportTotal
      ? `Need ${split.needsPct}% · Want ${split.wantsPct}% dari total.${split.wantsPct > 60 ? ' ⚠️ Want di atas 60%.' : ''}`
      : filterLabel === 'NEED'
        ? familySupportTotal > 0
          ? `Need pribadi (tanpa keluarga): ${formatCurrency(personalNeedsTotal, currency)}.`
          : `Need rata-rata ${formatCurrency(avgPerTx, currency)} per transaksi.`
        : filterLabel === 'WANT'
          ? (buildBudgetLine(scopedTotal, personalBudget, currency, 'Want-mu') ?? `Want rata-rata ${formatCurrency(avgPerTx, currency)} per transaksi.`)
          : filterLabel === 'TRANSFER'
            ? fundingTransferPattern
              ? 'Transfer ini terlihat sebagai pencairan dana, bukan belanja langsung.'
              : 'Transfer lebih tepat dibaca sebagai perpindahan saldo, bukan pengeluaran konsumtif.'
            : null,
    // Daily average & spending days
    uniqueDays > 0 && evaluationExpenses.length > 0 && filterLabel !== 'TRANSFER'
      ? `Belanja tersebar di ${uniqueDays} hari — rata-rata ${formatCurrency(dailyAvg, currency)}/hari, ${Math.round(evaluationExpenses.length / uniqueDays)} transaksi/hari.`
      : null,
    // Day-of-week insight
    dayDist && filterLabel !== 'TRANSFER'
      ? `Hari ${dayDist.busiestDay} paling banyak belanja (${dayDist.busiestDayCount} transaksi, total ${formatCurrency(dayDist.busiestDayTotal, currency)}).`
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
      ? `Pengeluaran pribadi ${formatCurrency(personalTotal, currency)} sudah melewati budget ${formatCurrency(personalBudget, currency)} — cek want terbesar dulu sebelum memangkas kebutuhan rutin.`
      : null,
    familySupportBudget > 0 && familySupportTotal > familySupportBudget
      ? `Bantuan keluarga ${formatCurrency(familySupportTotal, currency)} melebihi budget ${formatCurrency(familySupportBudget, currency)} — catat sebagai insidental agar target bulan depan realistis.`
      : null,
    filterLabel === 'NEED' && familySupportTotal > 0
      ? `Pisahkan need pribadi (${formatCurrency(personalNeedsTotal, currency)}) dan bantuan keluarga (${formatCurrency(familySupportTotal, currency)}) saat evaluasi agar total yang terlihat tidak menyesatkan.`
      : null,
    filterLabel === 'WANT' && personalBudget > 0 && scopedTotal > personalBudget
      ? `Want sudah ${formatCurrency(scopedTotal, currency)}, melewati budget ${formatCurrency(personalBudget, currency)} — mulai pangkas dari transaksi want terbesar.`
      : null,
    filterLabel === 'TRANSFER'
      ? fundingTransferPattern
        ? 'Kalau transfer ini memang pencairan dana rutin, beri nama/catatan konsisten agar histori lebih mudah dibaca.'
        : 'Bedakan transfer saldo dengan dana yang benar-benar keluar agar insight berikutnya lebih akurat.'
      : null,
    // Specific category cap suggestion — use personal top categories
    topCategory && filterLabel !== 'TRANSFER' && topCategory.pct >= 40
      ? `${topCategory.label} menyerap ${topCategory.pct}% (${formatCurrency(topCategory.amount, currency)}) — tetapkan batas bulanan agar tidak terus membengkak.`
      : null,
    // Repeated item action — smarter about NEED vs WANT
    topRepeated && filterLabel !== 'TRANSFER'
      ? (() => {
        const repeatedExpense = evaluationExpenses.find(e => e.name.trim().toLowerCase() === topRepeated.name.trim().toLowerCase());
        const isNeed = repeatedExpense?.type === 'NEED';
        return isNeed
          ? `"${topRepeated.name}" muncul ${topRepeated.count}× (total ${formatCurrency(topRepeated.total, currency)}) — ini kebutuhan rutin, pastikan sudah masuk recurring agar tidak terlewat.`
          : `"${topRepeated.name}" muncul ${topRepeated.count}× (total ${formatCurrency(topRepeated.total, currency)}) — pertimbangkan batas bulanan untuk pos ini.`;
      })()
      : null,
    // Largest expense action
    largestExpense && largestShare >= 30 && filterLabel !== 'TRANSFER'
      ? `"${largestExpense.name}" (${formatCurrency(largestExpense.amount, largestExpense.currency)}) = ${largestShare}% ${(filterLabel === 'Semua' && familySupportTotal > 0) ? 'belanja pribadi' : 'total'} — tandai sebagai insidental jika tidak rutin.`
      : null,
    // Want ratio guidance — only actionable when near budget
    (() => {
      const budgetUsedAction = personalBudget > 0 ? Math.round((personalTotal / personalBudget) * 100) : 0;
      const nearBudgetAction = personalBudget > 0 && budgetUsedAction > 75;
      if (filterLabel === 'Semua' && personalWantsPct > 60 && nearBudgetAction) {
        return `Rasio want ${personalWantsPct}% dan budget hampir habis. Perlu tekan ~${formatCurrency(personalWantsTotal - Math.round(personalSpendingTotal * 0.5), currency)} dari sisi want.`;
      }
      if (filterLabel === 'WANT') return 'Tetapkan batas bulanan per kategori want agar belanja tidak bocor tanpa disadari.';
      if (filterLabel !== 'TRANSFER' && nearBudgetAction && split.wantsPct >= 35) return 'Porsi want cukup besar dan budget menipis — mulai dari situ untuk menekan total.';
      if (filterLabel !== 'TRANSFER' && !nearBudgetAction) return null; // No action needed when well under budget
      return null;
    })(),
    // Data-specific comparison action (not generic)
    previousScopedTotal > 0 && delta > 0 && largestExpense
      ? `Kenaikan ${Math.abs(Math.round((delta / previousScopedTotal) * 100))}% dari periode lalu — cek apakah "${largestExpense.name}" (${formatCurrency(largestExpense.amount, largestExpense.currency)}) yang jadi penyebab utamanya.`
      : previousScopedTotal > 0 && delta < 0
        ? `Pengeluaran turun ${Math.abs(Math.round((delta / previousScopedTotal) * 100))}% dari periode lalu — tren positif, pertahankan.`
        : null,
  ];

  return {
    title: `Analisis ${filterLabel === 'Semua' ? '' : `${filterLabel.toLowerCase()} `}${scopeLabel}`.trim(),
    summary: summaryParts.join(' '),
    highlights: highlights.filter((h): h is string => h !== null && h !== undefined && h !== ''),
    actions: actions.filter((a): a is string => a !== null && a !== undefined && a !== ''),
  };
}

// ============================================================
//  buildQuickInsightLine
//
//  Design principles:
//  1. ONE short sentence (~15-20 words max) — scannable in 2 seconds
//  2. Focus on behavioral insight, not data recap
//  3. Don't repeat info already visible in the UI (total, breakdown)
//  4. Priority: budget status > behavioral warning > pattern signal
// ============================================================
export function buildQuickInsightLine(params: {
  filterLabel: string;
  currency: 'IDR' | 'USD';
  scopedExpenses: Expense[];
  scopedTotal: number;
  topCategories: HistoryInsightCategory[];
  personalTopCategories?: HistoryInsightCategory[];
  previousScopedTotal: number;
  familySupportTotal?: number;
  personalTotal?: number;
  personalNeedsTotal?: number;
  personalWantsTotal?: number;
  personalBudget?: number;
}): string {
  const {
    filterLabel,
    currency,
    scopedExpenses,
    scopedTotal,
    topCategories,
    personalTopCategories,
    previousScopedTotal,
    familySupportTotal = 0,
    personalTotal = scopedTotal,
    personalNeedsTotal = 0,
    personalWantsTotal = 0,
    personalBudget = 0,
  } = params;

  if (scopedExpenses.length === 0) {
    return `Belum ada transaksi ${filterLabel === 'Semua' ? '' : filterLabel.toLowerCase() + ' '}periode ini.`;
  }

  const fmt = (n: number) => formatCurrency(n, currency);
  const spendingExpenses = scopedExpenses.filter((e) => e.type !== 'TRANSFER');
  const evaluationExpenses = (filterLabel === 'Semua' && familySupportTotal > 0)
    ? spendingExpenses.filter((e) => !isFamilySupportExpense(e))
    : spendingExpenses;
  const evalTopCategories = (filterLabel === 'Semua' && familySupportTotal > 0 && personalTopCategories?.length)
    ? personalTopCategories
    : topCategories;
  const topCat = evalTopCategories[0];
  const delta = scopedTotal - previousScopedTotal;
  const deltaPct = previousScopedTotal > 0
    ? Math.round((delta / previousScopedTotal) * 100)
    : null;
  const evalTotal = (filterLabel === 'Semua' && familySupportTotal > 0) ? personalTotal : scopedTotal;
  const largest = getLargestExpense(evaluationExpenses);
  const largestShare = largest && evalTotal > 0 ? Math.round((largest.amount / evalTotal) * 100) : 0;
  const personalSpendingTotal = personalNeedsTotal + personalWantsTotal;
  const personalWantsPct = personalSpendingTotal > 0
    ? Math.round((personalWantsTotal / personalSpendingTotal) * 100)
    : 0;

  // ── TRANSFER ───────────────────────────────────────────────
  if (filterLabel === 'TRANSFER') {
    if (hasFundingTransferPattern(scopedExpenses)) return 'Ini pencairan/penarikan dana — bukan pengeluaran konsumtif.';
    return 'Perpindahan saldo antar akun — bukan belanja langsung.';
  }

  // ── WANT ───────────────────────────────────────────────────
  if (filterLabel === 'WANT') {
    if (personalBudget > 0 && scopedTotal > personalBudget) {
      return `Sudah lewat budget ${fmt(scopedTotal - personalBudget)} — perlu rem.`;
    }
    if (largest && largestShare >= 35) {
      return `"${largest.name}" menyerap ${largestShare}% dari seluruh want.`;
    }
    if (topCat && topCat.pct >= 40) {
      return `Sebagian besar want lari ke ${topCat.label} (${topCat.pct}%).`;
    }
    if (deltaPct !== null && deltaPct >= 20) {
      return `Want naik ${Math.abs(deltaPct)}% dari periode lalu.`;
    }
    if (deltaPct !== null && deltaPct <= -20) {
      return `Want turun ${Math.abs(deltaPct)}% — tren bagus.`;
    }
    if (topCat) {
      return `Tersebar merata, terbanyak di ${topCat.label} (${topCat.pct}%).`;
    }
    return `${spendingExpenses.length} transaksi want periode ini.`;
  }

  // ── NEED ───────────────────────────────────────────────────
  if (filterLabel === 'NEED') {
    if (familySupportTotal > 0) {
      const personalNeedExpenses = spendingExpenses.filter((e) => e.type === 'NEED' && !isFamilySupportExpense(e));
      const personalNeedTotal = personalNeedExpenses.reduce((s, e) => s + e.amount, 0);
      if (personalNeedTotal > 0) {
        return `Kebutuhan pribadi ${fmt(personalNeedTotal)} — sisanya bantuan keluarga.`;
      }
      return `Seluruhnya bantuan keluarga — belum ada need pribadi.`;
    }
    if (largest && largestShare >= 40) {
      return `"${largest.name}" menyerap ${largestShare}% dari seluruh need.`;
    }
    if (topCat && topCat.pct >= 40) {
      return `${topCat.label} jadi pos kebutuhan terbesar (${topCat.pct}%).`;
    }
    if (deltaPct !== null && Math.abs(deltaPct) >= 20) {
      return `Need ${delta > 0 ? 'naik' : 'turun'} ${Math.abs(deltaPct)}% dari periode lalu.`;
    }
    if (topCat) {
      return `Porsi terbesar di ${topCat.label} (${topCat.pct}%).`;
    }
    return `${spendingExpenses.length} transaksi kebutuhan periode ini.`;
  }

  // ── SEMUA (ALL) ────────────────────────────────────────────
  //
  // Evaluation logic:
  //  - Want ratio ONLY matters when spending is near/over budget (>75%)
  //  - When well under budget, the useful insight is budget status
  //  - Budget overage is always the top priority

  if (familySupportTotal > 0) {
    const budgetUsedPct = personalBudget > 0 ? Math.round((personalTotal / personalBudget) * 100) : 0;

    // 1. Over budget → urgent warning
    if (personalBudget > 0 && personalTotal > personalBudget) {
      return `Belanja pribadi lewat budget ${fmt(personalTotal - personalBudget)}.`;
    }
    // 2. Near budget (>75%) AND high want → want ratio is relevant here
    if (personalBudget > 0 && budgetUsedPct > 75 && personalWantsPct > 60 && personalSpendingTotal > 0) {
      return `Budget tinggal ${100 - budgetUsedPct}% dan want masih ${personalWantsPct}%.`;
    }
    // 3. Near budget (>75%) → budget nearly exhausted
    if (personalBudget > 0 && budgetUsedPct > 75) {
      return `Sudah terpakai ${budgetUsedPct}% budget — sisa ${fmt(personalBudget - personalTotal)}.`;
    }
    // 4. Well under budget → positive, reassuring status
    if (personalBudget > 0) {
      return `Belanja pribadi ${fmt(personalTotal)}, sisa budget ${fmt(personalBudget - personalTotal)}.`;
    }
    // 5. No budget set → basic personal total
    return `Belanja pribadimu ${fmt(personalTotal)} di luar bantuan keluarga.`;
  }

  // Without family support
  const budgetUsedPctAll = personalBudget > 0 ? Math.round((personalTotal / personalBudget) * 100) : 0;

  if (personalBudget > 0 && personalTotal > personalBudget) {
    return `Sudah lewat budget ${fmt(personalTotal - personalBudget)}.`;
  }
  if (personalBudget > 0 && budgetUsedPctAll > 75) {
    return `Sudah terpakai ${budgetUsedPctAll}% budget — sisa ${fmt(personalBudget - personalTotal)}.`;
  }
  if (largest && largestShare >= 40) {
    return `"${largest.name}" menyerap ~${largestShare}% total bulan ini.`;
  }
  if (topCat && topCat.pct >= 50) {
    return `${topCat.label} mendominasi ${topCat.pct}% pengeluaran.`;
  }
  if (deltaPct !== null && Math.abs(deltaPct) >= 15) {
    return `Pengeluaran ${delta > 0 ? 'naik' : 'turun'} ${Math.abs(deltaPct)}% dari periode lalu.`;
  }
  if (personalBudget > 0) {
    return `Masih dalam budget — sisa ${fmt(personalBudget - personalTotal)}.`;
  }
  if (topCat) {
    return `Pos terbesar: ${topCat.label} (${topCat.pct}%).`;
  }
  return `${spendingExpenses.length} transaksi periode ini.`;
}


// ============================================================
//  buildTopCategories
// ============================================================
export function buildTopCategories(
  scopedMonthExpenses: Expense[],
  categories: Array<{ slug: string; label: string }>,
  scopedTotal: number,
  toDisplay: (expense: Expense) => number,
  /** Category slugs to exclude from the ranking (e.g. ['keluarga']) */
  excludeCategories?: string[]
): HistoryInsightCategory[] {
  const excludeSet = excludeCategories ? new Set(excludeCategories.map(s => s.toLowerCase())) : null;
  const totals: Record<string, number> = {};
  scopedMonthExpenses.forEach((expense) => {
    // Skip excluded categories
    if (excludeSet && excludeSet.has(expense.category.toLowerCase())) return;
    // Also skip family-support-detected expenses when excluding keluarga
    if (excludeSet && excludeSet.has('keluarga') && isFamilySupportExpense(expense)) return;
    const key = expense.type === 'TRANSFER'
      ? `transfer:${expense.destination ?? 'Tanpa tujuan'}`
      : expense.category;
    totals[key] = (totals[key] ?? 0) + toDisplay(expense);
  });

  // Recalculate denominator for percentage if categories are excluded
  const adjustedTotal = excludeSet ? Object.values(totals).reduce((s, v) => s + v, 0) : scopedTotal;

  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([slug, amount]) => {
      const isTransfer = slug.startsWith('transfer:');
      const category = categories.find((item) => item.slug === slug);
      return {
        label: isTransfer ? slug.replace('transfer:', 'Transfer ke ') : (category?.label ?? slug),
        amount,
        pct: adjustedTotal > 0 ? Math.round((amount / adjustedTotal) * 100) : 0,
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
