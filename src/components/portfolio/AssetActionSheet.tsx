import React, { useRef, useState } from 'react';
import { ArrowLeft, Coins, LockKeyhole, Sprout, Trash2 } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Input, Textarea } from '../ui/Input';
import { formatPortfolioAmount, roundPortfolioAmount } from '../../lib/utils';
import type { PortfolioActivityLog, PortfolioAsset } from '../../types';

interface AssetActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
  asset?: PortfolioAsset | null;
  activityLogs?: PortfolioActivityLog[];
  currentPriceUsd?: number;
  colorTheme?: string;
  onApply: (assetId: string, newAmount: number, action: 'ADD' | 'REDUCE', note?: string) => Promise<void>;
  onSaveMetadata: (assetId: string, data: Pick<PortfolioAsset, 'location' | 'holding_type'> & Pick<Partial<PortfolioAsset>, 'chain' | 'note'>) => Promise<void>;
  onRemove: (assetId: string) => Promise<void>;
}

const HOLDING_TYPES: Array<{ value: PortfolioAsset['holding_type']; label: string; icon: React.ReactNode }> = [
  { value: 'liquid', label: 'Liquid', icon: <Coins size={13} strokeWidth={3} /> },
  { value: 'staked', label: 'Staked', icon: <Sprout size={13} strokeWidth={3} /> },
  { value: 'locked', label: 'Locked', icon: <LockKeyhole size={13} strokeWidth={3} /> },
];

const REMOVE_HOLD_MS = 1000;
const REMOVE_HOLD_PRESS_MS = 120;

function formatHistoryTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

const AssetActionSheet: React.FC<AssetActionSheetProps> = ({
  isOpen,
  onClose,
  onBack,
  asset,
  activityLogs = [],
  currentPriceUsd,
  colorTheme = '#B8F55A',
  onApply,
  onSaveMetadata,
  onRemove,
}) => {
  const [amount, setAmount] = useState('');
  const [metadataNote, setMetadataNote] = useState(asset?.note ?? '');
  const [location, setLocation] = useState(asset?.location ?? 'Wallet');
  const [chain, setChain] = useState(asset?.chain ?? '');
  const [holdingType, setHoldingType] = useState<PortfolioAsset['holding_type']>(asset?.holding_type ?? 'liquid');
  const [saving, setSaving] = useState(false);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeHoldProgress, setRemoveHoldProgress] = useState(0);
  const [isRemoveHoldPressing, setIsRemoveHoldPressing] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; location?: string }>({});
  const removeHoldStartedAtRef = useRef<number | null>(null);
  const removeHoldTimerRef = useRef<number | null>(null);
  const removeHoldFrameRef = useRef<number | null>(null);
  const removeHoldPressTimerRef = useRef<number | null>(null);

  const resetRemoveHold = React.useCallback(() => {
    if (removeHoldTimerRef.current !== null) {
      window.clearTimeout(removeHoldTimerRef.current);
      removeHoldTimerRef.current = null;
    }
    if (removeHoldFrameRef.current !== null) {
      window.cancelAnimationFrame(removeHoldFrameRef.current);
      removeHoldFrameRef.current = null;
    }
    if (removeHoldPressTimerRef.current !== null) {
      window.clearTimeout(removeHoldPressTimerRef.current);
      removeHoldPressTimerRef.current = null;
    }
    removeHoldStartedAtRef.current = null;
    setRemoveHoldProgress(0);
    setIsRemoveHoldPressing(false);
  }, []);

  const startRemoveHold = React.useCallback(() => {
    if (removing || saving || savingMetadata) return;
    resetRemoveHold();
    removeHoldStartedAtRef.current = performance.now();

    const tick = () => {
      if (removeHoldStartedAtRef.current === null) return;
      const elapsed = performance.now() - removeHoldStartedAtRef.current;
      setRemoveHoldProgress(Math.min(1, elapsed / REMOVE_HOLD_MS));
      if (elapsed < REMOVE_HOLD_MS) {
        removeHoldFrameRef.current = window.requestAnimationFrame(tick);
      }
    };

    removeHoldFrameRef.current = window.requestAnimationFrame(tick);
    removeHoldTimerRef.current = window.setTimeout(() => {
      if (removeHoldFrameRef.current !== null) {
        window.cancelAnimationFrame(removeHoldFrameRef.current);
        removeHoldFrameRef.current = null;
      }
      removeHoldTimerRef.current = null;
      removeHoldStartedAtRef.current = null;
      setRemoveHoldProgress(1);
      setIsRemoveHoldPressing(true);
      removeHoldPressTimerRef.current = window.setTimeout(() => {
        setIsRemoveHoldPressing(false);
        setRemoveHoldProgress(0);
        setConfirmRemoveOpen(true);
      }, REMOVE_HOLD_PRESS_MS);
    }, REMOVE_HOLD_MS);
  }, [removing, resetRemoveHold, saving, savingMetadata]);

  React.useEffect(() => {
    if (!asset) return;
    setLocation(asset.location ?? 'Wallet');
    setChain(asset.chain ?? '');
    setHoldingType(asset.holding_type ?? 'liquid');
    setAmount(formatPortfolioAmount(asset.amount));
    setMetadataNote(asset.note ?? '');
    setErrors({});
    resetRemoveHold();
  }, [asset, resetRemoveHold]);

  React.useEffect(() => resetRemoveHold, [resetRemoveHold]);

  if (!asset) return null;

  const parsedAmount = Number(amount);
  const hasValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const hasRawHoldingChanges = amount.trim() !== formatPortfolioAmount(asset.amount)
    || location.trim() !== (asset.location ?? 'Wallet')
    || (chain.trim() || undefined) !== (asset.chain ?? undefined)
    || holdingType !== (asset.holding_type ?? 'liquid')
    || (metadataNote.trim() || undefined) !== (asset.note ?? undefined);
  const hasHoldingChanges = hasValidAmount && hasRawHoldingChanges;
  const sortedActivityLogs = [...activityLogs].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <>
      <BottomSheet isOpen={isOpen && !confirmRemoveOpen} onClose={onClose} containPageOverscroll>
        <div
          className="portfolio-theme-sheet space-y-4"
          style={{ '--portfolio-pocket-accent': colorTheme } as React.CSSProperties}
        >
          <div className="flex items-start justify-between gap-3 border-b-2 border-[#555555] pb-3">
            <div>
              <h3 className="text-lg font-bold uppercase leading-tight tracking-tight">EDIT HOLDING</h3>
              <p className="mt-0.5 text-xs font-bold uppercase tracking-wider text-brutal-black/50">{asset.ticker}</p>
            </div>
            <div className="flex items-center">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center bg-red-500 text-red-50 transition-all duration-150 active:translate-x-0.5 active:translate-y-0.5"
                aria-label="Close sheet"
              >
                ×
              </button>
            </div>
          </div>
          <div className="neo-card p-3">
            <p className="flex items-center gap-2 text-sm font-black">
              <span>{asset.ticker}</span>
              <span className="text-xs font-medium text-brutal-black/60">≈ ${Number(currentPriceUsd ?? 0).toFixed(4)}</span>
            </p>
            <p className="text-xs font-medium text-brutal-black/60">
              Balance: {formatPortfolioAmount(asset.amount)}
              {' · '}
              {asset.location ?? 'Wallet'}{asset.chain ? ` · ${asset.chain}` : ''}
            </p>
          </div>
          <div className="neo-card space-y-3 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase text-brutal-black/60">Holding Metadata</p>
              <p className="text-[10px] font-black uppercase text-brutal-black/40">Edit holding</p>
            </div>
            <Input
              label="Amount"
              type="number"
              value={amount}
              error={errors.amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setErrors((current) => ({ ...current, amount: undefined }));
              }}
            />
            <Input
              label="Location"
              value={location}
              error={errors.location}
              onChange={(e) => {
                setLocation(e.target.value);
                setErrors((current) => ({ ...current, location: undefined }));
              }}
            />
            <Input label="Chain Optional" value={chain} onChange={(e) => setChain(e.target.value)} />
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-brutal-black">Holding Type</p>
              <div className="grid grid-cols-3 gap-2">
                {HOLDING_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    className={`neo-btn-secondary px-2 py-2 !text-xs !font-black leading-tight ${holdingType === type.value ? '!text-[#1A1A1A]' : '!text-[#F5F0E8]'}`}
                    style={holdingType === type.value ? { backgroundColor: colorTheme } : undefined}
                    onClick={() => setHoldingType(type.value)}
                  >
                    <span className="inline-flex items-center justify-center gap-1">
                      {type.icon}
                      {type.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <Textarea label="Holding Note Optional" value={metadataNote} onChange={(e) => setMetadataNote(e.target.value)} />
            <div className={`grid gap-2 ${onBack ? 'grid-cols-[auto_1fr_auto]' : 'grid-cols-[1fr_auto]'}`}>
              {onBack && (
                <Button
                  type="button"
                  variant="secondary"
                  className="!px-3 !font-black"
                  onClick={onBack}
                  leftIcon={<ArrowLeft size={15} strokeWidth={3} />}
                >
                  BACK
                </Button>
              )}
              <Button
                variant="secondary"
                fullWidth
                className="!font-black"
                loading={savingMetadata || saving}
                disabled={!hasRawHoldingChanges}
                onClick={async () => {
                  const nextErrors = {
                    amount: !hasValidAmount ? 'Amount harus lebih dari 0' : undefined,
                    location: !location.trim() ? 'Location wajib diisi' : undefined,
                  };
                  setErrors(nextErrors);
                  if (nextErrors.amount || nextErrors.location || !hasHoldingChanges) return;
                  setSavingMetadata(true);
                  setSaving(true);
                  try {
                    await onSaveMetadata(asset.id, {
                      location: location.trim(),
                      holding_type: holdingType,
                      chain: chain.trim() || undefined,
                      note: metadataNote.trim() || undefined,
                    });
                    const roundedAmount = roundPortfolioAmount(parsedAmount);
                    if (roundedAmount !== asset.amount) {
                      await onApply(asset.id, roundedAmount, roundedAmount > asset.amount ? 'ADD' : 'REDUCE', metadataNote.trim() || undefined);
                    }
                    onClose();
                  } finally {
                    setSavingMetadata(false);
                    setSaving(false);
                  }
                }}
              >
                SAVE
              </Button>
              <button
                type="button"
                className={`neo-btn neo-btn-destructive portfolio-remove-hold-button relative flex h-full min-h-10 w-11 shrink-0 items-center justify-center overflow-hidden px-0 ${isRemoveHoldPressing ? 'is-complete' : ''}`}
                aria-label="Hold 1 second to remove holding"
                title="Hold 1 second to remove"
                onPointerDown={startRemoveHold}
                onPointerUp={resetRemoveHold}
                onPointerLeave={resetRemoveHold}
                onPointerCancel={resetRemoveHold}
                onBlur={resetRemoveHold}
                onContextMenu={(event) => event.preventDefault()}
              >
                <span
                  className="portfolio-remove-hold-fill absolute inset-y-0 left-0"
                  style={{ width: `${removeHoldProgress * 100}%` }}
                  aria-hidden="true"
                />
                <Trash2 className="relative z-10" size={16} strokeWidth={3} />
              </button>
            </div>
          </div>
          <div className="neo-card space-y-3 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase text-brutal-black/60">History</p>
              <p className="text-[10px] font-black uppercase text-brutal-black/40">{sortedActivityLogs.length} TX</p>
            </div>
            {sortedActivityLogs.length === 0 ? (
              <p className="text-xs font-medium text-brutal-black/60">No holding history yet.</p>
            ) : (
              <div className="space-y-2">
                {sortedActivityLogs.map((log) => {
                  const positive = log.action === 'ADD';
                  return (
                    <div key={log.id} className="border-t-2 border-[#555555] pt-2 first:border-t-0 first:pt-0">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-black">
                          <span className={positive ? 'text-green-600' : 'text-red-500'}>{log.action}</span>
                          {' '}
                          <span className={positive ? 'text-green-600' : 'text-red-500'}>
                            {positive ? '+' : '-'}{formatPortfolioAmount(log.amount_change)}
                          </span>
                        </p>
                        <p className="shrink-0 text-right text-[10px] font-medium text-brutal-black/60">{formatHistoryTimestamp(log.created_at)}</p>
                      </div>
                      <p className="mt-0.5 text-[10px] font-bold leading-tight text-brutal-black/60">
                        ≈ ${log.price_at_time.toFixed(4)} · Balance {formatPortfolioAmount(log.balance_after)} {log.ticker}
                      </p>
                      {log.note && (
                        <p className="mt-0.5 text-[10px] font-medium leading-tight text-brutal-black/70">{log.note}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </BottomSheet>
      <ConfirmModal
        isOpen={confirmRemoveOpen}
        title="Hapus Holding?"
        description={`Holding ${asset.ticker} di ${asset.location ?? 'Wallet'}${asset.chain ? ` · ${asset.chain}` : ''} akan dihapus dari pocket ini.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        loading={removing}
        onCancel={() => setConfirmRemoveOpen(false)}
        onConfirm={async () => {
          setRemoving(true);
          try {
            await onRemove(asset.id);
            setConfirmRemoveOpen(false);
            onClose();
          } finally {
            setRemoving(false);
          }
        }}
      />
    </>
  );
};

export { AssetActionSheet };
