import type { Currency, Expense, ExpenseType } from '../types';

// ============================================================
//  CLASS MERGE UTILITY
// ============================================================

type ClassValue = string | undefined | null | false | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  return inputs.flat(Infinity as 0).filter(Boolean).join(' ');
}

// ============================================================
//  CURRENCY FORMATTING
// ============================================================

export function formatCurrency(amount: number, currency: Currency): string {
  if (currency === 'IDR') {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatAmount(amount: number, currency: Currency): string {
  if (currency === 'IDR') {
    return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(amount);
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function roundPortfolioAmount(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100_000_000) / 100_000_000;
}

export function formatPortfolioAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 8,
  }).format(roundPortfolioAmount(amount));
}

// ============================================================
//  DATE UTILITIES
// ============================================================

export function getLocalISODate(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}-${month}-${day}`;
}

export function todayISO(): string {
  return getLocalISODate();
}

export function friendlyDate(isoDate: string, locale = 'id-ID'): string {
  const today = todayISO();
  const yesterday = getLocalISODate(new Date(Date.now() - 86_400_000));
  if (isoDate === today) return 'Hari ini';
  if (isoDate === yesterday) return 'Kemarin';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(isoDate + 'T00:00:00'));
}

// ============================================================
//  GROUPING
// ============================================================

export function groupExpensesByDate(
  expenses: Expense[]
): Record<string, Expense[]> {
  const groups: Record<string, Expense[]> = {};
  for (const expense of expenses) {
    if (!groups[expense.date]) groups[expense.date] = [];
    groups[expense.date].push(expense);
  }
  const sorted: Record<string, Expense[]> = {};
  for (const key of Object.keys(groups).sort((a, b) => b.localeCompare(a))) {
    sorted[key] = groups[key];
  }
  return sorted;
}

// ============================================================
//  NEEDS vs WANTS SPLIT
//  TRANSFER entries are EXCLUDED from the calculation.
// ============================================================

export interface NeedsWantsSplit {
  needs: number;
  wants: number;
  needsPct: number;
  wantsPct: number;
}

export function calcNeedsWantsSplit(expenses: Expense[]): NeedsWantsSplit {
  let needs = 0;
  let wants = 0;

  for (const e of expenses) {
    // Exclude TRANSFER from split calculation
    if (e.type === 'NEED') needs += e.amount;
    else if (e.type === 'WANT') wants += e.amount;
  }

  const total = needs + wants;
  if (total === 0) return { needs: 0, wants: 0, needsPct: 0, wantsPct: 0 };

  const needsPct = Math.round((needs / total) * 100);
  return { needs, wants, needsPct, wantsPct: 100 - needsPct };
}

// ============================================================
//  CSV EXPORT  (includes destination column for TRANSFER)
// ============================================================

const CSV_HEADERS = [
  'ID', 'Date', 'Name', 'Amount', 'Currency',
  'Category', 'Type', 'Destination', 'Note',
  'Is Recurring', 'Recurring ID', 'Created At', 'Synced',
] as const;

function escapeCsvField(value: string): string {
  const str = String(value ?? '');
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCSV(expenses: Expense[]): string {
  const BOM = '\uFEFF';
  const SEP = ';';
  const header = CSV_HEADERS.map(escapeCsvField).join(SEP);
  const rows = expenses.map((e) =>
    [
      e.id, e.date, e.name, String(e.amount), e.currency,
      e.category, e.type, e.destination ?? '',
      e.note ?? '', e.is_recurring ? 'true' : 'false',
      e.recurring_id ?? '', e.created_at, e.synced ? 'true' : 'false',
    ].map(escapeCsvField).join(SEP)
  );
  return BOM + [header, ...rows].join('\r\n');
}

export function downloadCSV(expenses: Expense[], filename?: string): void {
  const csv = generateCSV(expenses);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename ?? `keuanganku-export-${todayISO()}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ============================================================
//  MONTH HELPERS
// ============================================================

export function currentMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function monthLabel(year: number, month: number, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
}

// ============================================================
//  TYPE GUARDS
// ============================================================

export function isExpenseType(value: unknown): value is ExpenseType {
  return value === 'NEED' || value === 'WANT' || value === 'TRANSFER';
}

export function isCurrency(value: unknown): value is Currency {
  return value === 'IDR' || value === 'USD';
}
