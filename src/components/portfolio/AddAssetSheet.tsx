import React, { useEffect, useState } from 'react';
import { CheckCircle2, Coins, Loader2, LockKeyhole, Search, Sprout } from 'lucide-react';
import { isBinanceSpotSymbolSupported, resolveCoingeckoId, searchCoinGeckoTickerOptions } from '../../lib/portfolio-prices';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import type { CoinGeckoTickerOption } from '../../lib/portfolio-prices';
import type { PortfolioAsset } from '../../types';

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

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={title ?? (lockedTicker ? 'ADD HOLDING' : 'ADD ASSET')}
      containPageOverscroll
    >
      <div
        className="portfolio-theme-sheet space-y-4"
        style={{ '--portfolio-pocket-accent': colorTheme } as React.CSSProperties}
      >
        {lockedTicker ? (
          <div className="neo-card flex items-center justify-between px-3 py-2">
            <p className="text-xs font-black uppercase text-brutal-black/50">Ticker Selected</p>
            <p className="text-lg font-black">{lockedTicker}</p>
          </div>
        ) : (
          <>
            <Input
              label="Ticker"
              value={ticker}
              error={errors.ticker}
              wrapperClassName="!gap-1"
              className="rounded-md pr-12"
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
              rightSection={(
                <button
                  type="button"
                  className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center border-2 border-[#1A1A1A] bg-[#2A2A2A] text-[#F5F0E8] transition-transform active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-40"
                  title="Find CoinGecko ID"
                  aria-label="Find CoinGecko ID"
                  disabled={!normalizedTicker || resolvingTicker}
                  onClick={() => void loadTickerOptions()}
                >
                  {resolvingTicker ? <Loader2 size={15} className="animate-spin" strokeWidth={3} /> : <Search size={15} strokeWidth={3} />}
                </button>
              )}
            />
            {resolverOpen && (
              <div className="space-y-2 border-2 border-[#4A4A4A] bg-[#202020] p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#F5F0E8]/60">CoinGecko ID</p>
                  {!!selectedCoingeckoId && (
                    <p className="max-w-[58%] truncate text-[10px] font-black uppercase text-[#F5F0E8]" title={selectedCoingeckoId}>
                      {selectedCoingeckoId}
                    </p>
                  )}
                </div>
                {resolvingTicker ? (
                  <div className="flex items-center gap-2 px-1 py-2 text-[11px] font-black uppercase text-[#F5F0E8]/65">
                    <Loader2 size={14} className="animate-spin" strokeWidth={3} />
                    Searching
                  </div>
                ) : coinOptions.length > 0 ? (
                  <div className="grid gap-2">
                    {coinOptions.map((option) => {
                      const isSelected = selectedCoingeckoId === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`flex w-full items-center gap-2 border-2 px-2 py-2 text-left transition-transform active:translate-x-[2px] active:translate-y-[2px] ${
                            isSelected ? 'border-[#1A1A1A] bg-[var(--portfolio-pocket-accent)] text-[#1A1A1A]' : 'border-[#5D5D5D] bg-[#2A2A2A] text-[#F5F0E8]'
                          }`}
                          onClick={() => {
                            setSelectedCoingeckoId(option.id);
                            setErrors((current) => ({ ...current, ticker: undefined }));
                          }}
                        >
                          {option.thumb ? <img src={option.thumb} alt="" className="h-5 w-5 shrink-0 rounded-full" /> : <Coins size={18} strokeWidth={3} className="shrink-0" />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-black uppercase leading-tight">{option.name}</span>
                            <span className="block truncate text-[10px] font-bold uppercase opacity-70">
                              {option.symbol} - {option.id}
                            </span>
                          </span>
                          {typeof option.market_cap_rank === 'number' && <span className="shrink-0 text-[10px] font-black opacity-70">#{option.market_cap_rank}</span>}
                          {isSelected && <CheckCircle2 size={16} strokeWidth={3} className="shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="px-1 py-2 text-[11px] font-black uppercase text-[#F5F0E8]/55">{resolverMessage}</p>
                )}
              </div>
            )}
          </>
        )}

        <Input
          label="Amount"
          type="number"
          wrapperClassName="!gap-1"
          className="rounded-md"
          value={amount}
          error={errors.amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setErrors((current) => ({ ...current, amount: undefined }));
          }}
        />
        <Input
          label="Location"
          wrapperClassName="!gap-1"
          className="rounded-md"
          value={location}
          error={errors.location}
          onChange={(e) => {
            setLocation(e.target.value);
            setErrors((current) => ({ ...current, location: undefined }));
          }}
          placeholder="Wallet, Hydro, Ledger..."
        />
        <Input label="Chain Optional" wrapperClassName="!gap-1" className="rounded-md" value={chain} onChange={(e) => setChain(e.target.value)} placeholder="Ethereum, Base, Ink..." />

        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wider text-brutal-black">Holding Type</p>
          <div className="relative grid w-full grid-cols-3 rounded-full bg-[#1B1B1B] p-1">
            <span
              className="pointer-events-none absolute inset-y-1 left-1 rounded-full transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform"
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
                className={`relative z-10 flex items-center justify-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-black uppercase leading-none tracking-wider transition-colors duration-200 ${holdingType === type.value ? 'text-[#1A1A1A]' : 'text-[#F5F0E8]/45 hover:text-[#F5F0E8]/75'}`}
                onClick={() => setHoldingType(type.value)}
              >
                {type.icon}
                {type.label}
              </button>
            ))}
          </div>
        </div>
        <Textarea label="Note Optional" wrapperClassName="!gap-1" className="rounded-md" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          fullWidth
          loading={saving}
          className="!font-black"
          style={{ backgroundColor: colorTheme, borderColor: '#2A2A2A', color: '#1A1A1A' }}
          onClick={async () => {
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
          }}
        >
          {lockedTicker ? 'ADD HOLDING' : 'ADD'}
        </Button>
      </div>
    </BottomSheet>
  );
};

export { AddAssetSheet };
