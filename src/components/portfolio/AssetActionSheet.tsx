import React, { useState } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Input } from '../ui/Input';
import type { PortfolioAsset } from '../../types';

interface AssetActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  asset?: PortfolioAsset | null;
  currentPriceUsd?: number;
  onApply: (assetId: string, newAmount: number, action: 'ADD' | 'REDUCE', note?: string) => Promise<void>;
  onRemove: (assetId: string) => Promise<void>;
}

const AssetActionSheet: React.FC<AssetActionSheetProps> = ({
  isOpen,
  onClose,
  asset,
  currentPriceUsd,
  onApply,
  onRemove,
}) => {
  const [mode, setMode] = useState<'ADD' | 'REDUCE'>('ADD');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!asset) return null;

  return (
    <>
      <BottomSheet isOpen={isOpen && !confirmRemoveOpen} onClose={onClose} title="ASSET ACTION">
        <div className="space-y-4">
          <div className="neo-card p-3">
            <p className="text-sm font-black">{asset.ticker}</p>
            <p className="text-xs font-medium text-brutal-black/60">Current amount: {asset.amount}</p>
            <p className="text-xs font-medium text-brutal-black/60">Current price: ${Number(currentPriceUsd ?? 0).toFixed(4)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={`neo-btn-secondary px-3 py-2 text-xs ${mode === 'ADD' ? '!bg-[#B8F55A]' : ''}`} onClick={() => setMode('ADD')}>
              ADD
            </button>
            <button type="button" className={`neo-btn-secondary px-3 py-2 text-xs ${mode === 'REDUCE' ? '!bg-[#FCA5A5]' : ''}`} onClick={() => setMode('REDUCE')}>
              REDUCE
            </button>
          </div>
          <Input label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button
            fullWidth
            loading={saving}
            onClick={async () => {
              const delta = Number(amount);
              if (!Number.isFinite(delta) || delta <= 0) return;
              const next = mode === 'ADD' ? asset.amount + delta : Math.max(0, asset.amount - delta);
              setSaving(true);
              try {
                await onApply(asset.id, next, mode, note.trim() || undefined);
                setAmount('');
                setNote('');
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            APPLY
          </Button>
          <Button
            variant="destructive"
            fullWidth
            onClick={() => setConfirmRemoveOpen(true)}
          >
            REMOVE ASSET
          </Button>
        </div>
      </BottomSheet>
      <ConfirmModal
        isOpen={confirmRemoveOpen}
        title="Hapus Aset?"
        description={`Aset ${asset.ticker} akan dihapus dari pocket ini.`}
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
