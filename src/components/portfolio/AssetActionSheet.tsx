import React, { useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Trash2 } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { ConfirmModal } from '../ui/ConfirmModal';
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
  onRemove: (assetId: string) => Promise<void>;
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

type AmountEditMode = 'amount' | 'add' | 'reduce';

const AMOUNT_EDIT_MODES: Array<{ value: AmountEditMode; label: string }> = [
  { value: 'amount', label: 'Amount' },
  { value: 'add', label: 'Add' },
  { value: 'reduce', label: 'Reduce' },
];

const REMOVE_HOLD_MS = 1000;
const REMOVE_HOLD_PRESS_MS = 120;
const ADD_ACCENT = '#22C55E';
const REDUCE_ACCENT = '#F87171';

function calculateNextHoldingAmount(currentAmount: number, inputAmount: number, mode: AmountEditMode): number {
  if (mode === 'add') return currentAmount + inputAmount;
  if (mode === 'reduce') return currentAmount - inputAmount;
  return inputAmount;
}

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
  asset: rawAsset,
  activityLogs = [],
  currentPriceUsd,
  colorTheme = '#B8F55A',
  onApply,
  onRemove,
}) => {
  const [activeAsset, setActiveAsset] = useState<PortfolioAsset | null>(null);

  React.useEffect(() => {
    if (rawAsset) {
      setActiveAsset(rawAsset);
    }
  }, [rawAsset]);

  const asset = rawAsset || activeAsset;

  const [amount, setAmount] = useState('');
  const [amountMode, setAmountMode] = useState<AmountEditMode>('amount');
  const [activityNote, setActivityNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeHoldProgress, setRemoveHoldProgress] = useState(0);
  const [isRemoveHoldPressing, setIsRemoveHoldPressing] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historySpacerHeight, setHistorySpacerHeight] = useState(0);
  const [errors, setErrors] = useState<{ amount?: string }>({});
  const sheetContentRef = useRef<HTMLDivElement | null>(null);
  const historyContentRef = useRef<HTMLDivElement | null>(null);
  const removeHoldStartedAtRef = useRef<number | null>(null);
  const removeHoldTimerRef = useRef<number | null>(null);
  const removeHoldFrameRef = useRef<number | null>(null);
  const removeHoldPressTimerRef = useRef<number | null>(null);
  const historyLockTimerRef = useRef<number | null>(null);

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
    if (removing || saving) return;
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
  }, [removing, resetRemoveHold, saving]);

  React.useEffect(() => {
    if (!asset) return;
    setAmountMode('amount');
    setAmount(String(roundPortfolioAmount(asset.amount)));
    setActivityNote('');
    setHistoryExpanded(false);
    setHistorySpacerHeight(0);
    setErrors({});
    resetRemoveHold();
  }, [asset, resetRemoveHold]);

  React.useEffect(() => {
    return () => {
      resetRemoveHold();
      if (historyLockTimerRef.current !== null) {
        window.clearTimeout(historyLockTimerRef.current);
      }
    };
  }, [resetRemoveHold]);

  const sortedActivityLogs = [...activityLogs].sort((a, b) => b.created_at.localeCompare(a.created_at));

  React.useLayoutEffect(() => {
    if (!historyExpanded) return;

    const historyHeight = historyContentRef.current?.scrollHeight ?? 0;
    const nextSpacerHeight = Math.round(Math.min(84, Math.max(18, historyHeight * 0.18)));
    setHistorySpacerHeight(nextSpacerHeight);
  }, [historyExpanded, sortedActivityLogs.length]);

  const isDirty = React.useMemo(() => {
    if (!asset) return false;
    const baseAmount = String(roundPortfolioAmount(asset.amount));
    return (
      amountMode !== 'amount' ||
      amount !== baseAmount ||
      activityNote !== ''
    );
  }, [asset, amountMode, amount, activityNote]);

  const handleClose = React.useCallback(() => {
    if (isDirty) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  if (!asset) return null;

  const amountInput = amount.trim();
  const currentAmountInput = String(roundPortfolioAmount(asset.amount));
  const parsedAmount = Number(amount);
  const hasAmountInput = amountInput.length > 0;
  const nextAmount = hasAmountInput
    ? roundPortfolioAmount(calculateNextHoldingAmount(asset.amount, parsedAmount, amountMode))
    : asset.amount;
  const hasValidAmount = hasAmountInput
    && Number.isFinite(parsedAmount)
    && parsedAmount > 0
    && nextAmount > 0;
  const hasAmountRawChange = amountMode === 'amount'
    ? amountInput !== currentAmountInput
    : hasAmountInput;
  const hasAmountChange = hasAmountInput && hasValidAmount && nextAmount !== asset.amount;
  const amountModeAccent = amountMode === 'add'
    ? ADD_ACCENT
    : amountMode === 'reduce'
      ? REDUCE_ACCENT
      : colorTheme;
  const amountModeIndex = Math.max(0, AMOUNT_EDIT_MODES.findIndex((mode) => mode.value === amountMode));
  const canShowAmountPreview = hasAmountInput && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const previewDelta = canShowAmountPreview ? nextAmount - asset.amount : 0;
  const previewDirectionClass = canShowAmountPreview && nextAmount > asset.amount
    ? 'text-green-600'
    : canShowAmountPreview && nextAmount < asset.amount
      ? 'text-red-500'
      : 'text-brutal-black/75';
  const locationLabel = `${asset.location ?? 'Wallet'}${asset.chain ? ` · ${asset.chain}` : ''}`;
  const amountError = hasAmountInput && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    ? 'Amount harus lebih dari 0'
    : hasAmountInput && nextAmount <= 0
      ? 'Reduce melebihi amount saat ini'
      : undefined;
  const hasRawHoldingChanges = hasAmountRawChange;
  const hasHoldingChanges = hasRawHoldingChanges && (!hasAmountInput || hasValidAmount);
  const toggleHistoryExpanded = () => {
    if (historyLockTimerRef.current !== null) {
      window.clearTimeout(historyLockTimerRef.current);
      historyLockTimerRef.current = null;
    }

    if (historyExpanded) {
      setHistoryExpanded(false);
      setHistorySpacerHeight(0);
      return;
    }

    setHistoryExpanded(true);
  };

  return (
    <>
      <BottomSheet
        isOpen={isOpen && !confirmRemoveOpen}
        onClose={handleClose}
        hasUnsavedChanges={isDirty}
        title="EDIT HOLDING"
        description={`${asset?.ticker ?? ''} · ${locationLabel}`}
        containPageOverscroll
        footer={
          <div className={`grid gap-2 ${onBack ? 'grid-cols-[auto_1fr_auto]' : 'grid-cols-[1fr_auto]'}`}>
            {onBack && (
              <button
                type="button"
                style={{ backgroundColor: colorTheme }}
                onClick={onBack}
                className="h-11 w-11 flex items-center justify-center rounded-xl text-[#1A1A1A] hover:opacity-85 transition-all shrink-0 active:scale-[0.98]"
                aria-label="Back"
              >
                <ArrowLeft size={16} strokeWidth={2.5} />
              </button>
            )}
            <button
              type="button"
              disabled={saving || !hasRawHoldingChanges}
              onClick={async () => {
                const nextAmountError = amountMode === 'amount' && !hasAmountInput
                  ? 'Amount harus lebih dari 0'
                  : amountError;
                const nextErrors = {
                  amount: nextAmountError,
                };
                setErrors(nextErrors);
                if (nextErrors.amount || !hasHoldingChanges) return;
                setSaving(true);
                try {
                  if (hasAmountChange) {
                    await onApply(asset!.id, nextAmount, nextAmount > asset!.amount ? 'ADD' : 'REDUCE', activityNote.trim() || undefined);
                  }
                  onClose();
                } finally {
                  setSaving(false);
                }
              }}
              className="h-11 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-40 text-white text-sm font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {saving && (
                <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              )}
              SAVE
            </button>
            <button
              type="button"
              className={`portfolio-remove-hold-button relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all ${isRemoveHoldPressing ? 'is-complete' : ''}`}
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
                className="portfolio-remove-hold-fill absolute inset-y-0 left-0 bg-red-500/20"
                style={{ width: `${removeHoldProgress * 100}%` }}
                aria-hidden="true"
              />
              <Trash2 className="relative z-10" size={16} strokeWidth={2} />
            </button>
          </div>
        }
      >
        <div
          ref={sheetContentRef}
          className="portfolio-theme-sheet flex flex-col gap-3.5 pb-2"
          style={{ '--portfolio-pocket-accent': colorTheme } as React.CSSProperties}
        >
          {asset && (
            <>
              {/* Balance card */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span>{asset.ticker}</span>
                  <span className="text-xs font-normal text-white/40">≈ ${Number(currentPriceUsd ?? 0).toFixed(4)}</span>
                </p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs font-normal text-white/50">
                  <span>Balance:</span>
                  <span className="font-semibold text-white/90">{formatPortfolioAmount(asset.amount)}</span>
                  {canShowAmountPreview && amountMode !== 'amount' && previewDelta !== 0 && (
                    <span
                      className="font-semibold"
                      style={{ color: previewDelta > 0 ? ADD_ACCENT : REDUCE_ACCENT }}
                    >
                      {previewDelta > 0 ? '+' : '-'}{formatPortfolioAmount(Math.abs(previewDelta))}
                    </span>
                  )}
                  {canShowAmountPreview && (
                    <>
                      <span className="text-white/20">→</span>
                      <span className={`font-semibold ${previewDirectionClass}`}>{formatPortfolioAmount(Math.max(0, nextAmount))}</span>
                      {amountMode === 'amount' && previewDelta !== 0 && (
                        <span
                          className="font-semibold"
                          style={{ color: previewDelta > 0 ? ADD_ACCENT : REDUCE_ACCENT }}
                        >
                          {previewDelta > 0 ? '+' : '-'}{formatPortfolioAmount(Math.abs(previewDelta))}
                        </span>
                      )}
                    </>
                  )}
                </p>
              </div>

              {/* Action selection and values */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-medium text-white/40">Action</p>
                  <div className="relative grid w-full grid-cols-3 rounded-xl bg-white/[0.05] p-1">
                    <span
                      className="pointer-events-none absolute inset-y-1 left-1 rounded-lg transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform"
                      style={{
                        width: 'calc((100% - 0.5rem) / 3)',
                        transform: `translateX(${amountModeIndex * 100}%)`,
                        backgroundColor: amountModeAccent,
                      }}
                      aria-hidden="true"
                    />
                    {AMOUNT_EDIT_MODES.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        className={`relative z-10 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors duration-200 ${amountMode === mode.value ? 'text-[#1A1A1A] font-semibold' : 'text-white/40 hover:text-white/70'}`}
                        onClick={() => {
                          setAmountMode(mode.value);
                          setAmount(mode.value === 'amount' ? currentAmountInput : '');
                          setErrors((current) => ({ ...current, amount: undefined }));
                        }}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                <FieldGroup label="Amount" error={errors.amount ?? amountError}>
                  <SlimInput
                    id="holding-amount"
                    type="number"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setErrors((current) => ({ ...current, amount: undefined }));
                    }}
                  />
                </FieldGroup>

                <FieldGroup label="Note">
                  <textarea
                    placeholder="Saved to update history..."
                    value={activityNote}
                    onChange={(e) => setActivityNote(e.target.value)}
                    className="slim-input resize-none h-16 min-h-16"
                    style={{ fontSize: '14px' }}
                  />
                </FieldGroup>
              </div>

              {/* History Expandable Panel */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 bg-white/[0.02] px-3 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.04]"
                  aria-expanded={historyExpanded}
                  onClick={toggleHistoryExpanded}
                >
                  <p className="text-[11px] font-medium text-white/40 uppercase tracking-widest">History</p>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-white/30">{sortedActivityLogs.length} TX</span>
                    <ChevronDown
                      size={14}
                      strokeWidth={2}
                      className={`text-white/35 transition-transform duration-200 ${historyExpanded ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                  </span>
                </button>
                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${historyExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                >
                  <div ref={historyContentRef} className="min-h-0 overflow-hidden px-3 pb-3 pt-1.5">
                    {sortedActivityLogs.length === 0 ? (
                      <p className="text-xs text-white/30">No holding history yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {sortedActivityLogs.map((log) => {
                          const positive = log.action === 'ADD';
                          return (
                            <div key={log.id} className="border-t border-white/[0.04] pt-2 first:border-t-0 first:pt-0">
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-xs font-semibold">
                                  <span className={positive ? 'text-green-400' : 'text-red-400'}>{log.action}</span>
                                  {' '}
                                  <span className={positive ? 'text-green-400' : 'text-red-400'}>
                                    {positive ? '+' : '-'}{formatPortfolioAmount(log.amount_change)}
                                  </span>
                                </p>
                                <p className="shrink-0 text-right text-[10px] text-white/30">{formatHistoryTimestamp(log.created_at)}</p>
                              </div>
                              <p className="mt-0.5 text-[10px] text-white/40">
                                ≈ ${log.price_at_time.toFixed(4)} · Balance {formatPortfolioAmount(log.balance_after)} {log.ticker}
                              </p>
                              {log.note && (
                                <p className="mt-0.5 text-[10px] text-white/50 font-normal leading-tight">{log.note}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
          {historyExpanded && (
            <div style={{ height: historySpacerHeight }} aria-hidden="true" />
          )}
        </div>
      </BottomSheet>
      <ConfirmModal
        isOpen={confirmRemoveOpen}
        title="Hapus Holding?"
        description={`Holding ${asset?.ticker ?? ''} di ${asset?.location ?? 'Wallet'}${asset?.chain ? ` · ${asset.chain}` : ''} akan dihapus dari pocket ini.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        loading={removing}
        onCancel={() => setConfirmRemoveOpen(false)}
        onConfirm={async () => {
          setRemoving(true);
          try {
            await onRemove(asset!.id);
            setConfirmRemoveOpen(false);
            onClose();
          } finally {
            setRemoving(false);
          }
        }}
      />
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
    </>
  );
};

export { AssetActionSheet };
