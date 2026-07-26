import { v4 as uuidv4 } from 'uuid';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Category,
  Expense,
  PortfolioActivityLog,
  PortfolioAsset,
  PortfolioPocket,
  RecurringTemplate,
  IncomeEntry,
} from '../types';
import { getSupabaseClientAsync } from './supabase';
import { GUEST_DATA_SCOPE, getActiveDataScope, scopedDataKey } from './dataScope';
import { readIDB, readIDBValue, writeIDB, writeIDBValue } from './idb-storage';
import { useAuthStore } from '../store/useAuthStore';
import { pullAdminSettings } from './adminSettingsSync';
import {
  applyPortfolioActivityLogOp,
  applyPortfolioAssetOp,
  applyPortfolioPocketOp,
  pullPortfolioActivityLog,
  pullPortfolioAssets,
  pullPortfolioPockets,
  reconcilePortfolioActivityLogSnapshot
} from './portfolio-sync';

type SyncEntity =
  | 'expenses'
  | 'categories'
  | 'recurring'
  | 'income_entries'
  | 'portfolio_pockets'
  | 'portfolio_assets'
  | 'portfolio_activity_log';
type SyncKind = 'upsert' | 'delete';
type SyncDomain = 'base' | 'portfolio' | 'all';

type SyncPayload =
  | Expense
  | Category
  | RecurringTemplate
  | IncomeEntry
  | PortfolioPocket
  | PortfolioAsset
  | PortfolioActivityLog;

interface SyncOperation {
  opId: string;
  entity: SyncEntity;
  kind: SyncKind;
  recordId: string;
  payload?: SyncPayload;
  enqueuedAt: string;
}

interface SyncMeta {
  cursorByEntity: Partial<Record<SyncEntity, string>>;
}

interface EntityCursor {
  updatedAt: string;
  tieBreaker: string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  changed: boolean;
  queueRemaining: number;
  skipped: boolean;
  reason?: string;
}

const QUEUE_KEY = 'sync_queue';
const META_KEY = 'sync_meta';
const BASE_KEYS = {
  expenses: 'expenses',
  categories: 'categories',
  recurring: 'recurring',
  income_entries: 'income_entries',
  portfolio_pockets: 'portfolio_pockets',
  portfolio_assets: 'portfolio_assets',
  portfolio_activity_log: 'portfolio_activity_log',
} as const;
const PULL_PAGE_SIZE = 500;
const SYNC_COOLDOWN_MS = 20_000;

const syncInflightByScope = new Map<string, Promise<SyncResult>>();
const syncLastRunAtByScope = new Map<string, number>();
const pushInflightByScope = new Map<string, Promise<number>>();

function syncRunKey(scope: string, domain: SyncDomain): string {
  return `${scope}::${domain}`;
}

function queueStorageKey(scope: string): string {
  return scopedDataKey(QUEUE_KEY, scope);
}

function metaStorageKey(scope: string): string {
  return scopedDataKey(META_KEY, scope);
}

function isBrowserOffline(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine === false;
}

function isMissingColumnError(error: unknown, column: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as { message?: string }).message ?? '').toLowerCase();
  const details = String((error as { details?: string }).details ?? '').toLowerCase();
  const needle = column.toLowerCase();
  return (message.includes('column') && message.includes(needle))
    || (details.includes('column') && details.includes(needle));
}

function isLikelyConnectivityError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('network')
    || message.includes('failed to fetch')
    || message.includes('fetch')
    || message.includes('timed out');
}

function compactQueue(queue: SyncOperation[], nextOp: SyncOperation): SyncOperation[] {
  const filtered = queue.filter((op) => !(op.entity === nextOp.entity && op.recordId === nextOp.recordId));
  return [...filtered, nextOp];
}

async function readQueue(scope: string): Promise<SyncOperation[]> {
  return (await readIDBValue<SyncOperation[]>(queueStorageKey(scope))) ?? [];
}

async function writeQueue(scope: string, queue: SyncOperation[]): Promise<void> {
  await writeIDBValue(queueStorageKey(scope), queue);
}

async function removeQueueOp(scope: string, opId: string): Promise<void> {
  const queue = await readQueue(scope);
  const next = queue.filter((op) => op.opId !== opId);
  await writeQueue(scope, next);
}

async function readMeta(scope: string): Promise<SyncMeta> {
  return (await readIDBValue<SyncMeta>(metaStorageKey(scope))) ?? { cursorByEntity: {} };
}

async function writeMeta(scope: string, meta: SyncMeta): Promise<void> {
  await writeIDBValue(metaStorageKey(scope), meta);
}

function parseCursor(raw?: string): EntityCursor | undefined {
  if (!raw) return undefined;
  const sepIdx = raw.indexOf('|');
  if (sepIdx < 0) {
    return { updatedAt: raw, tieBreaker: '' };
  }
  return {
    updatedAt: raw.slice(0, sepIdx),
    tieBreaker: raw.slice(sepIdx + 1),
  };
}

function serializeCursor(cursor?: EntityCursor): string | undefined {
  if (!cursor) return undefined;
  return `${cursor.updatedAt}|${cursor.tieBreaker}`;
}

function isFullSnapshotPull(cursorRaw?: string): boolean {
  return !cursorRaw;
}

function applyCursorFilter<TQuery extends { gt: (column: string, value: string) => TQuery; or: (filters: string) => TQuery }>(
  query: TQuery,
  cursor: EntityCursor | undefined,
  tieBreakerColumn: string,
): TQuery {
  if (!cursor) return query;
  if (!cursor.tieBreaker) {
    return query.gt('updated_at', cursor.updatedAt);
  }
  return query.or(
    `updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},${tieBreakerColumn}.gt.${cursor.tieBreaker})`
  );
}

function normalizeExpense(record: Expense): Expense {
  return {
    id: record.id,
    name: record.name,
    amount: Number(record.amount),
    currency: record.currency,
    category: record.category,
    type: record.type,
    destination: record.destination ?? undefined,
    date: record.date,
    note: record.note ?? undefined,
    is_recurring: record.is_recurring,
    recurring_id: record.recurring_id ?? undefined,
    created_at: record.created_at,
    synced: true,
  };
}

function normalizeCategory(record: Category): Category {
  return {
    slug: record.slug,
    label: record.label,
    emoji: record.emoji,
    is_default: record.is_default,
  };
}

function normalizeRecurring(record: RecurringTemplate): RecurringTemplate {
  return {
    id: record.id,
    name: record.name,
    amount: Number(record.amount),
    currency: record.currency,
    category: record.category,
    type: record.type,
    schedule_detail: record.schedule_detail ?? undefined,
    note: record.note ?? undefined,
    last_logged: record.last_logged ?? undefined,
    active: record.active,
  };
}

function normalizeIncome(record: IncomeEntry): IncomeEntry {
  return {
    id: record.id,
    title: record.title,
    source_type: record.source_type,
    asset_type: record.asset_type,
    amount: Number(record.amount),
    ticker: record.ticker ?? undefined,
    coingecko_id: record.coingecko_id ?? undefined,
    currency: record.currency,
    price_at_time: record.price_at_time !== undefined && record.price_at_time !== null ? Number(record.price_at_time) : undefined,
    is_manual_price: record.is_manual_price,
    value_usd: Number(record.value_usd),
    value_idr: Number(record.value_idr),
    has_cost_basis: record.has_cost_basis,
    cost_amount: record.cost_amount !== undefined && record.cost_amount !== null ? Number(record.cost_amount) : undefined,
    cost_ticker: record.cost_ticker ?? undefined,
    cost_coingecko_id: record.cost_coingecko_id ?? undefined,
    cost_price_per_unit: record.cost_price_per_unit !== undefined && record.cost_price_per_unit !== null ? Number(record.cost_price_per_unit) : undefined,
    cost_is_manual_price: record.cost_is_manual_price,
    cost_value_usd: record.cost_value_usd !== undefined && record.cost_value_usd !== null ? Number(record.cost_value_usd) : undefined,
    cost_value_idr: record.cost_value_idr !== undefined && record.cost_value_idr !== null ? Number(record.cost_value_idr) : undefined,
    chain: record.chain ?? undefined,
    platform: record.platform ?? undefined,
    pocket_id: record.pocket_id ?? undefined,
    contract_address: record.contract_address ?? undefined,
    mcap_at_time: record.mcap_at_time !== undefined && record.mcap_at_time !== null ? Number(record.mcap_at_time) : undefined,
    cost_mcap: record.cost_mcap !== undefined && record.cost_mcap !== null ? Number(record.cost_mcap) : undefined,
    token_ticker: record.token_ticker ?? undefined,
    token_price_entry: record.token_price_entry !== undefined && record.token_price_entry !== null ? Number(record.token_price_entry) : undefined,
    token_price_exit: record.token_price_exit !== undefined && record.token_price_exit !== null ? Number(record.token_price_exit) : undefined,
    date: record.date,
    note: record.note ?? undefined,
    created_at: record.created_at,
    synced: true,
  };
}

async function markExpenseSyncedLocally(scope: string, expenseId: string): Promise<void> {
  const key = scopedDataKey(BASE_KEYS.expenses, scope);
  const list = await readIDB<Expense>(key);
  const idx = list.findIndex((item) => item.id === expenseId);
  if (idx < 0) return;
  if (list[idx].synced) return;
  list[idx] = { ...list[idx], synced: true };
  await writeIDB(key, list);
}

async function markIncomeSyncedLocally(scope: string, incomeId: string): Promise<void> {
  const key = scopedDataKey(BASE_KEYS.income_entries, scope);
  const list = await readIDB<IncomeEntry>(key);
  const idx = list.findIndex((item) => item.id === incomeId);
  if (idx < 0) return;
  if (list[idx].synced) return;
  list[idx] = { ...list[idx], synced: true };
  await writeIDB(key, list);
}

export async function enqueueSyncUpsert(
  entity: SyncEntity,
  recordId: string,
  payload: SyncPayload,
): Promise<void> {
  const scope = getActiveDataScope();
  if (scope === GUEST_DATA_SCOPE) return;

  const queue = await readQueue(scope);
  const nextOp: SyncOperation = {
    opId: uuidv4(),
    entity,
    kind: 'upsert',
    recordId,
    payload,
    enqueuedAt: new Date().toISOString(),
  };
  await writeQueue(scope, compactQueue(queue, nextOp));
}

export async function enqueueSyncDelete(entity: SyncEntity, recordId: string): Promise<void> {
  const scope = getActiveDataScope();
  if (scope === GUEST_DATA_SCOPE) return;

  const queue = await readQueue(scope);
  const nextOp: SyncOperation = {
    opId: uuidv4(),
    entity,
    kind: 'delete',
    recordId,
    enqueuedAt: new Date().toISOString(),
  };
  await writeQueue(scope, compactQueue(queue, nextOp));
}

async function applyExpenseOperation(
  client: SupabaseClient,
  userId: string,
  op: SyncOperation,
): Promise<void> {
  if (op.kind === 'upsert') {
    const payload = normalizeExpense(op.payload as Expense);
    const basePayload = {
      id: payload.id,
      name: payload.name,
      amount: payload.amount,
      currency: payload.currency,
      category: payload.category,
      type: payload.type,
      destination: payload.destination ?? null,
      date: payload.date,
      note: payload.note ?? null,
      is_recurring: payload.is_recurring,
      recurring_id: payload.recurring_id ?? null,
      created_at: payload.created_at,
      synced: true,
      user_id: userId,
    };

    let { error } = await client
      .from('expenses')
      .upsert({ ...basePayload, deleted_at: null }, { onConflict: 'id' });

    if (error && isMissingColumnError(error, 'deleted_at')) {
      ({ error } = await client
        .from('expenses')
        .upsert(basePayload, { onConflict: 'id' }));
    }

    if (error) {
      throw new Error(`Sync expenses upsert gagal: ${error.message}`);
    }
    await markExpenseSyncedLocally(userId, payload.id);
    return;
  }

  let { error } = await client
    .from('expenses')
    .update({ deleted_at: new Date().toISOString(), synced: true })
    .eq('id', op.recordId)
    .eq('user_id', userId);

  if (error && isMissingColumnError(error, 'deleted_at')) {
    ({ error } = await client
      .from('expenses')
      .delete()
      .eq('id', op.recordId)
      .eq('user_id', userId));
  }

  if (error) {
    throw new Error(`Sync expenses delete gagal: ${error.message}`);
  }
}

async function applyCategoryOperation(
  client: SupabaseClient,
  userId: string,
  op: SyncOperation,
): Promise<void> {
  if (op.kind === 'upsert') {
    const payload = normalizeCategory(op.payload as Category);
    const basePayload = {
      slug: payload.slug,
      label: payload.label,
      emoji: payload.emoji,
      is_default: payload.is_default,
      user_id: userId,
    };

    let { error } = await client
      .from('categories')
      .upsert({ ...basePayload, deleted_at: null }, { onConflict: 'slug,user_id' });

    if (error && isMissingColumnError(error, 'deleted_at')) {
      ({ error } = await client
        .from('categories')
        .upsert(basePayload, { onConflict: 'slug,user_id' }));
    }

    if (error) {
      throw new Error(`Sync categories upsert gagal: ${error.message}`);
    }
    return;
  }

  let { error } = await client
    .from('categories')
    .update({ deleted_at: new Date().toISOString() })
    .eq('slug', op.recordId)
    .eq('user_id', userId)
    .eq('is_default', false);

  if (error && isMissingColumnError(error, 'deleted_at')) {
    ({ error } = await client
      .from('categories')
      .delete()
      .eq('slug', op.recordId)
      .eq('user_id', userId)
      .eq('is_default', false));
  }

  if (error) {
    throw new Error(`Sync categories delete gagal: ${error.message}`);
  }
}

async function applyRecurringOperation(
  client: SupabaseClient,
  userId: string,
  op: SyncOperation,
): Promise<void> {
  if (op.kind === 'upsert') {
    const payload = normalizeRecurring(op.payload as RecurringTemplate);
    const basePayload = {
      id: payload.id,
      name: payload.name,
      amount: payload.amount,
      currency: payload.currency,
      category: payload.category,
      type: payload.type,
      frequency: 'monthly',
      schedule_detail: payload.schedule_detail ?? null,
      note: payload.note ?? null,
      last_logged: payload.last_logged ?? null,
      active: payload.active,
      user_id: userId,
    };

    let { error } = await client
      .from('recurring_templates')
      .upsert({ ...basePayload, deleted_at: null }, { onConflict: 'id' });

    if (error && isMissingColumnError(error, 'deleted_at')) {
      ({ error } = await client
        .from('recurring_templates')
        .upsert(basePayload, { onConflict: 'id' }));
    }

    if (error) {
      throw new Error(`Sync recurring upsert gagal: ${error.message}`);
    }
    return;
  }

  let { error } = await client
    .from('recurring_templates')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', op.recordId)
    .eq('user_id', userId);

  if (error && isMissingColumnError(error, 'deleted_at')) {
    ({ error } = await client
      .from('recurring_templates')
      .delete()
      .eq('id', op.recordId)
      .eq('user_id', userId));
  }

  if (error) {
    throw new Error(`Sync recurring delete gagal: ${error.message}`);
  }
}

async function applyIncomeOperation(
  client: SupabaseClient,
  userId: string,
  op: SyncOperation,
): Promise<void> {
  if (op.kind === 'upsert') {
    const payload = normalizeIncome(op.payload as IncomeEntry);
    const basePayload = {
      id: payload.id,
      title: payload.title,
      source_type: payload.source_type,
      asset_type: payload.asset_type,
      amount: payload.amount,
      ticker: payload.ticker ?? null,
      coingecko_id: payload.coingecko_id ?? null,
      currency: payload.currency,
      price_at_time: payload.price_at_time ?? null,
      is_manual_price: payload.is_manual_price,
      value_usd: payload.value_usd,
      value_idr: payload.value_idr,
      has_cost_basis: payload.has_cost_basis,
      cost_amount: payload.cost_amount ?? null,
      cost_ticker: payload.cost_ticker ?? null,
      cost_coingecko_id: payload.cost_coingecko_id ?? null,
      cost_price_per_unit: payload.cost_price_per_unit ?? null,
      cost_is_manual_price: payload.cost_is_manual_price,
      cost_value_usd: payload.cost_value_usd ?? null,
      cost_value_idr: payload.cost_value_idr ?? null,
      chain: payload.chain ?? null,
      platform: payload.platform ?? null,
      pocket_id: payload.pocket_id ?? null,
      contract_address: payload.contract_address ?? null,
      mcap_at_time: payload.mcap_at_time ?? null,
      cost_mcap: payload.cost_mcap ?? null,
      token_ticker: payload.token_ticker ?? null,
      token_price_entry: payload.token_price_entry ?? null,
      token_price_exit: payload.token_price_exit ?? null,
      date: payload.date,
      note: payload.note ?? null,
      created_at: payload.created_at,
      synced: true,
      user_id: userId,
    };

    let { error } = await client
      .from('income_entries')
      .upsert({ ...basePayload, deleted_at: null }, { onConflict: 'id' });

    if (error && isMissingColumnError(error, 'deleted_at')) {
      ({ error } = await client
        .from('income_entries')
        .upsert(basePayload, { onConflict: 'id' }));
    }

    if (error) {
      throw new Error(`Sync income upsert gagal: ${error.message}`);
    }
    await markIncomeSyncedLocally(userId, payload.id);
    return;
  }

  let { error } = await client
    .from('income_entries')
    .update({ deleted_at: new Date().toISOString(), synced: true })
    .eq('id', op.recordId)
    .eq('user_id', userId);

  if (error && isMissingColumnError(error, 'deleted_at')) {
    ({ error } = await client
      .from('income_entries')
      .delete()
      .eq('id', op.recordId)
      .eq('user_id', userId));
  }

  if (error) {
    throw new Error(`Sync income delete gagal: ${error.message}`);
  }
}

async function applyOperation(client: SupabaseClient, userId: string, op: SyncOperation): Promise<void> {
  switch (op.entity) {
    case 'expenses':
      await applyExpenseOperation(client, userId, op);
      return;
    case 'categories':
      await applyCategoryOperation(client, userId, op);
      return;
    case 'recurring':
      await applyRecurringOperation(client, userId, op);
      return;
    case 'income_entries':
      await applyIncomeOperation(client, userId, op);
      return;
    case 'portfolio_pockets':
      await applyPortfolioPocketOp(client, userId, op);
      return;
    case 'portfolio_assets':
      await applyPortfolioAssetOp(client, userId, op);
      return;
    case 'portfolio_activity_log':
      await applyPortfolioActivityLogOp(client, userId, op);
      return;
    default:
      return;
  }
}

async function pushQueue(scope: string, client: SupabaseClient): Promise<number> {
  let pushed = 0;

  while (true) {
    const queue = await readQueue(scope);
    if (queue.length === 0) break;

    const op = queue[0];
    try {
      await applyOperation(client, scope, op);
      await removeQueueOp(scope, op.opId);
      pushed++;
    } catch (error) {
      if (isLikelyConnectivityError(error)) break;
      throw error;
    }
  }

  return pushed;
}

async function pushQueueOnce(scope: string, client: SupabaseClient): Promise<number> {
  const existing = pushInflightByScope.get(scope);
  if (existing) return existing;

  const runPromise = pushQueue(scope, client).finally(() => {
    pushInflightByScope.delete(scope);
  });
  pushInflightByScope.set(scope, runPromise);
  return runPromise;
}

interface RemoteExpenseRow extends Expense {
  updated_at?: string;
  deleted_at?: string | null;
}

interface RemoteCategoryRow extends Category {
  updated_at?: string;
  deleted_at?: string | null;
}

interface RemoteRecurringRow extends RecurringTemplate {
  updated_at?: string;
  deleted_at?: string | null;
}

interface RemoteIncomeRow extends IncomeEntry {
  updated_at?: string;
  deleted_at?: string | null;
}

interface PullResult {
  pulled: number;
  changed: boolean;
  cursor?: string;
}

interface DomainPullResult {
  pulled: number;
  changed: boolean;
  cursorPatch: Partial<Record<SyncEntity, string>>;
}

function expenseStorageKey(scope: string): string {
  return scopedDataKey(BASE_KEYS.expenses, scope);
}

function categoryStorageKey(scope: string): string {
  return scopedDataKey(BASE_KEYS.categories, scope);
}

function recurringStorageKey(scope: string): string {
  return scopedDataKey(BASE_KEYS.recurring, scope);
}

function areExpensesEqual(a: Expense, b: Expense): boolean {
  return a.id === b.id
    && a.name === b.name
    && a.amount === b.amount
    && a.currency === b.currency
    && a.category === b.category
    && a.type === b.type
    && (a.destination ?? undefined) === (b.destination ?? undefined)
    && a.date === b.date
    && (a.note ?? undefined) === (b.note ?? undefined)
    && a.is_recurring === b.is_recurring
    && (a.recurring_id ?? undefined) === (b.recurring_id ?? undefined)
    && a.created_at === b.created_at
    && a.synced === b.synced;
}

function areCategoriesEqual(a: Category, b: Category): boolean {
  return a.slug === b.slug
    && a.label === b.label
    && a.emoji === b.emoji
    && a.is_default === b.is_default;
}

function areRecurringEqual(a: RecurringTemplate, b: RecurringTemplate): boolean {
  return a.id === b.id
    && a.name === b.name
    && a.amount === b.amount
    && a.currency === b.currency
    && a.category === b.category
    && a.type === b.type
    && (a.schedule_detail ?? undefined) === (b.schedule_detail ?? undefined)
    && (a.note ?? undefined) === (b.note ?? undefined)
    && (a.last_logged ?? undefined) === (b.last_logged ?? undefined)
    && a.active === b.active;
}

function hasSameExpenseList(local: Expense[], remote: Expense[]): boolean {
  if (local.length !== remote.length) return false;
  const localById = new Map(local.map((item) => [item.id, item]));
  for (const remoteItem of remote) {
    const localItem = localById.get(remoteItem.id);
    if (!localItem || !areExpensesEqual(localItem, remoteItem)) {
      return false;
    }
  }
  return true;
}

function hasSameCategoryList(local: Category[], remote: Category[]): boolean {
  if (local.length !== remote.length) return false;
  const localBySlug = new Map(local.map((item) => [item.slug, item]));
  for (const remoteItem of remote) {
    const localItem = localBySlug.get(remoteItem.slug);
    if (!localItem || !areCategoriesEqual(localItem, remoteItem)) {
      return false;
    }
  }
  return true;
}

function hasSameRecurringList(local: RecurringTemplate[], remote: RecurringTemplate[]): boolean {
  if (local.length !== remote.length) return false;
  const localById = new Map(local.map((item) => [item.id, item]));
  for (const remoteItem of remote) {
    const localItem = localById.get(remoteItem.id);
    if (!localItem || !areRecurringEqual(localItem, remoteItem)) {
      return false;
    }
  }
  return true;
}

async function pullExpenses(scope: string, client: SupabaseClient, cursor?: string): Promise<PullResult> {
  const columns = [
    'id', 'name', 'amount', 'currency', 'category', 'type', 'destination', 'date',
    'note', 'is_recurring', 'recurring_id', 'created_at', 'synced', 'updated_at', 'deleted_at',
  ].join(',');

  const key = expenseStorageKey(scope);
  const local = await readIDB<Expense>(key);
  const map = new Map(local.map((item) => [item.id, item]));
  const initialCursor = parseCursor(cursor);
  let currentCursor = initialCursor;
  let pulled = 0;
  let changed = false;

  while (true) {
    let query = client
      .from('expenses')
      .select(columns)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PULL_PAGE_SIZE);

    query = applyCursorFilter(query, currentCursor, 'id');

    const expenseResult = await query;
    const data = expenseResult.data as unknown as RemoteExpenseRow[] | null;
    const error = expenseResult.error;

    if (error) {
      if (isMissingColumnError(error, 'updated_at') || isMissingColumnError(error, 'deleted_at')) {
        const fallback = await client
          .from('expenses')
          .select('id,name,amount,currency,category,type,destination,date,note,is_recurring,recurring_id,created_at,synced')
          .order('date', { ascending: false })
          .order('created_at', { ascending: false });

        if (fallback.error) throw new Error(`Pull expenses gagal: ${fallback.error.message}`);

        const remote = (fallback.data ?? []).map((row) => normalizeExpense(row as Expense));
        if (hasSameExpenseList(local, remote)) {
          return { pulled: remote.length, changed: false, cursor };
        }
        await writeIDB(key, remote);
        return { pulled: remote.length, changed: true, cursor };
      }
      throw new Error(`Pull expenses gagal: ${error.message}`);
    }

    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.deleted_at) {
        if (map.delete(row.id)) changed = true;
      } else {
        const nextValue = normalizeExpense(row);
        const current = map.get(nextValue.id);
        if (!current || !areExpensesEqual(current, nextValue)) {
          map.set(nextValue.id, nextValue);
          changed = true;
        }
      }
      pulled += 1;
    }

    const lastRow = rows[rows.length - 1];
    if (!lastRow.updated_at || !lastRow.id) break;
    currentCursor = { updatedAt: lastRow.updated_at, tieBreaker: lastRow.id };

    if (rows.length < PULL_PAGE_SIZE) break;
  }

  if (changed) {
    await writeIDB(key, Array.from(map.values()));
  } else if (pulled === 0 && isFullSnapshotPull(cursor) && local.length > 0) {
    await writeIDB(key, []);
    changed = true;
  }

  return { pulled, changed, cursor: serializeCursor(currentCursor) ?? cursor };
}

async function pullCategories(scope: string, client: SupabaseClient, cursor?: string): Promise<PullResult> {
  const columns = ['slug', 'label', 'emoji', 'is_default', 'updated_at', 'deleted_at'].join(',');

  const key = categoryStorageKey(scope);
  const local = await readIDB<Category>(key);
  const map = new Map(local.map((item) => [item.slug, item]));
  const initialCursor = parseCursor(cursor);
  let currentCursor = initialCursor;
  let pulled = 0;
  let changed = false;

  while (true) {
    let query = client
      .from('categories')
      .select(columns)
      .order('updated_at', { ascending: true })
      .order('slug', { ascending: true })
      .limit(PULL_PAGE_SIZE);

    query = applyCursorFilter(query, currentCursor, 'slug');

    const categoryResult = await query;
    const data = categoryResult.data as unknown as RemoteCategoryRow[] | null;
    const error = categoryResult.error;

    if (error) {
      if (isMissingColumnError(error, 'updated_at') || isMissingColumnError(error, 'deleted_at')) {
        const fallback = await client
          .from('categories')
          .select('slug,label,emoji,is_default')
          .order('label', { ascending: true });

        if (fallback.error) throw new Error(`Pull categories gagal: ${fallback.error.message}`);

        const remote = (fallback.data ?? []).map((row) => normalizeCategory(row as Category));
        if (hasSameCategoryList(local, remote)) {
          return { pulled: remote.length, changed: false, cursor };
        }
        await writeIDB(key, remote);
        return { pulled: remote.length, changed: true, cursor };
      }
      throw new Error(`Pull categories gagal: ${error.message}`);
    }

    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.deleted_at) {
        if (map.delete(row.slug)) changed = true;
      } else {
        const nextValue = normalizeCategory(row);
        const current = map.get(nextValue.slug);
        if (!current || !areCategoriesEqual(current, nextValue)) {
          map.set(nextValue.slug, nextValue);
          changed = true;
        }
      }
      pulled += 1;
    }

    const lastRow = rows[rows.length - 1];
    if (!lastRow.updated_at || !lastRow.slug) break;
    currentCursor = { updatedAt: lastRow.updated_at, tieBreaker: lastRow.slug };

    if (rows.length < PULL_PAGE_SIZE) break;
  }

  if (changed) {
    await writeIDB(key, Array.from(map.values()));
  } else if (pulled === 0 && isFullSnapshotPull(cursor) && local.length > 0) {
    await writeIDB(key, []);
    changed = true;
  }

  return { pulled, changed, cursor: serializeCursor(currentCursor) ?? cursor };
}

async function pullRecurring(scope: string, client: SupabaseClient, cursor?: string): Promise<PullResult> {
  const columns = [
    'id', 'name', 'amount', 'currency', 'category', 'type', 'schedule_detail',
    'note', 'last_logged', 'active', 'updated_at', 'deleted_at',
  ].join(',');

  const key = recurringStorageKey(scope);
  const local = await readIDB<RecurringTemplate>(key);
  const map = new Map(local.map((item) => [item.id, item]));
  const initialCursor = parseCursor(cursor);
  let currentCursor = initialCursor;
  let pulled = 0;
  let changed = false;

  while (true) {
    let query = client
      .from('recurring_templates')
      .select(columns)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PULL_PAGE_SIZE);

    query = applyCursorFilter(query, currentCursor, 'id');

    const recurringResult = await query;
    const data = recurringResult.data as unknown as RemoteRecurringRow[] | null;
    const error = recurringResult.error;

    if (error) {
      if (isMissingColumnError(error, 'updated_at') || isMissingColumnError(error, 'deleted_at')) {
        const fallback = await client
          .from('recurring_templates')
          .select('id,name,amount,currency,category,type,schedule_detail,note,last_logged,active')
          .order('active', { ascending: false });

        if (fallback.error) throw new Error(`Pull recurring gagal: ${fallback.error.message}`);

        const remote = (fallback.data ?? []).map((row) => normalizeRecurring(row as RecurringTemplate));
        if (hasSameRecurringList(local, remote)) {
          return { pulled: remote.length, changed: false, cursor };
        }
        await writeIDB(key, remote);
        return { pulled: remote.length, changed: true, cursor };
      }
      throw new Error(`Pull recurring gagal: ${error.message}`);
    }

    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.deleted_at) {
        if (map.delete(row.id)) changed = true;
      } else {
        const nextValue = normalizeRecurring(row);
        const current = map.get(nextValue.id);
        if (!current || !areRecurringEqual(current, nextValue)) {
          map.set(nextValue.id, nextValue);
          changed = true;
        }
      }
      pulled += 1;
    }

    const lastRow = rows[rows.length - 1];
    if (!lastRow.updated_at || !lastRow.id) break;
    currentCursor = { updatedAt: lastRow.updated_at, tieBreaker: lastRow.id };

    if (rows.length < PULL_PAGE_SIZE) break;
  }

  if (changed) {
    await writeIDB(key, Array.from(map.values()));
  } else if (pulled === 0 && isFullSnapshotPull(cursor) && local.length > 0) {
    await writeIDB(key, []);
    changed = true;
  }

  return { pulled, changed, cursor: serializeCursor(currentCursor) ?? cursor };
}

function incomeStorageKey(scope: string): string {
  return scopedDataKey(BASE_KEYS.income_entries, scope);
}

function areIncomesEqual(a: IncomeEntry, b: IncomeEntry): boolean {
  return a.id === b.id
    && a.title === b.title
    && a.source_type === b.source_type
    && a.asset_type === b.asset_type
    && a.amount === b.amount
    && a.ticker === b.ticker
    && a.coingecko_id === b.coingecko_id
    && a.currency === b.currency
    && a.price_at_time === b.price_at_time
    && a.is_manual_price === b.is_manual_price
    && a.value_usd === b.value_usd
    && a.value_idr === b.value_idr
    && a.has_cost_basis === b.has_cost_basis
    && a.cost_amount === b.cost_amount
    && a.cost_ticker === b.cost_ticker
    && a.cost_coingecko_id === b.cost_coingecko_id
    && a.cost_price_per_unit === b.cost_price_per_unit
    && a.cost_is_manual_price === b.cost_is_manual_price
    && a.cost_value_usd === b.cost_value_usd
    && a.cost_value_idr === b.cost_value_idr
    && a.chain === b.chain
    && a.platform === b.platform
    && a.pocket_id === b.pocket_id
    && a.contract_address === b.contract_address
    && a.mcap_at_time === b.mcap_at_time
    && a.cost_mcap === b.cost_mcap
    && a.token_ticker === b.token_ticker
    && a.token_price_entry === b.token_price_entry
    && a.token_price_exit === b.token_price_exit
    && a.date === b.date
    && a.note === b.note
    && a.created_at === b.created_at
    && a.synced === b.synced;
}

function hasSameIncomeList(local: IncomeEntry[], remote: IncomeEntry[]): boolean {
  if (local.length !== remote.length) return false;
  const localById = new Map(local.map((item) => [item.id, item]));
  for (const remoteItem of remote) {
    const localItem = localById.get(remoteItem.id);
    if (!localItem || !areIncomesEqual(localItem, remoteItem)) {
      return false;
    }
  }
  return true;
}

async function pullIncomes(scope: string, client: SupabaseClient, cursor?: string): Promise<PullResult> {
  const columns = [
    'id', 'title', 'source_type', 'asset_type', 'amount', 'ticker', 'coingecko_id',
    'currency', 'price_at_time', 'is_manual_price', 'value_usd', 'value_idr',
    'has_cost_basis', 'cost_amount', 'cost_ticker', 'cost_coingecko_id', 'cost_price_per_unit',
    'cost_is_manual_price', 'cost_value_usd', 'cost_value_idr', 'chain', 'platform',
    'pocket_id', 'contract_address', 'mcap_at_time', 'cost_mcap', 'token_ticker', 'token_price_entry', 'token_price_exit', 'date', 'note', 'created_at', 'synced', 'updated_at', 'deleted_at'
  ].join(',');

  const key = incomeStorageKey(scope);
  const local = await readIDB<IncomeEntry>(key);
  const map = new Map(local.map((item) => [item.id, item]));
  const initialCursor = parseCursor(cursor);
  let currentCursor = initialCursor;
  let pulled = 0;
  let changed = false;

  while (true) {
    let query = client
      .from('income_entries')
      .select(columns)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PULL_PAGE_SIZE);

    query = applyCursorFilter(query, currentCursor, 'id');

    const result = await query;
    const data = result.data as unknown as RemoteIncomeRow[] | null;
    const error = result.error;

    if (error) {
      if (isMissingColumnError(error, 'updated_at') || isMissingColumnError(error, 'deleted_at')) {
        const fallback = await client
          .from('income_entries')
          .select('id,title,source_type,asset_type,amount,ticker,coingecko_id,currency,price_at_time,is_manual_price,value_usd,value_idr,has_cost_basis,cost_amount,cost_ticker,cost_coingecko_id,cost_price_per_unit,cost_is_manual_price,cost_value_usd,cost_value_idr,chain,platform,pocket_id,contract_address,mcap_at_time,cost_mcap,token_ticker,token_price_entry,token_price_exit,date,note,created_at,synced')
          .order('date', { ascending: false })
          .order('created_at', { ascending: false });

        if (fallback.error) throw new Error(`Pull income gagal: ${fallback.error.message}`);

        const remote = (fallback.data ?? []).map((row) => normalizeIncome(row as IncomeEntry));
        if (hasSameIncomeList(local, remote)) {
          return { pulled: remote.length, changed: false, cursor };
        }
        await writeIDB(key, remote);
        return { pulled: remote.length, changed: true, cursor };
      }
      throw new Error(`Pull income gagal: ${error.message}`);
    }

    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.deleted_at) {
        if (map.delete(row.id)) changed = true;
      } else {
        const nextValue = normalizeIncome(row);
        const current = map.get(nextValue.id);
        if (!current || !areIncomesEqual(current, nextValue)) {
          map.set(nextValue.id, nextValue);
          changed = true;
        }
      }
      pulled += 1;
    }

    const lastRow = rows[rows.length - 1];
    if (!lastRow.updated_at || !lastRow.id) break;
    currentCursor = { updatedAt: lastRow.updated_at, tieBreaker: lastRow.id };

    if (rows.length < PULL_PAGE_SIZE) break;
  }

  const finalCursorStr = serializeCursor(currentCursor);
  if (changed) {
    const list = Array.from(map.values()).sort((a, b) => {
      const dateDiff = b.date.localeCompare(a.date);
      if (dateDiff !== 0) return dateDiff;
      return b.created_at.localeCompare(a.created_at);
    });
    await writeIDB(key, list);
  }

  return {
    pulled,
    changed,
    cursor: finalCursorStr || cursor,
  };
}

async function pullBaseFromRemote(scope: string, client: SupabaseClient, meta: SyncMeta): Promise<DomainPullResult> {
  const expensesResult = await pullExpenses(scope, client, meta.cursorByEntity.expenses);
  const categoriesResult = await pullCategories(scope, client, meta.cursorByEntity.categories);
  const recurringResult = await pullRecurring(scope, client, meta.cursorByEntity.recurring);
  const incomesResult = await pullIncomes(scope, client, meta.cursorByEntity.income_entries);
  const cursorPatch: Partial<Record<SyncEntity, string>> = {};

  if (expensesResult.cursor) cursorPatch.expenses = expensesResult.cursor;
  if (categoriesResult.cursor) cursorPatch.categories = categoriesResult.cursor;
  if (recurringResult.cursor) cursorPatch.recurring = recurringResult.cursor;
  if (incomesResult.cursor) cursorPatch.income_entries = incomesResult.cursor;

  return {
    pulled: expensesResult.pulled + categoriesResult.pulled + recurringResult.pulled + incomesResult.pulled,
    changed: expensesResult.changed || categoriesResult.changed || recurringResult.changed || incomesResult.changed,
    cursorPatch,
  };
}

async function pullPortfolioFromRemote(scope: string, client: SupabaseClient, meta: SyncMeta): Promise<DomainPullResult> {
  const pocketsResult = await pullPortfolioPockets(scope, client, meta.cursorByEntity.portfolio_pockets);
  const assetsResult = await pullPortfolioAssets(scope, client, meta.cursorByEntity.portfolio_assets);
  const activityResult = await pullPortfolioActivityLog(scope, client, meta.cursorByEntity.portfolio_activity_log);
  const activityReconcileResult = await reconcilePortfolioActivityLogSnapshot(scope, client);
  const cursorPatch: Partial<Record<SyncEntity, string>> = {};

  if (pocketsResult.cursor) cursorPatch.portfolio_pockets = pocketsResult.cursor;
  if (assetsResult.cursor) cursorPatch.portfolio_assets = assetsResult.cursor;
  if (activityResult.cursor) cursorPatch.portfolio_activity_log = activityResult.cursor;

  return {
    pulled: pocketsResult.pulled
      + assetsResult.pulled
      + activityResult.pulled
      + activityReconcileResult.pulled,
    changed: pocketsResult.changed
      || assetsResult.changed
      || activityResult.changed
      || activityReconcileResult.changed,
    cursorPatch,
  };
}

async function pullFromRemote(scope: string, client: SupabaseClient, domain: SyncDomain): Promise<{ pulled: number; changed: boolean }> {
  const meta = await readMeta(scope);
  const shouldPullBase = domain === 'base' || domain === 'all';
  const shouldPullPortfolio = domain === 'portfolio' || domain === 'all';

  const baseResult = shouldPullBase
    ? await pullBaseFromRemote(scope, client, meta)
    : { pulled: 0, changed: false, cursorPatch: {} };
  const portfolioResult = shouldPullPortfolio
    ? await pullPortfolioFromRemote(scope, client, meta)
    : { pulled: 0, changed: false, cursorPatch: {} };
  const latestMeta = await readMeta(scope);
  await writeMeta(scope, {
    cursorByEntity: {
      ...latestMeta.cursorByEntity,
      ...baseResult.cursorPatch,
      ...portfolioResult.cursorPatch,
    },
  });

  return {
    pulled: baseResult.pulled + portfolioResult.pulled,
    changed: baseResult.changed || portfolioResult.changed,
  };
}

async function runSync(scope: string, client: SupabaseClient, domain: SyncDomain): Promise<SyncResult> {
  const pushed = await pushQueueOnce(scope, client);
  const queueRemaining = (await readQueue(scope)).length;

  if (queueRemaining > 0) {
    return {
      pushed,
      pulled: 0,
      changed: pushed > 0,
      queueRemaining,
      skipped: false,
      reason: 'pending_queue',
    };
  }

  const pull = await pullFromRemote(scope, client, domain);
  return {
    pushed,
    pulled: pull.pulled,
    changed: pull.changed || pushed > 0,
    queueRemaining: 0,
    skipped: false,
  };
}

export async function resetSyncStateForScope(scope: string): Promise<void> {
  await Promise.all([
    writeQueue(scope, []),
    writeMeta(scope, { cursorByEntity: {} }),
  ]);
  for (const domain of ['base', 'portfolio', 'all'] satisfies SyncDomain[]) {
    syncInflightByScope.delete(syncRunKey(scope, domain));
    syncLastRunAtByScope.delete(syncRunKey(scope, domain));
  }
  pushInflightByScope.delete(scope);
}

export async function syncWithSupabaseIfNeeded(options: { force?: boolean; domain?: SyncDomain } = {}): Promise<SyncResult> {
  const force = options.force ?? false;
  const domain = options.domain ?? 'all';
  const scope = getActiveDataScope();
  if (scope === GUEST_DATA_SCOPE) {
    return { pushed: 0, pulled: 0, changed: false, queueRemaining: 0, skipped: true, reason: 'guest' };
  }

  if (isBrowserOffline()) {
    return { pushed: 0, pulled: 0, changed: false, queueRemaining: (await readQueue(scope)).length, skipped: true, reason: 'offline' };
  }

  const session = useAuthStore.getState().session;
  if (!session) {
    return { pushed: 0, pulled: 0, changed: false, queueRemaining: (await readQueue(scope)).length, skipped: true, reason: 'no_session' };
  }

  const client = await getSupabaseClientAsync();
  if (!client) {
    return { pushed: 0, pulled: 0, changed: false, queueRemaining: (await readQueue(scope)).length, skipped: true, reason: 'no_client' };
  }

  const runKey = syncRunKey(scope, domain);
  const existing = syncInflightByScope.get(runKey);
  if (existing) return existing;

  const queueRemaining = (await readQueue(scope)).length;
  if (!force && queueRemaining === 0) {
    const lastRunAt = syncLastRunAtByScope.get(runKey) ?? 0;
    if (Date.now() - lastRunAt < SYNC_COOLDOWN_MS) {
      return {
        pushed: 0,
        pulled: 0,
        changed: false,
        queueRemaining: 0,
        skipped: true,
        reason: 'cool_down',
      };
    }
  }

  const runPromise = runSync(scope, client, domain)
    .then((result) => {
      syncLastRunAtByScope.set(runKey, Date.now());
      void pullAdminSettings();
      return result;
    })
    .catch(async (error) => {
      if (isLikelyConnectivityError(error)) {
        return {
          pushed: 0,
          pulled: 0,
          changed: false,
          queueRemaining: (await readQueue(scope)).length,
          skipped: true,
          reason: 'network_error',
        } satisfies SyncResult;
      }
      throw error;
    })
    .finally(() => {
      syncInflightByScope.delete(runKey);
    });

  syncInflightByScope.set(runKey, runPromise);
  return runPromise;
}

export function triggerBackgroundSync(options: { domain?: SyncDomain } = {}): void {
  void syncWithSupabaseIfNeeded(options);
}
