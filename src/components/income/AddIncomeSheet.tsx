import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, CalendarDays, Loader2, RefreshCw } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { ConfirmModal } from '../ui/ConfirmModal';
import { TokenPriceInput } from './TokenPriceInput';
import { IncomeSourceInput } from './IncomeSourceInput';
import { useUIStore } from '../../store/useAppStore';
import { useIncomeStore } from '../../store/useIncomeStore';
import { usePortfolioStore } from '../../store/usePortfolioStore';
import { getExchangeRate } from '../../lib/exchangeRate';
import { todayISO } from '../../lib/utils';
import { fetchGeckoTerminalToken } from '../../lib/geckoterminal';
import { fetchCurrentAssetPrices } from '../../lib/portfolio-prices';
import type { IncomeAssetType, IncomeEntry, PortfolioPocket } from '../../types';

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

const SlimInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => <input ref={ref} {...props} className={`slim-input ${props.className ?? ''}`} />);
SlimInput.displayName = 'SlimInput';

const SOURCE_TYPE_ICONS: Record<string, string> = {
  CEX: '🏦',
  WEB3: '🌐',
  WALLET: '👛',
  LAINNYA: '📁',
};

const PocketPickerInput: React.FC<{
  pockets: PortfolioPocket[];
  value: string;
  onChange: (id: string) => void;
}> = ({ pockets, value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const selected = pockets.find((p) => p.id === value) ?? null;
  const icon = selected ? (SOURCE_TYPE_ICONS[selected.source_type] ?? '📁') : null;

  return (
    <div ref={containerRef} className="relative w-full">
      <p className="text-[11px] font-medium text-white/40 mb-1.5">Link to Pocket</p>

      {/* Trigger */}
      <button type="button" className="slim-input w-full flex items-center justify-between text-left" onClick={() => setIsOpen((o) => !o)}>
        <span className={selected ? 'text-white/90 flex items-center gap-2' : 'text-white/25'}>
          {selected ? (
            <>
              <span className="text-base">{icon}</span>
              <span className="font-medium">{selected.name}</span>
              <span className="text-[11px] text-white/30">{selected.source_type}</span>
            </>
          ) : (
            'None'
          )}
        </span>
        <svg className={`w-3.5 h-3.5 text-white/25 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute left-0 right-0 mt-1.5 z-50 rounded-xl bg-[#1c1c1c] border border-white/[0.08] shadow-2xl shadow-black/60 max-h-48 overflow-y-auto">
          {/* None option */}
          <button
            type="button"
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors border-b border-white/[0.04] ${!value ? 'text-white/60 bg-white/[0.04]' : 'text-white/35 hover:bg-white/[0.04]'}`}
            onClick={() => {
              onChange('');
              setIsOpen(false);
            }}
          >
            <span className="w-5 text-center text-base">—</span>
            <span className="font-medium">None</span>
          </button>
          {pockets.map((p) => {
            const isActive = value === p.id;
            const pIcon = SOURCE_TYPE_ICONS[p.source_type] ?? '📁';
            return (
              <button
                key={p.id}
                type="button"
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors border-b border-white/[0.04] last:border-b-0 ${
                  isActive ? 'bg-white/10 text-white font-semibold' : 'text-white/75 hover:bg-white/[0.05] hover:text-white/95'
                }`}
                onClick={() => {
                  onChange(p.id);
                  setIsOpen(false);
                }}
              >
                <span className="w-5 text-center text-base shrink-0">{pIcon}</span>
                <span className="font-medium flex-1 truncate">{p.name}</span>
                <span className={`text-[10px] shrink-0 ${isActive ? 'text-white/50' : 'text-white/25'}`}>{p.source_type}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

function haptic() {
  if ('vibrate' in navigator) navigator.vibrate(10);
}

const formatPriceForInput = (num: number): string => {
  if (num <= 0) return '';
  const str = num.toString();
  if (str.includes('e')) {
    return num.toFixed(10).replace(/\.?0+$/, '');
  }
  return str;
};

export const AddIncomeSheet: React.FC = () => {
  const { isAddIncomeSheetOpen, activeIncomeId, closeAddIncomeSheet } = useUIStore();
  const { incomes, addIncome, updateIncome } = useIncomeStore();
  const { pockets } = usePortfolioStore();

  const editingIncome = activeIncomeId ? (incomes.find((i) => i.id === activeIncomeId) ?? null) : null;
  const isEditMode = editingIncome !== null;

  // ── Form States ───────────────────────────────────────────
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [assetType, setAssetType] = useState<IncomeAssetType>('FIAT');

  // Fiat specific states
  const [fiatAmount, setFiatAmount] = useState('');
  const [fiatCurrency, setFiatCurrency] = useState<'IDR' | 'USD'>('IDR');

  // Crypto received specific states
  const [ticker, setTicker] = useState('');
  const [amount, setAmount] = useState('');
  const [coingeckoId, setCoingeckoId] = useState('');
  const [priceUsd, setPriceUsd] = useState(0);
  const [isManualPrice, setIsManualPrice] = useState(false);

  // Cost basis states
  const [costAmount, setCostAmount] = useState('');
  const [costTicker, setCostTicker] = useState('');
  const [costCoingeckoId, setCostCoingeckoId] = useState('');
  const [costPriceUsd, setCostPriceUsd] = useState(0);
  const [costIsManualPrice, setCostIsManualPrice] = useState(false);
  const [showManualMetadata, setShowManualMetadata] = useState(false);

  // Metadata states
  const [chain, setChain] = useState('');
  const [platform, setPlatform] = useState('');
  const [pocketId, setPocketId] = useState('');
  const [contractAddress, setContractAddress] = useState('');
  const [mcapAtTime, setMcapAtTime] = useState('');
  const [costMcap, setCostMcap] = useState('');
  const [tokenTicker, setTokenTicker] = useState('');
  const [tokenPriceEntry, setTokenPriceEntry] = useState('');
  const [tokenPriceExit, setTokenPriceExit] = useState('');
  const [resolvingCA, setResolvingCA] = useState(false);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');

  // UI state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(16000);

  const dateInputRef = useRef<HTMLInputElement>(null);
  const initializedOpenRef = useRef(false);

  // Fetch exchange rate on open
  useEffect(() => {
    if (isAddIncomeSheetOpen) {
      getExchangeRate().then((res) => {
        setExchangeRate(res.rate);
      });
    }
  }, [isAddIncomeSheetOpen]);

  // Load editing / default data
  useEffect(() => {
    if (!isAddIncomeSheetOpen) {
      initializedOpenRef.current = false;
      return;
    }
    if (initializedOpenRef.current) return;
    initializedOpenRef.current = true;

    if (editingIncome) {
      setTitle(editingIncome.title);
      setSourceType(editingIncome.source_type);
      setAssetType(editingIncome.asset_type);

      if (editingIncome.asset_type === 'FIAT') {
        setFiatAmount(editingIncome.amount.toString());
        setFiatCurrency(editingIncome.currency);
        // Reset crypto
        setTicker('');
        setAmount('');
        setCoingeckoId('');
        setPriceUsd(0);
        setIsManualPrice(false);
      } else {
        setFiatAmount('');
        setFiatCurrency('IDR');
        setTicker(editingIncome.ticker ?? '');
        setAmount(editingIncome.amount.toString());
        setCoingeckoId(editingIncome.coingecko_id ?? '');
        setPriceUsd(editingIncome.price_at_time ?? 0);
        setIsManualPrice(editingIncome.is_manual_price ?? false);
      }

      setCostAmount(editingIncome.cost_amount?.toString() ?? '');
      setCostTicker(editingIncome.cost_ticker ?? '');
      setCostCoingeckoId(editingIncome.cost_coingecko_id ?? '');
      setCostPriceUsd(editingIncome.cost_price_per_unit ?? 0);
      setCostIsManualPrice(editingIncome.cost_is_manual_price ?? false);
      setShowManualMetadata(!!editingIncome.token_ticker || !!editingIncome.token_price_entry || !!editingIncome.token_price_exit || !!editingIncome.cost_mcap || !!editingIncome.mcap_at_time);

      setChain(editingIncome.chain ?? '');
      setPlatform(editingIncome.platform ?? '');
      setPocketId(editingIncome.pocket_id ?? '');
      setContractAddress(editingIncome.contract_address ?? '');
      setMcapAtTime(editingIncome.mcap_at_time?.toString() ?? '');
      setCostMcap(editingIncome.cost_mcap?.toString() ?? '');
      setTokenTicker(editingIncome.token_ticker ?? '');
      setTokenPriceEntry(editingIncome.token_price_entry?.toString() ?? '');
      setTokenPriceExit(editingIncome.token_price_exit?.toString() ?? '');
      setDate(editingIncome.date);
      setNote(editingIncome.note ?? '');
    } else {
      // Defaults
      setTitle('');
      setSourceType('');
      setAssetType('FIAT');
      setFiatAmount('');
      setFiatCurrency('IDR');
      setTicker('');
      setAmount('');
      setCoingeckoId('');
      setPriceUsd(0);
      setIsManualPrice(false);
      setShowManualMetadata(false);
      setCostAmount('');
      setCostTicker('');
      setCostCoingeckoId('');
      setCostPriceUsd(0);
      setCostIsManualPrice(false);
      setChain('');
      setPlatform('');
      setPocketId('');
      setContractAddress('');
      setMcapAtTime('');
      setCostMcap('');
      setTokenTicker('');
      setTokenPriceEntry('');
      setTokenPriceExit('');
      setDate(todayISO());
      setNote('');
    }
  }, [isAddIncomeSheetOpen, editingIncome]);



  const handleAssetTypeChange = (type: IncomeAssetType) => {
    haptic();
    setAssetType(type);
  };

  const handleFiatCurrencyChange = (curr: 'IDR' | 'USD') => {
    haptic();
    setFiatCurrency(curr);
  };
  const openDatePicker = useCallback(() => {
    const input = dateInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    if ('showPicker' in input && typeof (input as HTMLInputElement & { showPicker: () => void }).showPicker === 'function') {
      (input as HTMLInputElement & { showPicker: () => void }).showPicker();
      return;
    }
    input.click();
  }, []);
  const handleResolveCA = async () => {
    if (!contractAddress.trim()) return;
    haptic();
    setResolvingCA(true);
    try {
      const result = await fetchGeckoTerminalToken(contractAddress, chain);
      if (result) {
        setTokenTicker(result.symbol);
        setTokenPriceExit(formatPriceForInput(result.priceUsd));
        if (result.mcapUsd) {
          setMcapAtTime(result.mcapUsd.toString());
        }
        if (result.networkId) {
          const formattedNetwork = result.networkId.toUpperCase();
          setChain(formattedNetwork);
          // Default capital tickers to native asset of resolved chain
          const nativeTicker = ['SOLANA'].includes(formattedNetwork) ? 'SOL' : 'ETH';
          if (!ticker) setTicker(nativeTicker);
          if (!costTicker) setCostTicker(nativeTicker);
        }
        if (!title.trim() && result.name) {
          setTitle(`Trade ${result.name}`);
        }
      } else {
        alert('Could not resolve token details from contract address. You can still input details manually.');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setResolvingCA(false);
    }
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (!title.trim()) next.title = 'Description is required';
    if (!sourceType.trim()) next.source_type = 'Source is required';

    if (assetType === 'FIAT') {
      const parsedAmount = parseFloat(fiatAmount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        next.fiatAmount = 'Amount must be greater than 0';
      }
    } else {
      if (!ticker.trim()) next.ticker = 'Token ticker is required';
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        next.amount = 'Amount must be greater than 0';
      }

      const isCostBasisFilled = costAmount.trim() !== '' || costTicker.trim() !== '';
      if (isCostBasisFilled) {
        if (!costTicker.trim()) next.costTicker = 'Cost token is required';
        if (costAmount.trim() !== '') {
          const parsedCostAmount = parseFloat(costAmount);
          if (isNaN(parsedCostAmount) || parsedCostAmount <= 0) {
            next.costAmount = 'Cost amount must be greater than 0';
          }
        }
      }
    }

    if (!date) next.date = 'Date is required';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);

    try {
      let finalAmount = 0;
      let finalTicker: string | undefined;
      let finalCoingeckoId: string | undefined;
      let finalCurrency: 'IDR' | 'USD' = 'USD';
      let finalPriceAtTime: number | undefined;
      let finalIsManualPrice = false;
      let finalValueUsd = 0;
      let finalValueIdr = 0;

      if (assetType === 'FIAT') {
        finalAmount = parseFloat(fiatAmount);
        finalCurrency = fiatCurrency;
        if (fiatCurrency === 'USD') {
          finalValueUsd = finalAmount;
          finalValueIdr = Math.round(finalAmount * exchangeRate);
        } else {
          finalValueIdr = finalAmount;
          finalValueUsd = parseFloat((finalAmount / exchangeRate).toFixed(2));
        }
      } else {
        finalAmount = parseFloat(amount);
        finalTicker = ticker.trim().toUpperCase();
        finalCoingeckoId = coingeckoId || undefined;
        finalCurrency = 'USD'; // Crypto is valued in USD

        let resolvedExitPrice = priceUsd;
        if (resolvedExitPrice <= 0) {
          if (contractAddress.trim()) {
            const resolved = await fetchGeckoTerminalToken(contractAddress, chain);
            if (resolved?.priceUsd) {
              resolvedExitPrice = resolved.priceUsd;
              setPriceUsd(resolved.priceUsd);
              if (resolved.mcapUsd && !mcapAtTime) {
                setMcapAtTime(resolved.mcapUsd.toString());
              }
            }
          } else if (finalCoingeckoId) {
            const prices = await fetchCurrentAssetPrices([{ ticker: finalTicker, coingecko_id: finalCoingeckoId }]);
            if (prices[finalCoingeckoId]?.usd) {
              resolvedExitPrice = prices[finalCoingeckoId].usd;
              setPriceUsd(resolvedExitPrice);
            }
          }
        }

        finalPriceAtTime = resolvedExitPrice;
        finalIsManualPrice = isManualPrice;
        finalValueUsd = parseFloat((finalAmount * resolvedExitPrice).toFixed(2));
        finalValueIdr = Math.round(finalValueUsd * exchangeRate);
      }

      const finalHasCostBasis = assetType === 'CRYPTO' && costAmount.trim() !== '' && !isNaN(parseFloat(costAmount)) && parseFloat(costAmount) > 0;

      // Cost Basis calculations
      let finalCostAmount: number | undefined;
      let finalCostTicker: string | undefined;
      let finalCostCoingeckoId: string | undefined;
      let finalCostPricePerUnit: number | undefined;
      let finalCostIsManualPrice = false;
      let finalCostValueUsd: number | undefined;
      let finalCostValueIdr: number | undefined;

      if (finalHasCostBasis) {
        finalCostAmount = parseFloat(costAmount);
        finalCostTicker = costTicker.trim().toUpperCase();
        finalCostCoingeckoId = costCoingeckoId || undefined;
        finalCostIsManualPrice = costIsManualPrice;

        let resolvedEntryPrice = costPriceUsd;
        if (resolvedEntryPrice <= 0 && finalCostCoingeckoId) {
          const prices = await fetchCurrentAssetPrices([{ ticker: finalCostTicker, coingecko_id: finalCostCoingeckoId }]);
          if (prices[finalCostCoingeckoId]?.usd) {
            resolvedEntryPrice = prices[finalCostCoingeckoId].usd;
            setCostPriceUsd(resolvedEntryPrice);
          }
        }

        finalCostPricePerUnit = resolvedEntryPrice;
        finalCostValueUsd = parseFloat((finalCostAmount * resolvedEntryPrice).toFixed(2));
        finalCostValueIdr = Math.round(finalCostValueUsd * exchangeRate);
      }

      const payload: Omit<IncomeEntry, 'id' | 'created_at' | 'synced'> = {
        title: title.trim(),
        source_type: sourceType.trim(),
        asset_type: assetType,
        amount: finalAmount,
        ticker: finalTicker,
        coingecko_id: finalCoingeckoId,
        currency: finalCurrency,
        price_at_time: finalPriceAtTime,
        is_manual_price: finalIsManualPrice,
        value_usd: finalValueUsd,
        value_idr: finalValueIdr,
        has_cost_basis: finalHasCostBasis,
        cost_amount: finalCostAmount,
        cost_ticker: finalCostTicker,
        cost_coingecko_id: finalCostCoingeckoId,
        cost_price_per_unit: finalCostPricePerUnit,
        cost_is_manual_price: finalCostIsManualPrice,
        cost_value_usd: finalCostValueUsd,
        cost_value_idr: finalCostValueIdr,
        chain: assetType === 'CRYPTO' && chain.trim() ? chain.trim() : undefined,
        platform: platform.trim() ? platform.trim() : undefined,
        pocket_id: pocketId || undefined,
        contract_address: assetType === 'CRYPTO' && contractAddress.trim() ? contractAddress.trim() : undefined,
        mcap_at_time: assetType === 'CRYPTO' && mcapAtTime.trim() ? parseFloat(mcapAtTime) : undefined,
        cost_mcap: assetType === 'CRYPTO' && finalHasCostBasis && costMcap.trim() ? parseFloat(costMcap) : undefined,
        token_ticker: assetType === 'CRYPTO' && tokenTicker.trim() ? tokenTicker.trim().toUpperCase() : undefined,
        token_price_entry: assetType === 'CRYPTO' && tokenPriceEntry.trim() ? parseFloat(tokenPriceEntry) : undefined,
        token_price_exit: assetType === 'CRYPTO' && tokenPriceExit.trim() ? parseFloat(tokenPriceExit) : undefined,
        date,
        note: note.trim() || undefined,
      };

      if (isEditMode && editingIncome) {
        await updateIncome(editingIncome.id, payload);
      } else {
        await addIncome(payload);
      }

      haptic();
      setErrors({});
      closeAddIncomeSheet();
    } catch (err) {
      setErrors({ root: err instanceof Error ? err.message : 'Failed to save income' });
    } finally {
      setSaving(false);
    }
  };

  const formattedDate = date
    ? new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(`${date}T00:00:00`))
    : '';

  const isDirty = React.useMemo(() => {
    const baseTitle = editingIncome?.title ?? '';
    const baseSourceType = editingIncome?.source_type ?? '';
    const baseAssetType = editingIncome?.asset_type ?? 'FIAT';
    const baseFiatAmount = editingIncome?.asset_type === 'FIAT' ? editingIncome.amount.toString() : '';
    const baseFiatCurrency = editingIncome?.asset_type === 'FIAT' ? editingIncome.currency : 'IDR';
    const baseTicker = editingIncome?.asset_type === 'CRYPTO' ? (editingIncome.ticker ?? '') : '';
    const baseAmount = editingIncome?.asset_type === 'CRYPTO' ? editingIncome.amount.toString() : '';
    const baseCoingeckoId = editingIncome?.asset_type === 'CRYPTO' ? (editingIncome.coingecko_id ?? '') : '';
    const basePriceUsd = editingIncome?.asset_type === 'CRYPTO' ? (editingIncome.price_at_time ?? 0) : 0;
    const baseIsManualPrice = editingIncome?.asset_type === 'CRYPTO' ? (editingIncome.is_manual_price ?? false) : false;

    const baseCostAmount = editingIncome?.cost_amount?.toString() ?? '';
    const baseCostTicker = editingIncome?.cost_ticker ?? '';
    const baseCostCoingeckoId = editingIncome?.cost_coingecko_id ?? '';
    const baseCostPriceUsd = editingIncome?.cost_price_per_unit ?? 0;
    const baseCostIsManualPrice = editingIncome?.cost_is_manual_price ?? false;

    const baseChain = editingIncome?.chain ?? '';
    const basePlatform = editingIncome?.platform ?? '';
    const basePocketId = editingIncome?.pocket_id ?? '';
    const baseContractAddress = editingIncome?.contract_address ?? '';
    const baseMcapAtTime = editingIncome?.mcap_at_time?.toString() ?? '';
    const baseCostMcap = editingIncome?.cost_mcap?.toString() ?? '';
    const baseTokenTicker = editingIncome?.token_ticker ?? '';
    const baseTokenPriceEntry = editingIncome?.token_price_entry?.toString() ?? '';
    const baseTokenPriceExit = editingIncome?.token_price_exit?.toString() ?? '';
    const baseDate = editingIncome?.date ?? todayISO();
    const baseNote = editingIncome?.note ?? '';

    return (
      title !== baseTitle ||
      sourceType !== baseSourceType ||
      assetType !== baseAssetType ||
      fiatAmount !== baseFiatAmount ||
      fiatCurrency !== baseFiatCurrency ||
      ticker !== baseTicker ||
      amount !== baseAmount ||
      coingeckoId !== baseCoingeckoId ||
      priceUsd !== basePriceUsd ||
      isManualPrice !== baseIsManualPrice ||
      costAmount !== baseCostAmount ||
      costTicker !== baseCostTicker ||
      costCoingeckoId !== baseCostCoingeckoId ||
      costPriceUsd !== baseCostPriceUsd ||
      costIsManualPrice !== baseCostIsManualPrice ||
      chain !== baseChain ||
      platform !== basePlatform ||
      pocketId !== basePocketId ||
      contractAddress !== baseContractAddress ||
      mcapAtTime !== baseMcapAtTime ||
      costMcap !== baseCostMcap ||
      tokenTicker !== baseTokenTicker ||
      tokenPriceEntry !== baseTokenPriceEntry ||
      tokenPriceExit !== baseTokenPriceExit ||
      date !== baseDate ||
      note !== baseNote
    );
  }, [
    editingIncome,
    title,
    sourceType,
    assetType,
    fiatAmount,
    fiatCurrency,
    ticker,
    amount,
    coingeckoId,
    priceUsd,
    isManualPrice,
    costAmount,
    costTicker,
    costCoingeckoId,
    costPriceUsd,
    costIsManualPrice,
    chain,
    platform,
    pocketId,
    contractAddress,
    mcapAtTime,
    costMcap,
    tokenTicker,
    tokenPriceEntry,
    tokenPriceExit,
    date,
    note
  ]);

  const handleClose = useCallback(() => {
    if (isDirty) {
      setShowConfirmClose(true);
    } else {
      setErrors({});
      closeAddIncomeSheet();
    }
  }, [isDirty, closeAddIncomeSheet]);

  return (
    <BottomSheet
      isOpen={isAddIncomeSheetOpen}
      onClose={handleClose}
      hasUnsavedChanges={isDirty}
      containPageOverscroll
      title={isEditMode ? 'Edit Income' : 'Add Income'}
      footer={
        <div className="flex gap-3 w-full">
          <button
            type="button"
            disabled={saving}
            onClick={handleClose}
            className="flex-1 h-11 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] text-white/70 text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={() => void handleSave()} className="flex-1 h-11 rounded-xl bg-[#a8a8ad] text-black hover:bg-[#a8a8ad]/90 text-sm font-semibold transition-all disabled:opacity-50 active:scale-[0.98]">
            {saving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Save Income'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5 pb-2">
        {errors.root && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            <AlertCircle size={14} strokeWidth={2} />
            {errors.root}
          </div>
        )}

        {/* Description */}
        <FieldGroup label="Description" error={errors.title}>
          <SlimInput
            value={title}
            placeholder="Salary or side income..."
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors((c) => ({ ...c, title: '' }));
            }}
          />
        </FieldGroup>

        {/* Source */}
        <IncomeSourceInput
          value={sourceType}
          onChange={(val) => {
            setSourceType(val);
            setErrors((c) => ({ ...c, source_type: '' }));
          }}
          error={errors.source_type}
        />

        {/* Asset Type Toggle */}
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-white/[0.05]">
          <button
            type="button"
            className={`py-2 text-xs font-medium rounded-lg transition-all ${assetType === 'FIAT' ? 'bg-[#a8a8ad] text-black shadow-sm' : 'text-white/40 hover:text-white/70'}`}
            onClick={() => handleAssetTypeChange('FIAT')}
          >
            Fiat Cash
          </button>
          <button
            type="button"
            className={`py-2 text-xs font-medium rounded-lg transition-all ${assetType === 'CRYPTO' ? 'bg-[#a8a8ad] text-black shadow-sm' : 'text-white/40 hover:text-white/70'}`}
            onClick={() => handleAssetTypeChange('CRYPTO')}
          >
            Crypto Asset
          </button>
        </div>

        {/* ── Fiat Fields ── */}
        {assetType === 'FIAT' && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <FieldGroup label="Amount" error={errors.fiatAmount}>
                  <SlimInput
                    type="number"
                    value={fiatAmount}
                    placeholder="0.00"
                    onChange={(e) => {
                      setFiatAmount(e.target.value);
                      setErrors((c) => ({ ...c, fiatAmount: '' }));
                    }}
                  />
                </FieldGroup>
              </div>
              <div>
                <p className="text-[11px] font-medium text-white/40 mb-1.5">Currency</p>
                <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-white/[0.05] h-9 items-center">
                  <button type="button" className={`h-full text-[11px] font-medium rounded-md transition-all ${fiatCurrency === 'IDR' ? 'bg-white/15 text-white' : 'text-white/35'}`} onClick={() => handleFiatCurrencyChange('IDR')}>
                    IDR
                  </button>
                  <button type="button" className={`h-full text-[11px] font-medium rounded-md transition-all ${fiatCurrency === 'USD' ? 'bg-white/15 text-white' : 'text-white/35'}`} onClick={() => handleFiatCurrencyChange('USD')}>
                    USD
                  </button>
                </div>
              </div>
            </div>
            {parseFloat(fiatAmount) > 0 && (
              <p className="text-[11px] text-white/30 text-right">
                {fiatCurrency === 'IDR'
                  ? `≈ $${(parseFloat(fiatAmount) / exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : `≈ Rp ${Math.round(parseFloat(fiatAmount) * exchangeRate).toLocaleString('id-ID')}`}
              </p>
            )}
          </div>
        )}

        {/* ── Crypto Fields ── */}
        {assetType === 'CRYPTO' && (
          <div className="space-y-3">
            {/* Traded Token Metadata */}
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-2.5">
              <p className="text-[10px] font-medium text-white/35 uppercase tracking-widest">
                Token Metadata <span className="normal-case text-white/20">(optional)</span>
              </p>

              {/* Contract Address */}
              <div className="flex gap-2 items-center">
                <input type="text" value={contractAddress} onChange={(e) => setContractAddress(e.target.value)} placeholder="Contract address (0x245a30...)" className="slim-input flex-1 min-w-0" />
                <button
                  type="button"
                  disabled={resolvingCA || !contractAddress.trim()}
                  onClick={handleResolveCA}
                  className="h-9 px-3 rounded-lg bg-[#a8a8ad]/90 text-black text-xs font-medium flex items-center gap-1.5 transition-opacity disabled:opacity-40 disabled:pointer-events-none shrink-0 hover:bg-[#a8a8ad]"
                >
                  {resolvingCA ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Resolve
                </button>
              </div>

              {/* Manual metadata toggle */}
              {!contractAddress.trim() && !showManualMetadata && (
                <button type="button" onClick={() => setShowManualMetadata(true)} className="text-[11px] text-white/60 hover:text-white/90 transition-colors">
                  + Input manually
                </button>
              )}

              {/* Metadata fields */}
              {(contractAddress.trim() !== '' || showManualMetadata) && (
                <div className="space-y-2.5 pt-2 border-t border-white/[0.05]">
                  <div className="grid grid-cols-3 gap-2">
                    <SlimInput value={tokenTicker} placeholder="Ticker" onChange={(e) => setTokenTicker(e.target.value)} />
                    <SlimInput type="number" step="any" value={tokenPriceEntry} placeholder="Entry $" onChange={(e) => setTokenPriceEntry(e.target.value)} />
                    <SlimInput type="number" step="any" value={tokenPriceExit} placeholder="Exit $" onChange={(e) => setTokenPriceExit(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <SlimInput type="number" value={costMcap} placeholder="Entry MCap $" onChange={(e) => setCostMcap(e.target.value)} />
                    <SlimInput type="number" value={mcapAtTime} placeholder="Exit MCap $" onChange={(e) => setMcapAtTime(e.target.value)} />
                  </div>
                  {!contractAddress.trim() && showManualMetadata && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowManualMetadata(false);
                        setTokenTicker('');
                        setTokenPriceEntry('');
                        setTokenPriceExit('');
                        setCostMcap('');
                        setMcapAtTime('');
                      }}
                      className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      Hide metadata
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Capital Flow */}
            <div className="space-y-2.5">
              <p className="text-[10px] font-medium text-white/35 uppercase tracking-widest">Capital Flow</p>
              <TokenPriceInput
                label="Exit / Received Asset"
                ticker={ticker}
                onChangeTicker={(val) => {
                  setTicker(val);
                  setErrors((c) => ({ ...c, ticker: '' }));
                }}
                amount={amount}
                onChangeAmount={(val) => {
                  setAmount(val);
                  setErrors((c) => ({ ...c, amount: '' }));
                }}
                coingeckoId={coingeckoId}
                onChangeCoingeckoId={setCoingeckoId}
                priceUsd={priceUsd}
                onChangePriceUsd={setPriceUsd}
                isManualPrice={isManualPrice}
                onChangeIsManualPrice={setIsManualPrice}
                error={errors.ticker}
                amountError={errors.amount}
              />
              <TokenPriceInput
                label="Entry / Cost Basis"
                ticker={costTicker}
                onChangeTicker={(val) => {
                  setCostTicker(val);
                  setErrors((c) => ({ ...c, costTicker: '' }));
                  if (!ticker) setTicker(val);
                }}
                amount={costAmount}
                onChangeAmount={(val) => {
                  setCostAmount(val);
                  setErrors((c) => ({ ...c, costAmount: '' }));
                }}
                coingeckoId={costCoingeckoId}
                onChangeCoingeckoId={setCostCoingeckoId}
                priceUsd={costPriceUsd}
                onChangePriceUsd={setCostPriceUsd}
                isManualPrice={costIsManualPrice}
                onChangeIsManualPrice={setCostIsManualPrice}
                error={errors.costTicker}
                amountError={errors.costAmount}
              />
            </div>

            {/* Chain / Platform */}
            <div className="grid grid-cols-2 gap-2">
              <FieldGroup label="Chain">
                <SlimInput value={chain} placeholder="Network..." onChange={(e) => setChain(e.target.value)} />
              </FieldGroup>
              <FieldGroup label="Platform">
                <SlimInput value={platform} placeholder="Uniswap" onChange={(e) => setPlatform(e.target.value)} />
              </FieldGroup>
            </div>
          </div>
        )}

        {/* Pocket Link */}
        {pockets.length > 0 && <PocketPickerInput pockets={pockets} value={pocketId} onChange={setPocketId} />}

        {/* Date */}
        <FieldGroup label="Date" error={errors.date}>
          <div className="relative">
            <button
              type="button"
              onClick={openDatePicker}
              className="slim-input flex items-center justify-between text-left w-full"
            >
              <span className={formattedDate ? 'text-white/90' : 'text-white/30'}>{formattedDate || 'Select date'}</span>
              <CalendarDays size={15} className="text-white/30 shrink-0" />
            </button>
            <input
              ref={dateInputRef}
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setErrors((c) => ({ ...c, date: '' }));
              }}
              className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
              required
            />
          </div>
        </FieldGroup>

        {/* Note */}
        <FieldGroup label="Note">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional notes..." className="slim-input resize-none h-16 min-h-16" />
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
          setErrors({});
          closeAddIncomeSheet();
        }}
        onCancel={() => {
          setShowConfirmClose(false);
        }}
      />
    </BottomSheet>
  );
};
