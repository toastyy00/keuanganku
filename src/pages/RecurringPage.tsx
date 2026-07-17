import React, { useEffect, useState } from 'react';
import { RefreshCcw, Trash2, ToggleLeft, ToggleRight, CalendarClock, Zap, AlertCircle } from 'lucide-react';
import { BottomSheet } from '../components/ui/BottomSheet';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { Badge } from '../components/ui/Badge';
import { CategoryPicker } from '../components/ui/CategoryPicker';
import { Card, CardBody } from '../components/ui/Card';
import { useExpenseStore } from '../store/useExpenseStore';
import { useUIStore } from '../store/useAppStore';
import { useCurrencyInput } from '../hooks/useCurrencyInput';
import { formatCurrency, friendlyDate } from '../lib/utils';
import type { ExpenseType, RecurringTemplate } from '../types';

function haptic() { if ('vibrate' in navigator) navigator.vibrate(10); }

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
}

const EMPTY_FORM: RecurringFormState = {
  name: '', category: '', type: 'NEED', schedule_detail: '', note: '',
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
          name: form.name.trim(), amount: amountInput.rawValue, currency,
          category: form.category, type: form.type,
          schedule_detail: form.schedule_detail.trim() || undefined,
          note: form.note.trim() || undefined,
        });
      } else {
        await addRecurring({
          name: form.name.trim(), amount: amountInput.rawValue, currency,
          category: form.category, type: form.type,
          schedule_detail: form.schedule_detail.trim() || undefined,
          note: form.note.trim() || undefined, active: true,
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

    return (
      form.name !== baseName ||
      form.category !== baseCategory ||
      form.type !== baseType ||
      form.schedule_detail !== baseSchedule ||
      form.note !== baseNote ||
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
    return () => { document.title = 'Keuanganku'; };
  }, []);

  const { recurringTemplates, categories, currency, deleteRecurring, updateRecurring } =
    useExpenseStore();
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

  const handleToggleActive = async (t: RecurringTemplate) => {
    haptic();
    await updateRecurring(t.id, { active: !t.active });
  };

  const handleQuickLog = (t: RecurringTemplate) => {
    haptic();
    // Only NEED and WANT make sense for recurring quick-log (TRANSFER is not a typical recurring)
    const safeType = t.type === 'TRANSFER' ? 'NEED' : t.type;
    openAddSheet({
      name: t.name, amount: t.amount, category: t.category,
      type: safeType, note: t.note, is_recurring: true, recurring_id: t.id,
    });
  };

  return (
    <div className="section-pad max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black uppercase tracking-tight">Pengeluaran Rutin</h1>
      </div>

      {recurringTemplates.length === 0 && (
        <Card flat className="p-10 text-center border-[#3A3A3A]">
          <RefreshCcw size={36} strokeWidth={1.5} className="mx-auto mb-3 text-brutal-bone-dim" />
          <p className="font-black uppercase text-[#F5F0E8]">Belum ada pengeluaran rutin</p>
          <p className="text-sm text-brutal-bone-dim font-medium mt-1">
            Tambah sekarang! Kelola tagihan, langganan, atau pengeluaran bulanan kamu di sini.
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {recurringTemplates.map((t) => {
          const cat = categories.find((c) => c.slug === t.category);
          const isDeletingThis = deletingId === t.id;
          const badgeVariant = t.type === 'NEED' ? 'need' : t.type === 'WANT' ? 'want' : 'transfer';

          return (
            <Card
              key={t.id}
              className={`${!t.active ? 'opacity-60' : ''} !shadow-[3px_3px_0_0_#746C62]`}
            >
              {isDeletingThis ? (
                <div className="p-3 bg-red-500">
                  <p className="font-black text-white uppercase text-xs mb-2.5">Hapus "{t.name}"?</p>
                  <div className="flex gap-2">
                    <button onClick={() => handleDelete(t.id)} className="flex-1 py-2 bg-white text-red-500 font-black text-[11px] uppercase border-2 border-white min-h-[40px]">
                      Ya, Hapus
                    </button>
                    <button onClick={() => setDeletingId(null)} className="flex-1 py-2 bg-red-500 text-white font-black text-[11px] uppercase border-2 border-white min-h-[40px]">
                      Batal
                    </button>
                  </div>
                </div>
              ) : (
                <CardBody className="px-2.5 py-1">
                  <div className="flex items-start gap-2">
                    <span className="text-3xl mt-0.5 shrink-0">{cat?.emoji ?? '🛍️'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <p className="font-black text-[15px] leading-tight">{t.name}</p>
                        <Badge variant={badgeVariant} size="sm">{t.type}</Badge>
                        {t.schedule_detail && (
                          <Badge variant="neutral" size="sm" className="!bg-[#2A2820] !text-[#F5F0E8] border-[#B8F55A]">
                            ⏱ {t.schedule_detail}
                          </Badge>
                        )}
                        {!t.active && <Badge variant="neutral" size="sm" className="!bg-brutal-black/20">Nonaktif</Badge>}
                      </div>
                      <p className="text-lg font-black mt-px">{formatCurrency(t.amount, t.currency ?? currency)}</p>
                      <div className="flex items-center gap-1 mt-px min-w-0 text-[10px] text-brutal-bone-dim font-medium">
                        {t.last_logged ? (
                          <span className="flex items-center gap-1 shrink-0">
                            <CalendarClock size={10} /> Terakhir: {friendlyDate(t.last_logged)}
                          </span>
                        ) : (
                          <span className="shrink-0 italic">Belum pernah dicatat</span>
                        )}
                        {t.note && (
                          <>
                            <span className="shrink-0 text-brutal-bone-dim/60">|</span>
                            <span className="truncate italic">{t.note}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 mt-1 border-t-2 border-[#555555] pt-1">
                    <button
                      onClick={() => handleQuickLog(t)}
                      className="flex-1 flex items-center justify-center gap-1 py-1 neo-btn neo-btn-primary font-black text-[10px] min-h-[32px]"
                    >
                      <Zap size={12} strokeWidth={2.5} /> Catat
                    </button>
                    <button
                      onClick={() => { setEditing(t); setSheetOpen(true); }}
                      className="flex-1 flex items-center justify-center py-1 neo-btn neo-btn-secondary font-black text-[10px] min-h-[32px]"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleActive(t)}
                      className="p-1 border-2 border-[#555555] hover:bg-brutal-bone/10 transition-all duration-150 min-w-[32px] min-h-[32px] flex items-center justify-center"
                      title={t.active ? 'Nonaktifkan' : 'Aktifkan'}
                    >
                      {t.active
                        ? <ToggleRight size={16} strokeWidth={2.5} />
                        : <ToggleLeft size={16} strokeWidth={2.5} className="opacity-40" />
                      }
                    </button>
                    <button
                      onClick={() => { haptic(); setDeletingId(t.id); }}
                      className="p-1 neo-btn-destructive transition-all duration-150 min-w-[32px] min-h-[32px] flex items-center justify-center border-2"
                      aria-label="Hapus"
                    >
                      <Trash2 size={14} strokeWidth={2.5} />
                    </button>
                  </div>
                </CardBody>
              )}
            </Card>
          );
        })}
      </div>

      <div className="h-20" />

      <AddRecurringSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editing={editing}
      />
    </div>
  );
};

export default RecurringPage;
