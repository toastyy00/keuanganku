import React, { useMemo, useState } from 'react';
import { Coins, LockKeyhole, Plus, Sprout } from 'lucide-react';
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
  idrRate?: number;
  colorTheme?: string;
  onAddHolding: (input: { ticker: string; amount: number; location: string; holding_type: PortfolioAsset['holding_type']; chain?: string; note?: string }) => Promise<void>;
  onSelectHolding: (holding: PortfolioAsset) => void;
}

const TYPE_META: Record<PortfolioAsset['holding_type'], { label: string; icon: React.ReactNode }> = {
  liquid: {
    label: 'Liquid',
    icon: <Coins size={20} strokeWidth={3} />,
  },
  staked: {
    label: 'Staked',
    icon: <Sprout size={20} strokeWidth={3} />,
  },
  locked: {
    label: 'Locked',
    icon: <LockKeyhole size={20} strokeWidth={3} />,
  },
};

function holdingPlace(asset: PortfolioAsset): string {
  const location = asset.location ?? 'Wallet';
  return asset.chain ? `${location} · ${asset.chain}` : location;
}

const HoldingsBottomSheet: React.FC<HoldingsBottomSheetProps> = ({ isOpen, onClose, aggregate, currentPriceUsd = 0, idrRate, colorTheme = '#B8F55A', onAddHolding, onSelectHolding }) => {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const sortedHoldings = useMemo(() => {
    return [...(aggregate?.holdings ?? [])].sort((a, b) => b.amount * currentPriceUsd - a.amount * currentPriceUsd);
  }, [aggregate?.holdings, currentPriceUsd]);
  const formatIdrValue = (usdValue: number) => (idrRate ? formatCurrency(usdValue * idrRate, 'IDR') : 'Rp --');

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
        <div className="portfolio-theme-sheet space-y-4" style={{ '--portfolio-pocket-accent': colorTheme, '--portfolio-pocket-accent-soft': `${colorTheme}24` } as React.CSSProperties}>
          <div className="relative overflow-hidden border-[3px] border-[#F5F0E8] bg-[#1A1A1A] p-4 text-[#F5F0E8]" style={{ boxShadow: `5px 5px 0 0 ${colorTheme}` }}>
            <div className="absolute -right-8 -top-8 h-24 w-24 rotate-12 border-[3px]" style={{ backgroundColor: `${colorTheme}1A`, borderColor: `${colorTheme}80` }} />
            <div className="relative z-10 flex items-start justify-between gap-3">
              <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: colorTheme }}>
                Total Position
              </p>
              <p className="max-w-[42%] text-right text-[10px] font-black uppercase leading-tight text-[#F5F0E8]/55">
                1 {aggregate.ticker} ≈ ${currentPriceUsd.toFixed(4)}
              </p>
            </div>
            <p className="mt-1 text-3xl font-black leading-none tracking-[-0.04em]">
              {formatPortfolioAmount(aggregate.totalAmount)} {aggregate.ticker}
            </p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="text-sm font-black text-[#F5F0E8]/70">${aggregate.totalUsdValue.toFixed(2)}</p>
              <p className="text-base font-black">{formatIdrValue(aggregate.totalUsdValue)}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="-mt-0.5 flex items-end justify-between">
              <p className="text-xs font-black uppercase leading-none text-[#F5F0E8]/50">Holding Locations</p>
              <p className="text-[10px] font-black uppercase text-[#F5F0E8]/50">Tap to edit</p>
            </div>
            {sortedHoldings.map((holding) => {
              const meta = TYPE_META[holding.holding_type ?? 'liquid'];
              const holdingUsd = holding.amount * currentPriceUsd;
              return (
                <button key={holding.id} type="button" className="neo-card portfolio-holding-location-card flex w-full items-center justify-between gap-3 px-3 py-3 text-left" onClick={() => onSelectHolding(holding)}>
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-1.5 text-base font-black leading-tight">
                      <span className="shrink-0" style={{ color: colorTheme }} aria-label={meta.label} title={meta.label}>
                        {meta.icon}
                      </span>
                      <span className="truncate">{holdingPlace(holding)}</span>
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">{holding.note && <span className="max-w-[140px] truncate text-[10px] font-bold text-brutal-black/50">{holding.note}</span>}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-black">{formatPortfolioAmount(holding.amount)}</p>
                    <p className="text-[11px] font-bold leading-tight text-brutal-black/60">
                      ${holdingUsd.toFixed(2)} · {formatIdrValue(holdingUsd)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <Button fullWidth leftIcon={<Plus size={16} strokeWidth={3} />} style={{ backgroundColor: colorTheme, borderColor: '#2A2A2A', color: '#1A1A1A' }} onClick={() => setIsAddOpen(true)}>
            ADD HOLDING
          </Button>
        </div>
      </BottomSheet>

      <AddAssetSheet
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        lockedTicker={aggregate.ticker}
        title={`ADD ${aggregate.ticker} HOLDING`}
        colorTheme={colorTheme}
        onAdd={async (input) => {
          await onAddHolding(input);
          setIsAddOpen(false);
        }}
      />
    </>
  );
};

export { HoldingsBottomSheet };
