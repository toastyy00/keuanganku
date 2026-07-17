import React, { useEffect, useState } from 'react';
import { CheckCircle2, Coins, Loader2, LockKeyhole, Search, Sprout } from 'lucide-react';
import { isBinanceSpotSymbolSupported, resolveCoingeckoId, searchCoinGeckoTickerOptions } from '../../lib/portfolio-prices';
import { BottomSheet } from '../ui/BottomSheet';
import { ConfirmModal } from '../ui/ConfirmModal';
import type { CoinGeckoTickerOption } from '../../lib/portfolio-prices';
import type { PortfolioAsset } from '../../types';

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


interface AddAssetSheetProps {
  isOpen: boolean;
  onClose: () => void;
  lockedTicker?: string;
  title?: string;
  colorTheme?: string;
  onAdd: (input: {
    ticker: string;
    amount: number;
    location: string;
    holding_type: PortfolioAsset['holding_type'];
    coingecko_id?: string;
    chain?: string;
    note?: string;
  }) => Promise<void>;
}

const HOLDING_TYPES: Array<{ value: PortfolioAsset['holding_type']; label: string; icon: React.ReactNode }> = [
  { value: 'liquid', label: 'Liquid', icon: <Coins size={13} strokeWidth={3} /> },
  { value: 'staked', label: 'Staked', icon: <Sprout size={13} strokeWidth={3} /> },
  { value: 'locked', label: 'Locked', icon: <LockKeyhole size={13} strokeWidth={3} /> },
];

const AddAssetSheet: React.FC<AddAssetSheetProps> = ({ isOpen, onClose, lockedTicker, title, colorTheme = '#B8F55A', onAdd }) => {
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [ticker, setTicker] = useState('');
  const [amount, setAmount] = useState('');
  const [location, setLocation] = useState('');
  const [holdingType, setHoldingType] = useState<PortfolioAsset['holding_type']>('liquid');
  const [chain, setChain] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [resolvingTicker, setResolvingTicker] = useState(false);
  const [resolverOpen, setResolverOpen] = useState(false);
  const [coinOptions, setCoinOptions] = useState<CoinGeckoTickerOption[]>([]);
  const [selectedCoingeckoId, setSelectedCoingeckoId] = useState('');
  const [resolverMessage, setResolverMessage] = useState('');
  const [errors, setErrors] = useState<{ ticker?: string; amount?: string; location?: string }>({});
  const activeTicker = lockedTicker ?? ticker;
  const normalizedTicker = activeTicker.trim().toUpperCase();
  const holdingTypeIndex = Math.max(0, HOLDING_TYPES.findIndex((type) => type.value === holdingType));

  useEffect(() => {
    if (isOpen) {
      setErrors({});
      setResolverOpen(false);
      setCoinOptions([]);
      setSelectedCoingeckoId('');
      setResolverMessage('');
    }
  }, [isOpen]);

  const resetResolver = () => {
    setCoinOptions([]);
    setSelectedCoingeckoId('');
    setResolverOpen(false);
    setResolverMessage('');
  };

  const loadTickerOptions = async (): Promise<CoinGeckoTickerOption[]> => {
    if (!normalizedTicker || lockedTicker) return [];
    setResolvingTicker(true);
    setResolverOpen(true);
    setResolverMessage('');
    try {
      const options = await searchCoinGeckoTickerOptions(normalizedTicker);
      setCoinOptions(options);
      setResolverMessage(options.length === 0 ? 'No exact CoinGecko match' : '');
      return options;
    } finally {
      setResolvingTicker(false);
    }
  };

  const handleSave = async () => {
    const parsed = Number(amount);
    const nextErrors = {
      ticker: !activeTicker.trim() ? 'Ticker wajib diisi' : undefined,
      amount: !Number.isFinite(parsed) || parsed <= 0 ? 'Amount harus lebih dari 0' : undefined,
      location: !location.trim() ? 'Location wajib diisi' : undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.ticker || nextErrors.amount || nextErrors.location) return;
    const coingeckoId = selectedCoingeckoId || undefined;
    const hasKnownLocalMapping = resolveCoingeckoId(normalizedTicker) !== normalizedTicker.toLowerCase();
    if (!lockedTicker && !coingeckoId && !hasKnownLocalMapping) {
      const binanceSupport = await isBinanceSpotSymbolSupported(`${normalizedTicker}USDT`);
      if (binanceSupport !== true) {
        const options = coinOptions.length > 0 ? coinOptions : await loadTickerOptions();
        if (options.length > 0) {
          setErrors((current) => ({ ...current, ticker: 'Pilih CoinGecko ID dulu' }));
          return;
        }
      }
    }
    setSaving(true);
    try {
      await onAdd({
        ticker: activeTicker.trim(),
        amount: parsed,
        location: location.trim(),
        holding_type: holdingType,
        coingecko_id: coingeckoId,
        chain: chain.trim() || undefined,
        note: note.trim() || undefined,
      });
      setTicker('');
      setAmount('');
      setLocation('');
      setHoldingType('liquid');
      setChain('');
      setNote('');
      resetResolver();
      setErrors({});
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const isDirty = React.useMemo(() => {
    const hasTicker = lockedTicker ? false : ticker.trim() !== '';
    return (
      hasTicker ||
      amount.trim() !== '' ||
      location.trim() !== '' ||
      chain.trim() !== '' ||
      note.trim() !== ''
    );
  }, [lockedTicker, ticker, amount, location, chain, note]);

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
      title={title ?? (lockedTicker ? 'ADD HOLDING' : 'ADD ASSET')}
      containPageOverscroll
      footer={
        <button
          type="button"
          disabled={saving}
          style={{ backgroundColor: colorTheme }}
          onClick={() => void handleSave()}
          className="w-full h-11 rounded-xl text-[#1A1A1A] text-sm font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {saving && (
            <Loader2 size={15} className="animate-spin" strokeWidth={3} />
          )}
          {lockedTicker ? 'ADD HOLDING' : 'ADD'}
        </button>
      }
    >
      <div
        className="portfolio-theme-sheet flex flex-col gap-3.5 pb-2"
        style={{ '--portfolio-pocket-accent': colorTheme } as React.CSSProperties}
      >
        {lockedTicker ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] flex items-center justify-between px-3 py-2">
            <p className="text-[11px] font-medium text-white/40">Ticker Selected</p>
            <p className="text-base font-semibold text-white/95">{lockedTicker}</p>
          </div>
        ) : (
          <>
            <FieldGroup label="Ticker" error={errors.ticker}>
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={ticker}
                  placeholder="Ticker"
                  className="slim-input pr-10 uppercase"
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void loadTickerOptions();
                  }}
                  onChange={(e) => {
                    setTicker(e.target.value.toUpperCase());
                    setErrors((current) => ({ ...current, ticker: undefined }));
                    resetResolver();
                  }}
                />
                <button
                  type="button"
                  className="absolute right-2 text-white/30 hover:text-white/70 transition-colors disabled:opacity-30"
                  title="Find CoinGecko ID"
                  aria-label="Find CoinGecko ID"
                  disabled={!normalizedTicker || resolvingTicker}
                  onClick={() => void loadTickerOptions()}
                >
                  {resolvingTicker ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Search size={12} strokeWidth={2.5} />
                  )}
                </button>
              </div>
            </FieldGroup>

            {resolverOpen && (
              <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2 border-b border-white/[0.04] pb-1.5">
                  <p className="text-[10px] font-medium text-white/35 uppercase tracking-widest">CoinGecko ID</p>
                  {!!selectedCoingeckoId && (
                    <p className="max-w-[58%] truncate text-[10px] text-white/50" title={selectedCoingeckoId}>
                      {selectedCoingeckoId}
                    </p>
                  )}
                </div>
                {resolvingTicker ? (
                  <div className="flex items-center gap-2 px-1 py-1.5 text-[11px] text-white/40">
                    <Loader2 size={12} className="animate-spin" strokeWidth={2.5} />
                    Searching...
                  </div>
                ) : coinOptions.length > 0 ? (
                  <div className="grid gap-1.5 max-h-36 overflow-y-auto divide-y divide-white/[0.04]">
                    {coinOptions.map((option) => {
                      const isSelected = selectedCoingeckoId === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`flex w-full items-center gap-2.5 px-2 py-2 text-left transition-colors rounded-lg text-xs ${
                            isSelected
                              ? 'bg-[var(--portfolio-pocket-accent)]/10 text-[var(--portfolio-pocket-accent)]'
                              : 'text-white/80 hover:bg-white/[0.05]'
                          }`}
                          onClick={() => {
                            setSelectedCoingeckoId(option.id);
                            setErrors((current) => ({ ...current, ticker: undefined }));
                          }}
                        >
                          {option.thumb ? (
                            <img src={option.thumb} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                          ) : (
                            <Coins size={14} className="shrink-0 text-white/30" />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-semibold uppercase">{option.name}</span>
                            <span className="opacity-45 ml-1.5 text-[10px]">
                              {option.symbol}
                            </span>
                          </span>
                          {typeof option.market_cap_rank === 'number' && (
                            <span className="shrink-0 text-[10px] opacity-40">#{option.market_cap_rank}</span>
                          )}
                          {isSelected && <CheckCircle2 size={12} className="shrink-0 text-current" />}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="px-1 py-1 text-[11px] text-white/35">{resolverMessage}</p>
                )}
              </div>
            )}
          </>
        )}

        <FieldGroup label="Amount" error={errors.amount}>
          <SlimInput
            type="number"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setErrors((current) => ({ ...current, amount: undefined }));
            }}
          />
        </FieldGroup>

        <FieldGroup label="Location" error={errors.location}>
          <SlimInput
            value={location}
            placeholder="Wallet, Hydro, Ledger..."
            onChange={(e) => {
              setLocation(e.target.value);
              setErrors((current) => ({ ...current, location: undefined }));
            }}
          />
        </FieldGroup>

        <FieldGroup label="Chain Optional">
          <SlimInput
            value={chain}
            placeholder="Ethereum, Base, Ink..."
            onChange={(e) => setChain(e.target.value)}
          />
        </FieldGroup>

        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-medium text-white/40">Holding Type</p>
          <div className="relative grid w-full grid-cols-3 rounded-xl bg-white/[0.05] p-1">
            <span
              className="pointer-events-none absolute inset-y-1 left-1 rounded-lg transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform"
              style={{
                width: 'calc((100% - 0.5rem) / 3)',
                transform: `translateX(${holdingTypeIndex * 100}%)`,
                backgroundColor: colorTheme,
              }}
              aria-hidden="true"
            />
            {HOLDING_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                className={`relative z-10 flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors duration-200 ${holdingType === type.value ? 'text-[#1A1A1A] font-semibold' : 'text-white/40 hover:text-white/70'}`}
                onClick={() => setHoldingType(type.value)}
              >
                {type.icon}
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <FieldGroup label="Note Optional">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="slim-input resize-none h-16 min-h-16"
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

export { AddAssetSheet };
