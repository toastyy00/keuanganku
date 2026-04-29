import React, { useState } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface AddAssetSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (ticker: string, amount: number, note?: string) => Promise<void>;
}

const SUGGESTIONS = ['BTC', 'ETH', 'SOL', 'JUP', 'PYTH', 'WEN', 'TNSR'];

const AddAssetSheet: React.FC<AddAssetSheetProps> = ({ isOpen, onClose, onAdd }) => {
  const [ticker, setTicker] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="ADD ASSET">
      <div className="space-y-4">
        <Input
          label="Ticker"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
        />
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((item) => (
            <button key={item} type="button" className="neo-btn-secondary px-2 py-1 text-xs" onClick={() => setTicker(item)}>
              {item}
            </button>
          ))}
        </div>
        <Input label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          fullWidth
          loading={saving}
          onClick={async () => {
            const parsed = Number(amount);
            if (!ticker.trim() || !Number.isFinite(parsed) || parsed <= 0) return;
            setSaving(true);
            try {
              await onAdd(ticker.trim(), parsed, note.trim() || undefined);
              setTicker('');
              setAmount('');
              setNote('');
              onClose();
            } finally {
              setSaving(false);
            }
          }}
        >
          ADD
        </Button>
      </div>
    </BottomSheet>
  );
};

export { AddAssetSheet };
