import { v4 as uuidv4 } from 'uuid';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Category,
  Expense,
  PortfolioActivityLog,
  PortfolioAsset,
  PortfolioPocket,
  RecurringTemplate
} from '../types';
import { getSupabaseClientAsync } from './supabase';
import { GUEST_DATA_SCOPE, getActiveDataScope, scopedDataKey } from './dataScope';
import { readIDB, readIDBValue, writeIDB, writeIDBValue } from './idb-storage';
import { useAuthStore } from '../store/useAuthStore';
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
  | 'portfolio_pockets'
  | 'portfolio_assets'
  | 'portfolio_activity_log';
type SyncKind = 'upsert' | 'delete';

type SyncPayload =
  | Expense
  | Category
  | RecurringTemplate
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
  portfolio_pockets: 'portfolio_pockets',
  portfolio_assets: 'portfolio_assets',
  portfolio_activity_log: 'portfolio_activity_log',
} as const;
const PULL_PAGE_SIZE = 500;
const SYNC_COOLDOWN_MS = 20_000;

const syncInflightByScope = new Map<string, Promise<SyncResult>>();
const syncLastRunAtByScope = new Map<string, number>();

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

async function markExpenseSyncedLocally(scope: string, expenseId: string): Promise<void> {
  const key = scopedDataKey(BASE_KEYS.expenses, scope);
  const list = await readIDB<Expense>(key);
  const idx = list.findIndex((item) => item.id === expenseId);
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

interface PullResult {
  pulled: number;
  changed: boolean;
  cursor?: string;
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

async function pullFromRemote(scope: string, client: SupabaseClient): Promise<{ pulled: number; changed: boolean }> {
  const meta = await readMeta(scope);

  const expensesResult = await pullExpenses(scope, client, meta.cursorByEntity.expenses);
  const categoriesResult = await pullCategories(scope, client, meta.cursorByEntity.categories);
  const recurringResult = await pullRecurring(scope, client, meta.cursorByEntity.recurring);
  const pocketsResult = await pullPortfolioPockets(scope, client, meta.cursorByEntity.portfolio_pockets);
  const assetsResult = await pullPortfolioAssets(scope, client, meta.cursorByEntity.portfolio_assets);
  const activityResult = await pullPortfolioActivityLog(scope, client, meta.cursorByEntity.portfolio_activity_log);
  const activityReconcileResult = await reconcilePortfolioActivityLogSnapshot(scope, client);

  if (expensesResult.cursor) meta.cursorByEntity.expenses = expensesResult.cursor;
  if (categoriesResult.cursor) meta.cursorByEntity.categories = categoriesResult.cursor;
  if (recurringResult.cursor) meta.cursorByEntity.recurring = recurringResult.cursor;
  if (pocketsResult.cursor) meta.cursorByEntity.portfolio_pockets = pocketsResult.cursor;
  if (assetsResult.cursor) meta.cursorByEntity.portfolio_assets = assetsResult.cursor;
  if (activityResult.cursor) meta.cursorByEntity.portfolio_activity_log = activityResult.cursor;
  await writeMeta(scope, meta);

  return {
    pulled: expensesResult.pulled
      + categoriesResult.pulled
      + recurringResult.pulled
      + pocketsResult.pulled
      + assetsResult.pulled
      + activityResult.pulled
      + activityReconcileResult.pulled,
    changed: expensesResult.changed
      || categoriesResult.changed
      || recurringResult.changed
      || pocketsResult.changed
      || assetsResult.changed
      || activityResult.changed
      || activityReconcileResult.changed,
  };
}

async function runSync(scope: string, client: SupabaseClient): Promise<SyncResult> {
  const pushed = await pushQueue(scope, client);
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

  const pull = await pullFromRemote(scope, client);
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
  syncInflightByScope.delete(scope);
  syncLastRunAtByScope.delete(scope);
}

export async function syncWithSupabaseIfNeeded(options: { force?: boolean } = {}): Promise<SyncResult> {
  const force = options.force ?? false;
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

  const existing = syncInflightByScope.get(scope);
  if (existing) return existing;

  const queueRemaining = (await readQueue(scope)).length;
  if (!force && queueRemaining === 0) {
    const lastRunAt = syncLastRunAtByScope.get(scope) ?? 0;
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

  const runPromise = runSync(scope, client)
    .then((result) => {
      syncLastRunAtByScope.set(scope, Date.now());
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
      syncInflightByScope.delete(scope);
    });

  syncInflightByScope.set(scope, runPromise);
  return runPromise;
}

export function triggerBackgroundSync(): void {
  void syncWithSupabaseIfNeeded();
}
