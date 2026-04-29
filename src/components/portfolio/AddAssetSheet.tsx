import React, { useEffect, useState } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import type { PortfolioAsset } from '../../types';

interface AddAssetSheetProps {
  isOpen: boolean;
  onClose: () => void;
  lockedTicker?: string;
  title?: string;
  onAdd: (input: {
    ticker: string;
    amount: number;
    location: string;
    holding_type: PortfolioAsset['holding_type'];
    chain?: string;
    note?: string;
  }) => Promise<void>;
}

const SUGGESTIONS = ['BTC', 'ETH', 'SOL', 'JUP', 'PYTH', 'WEN', 'TNSR'];

const HOLDING_TYPES: Array<{ value: PortfolioAsset['holding_type']; label: string }> = [
  { value: 'liquid', label: 'Liquid' },
  { value: 'staked', label: 'Staked' },
  { value: 'locked', label: 'Locked' },
];

const AddAssetSheet: React.FC<AddAssetSheetProps> = ({ isOpen, onClose, lockedTicker, title, onAdd }) => {
  const [ticker, setTicker] = useState('');
  const [amount, setAmount] = useState('');
  const [location, setLocation] = useState('');
  const [holdingType, setHoldingType] = useState<PortfolioAsset['holding_type']>('liquid');
  const [chain, setChain] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ ticker?: string; amount?: string; location?: string }>({});
  const activeTicker = lockedTicker ?? ticker;

  useEffect(() => {
    if (isOpen) setErrors({});
  }, [isOpen]);

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={title ?? (lockedTicker ? 'ADD HOLDING' : 'ADD ASSET')}
      containPageOverscroll
    >
      <div className="space-y-4">
        {lockedTicker ? (
          <div className="neo-card flex items-center justify-between px-3 py-2">
            <p className="text-xs font-black uppercase text-brutal-black/50">Ticker Locked</p>
            <p className="text-lg font-black">{lockedTicker}</p>
          </div>
        ) : (
          <>
            <Input
              label="Ticker"
              value={ticker}
              error={errors.ticker}
              onChange={(e) => {
                setTicker(e.target.value.toUpperCase());
                setErrors((current) => ({ ...current, ticker: undefined }));
              }}
            />
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="neo-btn-secondary px-2 py-1 text-xs"
                  onClick={() => {
                    setTicker(item);
                    setErrors((current) => ({ ...current, ticker: undefined }));
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          </>
        )}

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
          placeholder="Wallet, Hydro, Ledger..."
        />
        <Input label="Chain Optional" value={chain} onChange={(e) => setChain(e.target.value)} placeholder="Ethereum, Base, Ink..." />

        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-brutal-black">Holding Type</p>
          <div className="grid grid-cols-3 gap-2">
            {HOLDING_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                className={`neo-btn-secondary px-2 py-2 !text-xs !font-black leading-tight ${holdingType === type.value ? '!bg-[#B8F55A] !text-[#1A1A1A]' : '!text-[#F5F0E8]'}`}
                onClick={() => setHoldingType(type.value)}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>
        <Textarea label="Note Optional" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          fullWidth
          loading={saving}
          className="!font-black"
          onClick={async () => {
            const parsed = Number(amount);
            const nextErrors = {
              ticker: !activeTicker.trim() ? 'Ticker wajib diisi' : undefined,
              amount: !Number.isFinite(parsed) || parsed <= 0 ? 'Amount harus lebih dari 0' : undefined,
              location: !location.trim() ? 'Location wajib diisi' : undefined,
            };
            setErrors(nextErrors);
            if (nextErrors.ticker || nextErrors.amount || nextErrors.location) return;
            setSaving(true);
            try {
              await onAdd({
                ticker: activeTicker.trim(),
                amount: parsed,
                location: location.trim(),
                holding_type: holdingType,
                chain: chain.trim() || undefined,
                note: note.trim() || undefined,
              });
              setTicker('');
              setAmount('');
              setLocation('');
              setHoldingType('liquid');
              setChain('');
              setNote('');
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
