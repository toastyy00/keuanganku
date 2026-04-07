import type { Expense, ExpenseType } from '../types';
import { formatCurrency } from './utils';

export type HistoryInsightIntent = 'summary' | 'transaction_insights';
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
  monthLabelStr: string;
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

// ── helper: find repeated item names ────────────────────────────
function getRepeatedItem(expenses: Expense[]): { name: string; count: number; total: number } | null {
  const freq: Record<string, { count: number; total: number }> = {};
  for (const e of expenses) {
    const key = e.name.trim().toLowerCase();
    if (!key) continue;
    freq[key] = { count: (freq[key]?.count ?? 0) + 1, total: (freq[key]?.total ?? 0) + e.amount };
  }
  const repeated = Object.entries(freq)
    .filter(([, v]) => v.count > 1)
    .sort(([, a], [, b]) => b.total - a.total)[0];
  if (!repeated) return null;
  // Normalise capitalisation to match one of the original names
  const originalName = expenses.find((e) => e.name.trim().toLowerCase() === repeated[0])?.name ?? repeated[0];
  return { name: originalName, count: repeated[1].count, total: repeated[1].total };
}

// ── helper: month-over-month change label ───────────────────────
function buildDeltaLabel(delta: number, deltaPct: number | null): string {
  if (deltaPct === null) return '';
  const arrow = delta > 0 ? 'naik' : 'turun';
  const sign = delta > 0 ? '+' : '';
  return `${arrow} ${sign}${formatPct(deltaPct)} dari bulan lalu`;
}

// ============================================================
//  buildSummaryInsight  (improved)
// ============================================================
export function buildSummaryInsight(params: HistoryInsightParams): HistoryInsightResponse {
  const {
    monthLabelStr,
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
  const largestExpense = getLargestExpense(scopedExpenses.filter((e) => e.type !== 'TRANSFER'));
  const repeatedItem = getRepeatedItem(scopedExpenses.filter((e) => e.type !== 'TRANSFER'));
  const avgPerTx = transactionCount > 0 ? Math.round(scopedTotal / transactionCount) : 0;

  // ── summary paragraph ────────────────────────────────────────
  const summaryParts: string[] = [];

  if (filterLabel === 'NEED') {
    summaryParts.push(
      `Transaksi need di ${monthLabelStr}: ${transactionCount} transaksi, total ${formatCurrency(scopedTotal, currency)}.`
    );
    if (familySupportTotal > 0) {
      summaryParts.push(`Sebagian need ini masuk ke bantuan keluarga, sehingga kebutuhan harian pribadimu lebih rendah dari total itu.`);
    } else if (topCategory) {
      summaryParts.push(`Porsi need terbesar ada di ${topCategory.label} (${topCategory.pct}%).`);
    }
    if (deltaPct !== null) {
      summaryParts.push(`Dibanding bulan lalu, need ${buildDeltaLabel(delta, deltaPct)}.`);
    } else {
      summaryParts.push('Belum ada data bulan lalu sebagai pembanding.');
    }
  } else if (filterLabel === 'WANT') {
    summaryParts.push(
      `Transaksi want di ${monthLabelStr}: ${transactionCount} transaksi, total ${formatCurrency(scopedTotal, currency)}.`
    );
    if (topCategory) {
      summaryParts.push(
        secondCategory
          ? `Porsi terbesar dari ${topCategory.label} (${topCategory.pct}%) diikuti ${secondCategory.label} (${secondCategory.pct}%).`
          : `Want paling besar datang dari ${topCategory.label} (${topCategory.pct}%).`
      );
    }
    if (deltaPct !== null) {
      summaryParts.push(`Dibanding bulan lalu, want ${buildDeltaLabel(delta, deltaPct)}.`);
    }
  } else if (filterLabel === 'TRANSFER') {
    summaryParts.push(
      `Transfer di ${monthLabelStr}: ${transactionCount} transaksi, total ${formatCurrency(scopedTotal, currency)}.`
    );
    summaryParts.push(
      fundingTransferPattern
        ? 'Polanya menunjukkan perpindahan dana (cth. pencairan USDT/crypto), bukan belanja konsumtif langsung.'
        : 'Ini lebih tepat dibaca sebagai perpindahan saldo antar akun, bukan pengeluaran harian.'
    );
    if (deltaPct !== null) {
      summaryParts.push(`Dibanding bulan lalu, total transfer ${buildDeltaLabel(delta, deltaPct)}.`);
    }
  } else {
    // ALL
    summaryParts.push(
      `Total ${scopeNoun.toLowerCase()} di ${monthLabelStr}: ${transactionCount} transaksi, ${formatCurrency(scopedTotal, currency)}.`
    );
    if (familySupportTotal > 0) {
      summaryParts.push(
        `Dari angka itu, ${formatCurrency(familySupportTotal, currency)} adalah bantuan keluarga — belanja pribadimu sekitar ${formatCurrency(personalTotal, currency)}.`
      );
    }
    if (topCategory) {
      const topNote = familySupportTotal > 0
        ? `Di luar keluarga, kategori terbesar ada di ${topCategory.label} (${formatCurrency(topCategory.amount, currency)}, ${topCategory.pct}%).`
        : `Kategori terbesar adalah ${topCategory.label} sebesar ${formatCurrency(topCategory.amount, currency)} (${topCategory.pct}%).`;
      summaryParts.push(topNote);
    }
    if (deltaPct !== null) {
      summaryParts.push(`Pengeluaran ${buildDeltaLabel(delta, deltaPct)}.`);
    } else {
      summaryParts.push('Belum ada data bulan lalu untuk perbandingan.');
    }
    if (avgPerTx > 0 && transactionCount >= 3) {
      summaryParts.push(`Rata-rata per transaksi sekitar ${formatCurrency(avgPerTx, currency)}.`);
    }
  }

  // ── highlights ───────────────────────────────────────────────
  const highlights = [
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
      ? `Bantuan keluarga menyerap ${Math.round((familySupportTotal / scopedTotal) * 100)}% dari total bulan ini.`
      : null,
    // Top category
    topCategory
      ? filterLabel === 'TRANSFER'
        ? `${topCategory.label} menyerap ${topCategory.pct}% dari total transfer.`
        : `${topCategory.label} menyerap ${topCategory.pct}% dari total ${filterLabel === 'Semua' ? 'pengeluaran' : filterLabel.toLowerCase()}.`
      : null,
    // Largest single expense (non-transfer)
    largestExpense && filterLabel !== 'TRANSFER'
      ? `Pengeluaran terbesar: ${largestExpense.name} — ${formatCurrency(largestExpense.amount, largestExpense.currency)}.`
      : null,
    // Repeated item
    repeatedItem && filterLabel !== 'TRANSFER'
      ? `"${repeatedItem.name}" muncul ${repeatedItem.count}× dengan total ${formatCurrency(repeatedItem.total, currency)}.`
      : null,
    // Needs/wants split
    filterLabel === 'Semua'
      ? familySupportTotal > 0
        ? `Di luar bantuan keluarga: kebutuhan pribadi ${formatCurrency(personalNeedsTotal, currency)}, keinginan ${formatCurrency(personalWantsTotal, currency)}.`
        : `Need ${split.needsPct}% · Want ${split.wantsPct}% dari total bulan ini.`
      : filterLabel === 'NEED'
        ? familySupportTotal > 0
          ? 'Need bulan ini termasuk bantuan keluarga — pisahkan keduanya saat evaluasi.'
          : `Need rata-rata ${formatCurrency(avgPerTx, currency)} per transaksi.`
        : filterLabel === 'WANT'
          ? (buildBudgetLine(scopedTotal, personalBudget, currency, 'Want-mu') ?? `Want rata-rata ${formatCurrency(avgPerTx, currency)} per transaksi.`)
          : fundingTransferPattern
            ? 'Transfer ini terlihat sebagai pencairan dana, bukan belanja langsung.'
            : 'Transfer lebih tepat dibaca sebagai perpindahan saldo, bukan pengeluaran konsumtif.',
    // Transfer note (for non-transfer filter)
    filterLabel !== 'TRANSFER' && transferTotal > 0
      ? `Ada transfer ${formatCurrency(transferTotal, currency)} yang sebaiknya dipisahkan dari evaluasi belanja harian.`
      : null,
  ].filter(Boolean) as string[];

  // ── actions ──────────────────────────────────────────────────
  const actions = [
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
    topCategory && topCategory.pct >= 50
      ? `${topCategory.label} mendominasi >50% — pertimbangkan pisahkan sebagai pos khusus jika ini tidak rutin setiap bulan.`
      : repeatedItem
        ? `"${repeatedItem.name}" muncul berulang — pertimbangkan tetapkan batas bulanan untuk pos ini.`
        : 'Pantau kategori teratasmu setiap bulan agar tidak ada pos yang diam-diam membengkak.',
    filterLabel === 'WANT'
      ? 'Tetapkan batas bulanan per kategori want agar belanja tidak bocor tanpa disadari.'
      : split.wantsPct >= 35
        ? 'Porsi want sudah cukup besar — mulai dari situ jika ingin menekan total bulanan.'
        : 'Porsi want masih terkendali, fokus ke pengeluaran besar yang sifatnya kebutuhan.',
    previousScopedTotal > 0 && delta > 0
      ? 'Bandingkan transaksi besar bulan ini dengan bulan lalu untuk tahu apakah kenaikannya memang wajar.'
      : 'Pantau transaksi besar agar mudah membedakan kebutuhan rutin dan pengeluaran sesaat.',
  ].filter(Boolean) as string[];

  return {
    title: `Ringkasan ${filterLabel === 'Semua' ? '' : `${filterLabel.toLowerCase()} `}${monthLabelStr}`.trim(),
    summary: summaryParts.join(' '),
    highlights: highlights.filter((h): h is string => h !== null && h !== undefined && h !== ''),
    actions: actions.filter((a): a is string => a !== null && a !== undefined && a !== ''),
  };
}

// ============================================================
//  buildTransactionInsight  (improved)
// ============================================================
export function buildTransactionInsight(params: Omit<HistoryInsightParams, 'split' | 'transferTotal' | 'previousScopedTotal'>): HistoryInsightResponse {
  const { monthLabelStr, currency, scopedExpenses, scopedTotal, topCategories, filterLabel, personalBudget = 0 } = params;

  const spendingExpenses = scopedExpenses.filter((e) => e.type !== 'TRANSFER');
  const sortedByAmount = [...spendingExpenses].sort((a, b) => b.amount - a.amount);
  const largestExpense = sortedByAmount[0] ?? null;
  const largestWant = sortedByAmount.find((e) => e.type === 'WANT') ?? null;
  const largestNeed = sortedByAmount.find((e) => e.type === 'NEED') ?? null;

  const repeatedItem = getRepeatedItem(spendingExpenses);

  const transferDestinations = Object.entries(
    scopedExpenses
      .filter((e) => e.type === 'TRANSFER' && e.destination)
      .reduce<Record<string, number>>((acc, e) => {
        const key = e.destination ?? '';
        acc[key] = (acc[key] ?? 0) + e.amount;
        return acc;
      }, {})
  ).sort(([, a], [, b]) => b - a)[0];

  const topCategory = topCategories[0];
  const secondCategory = topCategories[1];
  const largestShare = largestExpense && scopedTotal > 0
    ? Math.round((largestExpense.amount / scopedTotal) * 100)
    : 0;
  const fundingTransferPattern = hasFundingTransferPattern(scopedExpenses);

  // Count unique spending days
  const uniqueDays = new Set(spendingExpenses.map((e) => e.date)).size;

  // ── highlights ───────────────────────────────────────────────
  const rawHighlights = [
    largestExpense
      ? `Transaksi terbesar: ${largestExpense.name} — ${formatCurrency(largestExpense.amount, largestExpense.currency)}${largestExpense.note ? ` (${largestExpense.note})` : ''}.`
      : 'Belum ada transaksi yang bisa dianalisis.',
    repeatedItem
      ? `"${repeatedItem.name}" muncul ${repeatedItem.count}× bulan ini — total ${formatCurrency(repeatedItem.total, currency)}.`
      : 'Tidak ada nama transaksi yang berulang mencolok bulan ini.',
    secondCategory
      ? `Dua kategori teratas: ${topCategory?.label ?? '-'} (${topCategory?.pct ?? 0}%) & ${secondCategory.label} (${secondCategory.pct}%).`
      : topCategory
        ? `Satu kategori dominan: ${topCategory.label} menyerap ${topCategory.pct}% dari total.`
        : null,
    transferDestinations
      ? `Transfer paling besar mengarah ke ${transferDestinations[0]} — ${formatCurrency(transferDestinations[1], currency)}.`
      : null,
    filterLabel === 'TRANSFER' && fundingTransferPattern
      ? 'Beberapa transfer terlihat seperti pencairan dana (USDT/crypto) untuk kebutuhan bulanan.'
      : null,
    filterLabel === 'WANT' && personalBudget > 0
      ? buildBudgetLine(scopedTotal, personalBudget, currency, 'Total want-mu')
      : null,
    uniqueDays > 0 && spendingExpenses.length > 0
      ? `Pengeluaran tersebar di ${uniqueDays} hari — rata-rata ${Math.round(spendingExpenses.length / uniqueDays)} transaksi/hari.`
      : null,
  ].filter(Boolean) as Array<string | null>;
  const highlights = rawHighlights.filter((h): h is string => h !== null && h !== '');

  // ── summary paragraph ────────────────────────────────────────
  const summaryParts: string[] = [];

  if (filterLabel === 'TRANSFER') {
    summaryParts.push(
      topCategory
        ? `Transfer ${monthLabelStr}: aliran dana terbesar mengarah ke ${topCategory.label}.`
        : `Belum ada pola transfer yang cukup kuat di ${monthLabelStr}.`
    );
    summaryParts.push(
      fundingTransferPattern
        ? 'Nama transaksi dan tujuan menunjukkan ini pencairan dana (cth. USDT/PINTU), bukan pengeluaran konsumtif.'
        : 'Belum ada petunjuk kuat bahwa transfer ini pengeluaran langsung.'
    );
    if (largestExpense) {
      summaryParts.push(`Transfer terbesar: ${largestExpense.name} (${formatCurrency(largestExpense.amount, largestExpense.currency)}).`);
    }
  } else if (filterLabel === 'WANT') {
    summaryParts.push(
      topCategory
        ? `Want ${monthLabelStr}: porsi terbesar di ${topCategory.label} (${topCategory.pct}%).`
        : `Belum ada pola want yang kuat di ${monthLabelStr}.`
    );
    summaryParts.push(
      largestExpense
        ? largestShare >= 35
          ? `Want terbesar "${largestExpense.name}" menyumbang ~${largestShare}% dari total want bulan ini.`
          : `Want tersebar cukup merata — tidak ada satu item yang terlalu mendominasi.`
        : 'Belum ada transaksi want yang bisa dianalisis.'
    );
    if (largestWant && largestWant.id !== largestExpense?.id) {
      summaryParts.push(`Item want menonjol lainnya: ${largestWant.name} (${formatCurrency(largestWant.amount, largestWant.currency)}).`);
    }
  } else if (filterLabel === 'NEED') {
    summaryParts.push(
      topCategory
        ? `Need ${monthLabelStr}: porsi terbesar di ${topCategory.label} (${topCategory.pct}%).`
        : `Belum ada pola need yang kuat di ${monthLabelStr}.`
    );
    summaryParts.push(
      largestExpense
        ? largestShare >= 35
          ? `Satu kebutuhan besar "${largestExpense.name}" mendominasi sekitar ${largestShare}% dari total need.`
          : 'Need bulan ini relatif tersebar di beberapa transaksi — tidak ada satu yg terlalu besar.'
        : 'Belum ada transaksi need untuk dianalisis.'
    );
    if (largestNeed && largestNeed.note) {
      summaryParts.push(`Catatan pada need terbesar: "${largestNeed.note}".`);
    }
  } else {
    // ALL
    summaryParts.push(
      topCategory
        ? `Pola transaksi ${monthLabelStr}: ${topCategory.label} jadi kategori terbesar${secondCategory ? `, disusul ${secondCategory.label}` : ''}.`
        : `Belum ada pola kategori yang kuat di ${monthLabelStr}.`
    );
    summaryParts.push(
      largestExpense
        ? largestShare >= 35
          ? `"${largestExpense.name}" menyumbang ~${largestShare}% dari total — bulan ini terasa berat karena satu titik pengeluaran utama.`
          : 'Tidak ada satu transaksi yang terlalu mendominasi — pengeluaran tersebar.'
        : 'Belum ada transaksi yang bisa dianalisis.'
    );
    if (repeatedItem) {
      summaryParts.push(`"${repeatedItem.name}" adalah pengeluaran paling sering berulang bulan ini.`);
    }
  }

  // ── actions ──────────────────────────────────────────────────
  const actions: string[] = [
    filterLabel === 'TRANSFER'
      ? fundingTransferPattern
        ? 'Beri nama/catatan konsisten pada transfer rutin agar pola dana masuk lebih mudah terlacak.'
        : 'Bedakan transfer saldo dengan dana yang benar-benar keluar agar histori lebih bersih.'
      : largestExpense && largestShare >= 35
        ? `Tandai "${largestExpense.name}" sebagai pengeluaran insidental jika ini tidak rutin setiap bulan.`
        : 'Perhatikan transaksi nominalnya paling besar karena biasanya paling cepat menggeser total bulanan.',
    repeatedItem
      ? `Karena "${repeatedItem.name}" muncul berulang, pertimbangkan tetapkan batas bulanan khusus untuk pos ini.`
      : filterLabel === 'TRANSFER'
        ? 'Fokus ke tujuan transfer yang paling sering dipakai supaya arus dana lebih mudah dipantau.'
        : 'Karena pola transaksi tersebar, pantau kategori teratas dulu sebelum menetapkan batas per item.',
    filterLabel === 'WANT' && largestWant
      ? `Kalau mau mulai hemat, pangkas dari "${largestWant.name}" dulu — itu want terbesar bulan ini.`
      : filterLabel === 'TRANSFER'
        ? 'Jangan campurkan transfer dengan evaluasi boros/hemat sampai dana itu benar-benar dipakai.'
        : 'Fokuskan kontrol ke transaksi kebutuhan terbesar agar total bulan depan lebih stabil.',
  ];

  return {
    title: `Pola transaksi ${filterLabel === 'Semua' ? '' : `${filterLabel.toLowerCase()} `}${monthLabelStr}`.trim(),
    summary: summaryParts.join(' '),
    highlights,
    actions,
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
