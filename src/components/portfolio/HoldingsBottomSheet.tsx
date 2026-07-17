import React, { useMemo, useState } from 'react';
import { Coins, LockKeyhole, Plus, Sprout } from 'lucide-react';
import { formatCurrency, formatPortfolioAmount } from '../../lib/utils';
import { BottomSheet } from '../ui/BottomSheet';
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
    icon: <Coins size={16} strokeWidth={2} />,
  },
  staked: {
    label: 'Staked',
    icon: <Sprout size={16} strokeWidth={2} />,
  },
  locked: {
    label: 'Locked',
    icon: <LockKeyhole size={16} strokeWidth={2} />,
  },
};

function holdingPlace(asset: PortfolioAsset): string {
  const location = asset.location ?? 'Wallet';
  return asset.chain ? `${location} · ${asset.chain}` : location;
}

const HoldingsBottomSheet: React.FC<HoldingsBottomSheetProps> = ({
  isOpen,
  onClose,
  aggregate: rawAggregate,
  currentPriceUsd = 0,
  idrRate,
  colorTheme = '#B8F55A',
  onAddHolding,
  onSelectHolding,
}) => {
  const [activeAggregate, setActiveAggregate] = useState<AggregatedPortfolioAsset | null>(null);

  React.useEffect(() => {
    if (rawAggregate) {
      setActiveAggregate(rawAggregate);
    }
  }, [rawAggregate]);

  const aggregate = rawAggregate || activeAggregate;

  const [isAddOpen, setIsAddOpen] = useState(false);

  const sortedHoldings = useMemo(() => {
    return [...(aggregate?.holdings ?? [])].sort(
      (a, b) => b.amount * currentPriceUsd - a.amount * currentPriceUsd
    );
  }, [aggregate?.holdings, currentPriceUsd]);

  const formatIdrValue = (usdValue: number) =>
    idrRate ? formatCurrency(usdValue * idrRate, 'IDR') : 'Rp --';


  if (!aggregate) return null;

  return (
    <>
      <BottomSheet
        isOpen={isOpen && !isAddOpen}
        onClose={onClose}
        title={`${aggregate.ticker} HOLDINGS`}
        description={`${sortedHoldings.length} position${sortedHoldings.length === 1 ? '' : 's'}`}
        panelClassName="sm:max-w-[520px]"
        containPageOverscroll
        footer={
          <button
            type="button"
            style={{ backgroundColor: colorTheme }}
            onClick={() => setIsAddOpen(true)}
            className="w-full h-11 rounded-xl text-[#1A1A1A] text-sm font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
          >
            <Plus size={15} strokeWidth={2.5} />
            ADD HOLDING
          </button>
        }
      >
        <div
          className="portfolio-theme-sheet flex flex-col gap-3.5 pb-2"
          style={{
            '--portfolio-pocket-accent': colorTheme,
            '--portfolio-pocket-accent-soft': `${colorTheme}24`,
          } as React.CSSProperties}
        >
          {/* Total position card */}
          <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 text-[#F5F0E8]">
            <div className="relative z-10 flex items-start justify-between gap-3">
              <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: colorTheme }}>
                Total Position
              </p>
              <p className="max-w-[42%] text-right text-[10px] text-white/40 leading-tight">
                1 {aggregate.ticker} ≈ ${currentPriceUsd.toFixed(4)}
              </p>
            </div>
            <p className="mt-1.5 text-2xl font-bold leading-none tracking-tight">
              {formatPortfolioAmount(aggregate.totalAmount)} {aggregate.ticker}
            </p>
            <div className="mt-4 flex items-end justify-between gap-3 border-t border-white/[0.04] pt-3">
              <p className="text-sm font-semibold text-white/50">${aggregate.totalUsdValue.toFixed(2)}</p>
              <p className="text-base font-semibold text-white/95">{formatIdrValue(aggregate.totalUsdValue)}</p>
            </div>
          </div>

          {/* Holdings list */}
          <div className="space-y-2">
            <div className="flex items-end justify-between px-1">
              <p className="text-[10px] font-medium uppercase tracking-widest text-white/35">Holding Positions</p>
              <p className="text-[10px] text-white/35">Tap to edit</p>
            </div>
            <div className="flex flex-col gap-2">
              {sortedHoldings.map((holding) => {
                const meta = TYPE_META[holding.holding_type ?? 'liquid'];
                const holdingUsd = holding.amount * currentPriceUsd;
                return (
                  <button
                    key={holding.id}
                    type="button"
                    className="rounded-xl border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06] transition-colors flex items-center justify-between gap-3 px-3.5 py-3 text-left"
                    onClick={() => onSelectHolding(holding)}
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      <span
                        className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0"
                        style={{ color: colorTheme }}
                        aria-label={meta.label}
                        title={meta.label}
                      >
                        {meta.icon}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white/95 leading-tight">
                          {holdingPlace(holding)}
                        </p>
                        {holding.note && (
                          <p className="max-w-[140px] truncate text-[10px] text-white/30 mt-0.5 font-normal">
                            {holding.note}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-white/95">{formatPortfolioAmount(holding.amount)}</p>
                      <p className="text-[11px] text-white/40 leading-none mt-0.5">
                        ${holdingUsd.toFixed(2)} · {formatIdrValue(holdingUsd)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
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
