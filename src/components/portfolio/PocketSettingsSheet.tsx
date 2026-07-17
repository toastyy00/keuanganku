import React, { useEffect, useState } from 'react';
import { BriefcaseBusiness, Landmark, Link2, Shield, Wallet } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { ConfirmModal } from '../ui/ConfirmModal';
import type { PortfolioPocket } from '../../types';

interface PocketSettingsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  pocket?: PortfolioPocket | null;
  onSave: (input: Omit<PortfolioPocket, 'id' | 'created_at'>) => Promise<void>;
  onDelete?: () => Promise<void>;
}

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
  const sourceTypeIndex = Math.max(0, SOURCES.findIndex((item) => item === sourceType));

  useEffect(() => {
    setName(pocket?.name ?? '');
    setSourceType(pocket?.source_type ?? 'CEX');
    setSource(pocket?.source ?? '');
    setColorTheme(pocket?.color_theme ?? COLORS[0]);
    setIcon(pocket?.icon ?? ICONS[0]);
    setErrors({});
  }, [pocket, isOpen]);

  const renderIcon = (iconKey: string) => {
    if (iconKey === 'wallet') return <Wallet size={16} strokeWidth={2} />;
    if (iconKey === 'bank') return <Landmark size={16} strokeWidth={2} />;
    if (iconKey === 'shield') return <Shield size={16} strokeWidth={2} />;
    if (iconKey === 'link') return <Link2 size={16} strokeWidth={2} />;
    return <BriefcaseBusiness size={16} strokeWidth={2} />;
  };

  const isDirty = React.useMemo(() => {
    const baseName = pocket?.name ?? '';
    const baseSourceType = pocket?.source_type ?? 'CEX';
    const baseSource = pocket?.source ?? '';
    const baseColor = pocket?.color_theme ?? COLORS[0];
    const baseIcon = pocket?.icon ?? ICONS[0];

    return (
      name !== baseName ||
      sourceType !== baseSourceType ||
      source !== baseSource ||
      colorTheme !== baseColor ||
      icon !== baseIcon
    );
  }, [pocket, name, sourceType, source, colorTheme, icon]);

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        hasUnsavedChanges={isDirty}
        title={pocket ? 'POCKET SETTINGS' : 'NEW POCKET'}
        containPageOverscroll
        footer={
          <div className={`grid gap-2 ${pocket && onDelete ? 'grid-cols-[1fr_auto]' : 'grid-cols-1'}`}>
            <button
              type="button"
              disabled={saving}
              className="w-full h-11 rounded-xl text-[#1A1A1A] text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ backgroundColor: colorTheme }}
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
              {saving && <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              SAVE
            </button>
            {!!pocket && !!onDelete && (
              <button
                type="button"
                className="whitespace-nowrap border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 px-4 h-11 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
                onClick={() => {
                  onClose();
                  setConfirmDeleteOpen(true);
                }}
              >
                DELETE
              </button>
            )}
          </div>
        }
      >
        <div
          className="portfolio-theme-sheet flex flex-col gap-3.5 pb-2"
          style={{ '--portfolio-pocket-accent': colorTheme } as React.CSSProperties}
        >
          <FieldGroup label="Name" error={errors.name}>
            <SlimInput
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((current) => ({ ...current, name: undefined }));
              }}
            />
          </FieldGroup>

          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-medium text-white/40">Source Type</p>
            <div className="relative grid w-full grid-cols-4 rounded-xl bg-white/[0.05] p-1">
              <span
                className="pointer-events-none absolute inset-y-1 left-1 rounded-lg transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform"
                style={{
                  width: 'calc((100% - 0.5rem) / 4)',
                  transform: `translateX(${sourceTypeIndex * 100}%)`,
                  backgroundColor: colorTheme,
                }}
                aria-hidden="true"
              />
              {SOURCES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSourceType(item)}
                  className={`relative z-10 flex items-center justify-center rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors duration-200 ${sourceType === item ? 'text-[#1A1A1A] font-semibold' : 'text-white/40 hover:text-white/70'}`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <FieldGroup label="Source">
            <SlimInput
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Optional"
            />
          </FieldGroup>

          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-medium text-white/40">Theme</p>
            <div className="grid grid-cols-5 gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] p-2.5">
              {COLORS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setColorTheme(item)}
                  className={`h-7 rounded-full border transition-all duration-150 ${
                    colorTheme === item
                      ? 'border-white ring-2 ring-white/20 scale-105 shadow-md shadow-black/40'
                      : 'border-white/10 hover:border-white/40 hover:saturate-125'
                  }`}
                  style={{ backgroundColor: item }}
                  aria-label={`Use theme color ${item}`}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-medium text-white/40">Icon</p>
            <div className="grid grid-cols-5 gap-2">
              {ICONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setIcon(item)}
                  className={`flex h-10 items-center justify-center rounded-xl border transition-all duration-150 ${
                    icon === item
                      ? 'bg-white/[0.06] text-[var(--portfolio-pocket-accent)]'
                      : 'border-white/[0.08] bg-white/[0.02] text-white/40 hover:border-white/20 hover:text-white/70'
                  }`}
                  style={icon === item ? { borderColor: colorTheme, color: colorTheme } : undefined}
                >
                  {renderIcon(item)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </BottomSheet>
      <ConfirmModal
        isOpen={confirmDeleteOpen}
        title="Hapus Pocket?"
        description={`Pocket "${pocket?.name ?? (name || 'ini')}" beserta aset dan aktivitas di dalamnya akan ikut terhapus.`}
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
