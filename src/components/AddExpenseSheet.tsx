import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, CalendarDays, ScanLine, Loader2, Camera, Image as ImageIcon } from 'lucide-react';
import { BottomSheet } from './ui/BottomSheet';
import { CategoryPicker } from './ui/CategoryPicker';
import { ConfirmModal } from './ui/ConfirmModal';
import { useUIStore } from '../store/useAppStore';
import { useExpenseStore } from '../store/useExpenseStore';
import { useReceiptStore } from '../store/useReceiptStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCurrencyInput } from '../hooks/useCurrencyInput';
import { getExchangeRate } from '../lib/exchangeRate';
import { todayISO } from '../lib/utils';
import type { Currency, ExpenseType } from '../types';

// —— Sleek form helpers ——
const FieldGroup: React.FC<{
  label: string;
  error?: string;
  children: React.ReactNode;
}> = ({ label, error, children }) => (
  <div className="flex flex-col gap-1.5">
    <p className={`text-[11px] font-medium ${error ? 'text-red-400' : 'text-white/40'}`}>{label}</p>
    {children}
    {error && <p className="text-[10px] text-red-400">{error}</p>}
  </div>
);

const SlimInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>((props, ref) => (
  <input
    ref={ref}
    {...props}
    className={`slim-input ${props.className ?? ''}`}
  />
));
SlimInput.displayName = 'SlimInput';


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
  const [showConfirmClose, setShowConfirmClose] = useState(false);
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

  // ── Handle pending conversion after currency switch ────────
  useEffect(() => {
    if (prevCurrencyRef.current === entryCurrency) return;
    prevCurrencyRef.current = entryCurrency;
    if (pendingConversionRef.current !== null) {
      setFromNumber(pendingConversionRef.current);
      pendingConversionRef.current = null;
    }
  }, [entryCurrency, setFromNumber]);

  // ── Reset on open / close / prefill change ────────────────────
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isAddSheetOpen) {
      setName('');
      reset();
      setDate(todayISO());
      setCategory(categories[0]?.slug ?? '');
      setType('NEED');
      setDestination('');
      setNote('');
      setErrors({});
      return;
    }

    const initialCurrency = editingExpense?.currency ?? prefillData?.currency ?? defaultCurrency;
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
      setDate(prefillData.date ?? todayISO());
      setCategory(prefillData.category ?? categories[0]?.slug ?? '');
      setType(prefillData.type ?? 'NEED');
      setDestination('');
      setNote(prefillData.note ?? '');
      if (prefillData.currency) setEntryCurrency(prefillData.currency);
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

  const openDatePicker = useCallback(() => {
    const input = dateInputRef.current;
    if (!input) return;

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
      setErrors({});

      // Advance receipt review sequence if active
      const isReviewSeq = Boolean(useReceiptStore.getState().reviewSequence);
      if (isReviewSeq) {
        const hasMore = await useReceiptStore.getState().advanceReviewSequence();
        if (!hasMore) {
          closeAddSheet();
        }
      } else {
        closeAddSheet();
      }
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

  const isDirty = React.useMemo(() => {
    const baseName = editingExpense?.name ?? prefillData?.name ?? '';
    const baseAmount = editingExpense?.amount ?? prefillData?.amount ?? 0;
    const baseDate = editingExpense?.date ?? todayISO();
    const baseCategory = editingExpense?.category ?? prefillData?.category ?? categories[0]?.slug ?? '';
    const baseType = editingExpense?.type ?? prefillData?.type ?? 'NEED';
    const baseDestination = editingExpense?.destination ?? '';
    const baseNote = editingExpense?.note ?? prefillData?.note ?? '';
    const baseCurrency = editingExpense?.currency ?? defaultCurrency;

    // Content fields that indicate the user has actually started filling the form
    const hasContentChanges =
      name !== baseName ||
      rawValue !== baseAmount ||
      date !== baseDate ||
      note !== baseNote ||
      entryCurrency !== baseCurrency;

    // Pill/selector changes (type, category, destination) only count as
    // dirty when the user has also entered actual content. This prevents
    // the discard popup from appearing when only switching pills on an
    // otherwise-empty form.
    const hasSelectorChanges =
      type !== baseType ||
      category !== baseCategory ||
      destination !== baseDestination;

    if (hasContentChanges) return true;
    if (hasSelectorChanges && (name.trim() !== '' || rawValue > 0 || note.trim() !== '')) return true;
    return false;
  }, [editingExpense, prefillData, categories, defaultCurrency, name, rawValue, date, category, type, destination, note, entryCurrency]);

  const handleClose = useCallback(() => {
    if (isDirty) {
      setShowConfirmClose(true);
    } else {
      setErrors({});
      useReceiptStore.getState().cancelReviewSequence();
      closeAddSheet();
    }
  }, [isDirty, closeAddSheet]);

  return (
    <BottomSheet
      isOpen={isAddSheetOpen}
      onClose={handleClose}
      hasUnsavedChanges={isDirty}
      containPageOverscroll
      title={sheetTitle}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 h-11 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] text-white text-sm font-semibold transition-all active:scale-[0.98]"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void handleSave()}
            className="flex-1 h-11 rounded-xl bg-[#a8a8ad] disabled:opacity-50 text-black hover:bg-[#a8a8ad]/90 text-sm font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {isLoading && (
              <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            )}
            {isDisplayEditMode ? 'Simpan' : 'Tambah'}
          </button>
          {!isEditMode && <ReceiptScanSquare categories={categories} />}
        </div>
      }
    >
      <div className="flex flex-col gap-3.5 pb-2">
        {/* Root error */}
        {errors.root && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            <AlertCircle size={14} strokeWidth={2} />
            {errors.root}
          </div>
        )}



        {/* Tipe Transaksi Chips */}
        <div className="flex flex-col gap-1.5 pt-1">
          <p className="text-[11px] font-medium text-white/40">Jenis Pengeluaran</p>
          <div className="relative grid w-full grid-cols-3 rounded-xl bg-white/[0.05] p-1">
            <span
              className="pointer-events-none absolute inset-y-1 left-1 rounded-lg transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform"
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
                  className={`relative z-10 flex items-center justify-center rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors duration-200 ${isActive ? 'text-[#1A1A1A] font-semibold' : 'text-white/40 hover:text-white/70'}`}
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
        <FieldGroup label="Nama Item" error={errors.name}>
          <SlimInput
            id="expense-name"
            placeholder={isTransfer ? "Nama transfer..." : "Nama pengeluaran..."}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            autoCapitalize="words"
          />
        </FieldGroup>

        {/* Amount + Currency pill */}
        <FieldGroup label="Nominal" error={errors.amount}>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center overflow-hidden rounded-xl border border-transparent bg-white/[0.05] transition-all duration-150 focus-within:border-white/20 focus-within:bg-white/[0.08]">
              <span className="pl-3 text-sm font-medium text-white/40 shrink-0 select-none">
                {symbol}
              </span>
              <input
                id="expense-amount"
                type="text"
                inputMode="decimal"
                placeholder={entryCurrency === 'IDR' ? '0' : '0.00'}
                value={displayValue}
                onChange={(e) => handleChange(e.target.value)}
                className="flex-1 bg-transparent px-2 py-2 font-medium text-white placeholder-white/20 focus:outline-none"
                style={{ fontSize: '16px' }}
                aria-label="Nominal"
              />
            </div>
            {/* Currency pill toggle */}
            <button
              type="button"
              onClick={handleCurrencySwitch}
              className="h-10 px-4 rounded-xl border border-white/[0.08] bg-white/[0.04] text-white/80 hover:bg-white/[0.09] transition-all font-semibold text-xs shrink-0 select-none"
              aria-label={`Switch to ${entryCurrency === 'IDR' ? 'USD' : 'IDR'}`}
            >
              {entryCurrency}
            </button>
          </div>
        </FieldGroup>

        {/* Date */}
        <FieldGroup label="Tanggal" error={errors.date}>
          <div className="relative">
            <button
              type="button"
              onClick={openDatePicker}
              className="slim-input flex items-center justify-between text-left w-full"
              aria-label={`Tanggal: ${formattedDate}`}
            >
              <span className={formattedDate ? 'text-white/90' : 'text-white/30'}>
                {formattedDate}
              </span>
              <CalendarDays size={15} className="text-white/30 shrink-0" aria-hidden="true" />
            </button>
            <input
              ref={dateInputRef}
              id="expense-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
              style={{ fontSize: '16px' }}
              aria-label="Tanggal"
              required
            />
          </div>
        </FieldGroup>

        {/* TRANSFER: Tujuan field instead of Category */}
        {isTransfer ? (
          <FieldGroup label="Tujuan Transfer" error={errors.destination}>
            <SlimInput
              id="expense-destination"
              placeholder="Tujuan dana..."
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </FieldGroup>
        ) : (
          /* Category + AI suggest */
          <CategoryPicker
            label="Kategori"
            value={category}
            onChange={setCategory}
            categories={categories}
            panelClassName="sm:max-h-[260px]"
            buttonClassName="!min-h-[38px] !h-10 !rounded-xl !bg-white/[0.05] !border !border-white/[0.09] !font-medium"
          />
        )}

        {/* Note */}
        <FieldGroup label="Catatan (opsional)">
          <textarea
            id="expense-note"
            placeholder="Catatan tambahan..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="slim-input resize-none h-16 min-h-16"
            style={{ fontSize: '16px' }}
          />
        </FieldGroup>
      </div>

      <ConfirmModal
        isOpen={showConfirmClose}
        title="Discard Changes?"
        description="You have unsaved changes. Are you sure you want to discard them and close?"
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        onConfirm={() => {
          setShowConfirmClose(false);
          setErrors({});
          closeAddSheet();
        }}
        onCancel={() => {
          setShowConfirmClose(false);
        }}
      />
    </BottomSheet>
  );
};

export { AddExpenseSheet };

// ── Receipt Scan square button for footer ──

import type { Category } from '../types';

const ReceiptScanSquare: React.FC<{ categories: Category[] }> = ({ categories }) => {
  const { isUploading, uploadAndScan, uploadAndScanMultiple } = useReceiptStore();
  const settings = useSettingsStore();
  const [showOptions, setShowOptions] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showOptions) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showOptions]);

  const handleFilesSelected = async (files: File[]) => {
    setShowOptions(false);
    if (!files || files.length === 0) return;

    const config = {
      provider: settings.aiProvider,
      apiKey: settings.aiProvider === 'openai' ? settings.openaiKey : settings.openrouterKey,
      openrouterModel: settings.openrouterModel,
    };

    try {
      if (files.length === 1) {
        await uploadAndScan(files[0], categories, config);
      } else {
        await uploadAndScanMultiple(files, categories, config);
      }
    } finally {
      useUIStore.getState().closeAddSheet();
    }
  };

  // Hide scan button if AI is not configured OR if currently reviewing/recording a receipt item
  const prefill = useUIStore.getState().prefillData;
  const isReviewingReceiptItem = Boolean(prefill || useReceiptStore.getState().reviewSequence);
  const hasApiKey = settings.aiProvider === 'openai'
    ? Boolean(settings.openaiKey)
    : Boolean(settings.openrouterKey);

  if (!hasApiKey || isReviewingReceiptItem) return null;

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Hidden inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (files.length > 0) handleFilesSelected(files);
          if (cameraInputRef.current) cameraInputRef.current.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (files.length > 0) handleFilesSelected(files);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />

      {/* Options Popup */}
      {showOptions && !isUploading && (
        <div className="absolute bottom-full right-0 mb-2.5 w-52 rounded-2xl bg-[#222222] border border-white/15 p-1.5 shadow-2xl z-50 flex flex-col gap-1 page-fade-in animate-in fade-in slide-in-from-bottom-2 duration-150">
          <button
            type="button"
            onClick={() => {
              setShowOptions(false);
              cameraInputRef.current?.click();
            }}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/10 active:scale-[0.98] text-white text-xs font-semibold transition-all text-left"
          >
            <div className="p-1.5 rounded-lg bg-white/10 text-white shrink-0">
              <Camera size={16} />
            </div>
            <div className="flex flex-col">
              <span className="text-white text-xs font-bold">Ambil Foto</span>
              <span className="text-[10px] text-white/40 font-normal">Gunakan Kamera</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowOptions(false);
              fileInputRef.current?.click();
            }}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/10 active:scale-[0.98] text-white text-xs font-semibold transition-all text-left"
          >
            <div className="p-1.5 rounded-lg bg-white/10 text-white shrink-0">
              <ImageIcon size={16} />
            </div>
            <div className="flex flex-col">
              <span className="text-white text-xs font-bold">Pilih Gambar</span>
              <span className="text-[10px] text-white/40 font-normal">Galeri / Screenshot</span>
            </div>
          </button>
        </div>
      )}

      {/* Main Square Scan Button */}
      <button
        type="button"
        disabled={isUploading}
        onClick={() => setShowOptions((v) => !v)}
        className="h-11 w-11 shrink-0 rounded-xl bg-[#a8a8ad] hover:bg-[#a8a8ad]/90 disabled:opacity-50 text-black flex items-center justify-center transition-all active:scale-[0.93]"
        title="Scan Struk (Kamera / Galeri)"
        aria-label="Scan Struk"
      >
        {isUploading ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <ScanLine size={18} strokeWidth={2.5} />
        )}
      </button>
    </div>
  );
};
