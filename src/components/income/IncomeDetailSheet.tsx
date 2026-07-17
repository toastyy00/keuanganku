import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { IconPencil, IconCopy, IconMapPin, IconTrash } from '@tabler/icons-react';
import { BottomSheet } from '../ui/BottomSheet';
import { useUIStore } from '../../store/useAppStore';
import { useIncomeStore } from '../../store/useIncomeStore';
import { usePortfolioStore } from '../../store/usePortfolioStore';
import { useExpenseStore } from '../../store/useExpenseStore';
import { getSourceEmoji } from '../../lib/income-sources';
import { getTablerIconByEmoji } from '../../lib/icons-map';
import { ConfirmModal } from '../ui/ConfirmModal';

const copyToClipboard = (text: string): boolean => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text);
    return true;
  }
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback copy failed:', err);
    return false;
  }
};

const formatMcap = (val?: number): string => {
  if (val === undefined || val === null || val <= 0) return '$0';
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}k`;
  return `$${val.toFixed(2)}`;
};

const DetailRow: React.FC<{
  label: string;
  value: React.ReactNode;
  border?: boolean;
}> = ({ label, value, border = true }) => (
  <div className={`flex justify-between items-center py-2.5 ${border ? 'border-b border-white/[0.04]' : ''}`}>
    <span className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">{label}</span>
    <div className="text-right text-xs font-semibold text-white/90">{value}</div>
  </div>
);

export const IncomeDetailSheet: React.FC = () => {
  const { incomes, deleteIncome } = useIncomeStore();
  const { pockets } = usePortfolioStore();
  const { currency } = useExpenseStore();
  const {
    isIncomeDetailSheetOpen,
    activeIncomeId,
    closeIncomeDetailSheet,
  } = useUIStore();

  const [showCopied, setShowCopied] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleConfirmDelete = async (id: string) => {
    setIsDeleting(true);
    setErrorMsg(null);
    try {
      await deleteIncome(id);
      setIsConfirmOpen(false);
      closeIncomeDetailSheet();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete income');
    } finally {
      setIsDeleting(false);
    }
  };

  const rawIncome = activeIncomeId
    ? incomes.find((i) => i.id === activeIncomeId) ?? null
    : null;

  const [activeIncome, setActiveIncome] = useState<typeof rawIncome>(null);

  React.useEffect(() => {
    if (rawIncome) {
      setActiveIncome(rawIncome);
    }
  }, [rawIncome]);

  const income = rawIncome || activeIncome;

  if (!income) return null;

  const emoji = getSourceEmoji(income.source_type);
  const matchedPocket = pockets.find((p) => p.id === income.pocket_id);

  // Date formatting
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${income.date}T00:00:00`));

  // PnL Calculations
  const hasCost = income.has_cost_basis && income.cost_amount !== undefined;
  const costValUsd = income.cost_value_usd ?? 0;
  const costValIdr = income.cost_value_idr ?? 0;
  const pnlUsd = income.value_usd - costValUsd;
  const pnlIdr = income.value_idr - costValIdr;
  const pnlPct = costValUsd > 0 ? (pnlUsd / costValUsd) * 100 : 0;
  // Token-level PnL (only meaningful for CRYPTO)
  const pnlTokens = income.asset_type !== 'FIAT'
    ? income.amount - (income.cost_amount ?? 0)
    : null;

  const handleEdit = () => {
    // Transition to edit mode by updating store state directly
    useUIStore.setState({
      activeIncomeId: income.id,
      isAddIncomeSheetOpen: true,
      isIncomeDetailSheetOpen: false,
    });
  };

  const handleCopy = () => {
    if (income.contract_address) {
      copyToClipboard(income.contract_address);
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    }
  };

  return (
    <BottomSheet
      isOpen={isIncomeDetailSheetOpen}
      onClose={closeIncomeDetailSheet}
      containPageOverscroll
      title="Income Details"
      footer={
        <div className="flex gap-3 w-full">
          <button
            type="button"
            onClick={() => setIsConfirmOpen(true)}
            className="flex-1 flex items-center justify-center gap-2 text-xs font-semibold px-4 py-3 rounded-2xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400 active:scale-95 transition-all duration-200"
          >
            <IconTrash size={13} />
            <span>Delete</span>
          </button>
          <button
            type="button"
            onClick={handleEdit}
            className="flex-1 flex items-center justify-center gap-2 text-xs font-semibold px-4 py-3 rounded-2xl bg-[#B8F55A] hover:bg-[#a6de4b] text-black active:scale-95 transition-all duration-200"
          >
            <IconPencil size={13} />
            <span>Edit</span>
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 pb-2">
        {/* Main Header Card */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 flex flex-col items-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#B8F55A]/5 rounded-full blur-[40px] pointer-events-none" />

          {/* Header Row */}
          <div className="flex items-center justify-between w-full border-b border-white/[0.06] pb-4 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.08] shrink-0">
                {React.createElement(getTablerIconByEmoji(emoji), { size: 16, className: "text-white/80" })}
              </div>
              <div className="text-left min-w-0">
                <span className="text-[9px] font-bold text-[#B8F55A] uppercase tracking-wider block">
                  {income.source_type}
                </span>
                <h3 className="text-xs font-bold text-white leading-tight mt-0.5 truncate max-w-[160px] sm:max-w-[280px]">
                  {income.title}
                </h3>
              </div>
            </div>
            {hasCost && (
              <span className={`text-lg font-black uppercase tracking-wider ${pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {pnlUsd >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
              </span>
            )}
          </div>

          {!hasCost ? (
            /* Simple received display for entries WITHOUT cost basis */
            <div className="flex flex-col items-center py-2 w-full text-center">
              <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest block mb-1">
                Amount Received
              </span>
              {income.asset_type === 'FIAT' ? (
                <>
                  <span className="text-2xl font-bold tracking-tight text-white">
                    Rp {income.value_idr.toLocaleString('id-ID')}
                  </span>
                  <span className="text-xs text-white/40 mt-1 font-medium">
                    ≈ ${income.value_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-2xl font-bold tracking-tight text-white">
                    {income.amount.toLocaleString('en-US', { maximumFractionDigits: 8 })} {income.ticker}
                  </span>
                  <span className="text-xs text-white/40 mt-1 font-medium">
                    {currency === 'IDR'
                      ? `Rp ${income.value_idr.toLocaleString('id-ID')} (≈ $${income.value_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })})`
                      : `$${income.value_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })} (≈ Rp ${income.value_idr.toLocaleString('id-ID')})`}
                  </span>
                </>
              )}
            </div>
          ) : (
            /* Visual Comparison for entries WITH cost basis */
            <div className="w-full flex flex-col items-center text-center">
              {/* Net Profit */}
              <div className="py-1 text-center">
                <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest block mb-1">
                  Net Profit
                </span>
                <p className={`text-2xl font-black tracking-tight ${pnlUsd >= 0 ? 'text-white' : 'text-red-400'}`}>
                  {pnlTokens !== null 
                    ? `${pnlTokens >= 0 ? '+' : ''}${pnlTokens.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${income.ticker}`
                    : `${pnlIdr >= 0 ? '+' : ''}Rp ${pnlIdr.toLocaleString('id-ID')}`
                  }
                </p>
                <p className={`text-[10px] font-semibold mt-1 ${pnlUsd >= 0 ? 'text-[#B8F55A]' : 'text-red-400/80'}`}>
                  {pnlUsd >= 0 ? '+' : ''}${pnlUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  <span className="text-white/40 font-medium ml-1.5">(≈ Rp {pnlIdr.toLocaleString('id-ID')})</span>
                </p>
              </div>

              {/* Grid for Entry and Exit */}
              <div className="grid grid-cols-2 gap-0 w-full mt-4 pt-4 border-t border-white/[0.06]">
                {/* Entry (Capital) */}
                <div className="text-center min-w-0 px-2 border-r border-white/[0.08]">
                  <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest block mb-1">
                    Entry (Capital)
                  </span>
                  <p className="text-xs font-bold text-white/80 truncate">
                    {income.cost_amount?.toLocaleString('en-US', { maximumFractionDigits: 8 })} {income.cost_ticker || income.ticker}
                  </p>
                  <p className="text-[9px] text-white/40 font-medium mt-1 truncate">
                    ${costValUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    <span className="text-white/20 mx-1">·</span>
                    Rp {costValIdr.toLocaleString('id-ID')}
                  </p>
                </div>

                {/* Exit (Received) */}
                <div className="text-center min-w-0 px-2">
                  <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest block mb-1">
                    Exit (Received)
                  </span>
                  <p className="text-xs font-bold text-white/90 truncate">
                    {income.amount.toLocaleString('en-US', { maximumFractionDigits: 8 })} {income.ticker}
                  </p>
                  <p className="text-[9px] text-white/40 font-medium mt-1 truncate">
                    ${income.value_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    <span className="text-white/20 mx-1">·</span>
                    Rp {income.value_idr.toLocaleString('id-ID')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Core Metadata List */}
        <div className="flex flex-col bg-white/[0.01] rounded-2xl border border-white/[0.04] px-4 py-2">
          <DetailRow label="Date" value={formattedDate} />
          {matchedPocket && (
            <DetailRow
              label="Pocket"
              value={
                <span className="flex items-center gap-1.5 justify-end">
                  <IconMapPin size={13} className="text-white/40" />
                  <span>{matchedPocket.name}</span>
                </span>
              }
            />
          )}
          {income.chain && (
            <DetailRow label="Chain / Network" value={income.chain.toUpperCase()} />
          )}
          {income.platform && (
            <DetailRow label="Platform" value={income.platform} />
          )}
          {income.asset_type === 'CRYPTO' && income.token_ticker && (
            <DetailRow label="Token Ticker" value={`$${income.token_ticker.toUpperCase()}`} />
          )}
          {income.mcap_at_time !== undefined && income.mcap_at_time !== null && (
            <DetailRow label="Market Cap" value={formatMcap(income.mcap_at_time)} />
          )}
          {income.contract_address && (
            <div className="flex justify-between items-center py-2.5">
              <span className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">Contract Address</span>
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy contract address"
                className="flex items-center gap-1.5 font-mono bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] px-2 py-1 rounded-lg text-[10px] text-white/80 transition-colors"
              >
                <span>{income.contract_address.slice(0, 6)}...{income.contract_address.slice(-4)}</span>
                <IconCopy size={10} className="text-white/40" />
              </button>
            </div>
          )}
        </div>

        {/* Notes */}
        {income.note && (
          <div className="flex flex-col gap-2">
            <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest pl-1">
              Note
            </p>
            <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] px-4 py-3 text-xs text-white/60 leading-relaxed font-medium">
              {income.note}
            </div>
          </div>
        )}
      </div>

      {showCopied && createPortal(
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] pointer-events-none transition-all duration-300 ease-out">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/[0.08] bg-[#121212]/95 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.6)] text-[9px] font-semibold uppercase tracking-widest text-[#B8F55A] animate-pulse">
            <span>✓</span>
            <span>Address Copied</span>
          </div>
        </div>,
        document.body
      )}
      <ConfirmModal
        isOpen={isConfirmOpen}
        title="Delete Income"
        description={errorMsg ? `Error: ${errorMsg}` : `Are you sure you want to delete "${income.title}"? This action is permanent and cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => handleConfirmDelete(income.id)}
        onCancel={() => {
          setIsConfirmOpen(false);
          setErrorMsg(null);
        }}
        loading={isDeleting}
      />
    </BottomSheet>
  );
};
