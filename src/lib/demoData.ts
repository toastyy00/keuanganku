import type { Category, Expense, RecurringTemplate } from '../types';
import { DEFAULT_CATEGORIES } from './categories';

// Seed key is now dynamically generated based on the current month to ensure fresh demo data

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoNow(date: Date): string {
  return date.toISOString();
}

function shiftDate(base: Date, day: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), day, 12, 0, 0);
}

function createDemoExpenses(): Expense[] {
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0);
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12, 0, 0);

  const entries = [
    ['demo-transfer-current-1', 'Tarik USDT', 3500000, 'IDR', '', 'TRANSFER', 'PINTU', shiftDate(currentMonth, 2), 'Pencairan bulanan dari crypto'] as const,
    ['demo-family-current-1', 'Ortu', 1500000, 'IDR', 'keluarga', 'NEED', undefined, shiftDate(currentMonth, 3), 'Uang bulanan ortu'] as const,
    ['demo-bill-current-1', 'Internet rumah', 350000, 'IDR', 'tagihan', 'NEED', undefined, shiftDate(currentMonth, 4), 'Tagihan rutin'] as const,
    ['demo-food-current-1', 'Belanja mingguan', 285000, 'IDR', 'keperluan', 'NEED', undefined, shiftDate(currentMonth, 6), 'Stok rumah'] as const,
    ['demo-lifestyle-current-1', 'Face wash', 89000, 'IDR', 'lifestyle', 'NEED', undefined, shiftDate(currentMonth, 7), 'Perawatan diri'] as const,
    ['demo-digital-current-1', 'Steam Wallet', 425000, 'IDR', 'digital', 'WANT', undefined, shiftDate(currentMonth, 10), 'Top up game'] as const,
    ['demo-food-current-2', 'Makan bakso', 42000, 'IDR', 'makan', 'NEED', undefined, shiftDate(currentMonth, 11), 'Makan siang'] as const,
    ['demo-transport-current-1', 'Gojek', 27000, 'IDR', 'transport', 'NEED', undefined, shiftDate(currentMonth, 12), 'Pergi kerja'] as const,
    ['demo-lifestyle-current-2', 'Sabun mandi', 36000, 'IDR', 'lifestyle', 'NEED', undefined, shiftDate(currentMonth, 14), 'Kebutuhan mandi'] as const,
    ['demo-gift-current-1', 'Hadiah ulang tahun', 150000, 'IDR', 'hadiah', 'WANT', undefined, shiftDate(currentMonth, 18), 'Kado teman'] as const,
    ['demo-transfer-prev-1', 'Tarik USDT', 3000000, 'IDR', '', 'TRANSFER', 'PINTU', shiftDate(previousMonth, 2), 'Pencairan bulanan dari crypto'] as const,
    ['demo-family-prev-1', 'Ortu', 1500000, 'IDR', 'keluarga', 'NEED', undefined, shiftDate(previousMonth, 3), 'Uang bulanan ortu'] as const,
    ['demo-bill-prev-1', 'Internet rumah', 350000, 'IDR', 'tagihan', 'NEED', undefined, shiftDate(previousMonth, 4), 'Tagihan rutin'] as const,
    ['demo-digital-prev-1', 'Spotify', 54990, 'IDR', 'digital', 'WANT', undefined, shiftDate(previousMonth, 7), 'Langganan musik'] as const,
    ['demo-food-prev-1', 'Belanja mingguan', 240000, 'IDR', 'keperluan', 'NEED', undefined, shiftDate(previousMonth, 8), 'Stok rumah'] as const,
    ['demo-food-prev-2', 'Makan ayam', 38000, 'IDR', 'makan', 'NEED', undefined, shiftDate(previousMonth, 10), 'Makan malam'] as const,
    ['demo-lifestyle-prev-1', 'Kaos polos', 120000, 'IDR', 'lifestyle', 'WANT', undefined, shiftDate(previousMonth, 15), 'Belanja lifestyle'] as const,
  ];

  return entries.map(([id, name, amount, currency, category, type, destination, date, note]) => ({
    id,
    name,
    amount,
    currency,
    category,
    type,
    destination,
    date: isoDate(date),
    note,
    is_recurring: ['Internet rumah', 'Spotify'].includes(name),
    recurring_id: undefined,
    created_at: isoNow(date),
    synced: false,
  })) as Expense[];
}

function createDemoRecurring(): RecurringTemplate[] {
  return [
    {
      id: 'demo-recurring-internet',
      name: 'Internet rumah',
      amount: 350000,
      currency: 'IDR',
      category: 'tagihan',
      type: 'NEED',
      schedule_detail: 'Tanggal 4',
      note: 'Tagihan bulanan',
      active: true,
      last_logged: undefined,
    },
    {
      id: 'demo-recurring-family',
      name: 'Ortu',
      amount: 1500000,
      currency: 'IDR',
      category: 'keluarga',
      type: 'NEED',
      schedule_detail: 'Tanggal 3',
      note: 'Uang bulanan ortu',
      active: true,
      last_logged: undefined,
    },
  ];
}

export function seedDemoData(): void {
  if (typeof window === 'undefined') return;
  
  const now = new Date();
  const currentMonthKey = `keuanganku-demo-seeded-${now.getFullYear()}-${now.getMonth()}`;
  
  if (localStorage.getItem(currentMonthKey) === 'true') return;

  // Clear previous demo data so new data for current month is generated cleanly
  localStorage.removeItem('expenses');
  localStorage.removeItem('categories');
  localStorage.removeItem('recurring');

  // Also remove the old version key if it exists
  localStorage.removeItem('keuanganku-demo-seeded-v1');

  if (!localStorage.getItem('expenses')) {
    localStorage.setItem('expenses', JSON.stringify(createDemoExpenses()));
  }
  if (!localStorage.getItem('categories')) {
    localStorage.setItem('categories', JSON.stringify(DEFAULT_CATEGORIES as Category[]));
  }
  if (!localStorage.getItem('recurring')) {
    localStorage.setItem('recurring', JSON.stringify(createDemoRecurring()));
  }

  localStorage.setItem(currentMonthKey, 'true');
}
