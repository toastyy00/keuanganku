import React, { useEffect, useState } from 'react';
import {
  RefreshCcw,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Receipt,
  AlertCircle,
  Bell,
} from 'lucide-react';
import { BottomSheet } from '../components/ui/BottomSheet';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { CategoryPicker } from '../components/ui/CategoryPicker';
import { Card } from '../components/ui/Card';
import { useExpenseStore } from '../store/useExpenseStore';
import { useUIStore } from '../store/useAppStore';
import { useCurrencyInput } from '../hooks/useCurrencyInput';
import { formatCurrency, friendlyDate } from '../lib/utils';
import type { ExpenseType, RecurringTemplate } from '../types';

function haptic() {
  if ('vibrate' in navigator) navigator.vibrate(10);
}

const RECURRING_TYPE_OPTIONS: Array<{ id: ExpenseType; label: string; color: string }> = [
  { id: 'NEED', label: 'Need', color: '#5B9CF6' },
  { id: 'WANT', label: 'Want', color: '#F472B6' },
];

interface RecurringFormState {
  name: string;
  category: string;
  type: ExpenseType;
  schedule_detail: string;
  note: string;
  active: boolean;
}

const EMPTY_FORM: RecurringFormState = {
  name: '',
  category: '',
  type: 'NEED',
  schedule_detail: '',
  note: '',
  active: true,
};

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

interface AddRecurringSheetProps {
  isOpen: boolean;
  onClose: () => void;
  editing?: RecurringTemplate | null;
}

const AddRecurringSheet: React.FC<AddRecurringSheetProps> = ({ isOpen, onClose, editing }) => {
  const { categories, currency, addRecurring, updateRecurring } = useExpenseStore();
  const [form, setForm] = useState<RecurringFormState>({ ...EMPTY_FORM, category: categories[0]?.slug ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  const amountInput = useCurrencyInput(currency);
  const activeTypeIndex = Math.max(0, RECURRING_TYPE_OPTIONS.findIndex((item) => item.id === form.type));
  const activeTypeColor = RECURRING_TYPE_OPTIONS[activeTypeIndex]?.color ?? '#5B9CF6';

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setForm({
        name: editing.name,
        category: editing.category,
        type: editing.type,
        schedule_detail: editing.schedule_detail ?? '',
        note: editing.note ?? '',
        active: editing.active ?? true,
      });
      amountInput.setFromNumber(editing.amount);
    } else {
      setForm({ ...EMPTY_FORM, category: categories[0]?.slug ?? '' });
      amountInput.reset();
    }
    setErrors({});
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Nama wajib diisi';
    if (!amountInput.rawValue || amountInput.rawValue <= 0) next.amount = 'Nominal harus lebih dari 0';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.root;
      return next;
    });
    try {
      if (editing) {
        await updateRecurring(editing.id, {
          name: form.name.trim(),
          amount: amountInput.rawValue,
          currency,
          category: form.category,
          type: form.type,
          schedule_detail: form.schedule_detail.trim() || undefined,
          note: form.note.trim() || undefined,
          active: form.active,
        });
      } else {
        await addRecurring({
          name: form.name.trim(),
          amount: amountInput.rawValue,
          currency,
          category: form.category,
          type: form.type,
          schedule_detail: form.schedule_detail.trim() || undefined,
          note: form.note.trim() || undefined,
          active: form.active,
        });
      }
      haptic();
      onClose();
    } catch (err) {
      setErrors((prev) => ({ ...prev, root: err instanceof Error ? err.message : 'Gagal menyimpan' }));
    } finally {
      setSaving(false);
    }
  };

  const isDirty = React.useMemo(() => {
    const baseName = editing?.name ?? '';
    const baseCategory = editing?.category ?? categories[0]?.slug ?? '';
    const baseType = editing?.type ?? 'NEED';
    const baseSchedule = editing?.schedule_detail ?? '';
    const baseNote = editing?.note ?? '';
    const baseAmount = editing?.amount ?? 0;
    const baseActive = editing?.active ?? true;

    return (
      form.name !== baseName ||
      form.category !== baseCategory ||
      form.type !== baseType ||
      form.schedule_detail !== baseSchedule ||
      form.note !== baseNote ||
      form.active !== baseActive ||
      amountInput.rawValue !== baseAmount
    );
  }, [editing, categories, form, amountInput.rawValue]);

  const handleClose = React.useCallback(() => {
    if (isDirty) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      hasUnsavedChanges={isDirty}
      containPageOverscroll
      title={editing ? 'Edit Rutin' : 'Tambah Rutin'}
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 h-11 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] text-white text-sm font-semibold transition-all active:scale-[0.98]"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 h-11 rounded-xl bg-[#B8F55A] disabled:opacity-50 text-[#1A1A1A] text-sm font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {saving && <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            {editing ? 'Simpan' : 'Tambah'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5 pb-2">
        {/* Root error banner */}
        {errors.root && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            <AlertCircle size={14} />
            {errors.root}
          </div>
        )}

        {/* Type toggle */}
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-medium text-white/40">Tipe</p>
          <div className="relative grid w-full grid-cols-2 rounded-xl bg-white/[0.05] p-1">
            <span
              className="pointer-events-none absolute inset-y-1 left-1 rounded-lg transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform"
              style={{
                width: 'calc((100% - 0.5rem) / 2)',
                transform: `translateX(${activeTypeIndex * 100}%)`,
                backgroundColor: activeTypeColor,
              }}
              aria-hidden="true"
            />
            {RECURRING_TYPE_OPTIONS.map((item) => {
              const isActive = form.type === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: item.id }))}
                  className={`relative z-10 rounded-lg px-3 py-1.5 text-[11px] font-medium leading-none transition-colors duration-200 ${isActive ? 'text-[#1A1A1A] font-semibold' : 'text-white/40 hover:text-white/70'}`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Nama */}
        <FieldGroup label="Nama" error={errors.name}>
          <input
            className="slim-input"
            placeholder="Nama pengeluaran..."
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            style={{ fontSize: '16px' }}
          />
        </FieldGroup>

        {/* Nominal */}
        <FieldGroup label={`Nominal (${currency})`} error={errors.amount}>
          <div className="relative flex items-center">
            <span className="absolute left-3 text-sm text-white/40 select-none">
              {currency === 'IDR' ? 'Rp' : '$'}
            </span>
            <input
              type="text"
              inputMode="decimal"
              placeholder={currency === 'IDR' ? '0' : '0.00'}
              value={amountInput.displayValue}
              onChange={(e) => amountInput.handleChange(e.target.value)}
              className="slim-input pl-10"
              style={{ fontSize: '16px' }}
            />
          </div>
        </FieldGroup>

        {/* Kategori */}
        <CategoryPicker
          label="Kategori"
          value={form.category}
          onChange={(slug) => setForm((f) => ({ ...f, category: slug }))}
          categories={categories}
          buttonClassName="!min-h-[38px] !h-10 !rounded-xl !bg-white/[0.05] !border !border-white/[0.09] !font-medium"
        />

        {/* Jadwal */}
        <FieldGroup label="Jadwal / Frekuensi">
          <input
            className="slim-input"
            placeholder="Kapan pengeluaran ini biasa terjadi..."
            value={form.schedule_detail}
            onChange={(e) => setForm((f) => ({ ...f, schedule_detail: e.target.value }))}
            style={{ fontSize: '16px' }}
          />
        </FieldGroup>

        {/* Catatan */}
        <FieldGroup label="Catatan (opsional)">
          <textarea
            className="slim-input resize-none h-16 min-h-16"
            placeholder="Catatan tambahan..."
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </FieldGroup>

        {/* Option: Ingatkan Setiap Bulan */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <Bell size={16} className={form.active ? 'text-[#B8F55A]' : 'text-white/30'} />
            <div>
              <p className="text-xs font-semibold text-white/90">Ingatkan Setiap Bulan</p>
              <p className="text-[10px] text-white/40">Tampilkan notifikasi di Dashboard jika belum dicatat</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              haptic();
              setForm((f) => ({ ...f, active: !f.active }));
            }}
            className="text-white/80 hover:text-white transition-colors"
          >
            {form.active ? (
              <ToggleRight size={28} className="text-[#B8F55A]" />
            ) : (
              <ToggleLeft size={28} className="text-white/30" />
            )}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={showConfirmClose}
        title="Discard Changes?"
        description="You have unsaved changes. Are you sure you want to discard them and close?"
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        onConfirm={() => {
          setShowConfirmClose(false);
          onClose();
        }}
        onCancel={() => {
          setShowConfirmClose(false);
        }}
      />
    </BottomSheet>
  );
};

// ============================================================
//  RECURRING PAGE
// ============================================================

const RecurringPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Pengeluaran Rutin - KeuanganKu';
    return () => {
      document.title = 'Keuanganku';
    };
  }, []);

  const { recurringTemplates, categories, currency, deleteRecurring } = useExpenseStore();
  const { openAddSheet, isRecurringSheetOpen, closeRecurringSheet } = useUIStore();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTemplate | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Sync global FAB signal → open sheet
  React.useEffect(() => {
    if (isRecurringSheetOpen) {
      setEditing(null);
      setSheetOpen(true);
      closeRecurringSheet(); // reset signal
    }
  }, [isRecurringSheetOpen, closeRecurringSheet]);

  const handleDelete = async (id: string) => {
    haptic();
    await deleteRecurring(id);
    setDeletingId(null);
  };

  const handleQuickLog = (t: RecurringTemplate) => {
    haptic();
    const safeType = t.type === 'TRANSFER' ? 'NEED' : t.type;
    openAddSheet({
      name: t.name,
      amount: t.amount,
      category: t.category,
      type: safeType,
      note: t.note,
      is_recurring: true,
      recurring_id: t.id,
    });
  };

  return (
    <div className="section-pad max-w-2xl mx-auto pb-24">
      {/* Sticky Header Bar */}
      <div className="sticky top-0 z-20 bg-[#1A1A1A]/95 backdrop-blur-md pb-3 pt-3 -mx-4 px-4 border-b border-white/[0.08] mb-4">
        <h1 className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-2">
          Pengeluaran Rutin
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/70 font-semibold">
            {recurringTemplates.length}
          </span>
        </h1>
        <p className="text-[11px] text-white/40 font-medium">Kelola tagihan & pengeluaran bulanan</p>
      </div>

      {/* Empty State */}
      {recurringTemplates.length === 0 && (
        <Card flat className="p-8 text-center border-white/10 bg-white/[0.02] rounded-2xl">
          <RefreshCcw size={36} strokeWidth={1.5} className="mx-auto mb-3 text-white/30" />
          <p className="font-bold text-white uppercase text-sm">Belum ada pengeluaran rutin</p>
          <p className="text-xs text-white/40 font-medium mt-1 max-w-xs mx-auto">
            Gunakan tombol (+) di bawah untuk menambah pengeluaran rutin pertama kamu.
          </p>
        </Card>
      )}

      {/* Compact List Item Cards */}
      <div className="space-y-2.5">
        {recurringTemplates.map((t) => {
          const cat = categories.find((c) => c.slug === t.category);
          const isDeletingThis = deletingId === t.id;

          // Type indicator background style matching History page
          const typeEmojiBg =
            t.type === 'NEED'
              ? '#3B82F6'
              : t.type === 'WANT'
                ? '#EC4899'
                : '#FB923C';

          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                haptic();
                setEditing(t);
                setSheetOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  haptic();
                  setEditing(t);
                  setSheetOpen(true);
                }
              }}
              className="rounded-xl bg-[#1E1E20]/90 hover:bg-[#232326] border border-white/[0.08] hover:border-white/20 p-2.5 sm:p-3 shadow-sm transition-all duration-200 cursor-pointer active:scale-[0.99]"
            >
              {isDeletingThis ? (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30" onClick={(e) => e.stopPropagation()}>
                  <p className="font-bold text-red-400 text-xs mb-2">Hapus pengeluaran rutin "{t.name}"?</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(t.id);
                      }}
                      className="flex-1 py-1.5 rounded-lg bg-red-500 text-white font-bold text-xs hover:bg-red-600 transition-colors"
                    >
                      Ya, Hapus
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingId(null);
                      }}
                      className="flex-1 py-1.5 rounded-lg bg-white/10 text-white font-semibold text-xs hover:bg-white/20 transition-colors"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {/* Top Content Row */}
                  <div className="flex items-center gap-2.5">
                    {/* Category Emoji Tile matching History page */}
                    <span
                      className="text-[1.5rem] w-10 h-10 shrink-0 flex items-center justify-center rounded-xl border border-white/10 shadow-md"
                      style={{
                        background: `linear-gradient(rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.18)), ${typeEmojiBg}`,
                        textShadow: [
                          '0 0.5px 0 rgba(255, 255, 255, 0.48)',
                          '0 1px 0 rgba(255, 255, 255, 0.22)',
                          '0 1.5px 1.5px rgba(0, 0, 0, 0.5)',
                          '0 3px 3px rgba(0, 0, 0, 0.32)',
                        ].join(', '),
                        filter: 'drop-shadow(0 1px 0 rgba(255,255,255,0.18)) drop-shadow(0 2px 2px rgba(0,0,0,0.35))',
                      }}
                    >
                      {cat?.emoji ?? '🛍️'}
                    </span>

                    {/* Middle Title & Small Bell Icon */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="font-bold text-white text-sm leading-tight truncate">{t.name}</p>
                        {t.active !== false && (
                          <span title="Pengingat Aktif">
                            <Bell size={12} className="text-white/40 shrink-0" />
                          </span>
                        )}
                      </div>

                      {/* Sub-info: Date last logged & notes */}
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-white/40 font-medium truncate">
                        {t.last_logged ? (
                          <span className="shrink-0">Terakhir: {friendlyDate(t.last_logged)}</span>
                        ) : (
                          <span className="shrink-0 italic text-white/30">Belum pernah dicatat</span>
                        )}
                        {t.note && (
                          <>
                            <span className="shrink-0 text-white/20">•</span>
                            <span className="truncate italic text-white/50">{t.note}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right Amount */}
                    <div className="text-right shrink-0">
                      <p className="text-sm sm:text-base font-black text-[#B8F55A] tracking-tight">
                        {formatCurrency(t.amount, t.currency ?? currency)}
                      </p>
                    </div>
                  </div>

                  {/* Compact Action Bar */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06] mt-0.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleQuickLog(t);
                      }}
                      className="h-8 px-12 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white font-semibold text-[11px] transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-sm shrink-0"
                    >
                      <Receipt size={13} strokeWidth={2} className="text-white/70" /> Catat
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        haptic();
                        setDeletingId(t.id);
                      }}
                      className="h-8 w-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all active:scale-[0.98] flex items-center justify-center shrink-0"
                      aria-label="Hapus"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AddRecurringSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editing={editing}
      />
    </div>
  );
};

export default RecurringPage;
