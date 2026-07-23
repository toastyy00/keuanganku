import type {
  Expense,
  Category,
  RecurringTemplate,
  PortfolioActivityLog,
  PortfolioAsset,
  PortfolioPocket,
  IncomeEntry,
} from '../types';
import { useAuthStore } from '../store/useAuthStore';
import { v4 as uuidv4 } from 'uuid';
import { getSupabaseClientAsync } from './supabase';
import { getLocalISODate } from './utils';
import { writeIDB } from './idb-storage';
import { getActiveDataScope, scopedDataKey } from './dataScope';
import { resetSyncStateForScope, syncWithSupabaseIfNeeded } from './sync-engine';
import { getPortfolioActivityLogRepo, getPortfolioAssetRepo, getPortfolioPocketRepo } from './portfolio-repository';
import { getIncomeRepository } from './repository';

// ============================================================
//  SYNC — Compatibility wrapper (delegates to local-first sync engine)
// ============================================================

export interface SyncResult {
  synced: number;
  failed: number;
  errors: string[];
}

type ImportedCategory = Partial<Category> & { user_id?: string };
type ImportedRecurring = Partial<RecurringTemplate> & { user_id?: string; frequency?: string };
type ImportedExpense = Partial<Expense> & { user_id?: string };
type ImportedPortfolioPocket = Partial<PortfolioPocket> & { user_id?: string };
type ImportedPortfolioAsset = Partial<PortfolioAsset> & { user_id?: string };
type ImportedPortfolioActivityLog = Partial<PortfolioActivityLog> & { user_id?: string };
type ImportedIncome = Partial<IncomeEntry> & { user_id?: string };

export async function syncToSupabase(): Promise<SyncResult> {
  const result = await syncWithSupabaseIfNeeded({ force: true });

  if (result.skipped) {
    return {
      synced: 0,
      failed: 0,
      errors: result.reason ? [`Sync dilewati: ${result.reason}`] : [],
    };
  }

  const errors: string[] = [];
  if (result.queueRemaining > 0) {
    errors.push(`Masih ada ${result.queueRemaining} perubahan yang belum tersinkron.`);
  }

  return {
    synced: result.pushed,
    failed: 0,
    errors,
  };
}

// ============================================================
//  JSON BACKUP
// ============================================================

interface PortfolioBackupData {
  pockets: PortfolioPocket[];
  assets: PortfolioAsset[];
  activityLogs: PortfolioActivityLog[];
}

export async function exportJSON(data: {
  expenses: Expense[];
  categories: Category[];
  recurring: RecurringTemplate[];
  incomes?: IncomeEntry[];
  portfolio?: PortfolioBackupData;
}): Promise<void> {
  const incomes = data.incomes ?? (await getIncomeRepository().getAll());
  const portfolio = data.portfolio ?? {
    pockets: await getPortfolioPocketRepo().getAll(),
    assets: await getPortfolioAssetRepo().getAll(),
    activityLogs: await getPortfolioActivityLogRepo().getAll(),
  };

  const payload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    expenses: data.expenses,
    categories: data.categories,
    recurring: data.recurring,
    incomes,
    portfolio,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `keuanganku-backup-${getLocalISODate()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ============================================================
//  JSON IMPORT
// ============================================================

interface BackupData {
  version: number;
  expenses?: Expense[];
  categories?: unknown[];
  recurring?: unknown[];
  incomes?: unknown[];
  portfolio?: {
    pockets?: unknown[];
    assets?: unknown[];
    activityLogs?: unknown[];
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toImportedCategory(value: unknown): ImportedCategory | null {
  return isObject(value) ? (value as ImportedCategory) : null;
}

function toImportedRecurring(value: unknown): ImportedRecurring | null {
  return isObject(value) ? (value as ImportedRecurring) : null;
}

function toImportedExpense(value: unknown): ImportedExpense | null {
  return isObject(value) ? (value as ImportedExpense) : null;
}

function toImportedPortfolioPocket(value: unknown): ImportedPortfolioPocket | null {
  return isObject(value) ? (value as ImportedPortfolioPocket) : null;
}

function toImportedPortfolioAsset(value: unknown): ImportedPortfolioAsset | null {
  return isObject(value) ? (value as ImportedPortfolioAsset) : null;
}

function toImportedPortfolioActivityLog(value: unknown): ImportedPortfolioActivityLog | null {
  return isObject(value) ? (value as ImportedPortfolioActivityLog) : null;
}

function toImportedIncome(value: unknown): ImportedIncome | null {
  return isObject(value) ? (value as ImportedIncome) : null;
}

function normalizeImportedPortfolioPockets(raw: unknown[] | undefined): PortfolioPocket[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(toImportedPortfolioPocket)
    .filter((p): p is ImportedPortfolioPocket => p !== null)
    .map((p) => ({
      id: typeof p.id === 'string' ? p.id : uuidv4(),
      name: typeof p.name === 'string' ? p.name : 'Pocket',
      source_type: (p.source_type === 'CEX' || p.source_type === 'WEB3' || p.source_type === 'WALLET') ? p.source_type : 'LAINNYA',
      source: typeof p.source === 'string' && p.source.trim() ? p.source.trim() : undefined,
      color_theme: typeof p.color_theme === 'string' ? p.color_theme : 'blue',
      icon: typeof p.icon === 'string' ? p.icon : 'Wallet',
      sort_order: typeof p.sort_order === 'number' ? p.sort_order : 0,
      created_at: typeof p.created_at === 'string' ? p.created_at : new Date().toISOString(),
    }));
}

function normalizeImportedPortfolioAssets(raw: unknown[] | undefined): PortfolioAsset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(toImportedPortfolioAsset)
    .filter((a): a is ImportedPortfolioAsset => a !== null)
    .map((a) => ({
      id: typeof a.id === 'string' ? a.id : uuidv4(),
      pocket_id: typeof a.pocket_id === 'string' ? a.pocket_id : '',
      ticker: typeof a.ticker === 'string' ? a.ticker.trim().toUpperCase() : 'ASSET',
      coingecko_id: typeof a.coingecko_id === 'string' ? a.coingecko_id : undefined,
      amount: typeof a.amount === 'number' ? a.amount : 0,
      location: typeof a.location === 'string' && a.location.trim() ? a.location.trim() : 'Wallet',
      holding_type: a.holding_type === 'staked' || a.holding_type === 'locked' ? a.holding_type : 'liquid',
      chain: typeof a.chain === 'string' && a.chain.trim() ? a.chain.trim() : undefined,
      note: typeof a.note === 'string' && a.note.trim() ? a.note.trim() : undefined,
      created_at: typeof a.created_at === 'string' ? a.created_at : new Date().toISOString(),
    }));
}

function normalizeImportedPortfolioActivityLogs(raw: unknown[] | undefined): PortfolioActivityLog[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(toImportedPortfolioActivityLog)
    .filter((log): log is ImportedPortfolioActivityLog => log !== null)
    .map((log) => ({
      id: typeof log.id === 'string' ? log.id : uuidv4(),
      pocket_id: typeof log.pocket_id === 'string' ? log.pocket_id : '',
      asset_id: typeof log.asset_id === 'string' ? log.asset_id : '',
      ticker: typeof log.ticker === 'string' ? log.ticker.trim().toUpperCase() : 'ASSET',
      action: log.action === 'REDUCE' ? 'REDUCE' : 'ADD',
      amount_change: typeof log.amount_change === 'number' ? log.amount_change : 0,
      balance_after: typeof log.balance_after === 'number' ? log.balance_after : 0,
      price_at_time: typeof log.price_at_time === 'number' ? log.price_at_time : 0,
      location: typeof log.location === 'string' ? log.location : undefined,
      note: typeof log.note === 'string' ? log.note : undefined,
      created_at: typeof log.created_at === 'string' ? log.created_at : new Date().toISOString(),
    }));
}

function normalizeImportedIncomes(raw: unknown[] | undefined): IncomeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(toImportedIncome)
    .filter((inc): inc is ImportedIncome => inc !== null)
    .map((inc) => ({
      id: typeof inc.id === 'string' ? inc.id : uuidv4(),
      title: typeof inc.title === 'string' ? inc.title : 'Income',
      source_type: typeof inc.source_type === 'string' ? inc.source_type : 'Gaji',
      asset_type: inc.asset_type === 'CRYPTO' ? 'CRYPTO' : 'FIAT',
      amount: typeof inc.amount === 'number' ? inc.amount : 0,
      ticker: typeof inc.ticker === 'string' ? inc.ticker : undefined,
      coingecko_id: typeof inc.coingecko_id === 'string' ? inc.coingecko_id : undefined,
      currency: inc.currency === 'USD' ? 'USD' : 'IDR',
      price_at_time: typeof inc.price_at_time === 'number' ? inc.price_at_time : undefined,
      is_manual_price: typeof inc.is_manual_price === 'boolean' ? inc.is_manual_price : undefined,
      value_usd: typeof inc.value_usd === 'number' ? inc.value_usd : 0,
      value_idr: typeof inc.value_idr === 'number' ? inc.value_idr : 0,
      has_cost_basis: typeof inc.has_cost_basis === 'boolean' ? inc.has_cost_basis : false,
      cost_amount: typeof inc.cost_amount === 'number' ? inc.cost_amount : undefined,
      cost_ticker: typeof inc.cost_ticker === 'string' ? inc.cost_ticker : undefined,
      cost_coingecko_id: typeof inc.cost_coingecko_id === 'string' ? inc.cost_coingecko_id : undefined,
      cost_price_per_unit: typeof inc.cost_price_per_unit === 'number' ? inc.cost_price_per_unit : undefined,
      cost_is_manual_price: typeof inc.cost_is_manual_price === 'boolean' ? inc.cost_is_manual_price : undefined,
      cost_value_usd: typeof inc.cost_value_usd === 'number' ? inc.cost_value_usd : undefined,
      cost_value_idr: typeof inc.cost_value_idr === 'number' ? inc.cost_value_idr : undefined,
      chain: typeof inc.chain === 'string' ? inc.chain : undefined,
      platform: typeof inc.platform === 'string' ? inc.platform : undefined,
      pocket_id: typeof inc.pocket_id === 'string' ? inc.pocket_id : undefined,
      contract_address: typeof inc.contract_address === 'string' ? inc.contract_address : undefined,
      mcap_at_time: typeof inc.mcap_at_time === 'number' ? inc.mcap_at_time : undefined,
      cost_mcap: typeof inc.cost_mcap === 'number' ? inc.cost_mcap : undefined,
      token_ticker: typeof inc.token_ticker === 'string' ? inc.token_ticker : undefined,
      token_price_entry: typeof inc.token_price_entry === 'number' ? inc.token_price_entry : undefined,
      token_price_exit: typeof inc.token_price_exit === 'number' ? inc.token_price_exit : undefined,
      date: typeof inc.date === 'string' ? inc.date : getLocalISODate(),
      note: typeof inc.note === 'string' ? inc.note : undefined,
      created_at: typeof inc.created_at === 'string' ? inc.created_at : new Date().toISOString(),
      synced: true,
    }));
}

async function insertInChunks<T>(items: T[], insert: (chunk: T[]) => Promise<void>, chunkSize = 500): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await insert(items.slice(i, i + chunkSize));
  }
}

/**
 * Parses and validates a JSON backup, then overwrites data in Supabase or localStorage.
 * Throws if the file is invalid.
 */
export async function importJSON(raw: string): Promise<BackupData> {
  let parsed: BackupData;
  try {
    parsed = JSON.parse(raw) as BackupData;
  } catch {
    throw new Error('Invalid JSON file — could not parse.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid backup format — expected a JSON object.');
  }

  const { session, user } = useAuthStore.getState();
  const hasPortfolioBackup = parsed.portfolio !== undefined;
  const portfolioPockets = normalizeImportedPortfolioPockets(parsed.portfolio?.pockets);
  const portfolioAssets = normalizeImportedPortfolioAssets(parsed.portfolio?.assets);
  const portfolioActivityLogs = normalizeImportedPortfolioActivityLogs(parsed.portfolio?.activityLogs);
  const importedIncomes = normalizeImportedIncomes(parsed.incomes);

  if (session && user) {
    const client = await getSupabaseClientAsync();
    if (!client) throw new Error('Supabase client tidak dapat diakses.');
    await resetSyncStateForScope(user.id);

    // 1. Wipe existing data for this user
    const { error: deleteExpensesError } = await client.from('expenses').delete().eq('user_id', user.id);
    if (deleteExpensesError) throw new Error(`Gagal menghapus expense lama: ${deleteExpensesError.message}`);

    const { error: deleteRecurringError } = await client.from('recurring_templates').delete().eq('user_id', user.id);
    if (deleteRecurringError) throw new Error(`Gagal menghapus recurring lama: ${deleteRecurringError.message}`);

    const { error: deleteCategoriesError } = await client.from('categories').delete().eq('user_id', user.id);
    if (deleteCategoriesError) throw new Error(`Gagal menghapus kategori lama: ${deleteCategoriesError.message}`);

    const { error: deleteIncomesError } = await client.from('income_entries').delete().eq('user_id', user.id);
    if (deleteIncomesError) throw new Error(`Gagal menghapus income lama: ${deleteIncomesError.message}`);

    if (hasPortfolioBackup) {
      const { error: deletePortfolioActivityError } = await client.from('portfolio_activity_log').delete().eq('user_id', user.id);
      if (deletePortfolioActivityError) throw new Error(`Gagal menghapus portfolio activity lama: ${deletePortfolioActivityError.message}`);

      const { error: deletePortfolioAssetsError } = await client.from('portfolio_assets').delete().eq('user_id', user.id);
      if (deletePortfolioAssetsError) throw new Error(`Gagal menghapus portfolio asset lama: ${deletePortfolioAssetsError.message}`);

      const { error: deletePortfolioPocketsError } = await client.from('portfolio_pockets').delete().eq('user_id', user.id);
      if (deletePortfolioPocketsError) throw new Error(`Gagal menghapus portfolio pocket lama: ${deletePortfolioPocketsError.message}`);
    }

    // 2. Insert Categories
    if (Array.isArray(parsed.categories) && parsed.categories.length > 0) {
      const catsToInsert = parsed.categories
        .map(toImportedCategory)
        .filter((c): c is ImportedCategory => c !== null && c.is_default !== true)
        .map((c) => ({
          slug: typeof c.slug === 'string' ? c.slug : uuidv4(),
          label: typeof c.label === 'string' ? c.label : 'Kategori',
          emoji: typeof c.emoji === 'string' ? c.emoji : '🛍️',
          user_id: user.id,
          is_default: false,
        }));
      if (catsToInsert.length > 0) {
        const { error: upsertCategoriesError } = await client
          .from('categories')
          .upsert(catsToInsert, { onConflict: 'slug,user_id' });
        if (upsertCategoriesError) throw new Error(`Gagal import kategori: ${upsertCategoriesError.message}`);
      }
    }

    // 3. Insert Recurring
    if (Array.isArray(parsed.recurring) && parsed.recurring.length > 0) {
      const recsToInsert = parsed.recurring
        .map(toImportedRecurring)
        .filter((r): r is ImportedRecurring => r !== null)
        .map((r) => ({
          id: uuidv4(),
          name: typeof r.name === 'string' ? r.name : 'Recurring',
          amount: typeof r.amount === 'number' ? r.amount : 0,
          currency: r.currency === 'USD' ? 'USD' : 'IDR',
          category: typeof r.category === 'string' ? r.category : '',
          type: r.type === 'WANT' || r.type === 'TRANSFER' ? r.type : 'NEED',
          frequency: r.frequency === 'weekly' ? 'weekly' : 'monthly',
          schedule_detail: typeof r.schedule_detail === 'string' ? r.schedule_detail : undefined,
          note: typeof r.note === 'string' ? r.note : undefined,
          last_logged: typeof r.last_logged === 'string' ? r.last_logged : undefined,
          active: typeof r.active === 'boolean' ? r.active : true,
          user_id: user.id,
        }));
      if (recsToInsert.length > 0) {
        const { error: insertRecurringError } = await client
          .from('recurring_templates')
          .insert(recsToInsert);
        if (insertRecurringError) throw new Error(`Gagal import recurring: ${insertRecurringError.message}`);
      }
    }

    // 4. Insert Expenses
    if (Array.isArray(parsed.expenses) && parsed.expenses.length > 0) {
      const expsToInsert = parsed.expenses
        .map(toImportedExpense)
        .filter((e): e is ImportedExpense => e !== null)
        .map((e) => ({
          id: uuidv4(),
          name: typeof e.name === 'string' ? e.name : 'Expense',
          amount: typeof e.amount === 'number' ? e.amount : 0,
          currency: e.currency === 'USD' ? 'USD' : 'IDR',
          category: typeof e.category === 'string' ? e.category : '',
          type: e.type === 'WANT' || e.type === 'TRANSFER' ? e.type : 'NEED',
          destination: typeof e.destination === 'string' ? e.destination : undefined,
          date: typeof e.date === 'string' ? e.date : getLocalISODate(),
          note: typeof e.note === 'string' ? e.note : undefined,
          is_recurring: typeof e.is_recurring === 'boolean' ? e.is_recurring : false,
          recurring_id: typeof e.recurring_id === 'string' ? e.recurring_id : undefined,
          created_at: typeof e.created_at === 'string' ? e.created_at : new Date().toISOString(),
          synced: true,
          user_id: user.id,
        }));

      // Split chunks to avoid PostgREST limits
      await insertInChunks(expsToInsert, async (chunk) => {
        const { error: insertExpensesError } = await client
          .from('expenses')
          .insert(chunk);
        if (insertExpensesError) throw new Error(`Gagal import expense: ${insertExpensesError.message}`);
      });
    }

    // 5. Insert Incomes
    if (importedIncomes.length > 0) {
      await insertInChunks(importedIncomes, async (chunk) => {
        const { error: insertIncomesError } = await client
          .from('income_entries')
          .insert(chunk.map((inc) => ({ ...inc, user_id: user.id })));
        if (insertIncomesError) throw new Error(`Gagal import income: ${insertIncomesError.message}`);
      });
    }

    if (hasPortfolioBackup && portfolioPockets.length > 0) {
      await insertInChunks(portfolioPockets, async (chunk) => {
        const { error } = await client
          .from('portfolio_pockets')
          .upsert(chunk.map((p) => ({
            ...p,
            user_id: user.id,
            source: p.source ?? null,
            deleted_at: null,
          })), { onConflict: 'id' });
        if (error) throw new Error(`Gagal import portfolio pocket: ${error.message}`);
      });
    }

    if (hasPortfolioBackup && portfolioAssets.length > 0) {
      await insertInChunks(portfolioAssets, async (chunk) => {
        const { error } = await client
          .from('portfolio_assets')
          .upsert(chunk.map((a) => ({
            ...a,
            user_id: user.id,
            coingecko_id: a.coingecko_id ?? null,
            chain: a.chain ?? null,
            note: a.note ?? null,
            deleted_at: null,
          })), { onConflict: 'id' });
        if (error) throw new Error(`Gagal import portfolio asset: ${error.message}`);
      });
    }

    if (hasPortfolioBackup && portfolioActivityLogs.length > 0) {
      await insertInChunks(portfolioActivityLogs, async (chunk) => {
        const { error } = await client
          .from('portfolio_activity_log')
          .upsert(chunk.map((log) => ({
            ...log,
            user_id: user.id,
            location: log.location ?? null,
            note: log.note ?? null,
            deleted_at: null,
          })), { onConflict: 'id' });
        if (error) throw new Error(`Gagal import portfolio activity: ${error.message}`);
      });
    }

    await syncWithSupabaseIfNeeded({ force: true, domain: 'all' });
  } else {
    // Write to offline IndexedDB fallback
    const scope = getActiveDataScope();
    if (Array.isArray(parsed.expenses)) {
      await writeIDB(scopedDataKey('expenses', scope), parsed.expenses);
    }
    if (Array.isArray(parsed.categories)) {
      await writeIDB(scopedDataKey('categories', scope), parsed.categories);
    }
    if (Array.isArray(parsed.recurring)) {
      await writeIDB(scopedDataKey('recurring', scope), parsed.recurring);
    }
    if (Array.isArray(parsed.incomes)) {
      await writeIDB(scopedDataKey('incomes', scope), importedIncomes);
    }
    if (parsed.portfolio) {
      await writeIDB(scopedDataKey('portfolio_pockets', scope), portfolioPockets);
      await writeIDB(scopedDataKey('portfolio_assets', scope), portfolioAssets);
      await writeIDB(scopedDataKey('portfolio_activity_log', scope), portfolioActivityLogs);
    }
  }

  return parsed;
}
