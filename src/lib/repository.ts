import { v4 as uuidv4 } from 'uuid';
import type {
  Expense,
  Category,
  RecurringTemplate,
  ExpenseRepository,
  CategoryRepository,
  RecurringRepository,
} from '../types';
import { DEFAULT_CATEGORIES } from './categories';
import { getSupabaseClient } from './supabase';
import { useAuthStore } from '../store/useAuthStore';

// ============================================================
//  STORAGE KEYS
// ============================================================

const KEYS = {
  expenses: 'expenses',
  categories: 'categories',
  recurring: 'recurring',
} as const;

// ============================================================
//  HELPERS
// ============================================================

function readJSON<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch {
    return []
  }
}

function writeJSON<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data));
}

function isoNow(): string {
  return new Date().toISOString();
}

function isoDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Returns the authenticated user's ID, or throws if not authenticated. */
function requireUserId(): string {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) throw new Error('Pengguna belum masuk.');
  return userId;
}

/** True if the user currently has an active Supabase session. */
function isAuthenticated(): boolean {
  return useAuthStore.getState().session !== null;
}

// ============================================================
//  LOCAL STORAGE — EXPENSE REPOSITORY
// ============================================================

export class LocalStorageExpenseRepository implements ExpenseRepository {
  async getAll(): Promise<Expense[]> {
    const expenses = readJSON<Expense>(KEYS.expenses);
    return expenses.sort((a, b) => {
      const dateDiff = b.date.localeCompare(a.date);
      if (dateDiff !== 0) return dateDiff;
      return b.created_at.localeCompare(a.created_at);
    });
  }

  async getByMonth(year: number, month: number): Promise<Expense[]> {
    const all = await this.getAll();
    const monthStr = String(month).padStart(2, '0');
    const prefix = `${year}-${monthStr}`;
    return all.filter((e) => e.date.startsWith(prefix));
  }

  async create(
    data: Omit<Expense, 'id' | 'created_at' | 'synced'>
  ): Promise<Expense> {
    const expense: Expense = {
      ...data,
      id: uuidv4(),
      created_at: isoNow(),
      synced: false,
    };
    const all = readJSON<Expense>(KEYS.expenses);
    writeJSON(KEYS.expenses, [expense, ...all]);
    return expense;
  }

  async update(id: string, data: Partial<Expense>): Promise<Expense> {
    const all = readJSON<Expense>(KEYS.expenses);
    const index = all.findIndex((e) => e.id === id);
    if (index === -1) {
      throw new Error(`Expense with id "${id}" not found.`);
    }
    const updated: Expense = {
      ...all[index],
      ...data,
      id,
      synced: false,
    };
    all[index] = updated;
    writeJSON(KEYS.expenses, all);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const all = readJSON<Expense>(KEYS.expenses);
    writeJSON(
      KEYS.expenses,
      all.filter((e) => e.id !== id)
    );
  }
}

// ============================================================
//  LOCAL STORAGE — CATEGORY REPOSITORY
// ============================================================

export class LocalStorageCategoryRepository implements CategoryRepository {
  async getAll(): Promise<Category[]> {
    const stored = readJSON<Category>(KEYS.categories);

    // Migration/Sync: update labels for default categories that may have changed in code
    let changed = false;
    const updated = stored.map((s) => {
      const match = DEFAULT_CATEGORIES.find((d) => d.slug === s.slug);
      if (match && match.label !== s.label) {
        changed = true;
        return { ...s, label: match.label, emoji: match.emoji };
      }
      return s;
    });

    const storedSlugs = new Set(updated.map((c) => c.slug));
    const missing = DEFAULT_CATEGORIES.filter((d) => !storedSlugs.has(d.slug));

    if (missing.length > 0 || changed) {
      const merged = [...updated, ...missing];
      writeJSON(KEYS.categories, merged);
      return merged;
    }

    return updated;
  }

  async create(data: Category): Promise<Category> {
    const all = await this.getAll();
    const exists = all.some((c) => c.slug === data.slug);
    if (exists) {
      throw new Error(`Category slug "${data.slug}" already exists.`);
    }
    const newCategory: Category = { ...data, is_default: false };
    writeJSON(KEYS.categories, [...all, newCategory]);
    return newCategory;
  }

  async update(slug: string, data: Partial<Category>): Promise<Category> {
    const all = await this.getAll();
    const index = all.findIndex((c) => c.slug === slug);
    if (index === -1) throw new Error(`Category "${slug}" not found.`);
    const updated: Category = { ...all[index], ...data, slug };
    all[index] = updated;
    writeJSON(KEYS.categories, all);
    return updated;
  }

  async delete(slug: string): Promise<void> {
    const all = await this.getAll();
    const target = all.find((c) => c.slug === slug);
    if (!target) throw new Error(`Category "${slug}" not found.`);
    if (target.is_default) {
      throw new Error(`Default category "${slug}" cannot be deleted.`);
    }
    writeJSON(
      KEYS.categories,
      all.filter((c) => c.slug !== slug)
    );
  }
}

// ============================================================
//  LOCAL STORAGE — RECURRING REPOSITORY
// ============================================================

export class LocalStorageRecurringRepository implements RecurringRepository {
  async getAll(): Promise<RecurringTemplate[]> {
    return readJSON<RecurringTemplate>(KEYS.recurring);
  }

  async create(
    data: Omit<RecurringTemplate, 'id'>
  ): Promise<RecurringTemplate> {
    const template: RecurringTemplate = { ...data, id: uuidv4() };
    const all = readJSON<RecurringTemplate>(KEYS.recurring);
    writeJSON(KEYS.recurring, [template, ...all]);
    return template;
  }

  async update(
    id: string,
    data: Partial<RecurringTemplate>
  ): Promise<RecurringTemplate> {
    const all = readJSON<RecurringTemplate>(KEYS.recurring);
    const index = all.findIndex((r) => r.id === id);
    if (index === -1) throw new Error(`Recurring template "${id}" not found.`);
    const updated: RecurringTemplate = { ...all[index], ...data, id };
    all[index] = updated;
    writeJSON(KEYS.recurring, all);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const all = readJSON<RecurringTemplate>(KEYS.recurring);
    writeJSON(
      KEYS.recurring,
      all.filter((r) => r.id !== id)
    );
  }
}

// ============================================================
//  SUPABASE — EXPENSE REPOSITORY
// ============================================================

export class SupabaseExpenseRepository implements ExpenseRepository {
  private get client() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase client is not configured.');
    return client;
  }

  async getAll(): Promise<Expense[]> {
    const { data, error } = await this.client
      .from('expenses')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Supabase getAll error: ${error.message}`);
    return (data ?? []) as Expense[];
  }

  async getByMonth(year: number, month: number): Promise<Expense[]> {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(year, month, 0);
    const endStr = isoDate(end);

    const { data, error } = await this.client
      .from('expenses')
      .select('*')
      .gte('date', start)
      .lte('date', endStr)
      .order('date', { ascending: false });

    if (error) throw new Error(`Supabase getByMonth error: ${error.message}`);
    return (data ?? []) as Expense[];
  }

  async create(
    data: Omit<Expense, 'id' | 'created_at' | 'synced'>
  ): Promise<Expense> {
    const payload = {
      ...data,
      id: uuidv4(),
      created_at: isoNow(),
      synced: true,
      user_id: requireUserId(),
    };

    const { data: inserted, error } = await this.client
      .from('expenses')
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(`Supabase create error: ${error.message}`);
    return inserted as Expense;
  }

  async update(id: string, data: Partial<Expense>): Promise<Expense> {
    const { data: updated, error } = await this.client
      .from('expenses')
      .update({ ...data, synced: true })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Supabase update error: ${error.message}`);
    return updated as Expense;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('expenses')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Supabase delete error: ${error.message}`);
  }
}

// ============================================================
//  SUPABASE — CATEGORY REPOSITORY
// ============================================================

export class SupabaseCategoryRepository implements CategoryRepository {
  private get client() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase client is not configured.');
    return client;
  }

  async getAll(): Promise<Category[]> {
    const { data, error } = await this.client
      .from('categories')
      .select('*')
      .order('label', { ascending: true });

    if (error) throw new Error(`Supabase categories error: ${error.message}`);
    return (data ?? []) as Category[];
  }

  async create(data: Category): Promise<Category> {
    const { data: inserted, error } = await this.client
      .from('categories')
      .insert({ ...data, is_default: false, user_id: requireUserId() })
      .select()
      .single();

    if (error) throw new Error(`Supabase create category error: ${error.message}`);
    return inserted as Category;
  }

  async update(slug: string, data: Partial<Category>): Promise<Category> {
    const { data: updated, error } = await this.client
      .from('categories')
      .update(data)
      .eq('slug', slug)
      .select()
      .single();

    if (error) throw new Error(`Supabase update category error: ${error.message}`);
    return updated as Category;
  }

  async delete(slug: string): Promise<void> {
    const { data: cat } = await this.client
      .from('categories')
      .select('is_default')
      .eq('slug', slug)
      .single();

    if (cat?.is_default) {
      throw new Error(`Default category "${slug}" cannot be deleted.`);
    }

    const { error } = await this.client
      .from('categories')
      .delete()
      .eq('slug', slug);

    if (error) throw new Error(`Supabase delete category error: ${error.message}`);
  }
}

// ============================================================
//  SUPABASE — RECURRING REPOSITORY
// ============================================================

export class SupabaseRecurringRepository implements RecurringRepository {
  private get client() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase client is not configured.');
    return client;
  }

  async getAll(): Promise<RecurringTemplate[]> {
    const { data, error } = await this.client
      .from('recurring_templates')
      .select('*')
      .order('active', { ascending: false });

    if (error) throw new Error(`Supabase recurring getAll error: ${error.message}`);
    return (data ?? []) as RecurringTemplate[];
  }

  async create(data: Omit<RecurringTemplate, 'id'>): Promise<RecurringTemplate> {
    const payload = { ...data, id: uuidv4(), user_id: requireUserId(), frequency: 'monthly' };

    const { data: inserted, error } = await this.client
      .from('recurring_templates')
      .insert(payload)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST204') {
        throw new Error(`Update Supabase: Tambahkan kolom baru. Jalankan SQL: ALTER TABLE recurring_templates ADD COLUMN schedule_detail TEXT;`);
      }
      throw new Error(`Supabase create recurring error: ${error.message}`);
    }
    return inserted as RecurringTemplate;
  }

  async update(
    id: string,
    data: Partial<RecurringTemplate>
  ): Promise<RecurringTemplate> {
    const { data: updated, error } = await this.client
      .from('recurring_templates')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST204') {
        throw new Error(`Update Supabase: Tambahkan kolom baru. Jalankan SQL: ALTER TABLE recurring_templates ADD COLUMN schedule_detail TEXT;`);
      }
      throw new Error(`Supabase update recurring error: ${error.message}`);
    }
    return updated as RecurringTemplate;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('recurring_templates')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Supabase delete recurring error: ${error.message}`);
  }
}

// ============================================================
//  REPOSITORY FACTORY FUNCTIONS
// ============================================================

/**
 * Returns the correct ExpenseRepository based on auth state.
 * Authenticated (session exists) → SupabaseExpenseRepository
 * Unauthenticated → LocalStorageExpenseRepository (offline fallback)
 */
export function getExpenseRepository(): ExpenseRepository {
  return isAuthenticated()
    ? new SupabaseExpenseRepository()
    : new LocalStorageExpenseRepository();
}

export function getCategoryRepository(): CategoryRepository {
  return isAuthenticated()
    ? new SupabaseCategoryRepository()
    : new LocalStorageCategoryRepository();
}

export function getRecurringRepository(): RecurringRepository {
  return isAuthenticated()
    ? new SupabaseRecurringRepository()
    : new LocalStorageRecurringRepository();
}
