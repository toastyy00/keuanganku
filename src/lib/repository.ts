import { v4 as uuidv4 } from 'uuid';
import { getLocalISODate } from './utils';
import { readIDB, writeIDB } from './idb-storage';
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

const CATEGORY_MIGRATIONS = [
  {
    from: 'dapur',
    to: { slug: 'keperluan', label: 'Keperluan', emoji: '🛍️' },
  },
  {
    from: 'fashion',
    to: { slug: 'lifestyle', label: 'Lifestyle', emoji: '👟' },
  },
  {
    from: 'donasi',
    to: { slug: 'sedekah', label: 'Sedekah', emoji: '🤲' },
  },
] as const;

const CATEGORY_NORMALIZATIONS = [
  { slug: 'tagihan', label: 'Tagihan', emoji: '⚡' },
  { slug: 'keperluan', label: 'Keperluan', emoji: '🛍️' },
  { slug: 'makan', label: 'Makan', emoji: '🍜' },
  { slug: 'transport', label: 'Transportasi', emoji: '🚗' },
  { slug: 'health', label: 'Kesehatan', emoji: '💊' },
  { slug: 'lifestyle', label: 'Lifestyle', emoji: '👟' },
  { slug: 'gadget', label: 'Gadget', emoji: '📱' },
  { slug: 'digital', label: 'Digital', emoji: '💻' },
  { slug: 'sedekah', label: 'Sedekah', emoji: '🤲' },
  { slug: 'hadiah', label: 'Hadiah', emoji: '🎁' },
  { slug: 'keluarga', label: 'Keluarga', emoji: '👨‍👩‍👧' },
] as const;

// ============================================================
//  HELPERS
// ============================================================

function isoNow(): string {
  return new Date().toISOString();
}

function isoDate(date: Date = new Date()): string {
  return getLocalISODate(date);
}

async function migrateLocalCategorySlugs(): Promise<void> {
  const categories = await readIDB<Category>(KEYS.categories);
  let expenses = await readIDB<Expense>(KEYS.expenses);
  let recurring = await readIDB<RecurringTemplate>(KEYS.recurring);
  let changed = false;

  for (const migration of CATEGORY_MIGRATIONS) {
    const hasOldCategory = categories.some((item) => item.slug === migration.from);
    const hasOldExpense = expenses.some((item) => item.category === migration.from);
    const hasOldRecurring = recurring.some((item) => item.category === migration.from);

    if (!hasOldCategory && !hasOldExpense && !hasOldRecurring) continue;

    expenses = expenses.map((item) =>
      item.category === migration.from ? { ...item, category: migration.to.slug } : item
    );
    recurring = recurring.map((item) =>
      item.category === migration.from ? { ...item, category: migration.to.slug } : item
    );

    const targetIndex = categories.findIndex((item) => item.slug === migration.to.slug);
    const sourceIndex = categories.findIndex((item) => item.slug === migration.from);

    if (targetIndex >= 0) {
      categories[targetIndex] = {
        ...categories[targetIndex],
        label: migration.to.label,
        emoji: migration.to.emoji,
      };
      if (sourceIndex >= 0) {
        categories.splice(sourceIndex, 1);
      }
    } else if (sourceIndex >= 0) {
      categories[sourceIndex] = {
        ...categories[sourceIndex],
        slug: migration.to.slug,
        label: migration.to.label,
        emoji: migration.to.emoji,
      };
    } else {
      categories.push({
        slug: migration.to.slug,
        label: migration.to.label,
        emoji: migration.to.emoji,
        is_default: false,
      });
    }

    changed = true;
  }

  if (changed) {
    await writeIDB(KEYS.categories, categories);
    await writeIDB(KEYS.expenses, expenses);
    await writeIDB(KEYS.recurring, recurring);
  }
}

async function normalizeLocalCategoryMetadata(): Promise<void> {
  const categories = await readIDB<Category>(KEYS.categories);
  let changed = false;

  const normalized = categories.map((item) => {
    const match = CATEGORY_NORMALIZATIONS.find((category) => category.slug === item.slug);
    if (!match) return item;
    if (item.label === match.label && item.emoji === match.emoji) return item;

    changed = true;
    return {
      ...item,
      label: match.label,
      emoji: match.emoji,
    };
  });

  if (changed) {
    await writeIDB(KEYS.categories, normalized);
  }
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

let _migrationDone = false;

export async function runCategorySlugMigrations(): Promise<void> {
  if (_migrationDone) return;
  _migrationDone = true;

  if (!isAuthenticated()) {
    await migrateLocalCategorySlugs();
    await normalizeLocalCategoryMetadata();
    return;
  }

  const client = getSupabaseClient();
  const userId = useAuthStore.getState().user?.id;
  if (!client || !userId) return;

  for (const migration of CATEGORY_MIGRATIONS) {
    await client
      .from('expenses')
      .update({ category: migration.to.slug })
      .eq('user_id', userId)
      .eq('category', migration.from);

    await client
      .from('recurring_templates')
      .update({ category: migration.to.slug })
      .eq('user_id', userId)
      .eq('category', migration.from);

    await client
      .from('categories')
      .upsert(
        {
          slug: migration.to.slug,
          label: migration.to.label,
          emoji: migration.to.emoji,
          is_default: true,
          user_id: userId,
        },
        { onConflict: 'slug,user_id' }
      );

    await client
      .from('categories')
      .delete()
      .eq('user_id', userId)
      .eq('slug', migration.from);
  }

  for (const category of CATEGORY_NORMALIZATIONS) {
    await client
      .from('categories')
      .upsert(
        {
          slug: category.slug,
          label: category.label,
          emoji: category.emoji,
          is_default: true,
          user_id: userId,
        },
        { onConflict: 'slug,user_id' }
      );
  }
}

// ============================================================
//  LOCAL STORAGE — EXPENSE REPOSITORY
// ============================================================

export class LocalStorageExpenseRepository implements ExpenseRepository {
  async getAll(): Promise<Expense[]> {
    const expenses = await readIDB<Expense>(KEYS.expenses);
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
    const all = await readIDB<Expense>(KEYS.expenses);
    await writeIDB(KEYS.expenses, [expense, ...all]);
    return expense;
  }

  async update(id: string, data: Partial<Expense>): Promise<Expense> {
    const all = await readIDB<Expense>(KEYS.expenses);
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
    await writeIDB(KEYS.expenses, all);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const all = await readIDB<Expense>(KEYS.expenses);
    await writeIDB(
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
    const stored = await readIDB<Category>(KEYS.categories);

    // Migration/Sync: update labels for default categories that may have changed in code
    let changed = false;
    const updated = stored.map((s) => {
      const match = DEFAULT_CATEGORIES.find((d) => d.slug === s.slug);
      if (match && (match.label !== s.label || match.emoji !== s.emoji)) {
        changed = true;
        return { ...s, label: match.label, emoji: match.emoji };
      }
      return s;
    });

    const storedSlugs = new Set(updated.map((c) => c.slug));
    const missing = DEFAULT_CATEGORIES.filter((d) => !storedSlugs.has(d.slug));

    if (missing.length > 0 || changed) {
      const merged = [...updated, ...missing];
      await writeIDB(KEYS.categories, merged);
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
    await writeIDB(KEYS.categories, [...all, newCategory]);
    return newCategory;
  }

  async update(slug: string, data: Partial<Category>): Promise<Category> {
    const all = await this.getAll();
    const index = all.findIndex((c) => c.slug === slug);
    if (index === -1) throw new Error(`Category "${slug}" not found.`);
    const updated: Category = { ...all[index], ...data, slug };
    all[index] = updated;
    await writeIDB(KEYS.categories, all);
    return updated;
  }

  async delete(slug: string): Promise<void> {
    const all = await this.getAll();
    const target = all.find((c) => c.slug === slug);
    if (!target) throw new Error(`Category "${slug}" not found.`);
    if (target.is_default) {
      throw new Error(`Default category "${slug}" cannot be deleted.`);
    }
    await writeIDB(
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
    return readIDB<RecurringTemplate>(KEYS.recurring);
  }

  async create(
    data: Omit<RecurringTemplate, 'id'>
  ): Promise<RecurringTemplate> {
    const template: RecurringTemplate = { ...data, id: uuidv4() };
    const all = await readIDB<RecurringTemplate>(KEYS.recurring);
    await writeIDB(KEYS.recurring, [template, ...all]);
    return template;
  }

  async update(
    id: string,
    data: Partial<RecurringTemplate>
  ): Promise<RecurringTemplate> {
    const all = await readIDB<RecurringTemplate>(KEYS.recurring);
    const index = all.findIndex((r) => r.id === id);
    if (index === -1) throw new Error(`Recurring template "${id}" not found.`);
    const updated: RecurringTemplate = { ...all[index], ...data, id };
    all[index] = updated;
    await writeIDB(KEYS.recurring, all);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const all = await readIDB<RecurringTemplate>(KEYS.recurring);
    await writeIDB(
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
//  REPOSITORY FACTORY FUNCTIONS  (cached singletons)
// ============================================================

let _expenseRepo: ExpenseRepository | null = null;
let _categoryRepo: CategoryRepository | null = null;
let _recurringRepo: RecurringRepository | null = null;
let _lastAuthState: boolean | null = null;

function getOrCreate<T>(
  current: T | null,
  authed: boolean,
  AuthedClass: new () => T,
  LocalClass: new () => T,
): T {
  if (current && _lastAuthState === authed) return current;
  return authed ? new AuthedClass() : new LocalClass();
}

/**
 * Returns the correct ExpenseRepository based on auth state.
 * Authenticated (session exists) → SupabaseExpenseRepository
 * Unauthenticated → LocalStorageExpenseRepository (offline fallback)
 */
export function getExpenseRepository(): ExpenseRepository {
  const authed = isAuthenticated();
  if (_lastAuthState !== authed) {
    _expenseRepo = null;
    _categoryRepo = null;
    _recurringRepo = null;
    _lastAuthState = authed;
  }
  _expenseRepo = getOrCreate(_expenseRepo, authed, SupabaseExpenseRepository, LocalStorageExpenseRepository);
  return _expenseRepo;
}

export function getCategoryRepository(): CategoryRepository {
  const authed = isAuthenticated();
  if (_lastAuthState !== authed) { _lastAuthState = authed; _expenseRepo = null; _categoryRepo = null; _recurringRepo = null; }
  _categoryRepo = getOrCreate(_categoryRepo, authed, SupabaseCategoryRepository, LocalStorageCategoryRepository);
  return _categoryRepo;
}

export function getRecurringRepository(): RecurringRepository {
  const authed = isAuthenticated();
  if (_lastAuthState !== authed) { _lastAuthState = authed; _expenseRepo = null; _categoryRepo = null; _recurringRepo = null; }
  _recurringRepo = getOrCreate(_recurringRepo, authed, SupabaseRecurringRepository, LocalStorageRecurringRepository);
  return _recurringRepo;
}

