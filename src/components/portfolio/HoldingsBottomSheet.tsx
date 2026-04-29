import React, { useMemo, useState } from 'react';
import { Lock, Plus, Sparkles, WalletCards } from 'lucide-react';
import { formatCurrency, formatPortfolioAmount } from '../../lib/utils';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { AddAssetSheet } from './AddAssetSheet';
import type { PortfolioAsset } from '../../types';

export interface AggregatedPortfolioAsset {
  key: string;
  pocket_id: string;
  ticker: string;
  coingecko_id?: string;
  totalAmount: number;
  totalUsdValue: number;
  holdings: PortfolioAsset[];
}

interface HoldingsBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  aggregate: AggregatedPortfolioAsset | null;
  currentPriceUsd?: number;
  onAddHolding: (input: {
    ticker: string;
    amount: number;
    location: string;
    holding_type: PortfolioAsset['holding_type'];
    chain?: string;
    note?: string;
  }) => Promise<void>;
  onSelectHolding: (holding: PortfolioAsset) => void;
}

const TYPE_META: Record<PortfolioAsset['holding_type'], { label: string; className: string; icon: React.ReactNode }> = {
  liquid: {
    label: 'Liquid',
    className: 'bg-[#B8F55A] text-[#1A1A1A] border-[#1A1A1A]',
    icon: <WalletCards size={13} strokeWidth={3} />,
  },
  staked: {
    label: 'Staked',
    className: 'bg-[#F6D365] text-[#1A1A1A] border-[#1A1A1A]',
    icon: <Sparkles size={13} strokeWidth={3} />,
  },
  locked: {
    label: 'Locked',
    className: 'bg-[#FCA5A5] text-[#1A1A1A] border-[#1A1A1A]',
    icon: <Lock size={13} strokeWidth={3} />,
  },
};

function holdingPlace(asset: PortfolioAsset): string {
  const location = asset.location ?? 'Wallet';
  return asset.chain ? `${asset.chain} · ${location}` : location;
}

const HoldingsBottomSheet: React.FC<HoldingsBottomSheetProps> = ({
  isOpen,
  onClose,
  aggregate,
  currentPriceUsd = 0,
  onAddHolding,
  onSelectHolding,
}) => {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const sortedHoldings = useMemo(() => {
    return [...(aggregate?.holdings ?? [])].sort((a, b) => (b.amount * currentPriceUsd) - (a.amount * currentPriceUsd));
  }, [aggregate?.holdings, currentPriceUsd]);

  if (!aggregate) return null;

  return (
    <>
      <BottomSheet
        isOpen={isOpen && !isAddOpen}
        onClose={onClose}
        title={`${aggregate.ticker} HOLDINGS`}
        description={`${sortedHoldings.length} location${sortedHoldings.length === 1 ? '' : 's'}`}
        panelClassName="sm:max-w-[520px]"
        containPageOverscroll
      >
        <div className="space-y-4">
          <div className="relative overflow-hidden border-[3px] border-[#F5F0E8] bg-[#1A1A1A] p-4 text-[#F5F0E8] shadow-[5px_5px_0_0_#B8F55A]">
            <div className="absolute -right-8 -top-8 h-24 w-24 border-[3px] border-[#B8F55A]/50 bg-[#B8F55A]/10 rotate-12" />
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#B8F55A]">Total Position</p>
            <p className="mt-1 text-3xl font-black leading-none tracking-[-0.04em]">
              {formatPortfolioAmount(aggregate.totalAmount)} {aggregate.ticker}
            </p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="text-sm font-black text-[#F5F0E8]/70">${aggregate.totalUsdValue.toFixed(2)}</p>
              <p className="text-base font-black">{formatCurrency(aggregate.totalUsdValue * 16000, 'IDR')}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase text-[#B8F55A]">Breakdown</p>
              <p className="text-[10px] font-black uppercase text-[#F5F0E8]/50">Tap to edit</p>
            </div>
            {sortedHoldings.map((holding) => {
              const meta = TYPE_META[holding.holding_type ?? 'liquid'];
              const holdingUsd = holding.amount * currentPriceUsd;
              return (
                <button
                  key={holding.id}
                  type="button"
                  className="neo-card flex w-full items-start justify-between gap-3 px-3 py-3 text-left transition-[transform,box-shadow] duration-150 active:translate-x-1 active:translate-y-1 active:shadow-none"
                  onClick={() => onSelectHolding(holding)}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{holdingPlace(holding)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 border-2 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${meta.className}`}>
                        {meta.icon}
                        {meta.label}
                      </span>
                      {holding.note && <span className="max-w-[140px] truncate text-[10px] font-bold text-brutal-black/50">{holding.note}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-black">{formatPortfolioAmount(holding.amount)}</p>
                    <p className="text-[11px] font-bold text-brutal-black/60">{formatCurrency(holdingUsd * 16000, 'IDR')}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <Button fullWidth leftIcon={<Plus size={16} strokeWidth={3} />} onClick={() => setIsAddOpen(true)}>
            ADD HOLDING
          </Button>
        </div>
      </BottomSheet>

      <AddAssetSheet
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        lockedTicker={aggregate.ticker}
        title={`ADD ${aggregate.ticker} HOLDING`}
        onAdd={async (input) => {
          await onAddHolding(input);
          setIsAddOpen(false);
        }}
      />
    </>
  );
};

export { HoldingsBottomSheet };
