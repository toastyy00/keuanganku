import React, { useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Trash2 } from 'lucide-react';
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
  onRemove: (assetId: string) => Promise<void>;
}

type AmountEditMode = 'amount' | 'add' | 'reduce';

const AMOUNT_EDIT_MODES: Array<{ value: AmountEditMode; label: string }> = [
  { value: 'amount', label: 'Amount' },
  { value: 'add', label: 'Add' },
  { value: 'reduce', label: 'Reduce' },
];

const REMOVE_HOLD_MS = 1000;
const REMOVE_HOLD_PRESS_MS = 120;
const HISTORY_TRANSITION_MS = 200;
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
  asset,
  activityLogs = [],
  currentPriceUsd,
  colorTheme = '#B8F55A',
  onApply,
  onRemove,
}) => {
  const [amount, setAmount] = useState('');
  const [amountMode, setAmountMode] = useState<AmountEditMode>('amount');
  const [activityNote, setActivityNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeHoldProgress, setRemoveHoldProgress] = useState(0);
  const [isRemoveHoldPressing, setIsRemoveHoldPressing] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [lockedContentHeight, setLockedContentHeight] = useState<number | null>(null);
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
    setLockedContentHeight(null);
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
      historyLockTimerRef.current = window.setTimeout(() => {
        setLockedContentHeight(null);
        historyLockTimerRef.current = null;
      }, HISTORY_TRANSITION_MS);
      return;
    }

    const measuredHeight = sheetContentRef.current?.getBoundingClientRect().height ?? null;
    setLockedContentHeight(measuredHeight ? Math.ceil(measuredHeight) + 24 : null);
    setHistoryExpanded(true);
  };

  return (
    <>
      <BottomSheet
        isOpen={isOpen && !confirmRemoveOpen}
        onClose={onClose}
        panelClassName="!overflow-hidden"
        contentClassName="max-h-[calc(90dvh-2.75rem)] overflow-y-auto overscroll-contain"
        contentStyle={lockedContentHeight ? { height: lockedContentHeight } : undefined}
        containPageOverscroll
      >
        <div
          ref={sheetContentRef}
          className="portfolio-theme-sheet space-y-4"
          style={{ '--portfolio-pocket-accent': colorTheme } as React.CSSProperties}
        >
          <div className="flex items-start justify-between gap-3 border-b-2 border-[#555555] pb-3">
            <div>
              <h3 className="text-lg font-bold uppercase leading-tight tracking-tight">EDIT HOLDING</h3>
              <p className="mt-0.5 text-xs font-bold uppercase tracking-wider text-brutal-black/50">{asset.ticker} · {locationLabel}</p>
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
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs font-medium text-brutal-black/60">
              <span>Balance:</span>
              <span className="font-black text-brutal-black/80">{formatPortfolioAmount(asset.amount)}</span>
              {canShowAmountPreview && amountMode !== 'amount' && previewDelta !== 0 && (
                <span
                  className="font-black"
                  style={{ color: previewDelta > 0 ? ADD_ACCENT : REDUCE_ACCENT }}
                >
                  {previewDelta > 0 ? '+' : '-'}{formatPortfolioAmount(Math.abs(previewDelta))}
                </span>
              )}
              {canShowAmountPreview && (
                <>
                  <span className="text-brutal-black/35">→</span>
                  <span className={`font-black ${previewDirectionClass}`}>{formatPortfolioAmount(Math.max(0, nextAmount))}</span>
                  {amountMode === 'amount' && previewDelta !== 0 && (
                    <span
                      className="font-black"
                      style={{ color: previewDelta > 0 ? ADD_ACCENT : REDUCE_ACCENT }}
                    >
                      {previewDelta > 0 ? '+' : '-'}{formatPortfolioAmount(Math.abs(previewDelta))}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          <div className="neo-card space-y-3 p-3">
            <div className="space-y-1.5">
              <p className="text-xs font-black uppercase leading-none tracking-wider text-brutal-black/60">Action</p>
              <div className="relative grid w-full grid-cols-3 rounded-full bg-[#1B1B1B] p-1">
                <span
                  className="pointer-events-none absolute inset-y-1 left-1 rounded-full transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform"
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
                    className={`relative z-10 rounded-full px-3 py-1.5 text-[11px] font-black uppercase leading-none tracking-wider transition-colors duration-200 ${amountMode === mode.value ? 'text-[#1A1A1A]' : 'text-[#F5F0E8]/45 hover:text-[#F5F0E8]/75'}`}
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
            <Input
              id="holding-amount"
              type="number"
              className="rounded-md"
              value={amount}
              error={errors.amount ?? amountError}
              onChange={(e) => {
                setAmount(e.target.value);
                setErrors((current) => ({ ...current, amount: undefined }));
              }}
            />
            <Textarea
              label="Note"
              wrapperClassName="!gap-1"
              labelClassName="!text-[10px] !font-medium !leading-none text-brutal-black/55"
              className="rounded-md"
              value={activityNote}
              hint="Saved only to this update history."
              onChange={(e) => setActivityNote(e.target.value)}
            />
            <div className={`grid gap-2 ${onBack ? 'grid-cols-[auto_1fr_auto]' : 'grid-cols-[1fr_auto]'}`}>
              {onBack && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="!h-full !min-h-10 !w-11 !p-0 !text-[#1A1A1A]"
                  style={{ backgroundColor: colorTheme, borderColor: '#2A2A2A' }}
                  onClick={onBack}
                  leftIcon={<ArrowLeft size={16} strokeWidth={3} />}
                  aria-label="Back"
                />
              )}
              <Button
                variant="secondary"
                fullWidth
                className="!font-black"
                loading={saving}
                disabled={!hasRawHoldingChanges}
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
                      await onApply(asset.id, nextAmount, nextAmount > asset.amount ? 'ADD' : 'REDUCE', activityNote.trim() || undefined);
                    }
                    onClose();
                  } finally {
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
          <div className="neo-card overflow-hidden p-0">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 bg-[#1B1B1B] px-3 py-3 text-left transition-colors duration-150 hover:bg-[#1B1B1B] active:bg-[#1B1B1B]"
              aria-expanded={historyExpanded}
              onClick={toggleHistoryExpanded}
            >
              <p className="text-xs font-black uppercase text-brutal-black/60">History</p>
              <span className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase text-brutal-black/40">{sortedActivityLogs.length} TX</span>
                <ChevronDown
                  size={14}
                  strokeWidth={3}
                  className={`text-brutal-black/45 transition-transform duration-200 ${historyExpanded ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </span>
            </button>
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${historyExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
              <div ref={historyContentRef} className="min-h-0 overflow-hidden px-3 pb-3 pt-1.5">
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
          </div>
          {historyExpanded && (
            <div style={{ height: historySpacerHeight }} aria-hidden="true" />
          )}
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
