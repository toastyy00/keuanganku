import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Input, Textarea } from '../ui/Input';
import { formatPortfolioAmount, roundPortfolioAmount } from '../../lib/utils';
import type { PortfolioAsset } from '../../types';

interface AssetActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
  asset?: PortfolioAsset | null;
  currentPriceUsd?: number;
  onApply: (assetId: string, newAmount: number, action: 'ADD' | 'REDUCE', note?: string) => Promise<void>;
  onSaveMetadata: (assetId: string, data: Pick<PortfolioAsset, 'location' | 'holding_type'> & Pick<Partial<PortfolioAsset>, 'chain' | 'note'>) => Promise<void>;
  onRemove: (assetId: string) => Promise<void>;
}

const HOLDING_TYPES: Array<{ value: PortfolioAsset['holding_type']; label: string }> = [
  { value: 'liquid', label: 'Liquid' },
  { value: 'staked', label: 'Staked' },
  { value: 'locked', label: 'Locked' },
];

const AssetActionSheet: React.FC<AssetActionSheetProps> = ({
  isOpen,
  onClose,
  onBack,
  asset,
  currentPriceUsd,
  onApply,
  onSaveMetadata,
  onRemove,
}) => {
  const [amount, setAmount] = useState('');
  const [metadataNote, setMetadataNote] = useState(asset?.note ?? '');
  const [location, setLocation] = useState(asset?.location ?? 'Wallet');
  const [chain, setChain] = useState(asset?.chain ?? '');
  const [holdingType, setHoldingType] = useState<PortfolioAsset['holding_type']>(asset?.holding_type ?? 'liquid');
  const [saving, setSaving] = useState(false);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; location?: string }>({});

  React.useEffect(() => {
    if (!asset) return;
    setLocation(asset.location ?? 'Wallet');
    setChain(asset.chain ?? '');
    setHoldingType(asset.holding_type ?? 'liquid');
    setAmount(formatPortfolioAmount(asset.amount));
    setMetadataNote(asset.note ?? '');
    setErrors({});
  }, [asset]);

  if (!asset) return null;

  const parsedAmount = Number(amount);
  const hasValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const hasRawHoldingChanges = amount.trim() !== formatPortfolioAmount(asset.amount)
    || location.trim() !== (asset.location ?? 'Wallet')
    || (chain.trim() || undefined) !== (asset.chain ?? undefined)
    || holdingType !== (asset.holding_type ?? 'liquid')
    || (metadataNote.trim() || undefined) !== (asset.note ?? undefined);
  const hasHoldingChanges = hasValidAmount && hasRawHoldingChanges;

  return (
    <>
      <BottomSheet isOpen={isOpen && !confirmRemoveOpen} onClose={onClose} containPageOverscroll>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3 border-b-2 border-[#555555] pb-3">
            <div>
              <h3 className="text-lg font-bold uppercase leading-tight tracking-tight">EDIT HOLDING</h3>
              <p className="mt-0.5 text-xs font-bold uppercase tracking-wider text-brutal-black/50">{asset.ticker}</p>
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
            <p className="text-sm font-black">{asset.ticker}</p>
            <p className="text-xs font-medium text-brutal-black/60">Current amount: {formatPortfolioAmount(asset.amount)}</p>
            <p className="text-xs font-medium text-brutal-black/60">Current price: ${Number(currentPriceUsd ?? 0).toFixed(4)}</p>
            <p className="text-xs font-medium text-brutal-black/60">{asset.chain ? `${asset.chain} · ` : ''}{asset.location ?? 'Wallet'}</p>
          </div>
          <div className="neo-card space-y-3 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase text-brutal-black/60">Holding Metadata</p>
              <p className="text-[10px] font-black uppercase text-brutal-black/40">Edit holding</p>
            </div>
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
            />
            <Input label="Chain Optional" value={chain} onChange={(e) => setChain(e.target.value)} />
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
            <Textarea label="Holding Note Optional" value={metadataNote} onChange={(e) => setMetadataNote(e.target.value)} />
            <div className="grid grid-cols-[auto_1fr] gap-2">
              {onBack && (
                <Button
                  type="button"
                  variant="secondary"
                  className="!px-3 !font-black"
                  onClick={onBack}
                  leftIcon={<ArrowLeft size={15} strokeWidth={3} />}
                >
                  BACK
                </Button>
              )}
              <Button
                variant="secondary"
                fullWidth
                className="!font-black"
                loading={savingMetadata || saving}
                disabled={!hasRawHoldingChanges}
                onClick={async () => {
                  const nextErrors = {
                    amount: !hasValidAmount ? 'Amount harus lebih dari 0' : undefined,
                    location: !location.trim() ? 'Location wajib diisi' : undefined,
                  };
                  setErrors(nextErrors);
                  if (nextErrors.amount || nextErrors.location || !hasHoldingChanges) return;
                  setSavingMetadata(true);
                  setSaving(true);
                  try {
                    await onSaveMetadata(asset.id, {
                      location: location.trim(),
                      holding_type: holdingType,
                      chain: chain.trim() || undefined,
                      note: metadataNote.trim() || undefined,
                    });
                    const roundedAmount = roundPortfolioAmount(parsedAmount);
                    if (roundedAmount !== asset.amount) {
                      await onApply(asset.id, roundedAmount, roundedAmount > asset.amount ? 'ADD' : 'REDUCE', metadataNote.trim() || undefined);
                    }
                    onClose();
                  } finally {
                    setSavingMetadata(false);
                    setSaving(false);
                  }
                }}
              >
                SAVE HOLDING
              </Button>
            </div>
          </div>
          <Button
            variant="destructive"
            fullWidth
            className="!font-black"
            onClick={() => setConfirmRemoveOpen(true)}
          >
            REMOVE HOLDING
          </Button>
        </div>
      </BottomSheet>
      <ConfirmModal
        isOpen={confirmRemoveOpen}
        title="Hapus Holding?"
        description={`Holding ${asset.ticker} di ${asset.chain ? `${asset.chain} · ` : ''}${asset.location ?? 'Wallet'} akan dihapus dari pocket ini.`}
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
