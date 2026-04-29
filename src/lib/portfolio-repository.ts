import { v4 as uuidv4 } from 'uuid';
import { getActiveDataScope, scopedDataKey } from './dataScope';
import { readIDB, writeIDB } from './idb-storage';
import { useAuthStore } from '../store/useAuthStore';
import { enqueueSyncDelete, enqueueSyncUpsert, triggerBackgroundSync } from './sync-engine';
import type { PortfolioActivityLog, PortfolioAsset, PortfolioPocket } from '../types';

const KEYS = {
  pockets: 'portfolio_pockets',
  assets: 'portfolio_assets',
  activity: 'portfolio_activity_log',
} as const;

function scopedKey(key: keyof typeof KEYS, scope: string = getActiveDataScope()): string {
  return scopedDataKey(KEYS[key], scope);
}

function isoNow(): string {
  return new Date().toISOString();
}

function isAuthenticated(): boolean {
  return useAuthStore.getState().session !== null;
}

async function enqueueSyncDeletesSequentially(entity: 'portfolio_assets' | 'portfolio_activity_log', ids: string[]): Promise<void> {
  for (const id of ids) {
    await enqueueSyncDelete(entity, id);
  }
}

function normalizeHoldingType(value: unknown): PortfolioAsset['holding_type'] {
  if (value === 'staked' || value === 'locked') return value;
  return 'liquid';
}

function normalizePortfolioAssetLocal(record: PortfolioAsset): PortfolioAsset {
  return {
    ...record,
    ticker: record.ticker.trim().toUpperCase(),
    amount: Math.round((Number(record.amount) + Number.EPSILON) * 100_000_000) / 100_000_000,
    location: record.location?.trim() || 'Wallet',
    holding_type: normalizeHoldingType(record.holding_type),
    chain: record.chain?.trim() || undefined,
    note: record.note?.trim() || undefined,
  };
}

export class LocalPortfolioPocketRepo {
  async getAll(): Promise<PortfolioPocket[]> {
    const list = await readIDB<PortfolioPocket>(scopedKey('pockets'));
    return list.sort((a, b) => {
      const orderDiff = a.sort_order - b.sort_order;
      if (orderDiff !== 0) return orderDiff;
      return b.created_at.localeCompare(a.created_at);
    });
  }

  async create(data: Omit<PortfolioPocket, 'id' | 'created_at'>): Promise<PortfolioPocket> {
    const next: PortfolioPocket = {
      ...data,
      id: uuidv4(),
      created_at: isoNow(),
    };
    const key = scopedKey('pockets');
    const all = await readIDB<PortfolioPocket>(key);
    await writeIDB(key, [next, ...all]);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('portfolio_pockets', next.id, next);
      triggerBackgroundSync();
    }
    return next;
  }

  async update(id: string, data: Partial<PortfolioPocket>): Promise<PortfolioPocket> {
    const key = scopedKey('pockets');
    const all = await readIDB<PortfolioPocket>(key);
    const index = all.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Portfolio pocket "${id}" not found.`);
    const updated: PortfolioPocket = { ...all[index], ...data, id };
    all[index] = updated;
    await writeIDB(key, all);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('portfolio_pockets', updated.id, updated);
      triggerBackgroundSync();
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const key = scopedKey('pockets');
    const all = await readIDB<PortfolioPocket>(key);
    await writeIDB(key, all.filter((item) => item.id !== id));

    if (isAuthenticated()) {
      await enqueueSyncDelete('portfolio_pockets', id);
      triggerBackgroundSync();
    }
  }
}

export class LocalPortfolioAssetRepo {
  async getAll(): Promise<PortfolioAsset[]> {
    const list = await readIDB<PortfolioAsset>(scopedKey('assets'));
    return list.map(normalizePortfolioAssetLocal).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async create(data: Omit<PortfolioAsset, 'id' | 'created_at'>): Promise<PortfolioAsset> {
    const next = normalizePortfolioAssetLocal({
      ...data,
      id: uuidv4(),
      created_at: isoNow(),
    });
    const key = scopedKey('assets');
    const all = await readIDB<PortfolioAsset>(key);
    await writeIDB(key, [next, ...all]);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('portfolio_assets', next.id, next);
      triggerBackgroundSync();
    }
    return next;
  }

  async update(id: string, data: Partial<PortfolioAsset>): Promise<PortfolioAsset> {
    const key = scopedKey('assets');
    const all = await readIDB<PortfolioAsset>(key);
    const index = all.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Portfolio asset "${id}" not found.`);
    const updated: PortfolioAsset = normalizePortfolioAssetLocal({ ...all[index], ...data, id });
    all[index] = updated;
    await writeIDB(key, all);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('portfolio_assets', updated.id, updated);
      triggerBackgroundSync();
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const key = scopedKey('assets');
    const all = await readIDB<PortfolioAsset>(key);
    await writeIDB(key, all.filter((item) => item.id !== id));

    if (isAuthenticated()) {
      await enqueueSyncDelete('portfolio_assets', id);
      triggerBackgroundSync();
    }
  }

  async deleteByPocketId(pocketId: string): Promise<void> {
    const key = scopedKey('assets');
    const all = await readIDB<PortfolioAsset>(key);
    const deletedIds = all.filter((item) => item.pocket_id === pocketId).map((item) => item.id);
    await writeIDB(key, all.filter((item) => item.pocket_id !== pocketId));

    if (isAuthenticated() && deletedIds.length > 0) {
      await enqueueSyncDeletesSequentially('portfolio_assets', deletedIds);
      triggerBackgroundSync();
    }
  }
}

export class LocalPortfolioActivityLogRepo {
  async getAll(): Promise<PortfolioActivityLog[]> {
    const list = await readIDB<PortfolioActivityLog>(scopedKey('activity'));
    return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getByPocket(pocketId: string): Promise<PortfolioActivityLog[]> {
    const all = await this.getAll();
    return all.filter((item) => item.pocket_id === pocketId);
  }

  async create(data: Omit<PortfolioActivityLog, 'id' | 'created_at'>): Promise<PortfolioActivityLog> {
    const next: PortfolioActivityLog = {
      ...data,
      id: uuidv4(),
      created_at: isoNow(),
    };
    const key = scopedKey('activity');
    const all = await readIDB<PortfolioActivityLog>(key);
    await writeIDB(key, [next, ...all]);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('portfolio_activity_log', next.id, next);
      triggerBackgroundSync();
    }
    return next;
  }

  async deleteByPocketId(pocketId: string): Promise<void> {
    const key = scopedKey('activity');
    const all = await readIDB<PortfolioActivityLog>(key);
    const deletedIds = all.filter((item) => item.pocket_id === pocketId).map((item) => item.id);
    await writeIDB(key, all.filter((item) => item.pocket_id !== pocketId));

    if (isAuthenticated() && deletedIds.length > 0) {
      await enqueueSyncDeletesSequentially('portfolio_activity_log', deletedIds);
      triggerBackgroundSync();
    }
  }
}

let _pocketRepo: LocalPortfolioPocketRepo | null = null;
let _assetRepo: LocalPortfolioAssetRepo | null = null;
let _activityRepo: LocalPortfolioActivityLogRepo | null = null;

export function getPortfolioPocketRepo(): LocalPortfolioPocketRepo {
  if (_pocketRepo) return _pocketRepo;
  _pocketRepo = new LocalPortfolioPocketRepo();
  return _pocketRepo;
}

export function getPortfolioAssetRepo(): LocalPortfolioAssetRepo {
  if (_assetRepo) return _assetRepo;
  _assetRepo = new LocalPortfolioAssetRepo();
  return _assetRepo;
}

export function getPortfolioActivityLogRepo(): LocalPortfolioActivityLogRepo {
  if (_activityRepo) return _activityRepo;
  _activityRepo = new LocalPortfolioActivityLogRepo();
  return _activityRepo;
}
