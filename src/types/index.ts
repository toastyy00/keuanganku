// ============================================================
//  KEUANGANKU — Canonical Domain Types
// ============================================================

export type Currency = 'IDR' | 'USD';
export type ExpenseType = 'NEED' | 'WANT' | 'TRANSFER';

// ── Expense ──────────────────────────────────────────────────

export interface Expense {
  /** UUID v4 */
  id: string;
  /** Display name / short description */
  name: string;
  /** Always stored as-is; converted with formatCurrency() on display */
  amount: number;
  currency: Currency;
  /** Category slug, e.g. "makan", "tagihan". Empty string for TRANSFER type. */
  category: string;
  type: ExpenseType;
  /** Only used when type === 'TRANSFER'. Target wallet/account/platform. */
  destination?: string;
  /** ISO date string "YYYY-MM-DD" */
  date: string;
  note?: string;
  is_recurring: boolean;
  /** Foreign key to RecurringTemplate.id */
  recurring_id?: string;
  /** ISO timestamp of creation */
  created_at: string;
  /** Whether this record has been synced to Supabase */
  synced: boolean;
}

// ── Recurring Template ────────────────────────────────────────

export interface RecurringTemplate {
  /** UUID v4 */
  id: string;
  name: string;
  amount: number;
  currency: Currency;
  category: string;
  type: ExpenseType;
  /** Custom schedule details, e.g. "Tanggal 25" or "Tiap hari Selasa" */
  schedule_detail?: string;
  note?: string;
  /** ISO date of the most recent logged expense from this template */
  last_logged?: string;
  active: boolean;
}

// ── Category ──────────────────────────────────────────────────

export interface Category {
  /** Unique slug — also used as FK in Expense.category */
  slug: string;
  label: string;
  emoji: string;
  /** Whether this is a system preset (cannot be deleted by default) */
  is_default: boolean;
}

// ── App Settings (stored in localStorage) ────────────────────

export interface AppSettings {
  currency: Currency;
}

// ── Repository interfaces ─────────────────────────────────────

export interface ExpenseRepository {
  getAll(): Promise<Expense[]>;
  getByMonth(year: number, month: number): Promise<Expense[]>;
  create(data: Omit<Expense, 'id' | 'created_at' | 'synced'>): Promise<Expense>;
  update(id: string, data: Partial<Expense>): Promise<Expense>;
  delete(id: string): Promise<void>;
}

export interface CategoryRepository {
  getAll(): Promise<Category[]>;
  create(data: Category): Promise<Category>;
  update(slug: string, data: Partial<Category>): Promise<Category>;
  delete(slug: string): Promise<void>;
}

export interface RecurringRepository {
  getAll(): Promise<RecurringTemplate[]>;
  create(data: Omit<RecurringTemplate, 'id'>): Promise<RecurringTemplate>;
  update(id: string, data: Partial<RecurringTemplate>): Promise<RecurringTemplate>;
  delete(id: string): Promise<void>;
}

export interface PortfolioPocket {
  id: string;
  name: string;
  source_type: 'CEX' | 'WEB3' | 'WALLET' | 'LAINNYA';
  source?: string;
  color_theme: string;
  icon: string;
  sort_order: number;
  created_at: string;
}

export interface PortfolioAsset {
  id: string;
  pocket_id: string;
  ticker: string;
  coingecko_id?: string;
  amount: number;
  location: string;
  holding_type: 'liquid' | 'staked' | 'locked';
  chain?: string;
  note?: string;
  created_at: string;
}

export interface PortfolioActivityLog {
  id: string;
  pocket_id: string;
  asset_id: string;
  ticker: string;
  action: 'ADD' | 'REDUCE';
  amount_change: number;
  balance_after: number;
  price_at_time: number;
  location?: string;
  note?: string;
  created_at: string;
}
