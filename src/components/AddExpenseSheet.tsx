import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { BottomSheet } from './ui/BottomSheet';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { useUIStore } from '../store/useAppStore';
import { useExpenseStore } from '../store/useExpenseStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCurrencyInput } from '../hooks/useCurrencyInput';
import { suggestCategory } from '../lib/ai';
import { getExchangeRate } from '../lib/exchangeRate';
import { todayISO } from '../lib/utils';
import type { Currency, ExpenseType } from '../types';

// ============================================================
//  ADD / EDIT EXPENSE BOTTOM SHEET
// ============================================================

function haptic() {
  if ('vibrate' in navigator) navigator.vibrate(10);
}

// ── Component ─────────────────────────────────────────────────

const AddExpenseSheet: React.FC = () => {
  const { isAddSheetOpen, activeExpenseId, prefillData, closeAddSheet } = useUIStore();
  const { expenses, categories, currency: defaultCurrency, addExpense, updateExpense, isLoading, updateRecurring, recurringTemplates } =
    useExpenseStore();
  const settings = useSettingsStore();
  const activeAiKey = settings.aiProvider === 'openai'
    ? settings.openaiKey
    : settings.openrouterKey;

  const editingExpense = activeExpenseId
    ? expenses.find((e) => e.id === activeExpenseId) ?? null
    : null;
  const isEditMode = editingExpense !== null;

  // ── Per-entry currency (independent of global setting) ────
  const [entryCurrency, setEntryCurrency] = useState<Currency>(defaultCurrency);
  // Track previous to detect currency switch for conversion
  const prevCurrencyRef = useRef<Currency>(defaultCurrency);
  // Pending converted value after currency switch
  const pendingConversionRef = useRef<number | null>(null);
  // Flash animation trigger
  const [flashAmount, setFlashAmount] = useState(false);

  // ── Form state ─────────────────────────────────────────────
  const [name, setName] = useState('');
  const {
    displayValue,
    rawValue,
    handleChange,
    setFromNumber,
    reset,
  } = useCurrencyInput(entryCurrency);
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState('');
  const [type, setType] = useState<ExpenseType>('NEED');
  const [destination, setDestination] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // ── Handle pending conversion after currency switch ────────
  useEffect(() => {
    if (prevCurrencyRef.current === entryCurrency) return;
    prevCurrencyRef.current = entryCurrency;
    if (pendingConversionRef.current !== null) {
      setFromNumber(pendingConversionRef.current);
      pendingConversionRef.current = null;
      setFlashAmount(true);
      const t = setTimeout(() => setFlashAmount(false), 200);
      return () => clearTimeout(t);
    }
  }, [entryCurrency, setFromNumber]);

  // ── Reset on open ──────────────────────────────────────────
  const initializedOpenRef = useRef(false);

  useEffect(() => {
    if (!isAddSheetOpen) {
      initializedOpenRef.current = false;
      return;
    }

    // Prevents wiping user input if the app re-renders or resumes while idle
    if (initializedOpenRef.current) return;
    initializedOpenRef.current = true;

    setErrors({});
    setAiError('');

    const initialCurrency = editingExpense?.currency ?? defaultCurrency;
    setEntryCurrency(initialCurrency);
    prevCurrencyRef.current = initialCurrency;
    pendingConversionRef.current = null;

    if (editingExpense) {
      setName(editingExpense.name);
      setFromNumber(editingExpense.amount);
      setDate(editingExpense.date);
      setCategory(editingExpense.category);
      setType(editingExpense.type);
      setDestination(editingExpense.destination ?? '');
      setNote(editingExpense.note ?? '');
      setEntryCurrency(editingExpense.currency);
    } else if (prefillData) {
      setName(prefillData.name ?? '');
      setFromNumber(prefillData.amount ?? 0);
      setDate(todayISO());
      setCategory(prefillData.category ?? categories[0]?.slug ?? '');
      setType(prefillData.type ?? 'NEED');
      setDestination('');
      setNote('');
    } else {
      setName('');
      reset();
      setDate(todayISO());
      setCategory(categories[0]?.slug ?? '');
      setType('NEED');
      setDestination('');
      setNote('');
    }
  }, [isAddSheetOpen, editingExpense, prefillData, defaultCurrency, setFromNumber, reset, categories]);

  // ── Type change with haptic ────────────────────────────────
  const handleTypeChange = useCallback((val: ExpenseType) => {
    haptic();
    setType(val);
  }, []);

  // ── Currency pill switch with live conversion ──────────────
  const handleCurrencySwitch = useCallback(async () => {
    const newCurrency: Currency = entryCurrency === 'IDR' ? 'USD' : 'IDR';
    if (rawValue > 0) {
      const { rate } = await getExchangeRate();
      let converted: number;
      if (entryCurrency === 'IDR' && newCurrency === 'USD') {
        converted = Math.round((rawValue / rate) * 100) / 100;
      } else {
        converted = Math.round((rawValue * rate) / 100) * 100;
      }
      pendingConversionRef.current = converted;
    }
    setEntryCurrency(newCurrency);
  }, [entryCurrency, rawValue]);

  // ── AI category suggest ────────────────────────────────────
  const handleAiSuggest = async () => {
    if (!name.trim()) { setAiError('Masukkan nama item terlebih dahulu'); return; }
    if (!activeAiKey) { setAiError('Tambahkan API Key provider yang aktif di Settings'); return; }
    setAiLoading(true);
    setAiError('');
    try {
      const slug = await suggestCategory(name, categories, {
        provider: settings.aiProvider,
        apiKey: activeAiKey,
        openrouterModel: settings.openrouterModel,
      });
      if (slug && categories.some((c) => c.slug === slug)) {
        setCategory(slug);
        haptic();
      } else {
        setAiError('Tidak ada kecocokan — pilih manual');
      }
    } catch {
      setAiError('Permintaan AI gagal');
    } finally {
      setAiLoading(false);
    }
  };

  // ── Validation ─────────────────────────────────────────────
  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Nama wajib diisi';
    if (!rawValue || rawValue <= 0) {
      next.amount = 'Nominal harus lebih dari 0';
    }
    if (type === 'TRANSFER' && !destination.trim()) {
      next.destination = 'Tujuan transfer wajib diisi';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // ── Save ───────────────────────────────────────────────────
  const handleSave = async () => {
    if (!validate()) return;

    const payload = {
      name: name.trim(),
      amount: rawValue,
      currency: entryCurrency,
      category: type === 'TRANSFER' ? '' : category,
      type,
      destination: type === 'TRANSFER' ? destination.trim() : undefined,
      date,
      note: note.trim() || undefined,
      is_recurring: editingExpense?.is_recurring ?? false,
      recurring_id: editingExpense?.recurring_id,
    };

    try {
      if (isEditMode && editingExpense) {
        await updateExpense(editingExpense.id, payload);
      } else {
        await addExpense(payload);
        if (payload.is_recurring && payload.recurring_id) {
          const t = recurringTemplates.find(r => r.id === payload.recurring_id);
          if (t) {
            await updateRecurring(t.id, { last_logged: payload.date });
          }
        }
      }
      haptic();
      closeAddSheet();
    } catch (err) {
      setErrors({ root: err instanceof Error ? err.message : 'Gagal menyimpan' });
    }
  };

  // ── Render ─────────────────────────────────────────────────
  const symbol = entryCurrency === 'IDR' ? 'Rp' : '$';
  const isTransfer = type === 'TRANSFER';

  return (
    <BottomSheet
      isOpen={isAddSheetOpen}
      onClose={closeAddSheet}
      title={isEditMode ? 'Edit Pengeluaran' : 'Tambah Pengeluaran'}
    >
      <div className="flex flex-col gap-4">
        {/* Root error */}
        {errors.root && (
          <div className="flex items-center gap-2 p-3 bg-red-500 border-2 border-[#555555] text-white font-bold text-sm">
            <AlertCircle size={16} strokeWidth={2.5} />
            {errors.root}
          </div>
        )}

        {/* Tipe Transaksi Chips */}
        <div className="flex flex-col gap-1.5 pt-1">
          <label className="text-sm font-bold uppercase tracking-wider text-brutal-black/80">
            Tipe Transaksi
          </label>
          <div className="flex gap-2">
            {[
              { id: 'NEED', label: 'Need', color: '#5B9CF6' }, // Blue
              { id: 'WANT', label: 'Want', color: '#F472B6' }, // Pink
              { id: 'TRANSFER', label: 'Transfer', color: '#FB923C' }, // Orange
            ].map((item) => {
              const isActive = type === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleTypeChange(item.id as ExpenseType)}
                  className="flex-1 flex items-center justify-center py-2 px-0.5 border-2 font-black uppercase text-[13px] transition-all duration-150 active:translate-y-0.5 active:translate-x-0.5"
                  style={{
                    borderColor: isActive ? item.color : '#555555',
                    color: isActive ? item.color : '#A09890',
                    boxShadow: isActive ? `3px 3px 0px 0px ${item.color}` : 'none',
                    backgroundColor: isActive ? '#1A1A1A' : 'transparent',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Item Name */}
        <Input
          label="Nama Item"
          id="expense-name"
          placeholder={isTransfer ? "Nama transfer..." : "Nama pengeluaran..."}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          style={{ fontSize: '16px' }}
          autoComplete="off"
          autoCapitalize="words"
        />

        {/* Amount + Currency pill */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider">
            Nominal
          </label>
          <div className="flex gap-2">
            <div
              className={`flex-1 flex border-2 border-[#555555] bg-[#222222] transition-all duration-150 ${flashAmount ? 'bg-brutal-yellow' : ''
                } ${errors.amount ? 'border-red-500' : 'focus-within:border-brutal-yellow focus-within:shadow-[3px_3px_0px_0px_#7ABF3A]'}`}
            >
              <span className="flex items-center pl-3 text-sm font-bold text-brutal-black/60 shrink-0">
                {symbol}
              </span>
              <input
                id="expense-amount"
                type="text"
                inputMode="decimal"
                placeholder={entryCurrency === 'IDR' ? '0' : '0.00'}
                value={displayValue}
                onChange={(e) => handleChange(e.target.value)}
                className="flex-1 bg-transparent px-2 py-2.5 font-bold text-brutal-black focus:outline-none focus-visible:shadow-none transition-colors duration-200"
                style={{ fontSize: '16px' }}
                aria-label="Nominal"
              />
            </div>
            {/* Currency pill toggle */}
            <button
              type="button"
              onClick={handleCurrencySwitch}
              className="shrink-0 px-3 border-2 border-[#555555] font-black text-sm uppercase min-w-[56px] min-h-[44px] transition-all duration-150 text-brutal-yellow hover:opacity-80"
              aria-label={`Switch to ${entryCurrency === 'IDR' ? 'USD' : 'IDR'}`}
            >
              {entryCurrency}
            </button>
          </div>
          {errors.amount && (
            <p className="text-xs font-bold text-red-500 uppercase tracking-wider">{errors.amount}</p>
          )}
        </div>

        {/* Date */}
        <Input
          label="Tanggal"
          id="expense-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ fontSize: '16px' }}
        />

        {/* TRANSFER: Tujuan field instead of Category */}
        {isTransfer ? (
          <Input
            label="Tujuan Transfer"
            id="expense-destination"
            placeholder="Tujuan dana..."
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            error={errors.destination}
            style={{ fontSize: '16px' }}
          />
        ) : (
          /* Category + AI suggest */
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider">Kategori</label>
            <div className="flex gap-2">
              <select
                id="expense-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="neo-input flex-1 appearance-none"
                style={{ fontSize: '16px' }}
              >
                {categories.map((cat) => (
                  <option key={cat.slug} value={cat.slug}>
                    {cat.emoji} {cat.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAiSuggest}
                disabled={aiLoading}
                title="AI Suggest Category"
                className="neo-btn neo-btn-secondary px-3 shrink-0 min-w-[44px] min-h-[44px]"
                aria-label="Sarankan kategori dengan AI"
              >
                {aiLoading
                  ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
                  : <Sparkles size={16} strokeWidth={2.5} />}
              </button>
            </div>
            {aiError && (
              <p className="text-xs font-bold text-red-500 uppercase tracking-wider">{aiError}</p>
            )}
          </div>
        )}

        {/* Note */}
        <Textarea
          label="Catatan (opsional)"
          id="expense-note"
          placeholder="Catatan tambahan..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ fontSize: '16px' }}
        />

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" fullWidth onClick={closeAddSheet}>Batal</Button>
          <Button variant="primary" fullWidth onClick={handleSave} loading={isLoading}>
            {isEditMode ? 'Simpan' : 'Tambah'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
};

export { AddExpenseSheet };
