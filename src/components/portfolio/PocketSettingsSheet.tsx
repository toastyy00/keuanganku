import React, { useEffect, useState } from 'react';
import { BriefcaseBusiness, Landmark, Link2, Shield, Wallet } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Input } from '../ui/Input';
import type { PortfolioPocket } from '../../types';

interface PocketSettingsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  pocket?: PortfolioPocket | null;
  onSave: (input: Omit<PortfolioPocket, 'id' | 'created_at'>) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const COLORS = [
  '#3B82F6',
  '#06B6D4',
  '#F97316',
  '#DB2777',
  '#7C3AED',
  '#FACC15',
  '#0F766E',
  '#C084FC',
  '#F59E0B',
  '#64748B',
];
const ICONS = ['briefcase', 'wallet', 'bank', 'shield', 'link'] as const;
const SOURCES: Array<PortfolioPocket['source_type']> = ['CEX', 'WEB3', 'WALLET', 'LAINNYA'];

const PocketSettingsSheet: React.FC<PocketSettingsSheetProps> = ({ isOpen, onClose, pocket, onSave, onDelete }) => {
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<PortfolioPocket['source_type']>('CEX');
  const [source, setSource] = useState('');
  const [colorTheme, setColorTheme] = useState(COLORS[0]);
  const [icon, setIcon] = useState<string>(ICONS[0]);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState<{ name?: string }>({});

  useEffect(() => {
    setName(pocket?.name ?? '');
    setSourceType(pocket?.source_type ?? 'CEX');
    setSource(pocket?.source ?? '');
    setColorTheme(pocket?.color_theme ?? COLORS[0]);
    setIcon(pocket?.icon ?? ICONS[0]);
    setErrors({});
  }, [pocket, isOpen]);

  const renderIcon = (iconKey: string) => {
    if (iconKey === 'wallet') return <Wallet size={18} strokeWidth={2.4} />;
    if (iconKey === 'bank') return <Landmark size={18} strokeWidth={2.4} />;
    if (iconKey === 'shield') return <Shield size={18} strokeWidth={2.4} />;
    if (iconKey === 'link') return <Link2 size={18} strokeWidth={2.4} />;
    return <BriefcaseBusiness size={18} strokeWidth={2.4} />;
  };

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title={pocket ? 'POCKET SETTINGS' : 'NEW POCKET'}
        containPageOverscroll
      >
        <div
          className="portfolio-theme-sheet space-y-5"
          style={{ '--portfolio-pocket-accent': colorTheme } as React.CSSProperties}
        >
          <Input
            label="Name"
            value={name}
            error={errors.name}
            onChange={(e) => {
              setName(e.target.value);
              setErrors((current) => ({ ...current, name: undefined }));
            }}
            className="!py-2.5"
          />
          <div>
            <p className="mb-2 text-xs font-bold uppercase">Source Type</p>
            <div className="grid grid-cols-4 gap-1.5">
              {SOURCES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSourceType(item)}
                  className={`border-2 px-2 py-2 text-[11px] font-black uppercase transition-colors ${sourceType === item ? 'text-[#1A1A1A]' : 'border-[#F5F0E8] bg-transparent text-[#F5F0E8]'}`}
                  style={sourceType === item ? { borderColor: colorTheme, backgroundColor: colorTheme } : undefined}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <Input label="Source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Optional" className="!py-2.5" />
          <div>
            <p className="mb-2 text-xs font-bold uppercase">Theme</p>
            <div className="grid grid-cols-5 gap-2">
              {COLORS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setColorTheme(item)}
                  className={`h-8 w-full border-[3px] ${colorTheme === item ? 'border-[#F5F0E8]' : 'border-transparent'}`}
                  style={{ backgroundColor: item }}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-bold uppercase">Icon</p>
            <div className="grid grid-cols-5 gap-2">
              {ICONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setIcon(item)}
                  className={`flex h-10 items-center justify-center border-2 transition-colors ${icon === item ? '' : 'border-[#F5F0E8] text-[#F5F0E8]'}`}
                  style={icon === item ? { borderColor: colorTheme, color: colorTheme } : undefined}
                >
                  {renderIcon(item)}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            className="w-full border-2 py-3 text-sm font-black uppercase text-[#1A1A1A] shadow-[4px_4px_0_0_#000] transition-transform active:translate-x-1 active:translate-y-1 active:shadow-none disabled:opacity-60"
            style={{ borderColor: colorTheme, backgroundColor: colorTheme }}
            onClick={async () => {
              const nextErrors = {
                name: !name.trim() ? 'Name wajib diisi' : undefined,
              };
              setErrors(nextErrors);
              if (nextErrors.name) return;
              setSaving(true);
              try {
                await onSave({
                  name: name.trim(),
                  source_type: sourceType,
                  source: source.trim() || undefined,
                  color_theme: colorTheme,
                  icon,
                  sort_order: pocket?.sort_order ?? 0,
                });
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'SAVING...' : 'SAVE'}
          </button>
          {!!pocket && !!onDelete && (
            <button
              type="button"
              className="w-full border-2 border-[#F87171] bg-[#2A1A1A] py-3 text-sm font-black uppercase text-[#F87171] shadow-[4px_4px_0_0_#000] transition-transform active:translate-x-1 active:translate-y-1 active:shadow-none"
              onClick={() => {
                onClose();
                setConfirmDeleteOpen(true);
              }}
            >
              DELETE POCKET
            </button>
          )}
        </div>
      </BottomSheet>
      <ConfirmModal
        isOpen={confirmDeleteOpen}
        title="Hapus Pocket?"
        description="Aset dan aktivitas di pocket ini juga akan ikut terhapus."
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        loading={deleting}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          if (!onDelete) return;
          setDeleting(true);
          try {
            await onDelete();
            setConfirmDeleteOpen(false);
          } finally {
            setDeleting(false);
          }
        }}
      />
    </>
  );
};

export { PocketSettingsSheet };
