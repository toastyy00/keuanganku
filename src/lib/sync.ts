import type { Expense, Category, RecurringTemplate } from '../types';
import { useAuthStore } from '../store/useAuthStore';
import { v4 as uuidv4 } from 'uuid';
import {
  LocalStorageExpenseRepository,
  SupabaseExpenseRepository,
} from './repository';
import { getSupabaseClient } from './supabase';
import { getLocalISODate } from './utils';

// ============================================================
//  SYNC — Push unsynced localStorage expenses to Supabase
// ============================================================

export interface SyncResult {
  synced: number;
  failed: number;
  errors: string[];
}

type ImportedCategory = Partial<Category> & { user_id?: string };
type ImportedRecurring = Partial<RecurringTemplate> & { user_id?: string; frequency?: string };
type ImportedExpense = Partial<Expense> & { user_id?: string };

/**
 * Pushes all expenses with `synced: false` from localStorage to Supabase.
 * Marks them as `synced: true` in localStorage on success.
 */
export async function syncToSupabase(): Promise<SyncResult> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase is not configured. Add credentials in Settings.');
  }

  const localRepo = new LocalStorageExpenseRepository();
  const remoteRepo = new SupabaseExpenseRepository();

  const all = await localRepo.getAll();
  const unsynced = all.filter((e) => !e.synced);

  const result: SyncResult = { synced: 0, failed: 0, errors: [] };



  for (const expense of unsynced) {
    try {
      // Check if the expense already exists in Supabase (by id)
      const { data: existing } = await client
        .from('expenses')
        .select('id')
        .eq('id', expense.id)
        .single();

      if (existing) {
        // Update
        await remoteRepo.update(expense.id, { ...expense, synced: true });
      } else {
        // Insert
        await client.from('expenses').insert({
          ...expense,
          synced: true,
        });
      }

      // Mark as synced locally
      await localRepo.update(expense.id, { synced: true });
      result.synced++;
    } catch (err) {
      result.failed++;
      result.errors.push(
        `${expense.name}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  return result;
}

// ============================================================
//  JSON BACKUP
// ============================================================

export function exportJSON(data: { expenses: Expense[]; categories: Category[]; recurring: RecurringTemplate[] }): void {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    expenses: data.expenses,
    categories: data.categories,
    recurring: data.recurring,
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

  if (session && user) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase client tidak dapat diakses.');

    // 1. Wipe existing data for this user
    await client.from('expenses').delete().eq('user_id', user.id);
    await client.from('recurring_templates').delete().eq('user_id', user.id);
    await client.from('categories').delete().eq('user_id', user.id);

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
        await client.from('categories').upsert(catsToInsert, { onConflict: 'slug,user_id' });
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
        await client.from('recurring_templates').insert(recsToInsert);
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
      const chunkSize = 500;
      for (let i = 0; i < expsToInsert.length; i += chunkSize) {
        await client.from('expenses').insert(expsToInsert.slice(i, i + chunkSize));
      }
    }
  } else {
    // Write to localStorage
    if (Array.isArray(parsed.expenses)) {
      localStorage.setItem('expenses', JSON.stringify(parsed.expenses));
    }
    if (Array.isArray(parsed.categories)) {
      localStorage.setItem('categories', JSON.stringify(parsed.categories));
    }
    if (Array.isArray(parsed.recurring)) {
      localStorage.setItem('recurring', JSON.stringify(parsed.recurring));
    }
  }

  return parsed;
}
