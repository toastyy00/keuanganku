import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortfolioActivityLog, PortfolioAsset, PortfolioPocket } from '../types';
import { scopedDataKey } from './dataScope';
import { readIDB, writeIDB } from './idb-storage';

const PULL_PAGE_SIZE = 500;

interface EntityCursor {
  updatedAt: string;
  tieBreaker: string;
}

interface PullResult {
  pulled: number;
  changed: boolean;
  cursor?: string;
}

interface SyncOperationLike {
  kind: 'upsert' | 'delete';
  recordId: string;
  payload?: unknown;
}

interface RemotePortfolioPocketRow extends PortfolioPocket {
  updated_at?: string;
  deleted_at?: string | null;
}

interface RemotePortfolioAssetRow extends PortfolioAsset {
  updated_at?: string;
  deleted_at?: string | null;
}

interface RemotePortfolioActivityLogRow extends PortfolioActivityLog {
  updated_at?: string;
  deleted_at?: string | null;
}

function parseCursor(raw?: string): EntityCursor | undefined {
  if (!raw) return undefined;
  const sepIdx = raw.indexOf('|');
  if (sepIdx < 0) return { updatedAt: raw, tieBreaker: '' };
  return { updatedAt: raw.slice(0, sepIdx), tieBreaker: raw.slice(sepIdx + 1) };
}

function serializeCursor(cursor?: EntityCursor): string | undefined {
  if (!cursor) return undefined;
  return `${cursor.updatedAt}|${cursor.tieBreaker}`;
}

function applyCursorFilter<TQuery extends { gt: (column: string, value: string) => TQuery; or: (filters: string) => TQuery }>(
  query: TQuery,
  cursor: EntityCursor | undefined,
  tieBreakerColumn: string,
): TQuery {
  if (!cursor) return query;
  if (!cursor.tieBreaker) return query.gt('updated_at', cursor.updatedAt);
  return query.or(
    `updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},${tieBreakerColumn}.gt.${cursor.tieBreaker})`
  );
}

function pocketStorageKey(scope: string): string {
  return scopedDataKey('portfolio_pockets', scope);
}

function assetStorageKey(scope: string): string {
  return scopedDataKey('portfolio_assets', scope);
}

function activityStorageKey(scope: string): string {
  return scopedDataKey('portfolio_activity_log', scope);
}

function normalizePortfolioPocket(record: PortfolioPocket): PortfolioPocket {
  return {
    id: record.id,
    name: record.name,
    source_type: record.source_type,
    source: record.source ?? undefined,
    color_theme: record.color_theme,
    icon: record.icon,
    sort_order: Number(record.sort_order),
    created_at: record.created_at,
  };
}

function normalizePortfolioAsset(record: PortfolioAsset): PortfolioAsset {
  return {
    id: record.id,
    pocket_id: record.pocket_id,
    ticker: record.ticker,
    coingecko_id: record.coingecko_id ?? undefined,
    amount: Number(record.amount),
    created_at: record.created_at,
  };
}

function normalizePortfolioActivityLog(record: PortfolioActivityLog): PortfolioActivityLog {
  return {
    id: record.id,
    pocket_id: record.pocket_id,
    asset_id: record.asset_id,
    ticker: record.ticker,
    action: record.action,
    amount_change: Number(record.amount_change),
    balance_after: Number(record.balance_after),
    price_at_time: Number(record.price_at_time),
    note: record.note ?? undefined,
    created_at: record.created_at,
  };
}

function arePortfolioPocketsEqual(a: PortfolioPocket, b: PortfolioPocket): boolean {
  return a.id === b.id
    && a.name === b.name
    && a.source_type === b.source_type
    && (a.source ?? undefined) === (b.source ?? undefined)
    && a.color_theme === b.color_theme
    && a.icon === b.icon
    && a.sort_order === b.sort_order
    && a.created_at === b.created_at;
}

function arePortfolioAssetsEqual(a: PortfolioAsset, b: PortfolioAsset): boolean {
  return a.id === b.id
    && a.pocket_id === b.pocket_id
    && a.ticker === b.ticker
    && (a.coingecko_id ?? undefined) === (b.coingecko_id ?? undefined)
    && a.amount === b.amount
    && a.created_at === b.created_at;
}

function arePortfolioActivityLogsEqual(a: PortfolioActivityLog, b: PortfolioActivityLog): boolean {
  return a.id === b.id
    && a.pocket_id === b.pocket_id
    && a.asset_id === b.asset_id
    && a.ticker === b.ticker
    && a.action === b.action
    && a.amount_change === b.amount_change
    && a.balance_after === b.balance_after
    && a.price_at_time === b.price_at_time
    && (a.note ?? undefined) === (b.note ?? undefined)
    && a.created_at === b.created_at;
}

export async function applyPortfolioPocketOp(
  client: SupabaseClient,
  userId: string,
  op: SyncOperationLike,
): Promise<void> {
  if (op.kind === 'upsert') {
    const payload = normalizePortfolioPocket(op.payload as PortfolioPocket);
    const basePayload = {
      id: payload.id,
      user_id: userId,
      name: payload.name,
      source_type: payload.source_type,
      source: payload.source ?? null,
      color_theme: payload.color_theme,
      icon: payload.icon,
      sort_order: payload.sort_order,
      created_at: payload.created_at,
    };
    const { error } = await client
      .from('portfolio_pockets')
      .upsert({ ...basePayload, deleted_at: null }, { onConflict: 'id' });
    if (error) throw new Error(`Sync portfolio_pockets upsert gagal: ${error.message}`);
    return;
  }

  const { error } = await client
    .from('portfolio_pockets')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', op.recordId)
    .eq('user_id', userId);
  if (error) throw new Error(`Sync portfolio_pockets delete gagal: ${error.message}`);
}

export async function applyPortfolioAssetOp(
  client: SupabaseClient,
  userId: string,
  op: SyncOperationLike,
): Promise<void> {
  if (op.kind === 'upsert') {
    const payload = normalizePortfolioAsset(op.payload as PortfolioAsset);
    const basePayload = {
      id: payload.id,
      user_id: userId,
      pocket_id: payload.pocket_id,
      ticker: payload.ticker,
      coingecko_id: payload.coingecko_id ?? null,
      amount: payload.amount,
      created_at: payload.created_at,
    };
    const { error } = await client
      .from('portfolio_assets')
      .upsert({ ...basePayload, deleted_at: null }, { onConflict: 'id' });
    if (error) throw new Error(`Sync portfolio_assets upsert gagal: ${error.message}`);
    return;
  }

  const { error } = await client
    .from('portfolio_assets')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', op.recordId)
    .eq('user_id', userId);
  if (error) throw new Error(`Sync portfolio_assets delete gagal: ${error.message}`);
}

export async function applyPortfolioActivityLogOp(
  client: SupabaseClient,
  userId: string,
  op: SyncOperationLike,
): Promise<void> {
  if (op.kind === 'upsert') {
    const payload = normalizePortfolioActivityLog(op.payload as PortfolioActivityLog);
    const basePayload = {
      id: payload.id,
      user_id: userId,
      pocket_id: payload.pocket_id,
      asset_id: payload.asset_id,
      ticker: payload.ticker,
      action: payload.action,
      amount_change: payload.amount_change,
      balance_after: payload.balance_after,
      price_at_time: payload.price_at_time,
      note: payload.note ?? null,
      created_at: payload.created_at,
    };
    const { error } = await client
      .from('portfolio_activity_log')
      .upsert({ ...basePayload, deleted_at: null }, { onConflict: 'id' });
    if (error) throw new Error(`Sync portfolio_activity_log upsert gagal: ${error.message}`);
    return;
  }

  const { error } = await client
    .from('portfolio_activity_log')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', op.recordId)
    .eq('user_id', userId);
  if (error) throw new Error(`Sync portfolio_activity_log delete gagal: ${error.message}`);
}

export async function pullPortfolioPockets(scope: string, client: SupabaseClient, cursor?: string): Promise<PullResult> {
  const key = pocketStorageKey(scope);
  const map = new Map((await readIDB<PortfolioPocket>(key)).map((item) => [item.id, item]));
  let currentCursor = parseCursor(cursor);
  let pulled = 0;
  let changed = false;

  while (true) {
    let query = client
      .from('portfolio_pockets')
      .select('id,name,source_type,source,color_theme,icon,sort_order,created_at,updated_at,deleted_at')
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PULL_PAGE_SIZE);

    query = applyCursorFilter(query, currentCursor, 'id');
    const { data, error } = await query;
    if (error) throw new Error(`Pull portfolio_pockets gagal: ${error.message}`);

    const rows = (data ?? []) as RemotePortfolioPocketRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.deleted_at) {
        if (map.delete(row.id)) changed = true;
      } else {
        const next = normalizePortfolioPocket(row);
        const current = map.get(next.id);
        if (!current || !arePortfolioPocketsEqual(current, next)) {
          map.set(next.id, next);
          changed = true;
        }
      }
      pulled += 1;
    }

    const last = rows[rows.length - 1];
    if (!last.updated_at || !last.id) break;
    currentCursor = { updatedAt: last.updated_at, tieBreaker: last.id };
    if (rows.length < PULL_PAGE_SIZE) break;
  }

  if (changed) await writeIDB(key, Array.from(map.values()));
  return { pulled, changed, cursor: serializeCursor(currentCursor) ?? cursor };
}

export async function pullPortfolioAssets(scope: string, client: SupabaseClient, cursor?: string): Promise<PullResult> {
  const key = assetStorageKey(scope);
  const map = new Map((await readIDB<PortfolioAsset>(key)).map((item) => [item.id, item]));
  let currentCursor = parseCursor(cursor);
  let pulled = 0;
  let changed = false;

  while (true) {
    let query = client
      .from('portfolio_assets')
      .select('id,pocket_id,ticker,coingecko_id,amount,created_at,updated_at,deleted_at')
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PULL_PAGE_SIZE);

    query = applyCursorFilter(query, currentCursor, 'id');
    const { data, error } = await query;
    if (error) throw new Error(`Pull portfolio_assets gagal: ${error.message}`);

    const rows = (data ?? []) as RemotePortfolioAssetRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.deleted_at) {
        if (map.delete(row.id)) changed = true;
      } else {
        const next = normalizePortfolioAsset(row);
        const current = map.get(next.id);
        if (!current || !arePortfolioAssetsEqual(current, next)) {
          map.set(next.id, next);
          changed = true;
        }
      }
      pulled += 1;
    }

    const last = rows[rows.length - 1];
    if (!last.updated_at || !last.id) break;
    currentCursor = { updatedAt: last.updated_at, tieBreaker: last.id };
    if (rows.length < PULL_PAGE_SIZE) break;
  }

  if (changed) await writeIDB(key, Array.from(map.values()));
  return { pulled, changed, cursor: serializeCursor(currentCursor) ?? cursor };
}

export async function pullPortfolioActivityLog(scope: string, client: SupabaseClient, cursor?: string): Promise<PullResult> {
  const key = activityStorageKey(scope);
  const map = new Map((await readIDB<PortfolioActivityLog>(key)).map((item) => [item.id, item]));
  let currentCursor = parseCursor(cursor);
  let pulled = 0;
  let changed = false;

  while (true) {
    let query = client
      .from('portfolio_activity_log')
      .select('id,pocket_id,asset_id,ticker,action,amount_change,balance_after,price_at_time,note,created_at,updated_at,deleted_at')
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PULL_PAGE_SIZE);

    query = applyCursorFilter(query, currentCursor, 'id');
    const { data, error } = await query;
    if (error) throw new Error(`Pull portfolio_activity_log gagal: ${error.message}`);

    const rows = (data ?? []) as RemotePortfolioActivityLogRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.deleted_at) {
        if (map.delete(row.id)) changed = true;
      } else {
        const next = normalizePortfolioActivityLog(row);
        const current = map.get(next.id);
        if (!current || !arePortfolioActivityLogsEqual(current, next)) {
          map.set(next.id, next);
          changed = true;
        }
      }
      pulled += 1;
    }

    const last = rows[rows.length - 1];
    if (!last.updated_at || !last.id) break;
    currentCursor = { updatedAt: last.updated_at, tieBreaker: last.id };
    if (rows.length < PULL_PAGE_SIZE) break;
  }

  if (changed) await writeIDB(key, Array.from(map.values()));
  return { pulled, changed, cursor: serializeCursor(currentCursor) ?? cursor };
}
