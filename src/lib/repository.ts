import { v4 as uuidv4 } from 'uuid';
import { getLocalISODate } from './utils';
import { readIDB, readIDBValue, writeIDB, writeIDBValue } from './idb-storage';
import { GUEST_DATA_SCOPE, getActiveDataScope, scopedDataKey } from './dataScope';
import type {
  Expense,
  Category,
  RecurringTemplate,
  ExpenseRepository,
  CategoryRepository,
  RecurringRepository,
  IncomeEntry,
  IncomeRepository,
} from '../types';
import { DEFAULT_CATEGORIES } from './categories';
import { getSupabaseClient } from './supabase';
import { useAuthStore } from '../store/useAuthStore';
import { enqueueSyncDelete, enqueueSyncUpsert, triggerBackgroundSync } from './sync-engine';

// ============================================================
//  STORAGE KEYS
// ============================================================

const KEYS = {
  expenses: 'expenses',
  categories: 'categories',
  recurring: 'recurring',
  income_entries: 'income_entries',
} as const;
const LEGACY_MIGRATION_FLAG_PREFIX = '__scope_legacy_migrated__';

function scopedKey(key: keyof typeof KEYS, scope: string = getActiveDataScope()): string {
  return scopedDataKey(KEYS[key], scope);
}

async function readScopedArray<T>(
  key: keyof typeof KEYS,
  scope: string = getActiveDataScope(),
): Promise<T[]> {
  const currentKey = scopedKey(key, scope);
  const scopedData = await readIDB<T>(currentKey);
  if (scopedData.length > 0) return scopedData;

  const migrationFlagKey = scopedDataKey(`${LEGACY_MIGRATION_FLAG_PREFIX}:${KEYS[key]}`, scope);
  const migrated = await readIDBValue<boolean>(migrationFlagKey);
  if (migrated) return scopedData;

  // Privacy guard: never auto-import legacy global keys into authenticated scopes.
  if (scope !== GUEST_DATA_SCOPE) {
    await writeIDBValue(migrationFlagKey, true);
    return scopedData;
  }

  const legacyData = await readIDB<T>(KEYS[key]);
  if (legacyData.length > 0) {
    await writeIDB(currentKey, legacyData);
  }
  await writeIDBValue(migrationFlagKey, true);
  return legacyData;
}

const EXPENSE_SELECT_COLUMNS = [
  'id',
  'name',
  'amount',
  'currency',
  'category',
  'type',
  'destination',
  'date',
  'note',
  'is_recurring',
  'recurring_id',
  'created_at',
  'synced',
].join(',');

const CATEGORY_SELECT_COLUMNS = [
  'slug',
  'label',
  'emoji',
  'is_default',
].join(',');

const RECURRING_SELECT_COLUMNS = [
  'id',
  'name',
  'amount',
  'currency',
  'category',
  'type',
  'schedule_detail',
  'note',
  'last_logged',
  'active',
].join(',');

const INCOME_SELECT_COLUMNS = [
  'id',
  'title',
  'source_type',
  'asset_type',
  'amount',
  'ticker',
  'coingecko_id',
  'currency',
  'price_at_time',
  'is_manual_price',
  'value_usd',
  'value_idr',
  'has_cost_basis',
  'cost_amount',
  'cost_ticker',
  'cost_coingecko_id',
  'cost_price_per_unit',
  'cost_is_manual_price',
  'cost_value_usd',
  'cost_value_idr',
  'chain',
  'platform',
  'pocket_id',
  'date',
  'note',
].join(',');

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
  const categoriesKey = scopedKey('categories', GUEST_DATA_SCOPE);
  const expensesKey = scopedKey('expenses', GUEST_DATA_SCOPE);
  const recurringKey = scopedKey('recurring', GUEST_DATA_SCOPE);
  const categories = await readScopedArray<Category>('categories', GUEST_DATA_SCOPE);
  let expenses = await readScopedArray<Expense>('expenses', GUEST_DATA_SCOPE);
  let recurring = await readScopedArray<RecurringTemplate>('recurring', GUEST_DATA_SCOPE);
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
    await writeIDB(categoriesKey, categories);
    await writeIDB(expensesKey, expenses);
    await writeIDB(recurringKey, recurring);
  }
}

async function normalizeLocalCategoryMetadata(): Promise<void> {
  const categoriesKey = scopedKey('categories', GUEST_DATA_SCOPE);
  const categories = await readScopedArray<Category>('categories', GUEST_DATA_SCOPE);
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
    await writeIDB(categoriesKey, normalized);
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

  // Supabase-side category slug migrations have already been completed.
  // Keep this cleanup for offline/local data only so app startup stays quiet.
  if (isAuthenticated()) return;

  await migrateLocalCategorySlugs();
  await normalizeLocalCategoryMetadata();
}

// ============================================================
//  LOCAL STORAGE — EXPENSE REPOSITORY
// ============================================================

export class LocalStorageExpenseRepository implements ExpenseRepository {
  async getAll(): Promise<Expense[]> {
    const expenses = await readScopedArray<Expense>('expenses');
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
    const key = scopedKey('expenses');
    const all = await readScopedArray<Expense>('expenses');
    await writeIDB(key, [expense, ...all]);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('expenses', expense.id, expense);
      triggerBackgroundSync({ domain: 'base' });
    }
    return expense;
  }

  async update(id: string, data: Partial<Expense>): Promise<Expense> {
    const key = scopedKey('expenses');
    const all = await readScopedArray<Expense>('expenses');
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
    await writeIDB(key, all);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('expenses', updated.id, updated);
      triggerBackgroundSync({ domain: 'base' });
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const key = scopedKey('expenses');
    const all = await readScopedArray<Expense>('expenses');
    await writeIDB(
      key,
      all.filter((e) => e.id !== id)
    );

    if (isAuthenticated()) {
      await enqueueSyncDelete('expenses', id);
      triggerBackgroundSync({ domain: 'base' });
    }
  }
}

// ============================================================
//  LOCAL STORAGE — CATEGORY REPOSITORY
// ============================================================

export class LocalStorageCategoryRepository implements CategoryRepository {
  async getAll(): Promise<Category[]> {
    const key = scopedKey('categories');
    const stored = await readScopedArray<Category>('categories');

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
      await writeIDB(key, merged);
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
    await writeIDB(scopedKey('categories'), [...all, newCategory]);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('categories', newCategory.slug, newCategory);
      triggerBackgroundSync({ domain: 'base' });
    }
    return newCategory;
  }

  async update(slug: string, data: Partial<Category>): Promise<Category> {
    const all = await this.getAll();
    const index = all.findIndex((c) => c.slug === slug);
    if (index === -1) throw new Error(`Category "${slug}" not found.`);
    const updated: Category = { ...all[index], ...data, slug };
    all[index] = updated;
    await writeIDB(scopedKey('categories'), all);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('categories', updated.slug, updated);
      triggerBackgroundSync({ domain: 'base' });
    }
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
      scopedKey('categories'),
      all.filter((c) => c.slug !== slug)
    );

    if (isAuthenticated()) {
      await enqueueSyncDelete('categories', slug);
      triggerBackgroundSync({ domain: 'base' });
    }
  }
}

// ============================================================
//  LOCAL STORAGE — RECURRING REPOSITORY
// ============================================================

export class LocalStorageRecurringRepository implements RecurringRepository {
  async getAll(): Promise<RecurringTemplate[]> {
    return readScopedArray<RecurringTemplate>('recurring');
  }

  async create(
    data: Omit<RecurringTemplate, 'id'>
  ): Promise<RecurringTemplate> {
    const template: RecurringTemplate = { ...data, id: uuidv4() };
    const key = scopedKey('recurring');
    const all = await readScopedArray<RecurringTemplate>('recurring');
    await writeIDB(key, [template, ...all]);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('recurring', template.id, template);
      triggerBackgroundSync({ domain: 'base' });
    }
    return template;
  }

  async update(
    id: string,
    data: Partial<RecurringTemplate>
  ): Promise<RecurringTemplate> {
    const key = scopedKey('recurring');
    const all = await readScopedArray<RecurringTemplate>('recurring');
    const index = all.findIndex((r) => r.id === id);
    if (index === -1) throw new Error(`Recurring template "${id}" not found.`);
    const updated: RecurringTemplate = { ...all[index], ...data, id };
    all[index] = updated;
    await writeIDB(key, all);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('recurring', updated.id, updated);
      triggerBackgroundSync({ domain: 'base' });
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const key = scopedKey('recurring');
    const all = await readScopedArray<RecurringTemplate>('recurring');
    await writeIDB(
      key,
      all.filter((r) => r.id !== id)
    );

    if (isAuthenticated()) {
      await enqueueSyncDelete('recurring', id);
      triggerBackgroundSync({ domain: 'base' });
    }
  }
}

// ============================================================
//  LOCAL STORAGE — INCOME REPOSITORY
// ============================================================

export class LocalStorageIncomeRepository implements IncomeRepository {
  async getAll(): Promise<IncomeEntry[]> {
    const incomes = await readScopedArray<IncomeEntry>('income_entries');
    return incomes.sort((a, b) => {
      const dateDiff = b.date.localeCompare(a.date);
      if (dateDiff !== 0) return dateDiff;
      return b.created_at.localeCompare(a.created_at);
    });
  }

  async create(
    data: Omit<IncomeEntry, 'id' | 'created_at' | 'synced'>
  ): Promise<IncomeEntry> {
    const income: IncomeEntry = {
      ...data,
      id: uuidv4(),
      created_at: isoNow(),
      synced: false,
    };
    const key = scopedKey('income_entries');
    const all = await readScopedArray<IncomeEntry>('income_entries');
    await writeIDB(key, [income, ...all]);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('income_entries', income.id, income);
      triggerBackgroundSync({ domain: 'base' });
    }
    return income;
  }

  async update(id: string, data: Partial<IncomeEntry>): Promise<IncomeEntry> {
    const key = scopedKey('income_entries');
    const all = await readScopedArray<IncomeEntry>('income_entries');
    const index = all.findIndex((e) => e.id === id);
    if (index === -1) {
      throw new Error(`Income entry with id "${id}" not found.`);
    }
    const updated: IncomeEntry = {
      ...all[index],
      ...data,
      id,
      synced: false,
    };
    all[index] = updated;
    await writeIDB(key, all);

    if (isAuthenticated()) {
      await enqueueSyncUpsert('income_entries', updated.id, updated);
      triggerBackgroundSync({ domain: 'base' });
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const key = scopedKey('income_entries');
    const all = await readScopedArray<IncomeEntry>('income_entries');
    await writeIDB(
      key,
      all.filter((e) => e.id !== id)
    );

    if (isAuthenticated()) {
      await enqueueSyncDelete('income_entries', id);
      triggerBackgroundSync({ domain: 'base' });
    }
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
      .select(EXPENSE_SELECT_COLUMNS)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Supabase getAll error: ${error.message}`);
    return (data ?? []) as unknown as Expense[];
  }

  async getByMonth(year: number, month: number): Promise<Expense[]> {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(year, month, 0);
    const endStr = isoDate(end);

    const { data, error } = await this.client
      .from('expenses')
      .select(EXPENSE_SELECT_COLUMNS)
      .gte('date', start)
      .lte('date', endStr)
      .order('date', { ascending: false });

    if (error) throw new Error(`Supabase getByMonth error: ${error.message}`);
    return (data ?? []) as unknown as Expense[];
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
      .select(EXPENSE_SELECT_COLUMNS)
      .single();

    if (error) throw new Error(`Supabase create error: ${error.message}`);
    return inserted as unknown as Expense;
  }

  async update(id: string, data: Partial<Expense>): Promise<Expense> {
    const { data: updated, error } = await this.client
      .from('expenses')
      .update({ ...data, synced: true })
      .eq('id', id)
      .select(EXPENSE_SELECT_COLUMNS)
      .single();

    if (error) throw new Error(`Supabase update error: ${error.message}`);
    return updated as unknown as Expense;
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
      .select(CATEGORY_SELECT_COLUMNS)
      .order('label', { ascending: true });

    if (error) throw new Error(`Supabase categories error: ${error.message}`);
    return (data ?? []) as unknown as Category[];
  }

  async create(data: Category): Promise<Category> {
    const { data: inserted, error } = await this.client
      .from('categories')
      .insert({ ...data, is_default: false, user_id: requireUserId() })
      .select(CATEGORY_SELECT_COLUMNS)
      .single();

    if (error) throw new Error(`Supabase create category error: ${error.message}`);
    return inserted as unknown as Category;
  }

  async update(slug: string, data: Partial<Category>): Promise<Category> {
    const { data: updated, error } = await this.client
      .from('categories')
      .update(data)
      .eq('slug', slug)
      .select(CATEGORY_SELECT_COLUMNS)
      .single();

    if (error) throw new Error(`Supabase update category error: ${error.message}`);
    return updated as unknown as Category;
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
      .select(RECURRING_SELECT_COLUMNS)
      .order('active', { ascending: false });

    if (error) throw new Error(`Supabase recurring getAll error: ${error.message}`);
    return (data ?? []) as unknown as RecurringTemplate[];
  }

  async create(data: Omit<RecurringTemplate, 'id'>): Promise<RecurringTemplate> {
    const payload = { ...data, id: uuidv4(), user_id: requireUserId(), frequency: 'monthly' };

    const { data: inserted, error } = await this.client
      .from('recurring_templates')
      .insert(payload)
      .select(RECURRING_SELECT_COLUMNS)
      .single();

    if (error) {
      if (error.code === 'PGRST204') {
        throw new Error(`Update Supabase: Tambahkan kolom baru. Jalankan SQL: ALTER TABLE recurring_templates ADD COLUMN remind_monthly BOOLEAN DEFAULT TRUE;`);
      }
      throw new Error(`Supabase create recurring error: ${error.message}`);
    }
    return inserted as unknown as RecurringTemplate;
  }

  async update(
    id: string,
    data: Partial<RecurringTemplate>
  ): Promise<RecurringTemplate> {
    const { data: updated, error } = await this.client
      .from('recurring_templates')
      .update(data)
      .eq('id', id)
      .select(RECURRING_SELECT_COLUMNS)
      .single();

    if (error) {
      if (error.code === 'PGRST204') {
        throw new Error(`Update Supabase: Tambahkan kolom baru. Jalankan SQL: ALTER TABLE recurring_templates ADD COLUMN remind_monthly BOOLEAN DEFAULT TRUE;`);
      }
      throw new Error(`Supabase update recurring error: ${error.message}`);
    }
    return updated as unknown as RecurringTemplate;
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
//  SUPABASE — INCOME REPOSITORY
// ============================================================

export class SupabaseIncomeRepository implements IncomeRepository {
  private get client() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase client is not configured.');
    return client;
  }

  async getAll(): Promise<IncomeEntry[]> {
    const { data, error } = await this.client
      .from('income_entries')
      .select(INCOME_SELECT_COLUMNS)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Supabase income getAll error: ${error.message}`);
    return (data ?? []) as unknown as IncomeEntry[];
  }

  async create(data: Omit<IncomeEntry, 'id' | 'created_at' | 'synced'>): Promise<IncomeEntry> {
    const payload = {
      ...data,
      id: uuidv4(),
      user_id: requireUserId(),
      created_at: isoNow(),
      synced: true,
    };
    const { data: inserted, error } = await this.client
      .from('income_entries')
      .insert(payload)
      .select(INCOME_SELECT_COLUMNS)
      .single();

    if (error) throw new Error(`Supabase create income error: ${error.message}`);
    return inserted as unknown as IncomeEntry;
  }

  async update(id: string, data: Partial<IncomeEntry>): Promise<IncomeEntry> {
    const { data: updated, error } = await this.client
      .from('income_entries')
      .update({ ...data, synced: true })
      .eq('id', id)
      .select(INCOME_SELECT_COLUMNS)
      .single();

    if (error) throw new Error(`Supabase update income error: ${error.message}`);
    return updated as unknown as IncomeEntry;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('income_entries')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Supabase delete income error: ${error.message}`);
  }
}

// ============================================================
//  REPOSITORY FACTORY FUNCTIONS  (cached singletons)
// ============================================================

let _expenseRepo: ExpenseRepository | null = null;
let _categoryRepo: CategoryRepository | null = null;
let _recurringRepo: RecurringRepository | null = null;
let _incomeRepo: IncomeRepository | null = null;
let _lastAuthState: boolean | null = null;

function getOrCreate<T>(
  current: T | null,
  LocalClass: new () => T,
): T {
  if (current) return current;
  return new LocalClass();
}

/**
 * Returns local-first ExpenseRepository for the active data scope.
 * Authenticated users write locally first; Supabase sync runs in background.
 */
export function getExpenseRepository(): ExpenseRepository {
  const authed = isAuthenticated();
  if (_lastAuthState !== authed) {
    _expenseRepo = null;
    _categoryRepo = null;
    _recurringRepo = null;
    _incomeRepo = null;
    _lastAuthState = authed;
  }
  _expenseRepo = getOrCreate(_expenseRepo, LocalStorageExpenseRepository);
  return _expenseRepo;
}

export function getCategoryRepository(): CategoryRepository {
  const authed = isAuthenticated();
  if (_lastAuthState !== authed) { _lastAuthState = authed; _expenseRepo = null; _categoryRepo = null; _recurringRepo = null; _incomeRepo = null; }
  _categoryRepo = getOrCreate(_categoryRepo, LocalStorageCategoryRepository);
  return _categoryRepo;
}

export function getRecurringRepository(): RecurringRepository {
  const authed = isAuthenticated();
  if (_lastAuthState !== authed) { _lastAuthState = authed; _expenseRepo = null; _categoryRepo = null; _recurringRepo = null; _incomeRepo = null; }
  _recurringRepo = getOrCreate(_recurringRepo, LocalStorageRecurringRepository);
  return _recurringRepo;
}

export function getIncomeRepository(): IncomeRepository {
  const authed = isAuthenticated();
  if (_lastAuthState !== authed) { _lastAuthState = authed; _expenseRepo = null; _categoryRepo = null; _recurringRepo = null; _incomeRepo = null; }
  _incomeRepo = getOrCreate(_incomeRepo, LocalStorageIncomeRepository);
  return _incomeRepo;
}

