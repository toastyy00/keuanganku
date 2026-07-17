import React, { useState, useEffect } from 'react';
import { IconCircleCheck, IconCoins, IconLoader2, IconSearch } from '@tabler/icons-react';
import {
  fetchCurrentAssetPrices,
  resolveCoingeckoId,
  searchCoinGeckoTickerOptions
} from '../../lib/portfolio-prices';
import type { CoinGeckoTickerOption } from '../../lib/portfolio-prices';

interface TokenPriceInputProps {
  label: string;
  ticker: string;
  onChangeTicker: (val: string) => void;
  amount: string;
  onChangeAmount: (val: string) => void;
  coingeckoId: string;
  onChangeCoingeckoId: (val: string) => void;
  priceUsd: number;
  onChangePriceUsd: (val: number) => void;
  isManualPrice: boolean;
  onChangeIsManualPrice: (val: boolean) => void;
  error?: string;
  amountError?: string;
}

export const TokenPriceInput: React.FC<TokenPriceInputProps> = ({
  label,
  ticker,
  onChangeTicker,
  amount,
  onChangeAmount,
  coingeckoId,
  onChangeCoingeckoId,
  priceUsd,
  onChangePriceUsd,
  isManualPrice,
  onChangeIsManualPrice,
  error,
  amountError,
}) => {
  const [resolvingPrice, setResolvingPrice] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [coinOptions, setCoinOptions] = useState<CoinGeckoTickerOption[]>([]);
  const [searchMessage, setSearchMessage] = useState('');

  const normalizedTicker = ticker.trim().toUpperCase();

  const autoResolvePrice = async (t: string) => {
    const norm = t.trim().toUpperCase();
    if (!norm) return;
    setResolvingPrice(true);
    try {
      const resolvedId = resolveCoingeckoId(norm);
      onChangeCoingeckoId(resolvedId);
      const prices = await fetchCurrentAssetPrices([{ ticker: norm, coingecko_id: resolvedId }]);
      if (prices && prices[resolvedId] && typeof prices[resolvedId].usd === 'number') {
        onChangePriceUsd(prices[resolvedId].usd);
        onChangeIsManualPrice(false);
      } else {
        onChangePriceUsd(0);
        onChangeIsManualPrice(true);
      }
    } catch {
      onChangePriceUsd(0);
      onChangeIsManualPrice(true);
    } finally {
      setResolvingPrice(false);
    }
  };

  const lastResolvedTickerRef = React.useRef('');

  React.useEffect(() => {
    if (priceUsd > 0 && ticker) {
      lastResolvedTickerRef.current = ticker.trim().toUpperCase();
    }
  }, [priceUsd, ticker]);

  useEffect(() => {
    const norm = ticker.trim().toUpperCase();
    if (norm.length >= 2 && (priceUsd === 0 || norm !== lastResolvedTickerRef.current)) {
      const resolvedId = resolveCoingeckoId(norm);
      if (resolvedId) {
        lastResolvedTickerRef.current = norm;
        const fetchPrice = async () => {
          try {
            const prices = await fetchCurrentAssetPrices([{ ticker: norm, coingecko_id: resolvedId }]);
            if (prices && prices[resolvedId] && typeof prices[resolvedId].usd === 'number') {
              onChangePriceUsd(prices[resolvedId].usd);
              onChangeCoingeckoId(resolvedId);
              onChangeIsManualPrice(false);
            }
          } catch (e) {
            console.error(e);
          }
        };
        void fetchPrice();
      }
    }
  }, [ticker, priceUsd, onChangePriceUsd, onChangeCoingeckoId, onChangeIsManualPrice]);

  const runSearch = async () => {
    if (!normalizedTicker) return;
    setResolvingPrice(true);
    setSearchOpen(true);
    setSearchMessage('');
    try {
      const options = await searchCoinGeckoTickerOptions(normalizedTicker);
      setCoinOptions(options);
      if (options.length === 0) {
        setSearchMessage('No matches found. Enter price manually.');
        onChangeIsManualPrice(true);
      }
    } catch {
      setSearchMessage('Search failed. Enter price manually.');
      onChangeIsManualPrice(true);
    } finally {
      setResolvingPrice(false);
    }
  };

  const handleSelectOption = async (option: CoinGeckoTickerOption) => {
    onChangeCoingeckoId(option.id);
    setSearchOpen(false);
    setResolvingPrice(true);
    try {
      const prices = await fetchCurrentAssetPrices([{ ticker: option.symbol, coingecko_id: option.id }]);
      if (prices && prices[option.id] && typeof prices[option.id].usd === 'number') {
        onChangePriceUsd(prices[option.id].usd);
        onChangeIsManualPrice(false);
      } else {
        onChangePriceUsd(0);
        onChangeIsManualPrice(true);
      }
    } catch {
      onChangePriceUsd(0);
      onChangeIsManualPrice(true);
    } finally {
      setResolvingPrice(false);
    }
  };

  const handlePriceChange = (val: string) => {
    const parsed = parseFloat(val);
    onChangePriceUsd(isNaN(parsed) || parsed < 0 ? 0 : parsed);
  };

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-2.5">
      {/* Label row */}
      <p className="text-[10px] font-medium text-white/35 uppercase tracking-widest">{label}</p>

      {/* Ticker + Amount row */}
      <div className="grid grid-cols-3 gap-2">
        {/* Ticker input with search button */}
        <div className="relative flex items-center">
          <input
            type="text"
            value={ticker}
            placeholder="Ticker"
            className={`slim-input pr-8 uppercase ${error ? 'border-red-500/50' : ''}`}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              onChangeTicker(val);
              if (!val) {
                onChangeCoingeckoId('');
                onChangePriceUsd(0);
                onChangeIsManualPrice(false);
                setSearchOpen(false);
              }
            }}
            onBlur={() => {
              if (normalizedTicker && !coingeckoId) {
                void autoResolvePrice(ticker);
              }
            }}
          />
          {normalizedTicker && (
            <button
              type="button"
              className="absolute right-2 text-white/30 hover:text-white/70 transition-colors disabled:opacity-30 flex items-center justify-center"
              aria-label="Search CoinGecko"
              title="Search CoinGecko"
              disabled={resolvingPrice}
              onClick={() => void runSearch()}
            >
              {resolvingPrice ? (
                <IconLoader2 size={12} className="animate-spin" />
              ) : (
                <IconSearch size={12} strokeWidth={2.5} />
              )}
            </button>
          )}
        </div>

        {/* Amount input — wider */}
        <div className="col-span-2">
          <input
            type="number"
            value={amount}
            placeholder="Amount"
            className={`slim-input ${amountError ? 'border-red-500/50' : ''}`}
            onChange={(e) => onChangeAmount(e.target.value)}
          />
        </div>
      </div>

      {/* Inline error hints */}
      {(error || amountError) && (
        <div className="flex gap-2 text-[10px] text-red-400">
          {error && <span>{error}</span>}
          {amountError && <span className="ml-auto">{amountError}</span>}
        </div>
      )}

      {/* CoinGecko search results */}
      {searchOpen && (
        <div className="rounded-xl bg-white/[0.06] border border-white/[0.08] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.05]">
            <p className="text-[10px] text-white/35 uppercase tracking-widest">CoinGecko match</p>
            <button
              type="button"
              className="text-[10px] text-white/35 hover:text-white/70 transition-colors"
              onClick={() => setSearchOpen(false)}
            >
              Cancel
            </button>
          </div>
          {resolvingPrice ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-white/40">
              <IconLoader2 size={11} className="animate-spin" />
              Searching…
            </div>
          ) : coinOptions.length > 0 ? (
            <div className="max-h-36 overflow-y-auto divide-y divide-white/[0.04]">
              {coinOptions.slice(0, 5).map((option) => {
                const isSelected = coingeckoId === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors text-xs ${
                      isSelected
                        ? 'bg-[#B8F55A]/10 text-[#B8F55A]'
                        : 'text-white/80 hover:bg-white/[0.05]'
                    }`}
                    onClick={() => void handleSelectOption(option)}
                  >
                    {option.thumb ? (
                      <img src={option.thumb} alt="" className="h-4 w-4 shrink-0 rounded-full" />
                    ) : (
                      <IconCoins size={14} className="shrink-0 text-white/30" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-semibold uppercase">{option.symbol}</span>
                      <span className="opacity-40 ml-1.5 text-[11px]">{option.name}</span>
                    </span>
                    {isSelected && <IconCircleCheck size={12} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-2.5 text-[11px] text-white/35">{searchMessage}</p>
          )}
        </div>
      )}

      {/* Price + value snapshot */}
      {(isManualPrice || priceUsd > 0) && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <input
              type="number"
              step="any"
              value={priceUsd === 0 ? '' : priceUsd}
              placeholder="Price per token (USD)"
              className="slim-input text-sm"
              onChange={(e) => handlePriceChange(e.target.value)}
            />
          </div>
          <div className="text-right pb-1 shrink-0">
            <span className="text-[10px] text-white/25 block">Value</span>
            <span className="text-xs font-medium text-white/60">
              ${((parseFloat(amount) || 0) * priceUsd).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 6,
              })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
