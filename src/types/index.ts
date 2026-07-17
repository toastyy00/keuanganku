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

// ── Income Entry ──────────────────────────────────────────────

export type IncomeAssetType = 'FIAT' | 'CRYPTO';

export interface IncomeEntry {
  id: string;
  title: string;
  source_type: string;              // free text, e.g. "Gaji", "Trading", "LP DLMM"

  // ── Received ──────────────────────────────────────
  asset_type: IncomeAssetType;
  amount: number;
  ticker?: string;
  coingecko_id?: string;
  currency: Currency;               // IDR | USD
  price_at_time?: number;           // USD per unit at recording
  is_manual_price?: boolean;
  value_usd: number;                // total in USD at recording
  value_idr: number;                // total in IDR at recording

  // ── Cost Basis (optional) ─────────────────────────
  has_cost_basis: boolean;
  cost_amount?: number;
  cost_ticker?: string;             // 'SOL', 'ETH', any token, or null = fiat
  cost_coingecko_id?: string;
  cost_price_per_unit?: number;     // USD per cost token at recording
  cost_is_manual_price?: boolean;
  cost_value_usd?: number;
  cost_value_idr?: number;

  // ── Metadata ──────────────────────────────────────
  chain?: string;                   // free text
  platform?: string;                // free text
  pocket_id?: string;
  contract_address?: string;
  mcap_at_time?: number;
  cost_mcap?: number;
  token_ticker?: string;
  token_price_entry?: number;
  token_price_exit?: number;
  date: string;                     // "YYYY-MM-DD"
  note?: string;

  // ── Sync ──────────────────────────────────────────
  created_at: string;
  synced: boolean;
}

export interface IncomeRepository {
  getAll(): Promise<IncomeEntry[]>;
  create(data: Omit<IncomeEntry, 'id' | 'created_at' | 'synced'>): Promise<IncomeEntry>;
  update(id: string, data: Partial<IncomeEntry>): Promise<IncomeEntry>;
  delete(id: string): Promise<void>;
}
