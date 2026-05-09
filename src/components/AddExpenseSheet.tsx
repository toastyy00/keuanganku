import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, CalendarDays } from 'lucide-react';
import { BottomSheet } from './ui/BottomSheet';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { CategoryPicker } from './ui/CategoryPicker';
import { useUIStore } from '../store/useAppStore';
import { useExpenseStore } from '../store/useExpenseStore';
import { useCurrencyInput } from '../hooks/useCurrencyInput';
import { getExchangeRate } from '../lib/exchangeRate';
import { todayISO } from '../lib/utils';
import type { Currency, ExpenseType } from '../types';

// ============================================================
//  ADD / EDIT EXPENSE BOTTOM SHEET
// ============================================================

const EXPENSE_TYPE_OPTIONS: Array<{ id: ExpenseType; label: string; color: string }> = [
  { id: 'NEED', label: 'Need', color: '#5B9CF6' },
  { id: 'WANT', label: 'Want', color: '#F472B6' },
  { id: 'TRANSFER', label: 'Transfer', color: '#FB923C' },
];

function haptic() {
  if ('vibrate' in navigator) navigator.vibrate(10);
}

// ── Component ─────────────────────────────────────────────────

const AddExpenseSheet: React.FC = () => {
  const { isAddSheetOpen, activeExpenseId, prefillData, closeAddSheet } = useUIStore();
  const { expenses, categories, currency: defaultCurrency, addExpense, updateExpense, isLoading, updateRecurring, recurringTemplates } =
    useExpenseStore();

  const editingExpense = activeExpenseId
    ? expenses.find((e) => e.id === activeExpenseId) ?? null
    : null;
  const isEditMode = editingExpense !== null;
  const [displayMode, setDisplayMode] = useState<'add' | 'edit'>(activeExpenseId ? 'edit' : 'add');
  const isDisplayEditMode = displayMode === 'edit';
  const sheetTitle = isDisplayEditMode ? 'Edit Pengeluaran' : 'Tambah Pengeluaran';

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isAddSheetOpen) return;
    // Keep header/action label stable during close animation.
    setDisplayMode(activeExpenseId ? 'edit' : 'add');
  }, [isAddSheetOpen, activeExpenseId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Per-entry currency (independent of global setting) ────
  const [entryCurrency, setEntryCurrency] = useState<Currency>(defaultCurrency);
  // Track previous to detect currency switch for conversion
  const prevCurrencyRef = useRef<Currency>(defaultCurrency);
  // Pending converted value after currency switch
  const pendingConversionRef = useRef<number | null>(null);
  // Flash animation trigger
  const [flashAmount, setFlashAmount] = useState(false);
  const flashTimeoutRef = useRef<number | null>(null);

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
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [isDateFieldFocused, setIsDateFieldFocused] = useState(false);

  // ── Handle pending conversion after currency switch ────────
  useEffect(() => {
    if (prevCurrencyRef.current === entryCurrency) return;
    prevCurrencyRef.current = entryCurrency;
    if (pendingConversionRef.current !== null) {
      setFromNumber(pendingConversionRef.current);
      pendingConversionRef.current = null;
    }
  }, [entryCurrency, setFromNumber]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current !== null) {
        window.clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  // ── Reset on open ──────────────────────────────────────────
  const initializedOpenRef = useRef(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isAddSheetOpen) {
      initializedOpenRef.current = false;
      return;
    }

    // Prevents wiping user input if the app re-renders or resumes while idle
    if (initializedOpenRef.current) return;
    initializedOpenRef.current = true;

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
      setNote(prefillData.note ?? '');
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
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Type change with haptic ────────────────────────────────
  const handleTypeChange = useCallback((val: ExpenseType) => {
    haptic();
    setType(val);
  }, []);

  const handleClose = useCallback(() => {
    setErrors({});
    closeAddSheet();
  }, [closeAddSheet]);

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
    setFlashAmount(true);
    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current);
    }
    flashTimeoutRef.current = window.setTimeout(() => {
      setFlashAmount(false);
      flashTimeoutRef.current = null;
    }, 200);
  }, [entryCurrency, rawValue]);

  const openDatePicker = useCallback(() => {
    const input = dateInputRef.current;
    if (!input) return;

    setIsDateFieldFocused(true);
    input.focus({ preventScroll: true });

    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof pickerInput.showPicker === 'function') {
      pickerInput.showPicker();
      return;
    }

    input.click();
  }, []);


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
      is_recurring: editingExpense?.is_recurring ?? prefillData?.is_recurring ?? false,
      recurring_id: editingExpense?.recurring_id ?? prefillData?.recurring_id,
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
      handleClose();
    } catch (err) {
      setErrors({ root: err instanceof Error ? err.message : 'Gagal menyimpan' });
    }
  };

  // ── Render ─────────────────────────────────────────────────
  const symbol = entryCurrency === 'IDR' ? 'Rp' : '$';
  const isTransfer = type === 'TRANSFER';
  const activeTypeIndex = Math.max(0, EXPENSE_TYPE_OPTIONS.findIndex((item) => item.id === type));
  const activeTypeColor = EXPENSE_TYPE_OPTIONS[activeTypeIndex]?.color ?? '#5B9CF6';
  const formattedDate = date
    ? new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${date}T00:00:00`))
    : '';

  return (
    <BottomSheet
      isOpen={isAddSheetOpen}
      onClose={handleClose}
      title={sheetTitle}
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
        <div className="flex flex-col gap-1 pt-1">
          <label className="text-sm font-bold uppercase leading-none tracking-wider text-brutal-black/80">
            Jenis Pengeluaran
          </label>
          <div className="relative grid w-full grid-cols-3 rounded-full bg-[#1B1B1B] p-1">
            <span
              className="pointer-events-none absolute inset-y-1 left-1 rounded-full transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform"
              style={{
                width: 'calc((100% - 0.5rem) / 3)',
                transform: `translateX(${activeTypeIndex * 100}%)`,
                backgroundColor: activeTypeColor,
              }}
              aria-hidden="true"
            />
            {EXPENSE_TYPE_OPTIONS.map((item) => {
              const isActive = type === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleTypeChange(item.id as ExpenseType)}
                  className={`relative z-10 flex items-center justify-center rounded-full px-2 py-1.5 text-[11px] font-black uppercase leading-none tracking-wider transition-colors duration-200 ${isActive ? 'text-[#1A1A1A]' : 'text-[#F5F0E8]/45 hover:text-[#F5F0E8]/75'}`}
                >
                  <span className="inline-block min-w-[54px] text-center leading-none">
                    {item.label}
                  </span>
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
          wrapperClassName="!gap-1"
          labelClassName="!leading-none"
          className="rounded-md"
          style={{ fontSize: '16px' }}
          autoComplete="off"
          autoCapitalize="words"
        />

        {/* Amount + Currency pill */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold uppercase leading-none tracking-wider">
            Nominal
          </label>
          <div className="flex gap-2">
            <div
              className={`flex-1 flex overflow-hidden rounded-md border-2 border-[#555555] bg-[#222222] transition-all duration-150 ${flashAmount ? 'bg-brutal-yellow' : ''
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
              className="min-h-[44px] min-w-[56px] shrink-0 rounded-md border-2 border-[#555555] px-3 text-sm font-black uppercase text-brutal-yellow transition-all duration-150 hover:opacity-80"
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
        <div className="flex flex-col gap-1">
          <label htmlFor="expense-date" className="text-xs font-bold uppercase leading-none tracking-wider">
            Tanggal
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={openDatePicker}
              className={`neo-input flex min-h-[44px] w-full items-center rounded-md px-3 py-2.5 pr-10 text-left font-bold text-brutal-black transition-all duration-150 ${isDateFieldFocused ? '!border-brutal-yellow !shadow-[3px_3px_0px_0px_#7ABF3A]' : ''
                }`}
              aria-label={`Tanggal: ${formattedDate}`}
            >
              {formattedDate}
            </button>
            <input
              ref={dateInputRef}
              id="expense-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onFocus={() => setIsDateFieldFocused(true)}
              onBlur={() => setIsDateFieldFocused(false)}
              className="absolute h-px w-px opacity-0 pointer-events-none"
              style={{ fontSize: '16px' }}
              aria-label="Tanggal"
              tabIndex={-1}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brutal-black/60">
              <CalendarDays size={16} strokeWidth={2.5} aria-hidden="true" />
            </div>
          </div>
        </div>

        {/* TRANSFER: Tujuan field instead of Category */}
        {isTransfer ? (
          <Input
            label="Tujuan Transfer"
            id="expense-destination"
            placeholder="Tujuan dana..."
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            error={errors.destination}
            wrapperClassName="!gap-1"
            labelClassName="!leading-none"
            className="rounded-md"
            style={{ fontSize: '16px' }}
          />
        ) : (
          /* Category + AI suggest */
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold uppercase leading-none tracking-wider">Kategori</label>
            <CategoryPicker
              label=""
              value={category}
              onChange={setCategory}
              categories={categories}
              panelClassName="sm:max-h-[260px]"
              buttonClassName="!min-h-[44px] rounded-md"
            />
          </div>
        )}

        {/* Note */}
        <Textarea
          label="Catatan (opsional)"
          id="expense-note"
          placeholder="Catatan tambahan..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          wrapperClassName="!gap-1"
          labelClassName="!leading-none"
          className="rounded-md"
          style={{ fontSize: '16px' }}
        />

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" fullWidth onClick={handleClose}>Batal</Button>
          <Button variant="primary" fullWidth onClick={handleSave} loading={isLoading}>
            {isDisplayEditMode ? 'Simpan' : 'Tambah'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
};

export { AddExpenseSheet };
