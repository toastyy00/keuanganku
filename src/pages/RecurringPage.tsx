import React, { useEffect, useState } from 'react';
import { RefreshCcw, Trash2, ToggleLeft, ToggleRight, CalendarClock, Zap, AlertCircle } from 'lucide-react';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { CategoryPicker } from '../components/ui/CategoryPicker';
import { Toggle } from '../components/ui/Toggle';
import { Card, CardBody } from '../components/ui/Card';
import { useExpenseStore } from '../store/useExpenseStore';
import { useUIStore } from '../store/useAppStore';
import { useCurrencyInput } from '../hooks/useCurrencyInput';
import { formatCurrency, friendlyDate } from '../lib/utils';
import type { ExpenseType, RecurringTemplate } from '../types';

function haptic() { if ('vibrate' in navigator) navigator.vibrate(10); }

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

  const amountInput = useCurrencyInput(currency);

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

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={editing ? 'Edit Rutin' : 'Tambah Rutin'}>
      <div className="flex flex-col gap-4">
        {errors.root && (
          <div className="flex items-center gap-2 p-3 bg-red-500 border-2 border-[#555555] text-white font-bold text-sm">
            <AlertCircle size={16} strokeWidth={2.5} />
            {errors.root}
          </div>
        )}
        <Toggle
          label="Tipe"
          value={form.type}
          onChange={(v) => setForm((f) => ({ ...f, type: v }))}
          options={['NEED', 'WANT']}
        />
        <Input
          label="Nama"
          placeholder="Nama pengeluaran..."
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          error={errors.name}
          style={{ fontSize: '16px' }}
        />

        {/* Amount with live formatting */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider">
            Nominal ({currency})
          </label>
          <div className={`flex border-2 border-[#555555] bg-[#222222] transition-all duration-150 ${errors.amount ? 'border-red-500' : 'focus-within:border-brutal-yellow focus-within:shadow-[3px_3px_0px_0px_#7ABF3A]'}`}>
            <span className="flex items-center pl-3 text-sm font-bold text-brutal-black/60 shrink-0">
              {currency === 'IDR' ? 'Rp' : '$'}
            </span>
            <input
              type="text"
              inputMode="decimal"
              placeholder={currency === 'IDR' ? '0' : '0.00'}
              value={amountInput.displayValue}
              onChange={(e) => amountInput.handleChange(e.target.value)}
              className="flex-1 bg-transparent px-2 py-2.5 font-bold text-brutal-black focus:outline-none focus-visible:shadow-none"
              style={{ fontSize: '16px' }}
            />
          </div>
          {errors.amount && <p className="text-xs font-bold text-red-500">{errors.amount}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <CategoryPicker
            label="Kategori"
            value={form.category}
            onChange={(slug) => setForm((f) => ({ ...f, category: slug }))}
            categories={categories}
          />
        </div>

        <Input
          label="Jadwal / Frekuensi"
          placeholder="Kapan pengeluaran ini biasa terjadi..."
          value={form.schedule_detail}
          onChange={(e) => setForm((f) => ({ ...f, schedule_detail: e.target.value }))}
          style={{ fontSize: '16px' }}
        />

        <Textarea
          label="Catatan (opsional)"
          placeholder="Catatan tambahan..."
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          style={{ fontSize: '16px' }}
        />

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" fullWidth onClick={onClose}>Batal</Button>
          <Button variant="primary" fullWidth onClick={handleSave} loading={saving}>
            {editing ? 'Simpan' : 'Tambah'}
          </Button>
        </div>
      </div>
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
