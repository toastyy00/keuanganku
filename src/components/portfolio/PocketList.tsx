import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BriefcaseBusiness, Ellipsis, Landmark, Link2, Plus, Shield, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePortfolioStore } from '../../store/usePortfolioStore';
import type { PortfolioPocket } from '../../types';
import { PocketSettingsSheet } from './PocketSettingsSheet';
import { TotalPortfolioCard } from './TotalPortfolioCard';

type PocketListTimeframe = '24H';

interface PocketListProps {
  onOpenPocket: (pocket: PortfolioPocket) => void;
  shouldAnimateTotalSparkline?: boolean;
  onTotalSparklineRevealComplete?: () => void;
}


function renderPocketIcon(icon?: string) {
  const normalized = (icon ?? '').toLowerCase();
  if (normalized.includes('wallet')) return <Wallet size={26} strokeWidth={2.4} />;
  if (normalized.includes('bank')) return <Landmark size={26} strokeWidth={2.4} />;
  if (normalized.includes('shield')) return <Shield size={26} strokeWidth={2.4} />;
  if (normalized.includes('link')) return <Link2 size={26} strokeWidth={2.4} />;
  return <BriefcaseBusiness size={26} strokeWidth={2.4} />;
}

function getPocketChangePct(points: { timestamp: number; value: number }[]): number | null {
  if (points.length < 2) return null;

  const first = points[0]?.value ?? 0;
  const last = points[points.length - 1]?.value ?? 0;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;

  return ((last - first) / first) * 100;
}

function formatPocketChangePct(changePct: number): string {
  const sign = changePct >= 0 ? '+' : '-';
  return `${sign}${Math.abs(changePct).toFixed(2)}%`;
}

const POCKET_LIST_CHANGE_TIMEFRAME: PocketListTimeframe = '24H';

const PocketList: React.FC<PocketListProps> = ({
  onOpenPocket,
  shouldAnimateTotalSparkline,
  onTotalSparklineRevealComplete,
}) => {
  const navigate = useNavigate();
  const pockets = usePortfolioStore((s) => s.pockets);
  const assets = usePortfolioStore((s) => s.assets);
  const prices = usePortfolioStore((s) => s.prices);
  const chartSeriesByCacheKey = usePortfolioStore((s) => s.chartSeriesByCacheKey);
  const refreshChartSeries = usePortfolioStore((s) => s.refreshChartSeries);
  const addPocket = usePortfolioStore((s) => s.addPocket);
  const updatePocket = usePortfolioStore((s) => s.updatePocket);
  const deletePocket = usePortfolioStore((s) => s.deletePocket);
  const [editing, setEditing] = useState<PortfolioPocket | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [hoveredPocketId, setHoveredPocketId] = useState<string | null>(null);
  const sortedPockets = useMemo(() => {
    const valueByPocket = new Map<string, number>();

    for (const asset of assets) {
      const price = prices[asset.coingecko_id ?? '']?.usd ?? 0;
      valueByPocket.set(asset.pocket_id, (valueByPocket.get(asset.pocket_id) ?? 0) + asset.amount * price);
    }

    return [...pockets].sort((a, b) => {
      const valueDiff = (valueByPocket.get(b.id) ?? 0) - (valueByPocket.get(a.id) ?? 0);
      if (Math.abs(valueDiff) > 0.000001) return valueDiff;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [assets, pockets, prices]);

  const pocketChartRefreshKey = useMemo(
    () => assets
      .map((asset) => [
        asset.pocket_id,
        asset.id,
        asset.ticker,
        asset.coingecko_id ?? '',
        asset.amount,
      ].join(':'))
      .sort()
      .join('|'),
    [assets],
  );

  useEffect(() => {
    const pocketIdsWithAssets = Array.from(new Set(assets.map((asset) => asset.pocket_id)));
    if (pocketIdsWithAssets.length === 0) return;

    void Promise.allSettled(
      pocketIdsWithAssets.map((pocketId) => refreshChartSeries(pocketId, POCKET_LIST_CHANGE_TIMEFRAME)),
    );
  }, [pocketChartRefreshKey, assets, refreshChartSeries]);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-30 -mx-4 -mt-6 flex items-center justify-between bg-[#191B1D] px-4 pb-3 pt-6 md:-mx-6 md:px-6 select-none">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.08] hover:border-white/20 text-white/50 hover:text-white transition-all active:scale-95 shrink-0 shadow-sm"
          aria-label="Back to home"
        >
          <ArrowLeft size={16} strokeWidth={2.5} />
        </button>
        <div className="flex items-center gap-1.5 text-[15px] font-black uppercase tracking-[0.12em] text-right">
          <span className="text-[#B8F55A]">Pockets</span>
          <span className="text-[#F5F0E8]">Tracker</span>
        </div>
      </div>

      <TotalPortfolioCard
        shouldAnimateMiniSparkline={shouldAnimateTotalSparkline}
        onMiniSparklineRevealComplete={onTotalSparklineRevealComplete}
      />

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-3 flex-1 mr-4">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">My Pockets</p>
          <div className="h-[1px] flex-1 bg-white/[0.08]" />
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setIsSheetOpen(true);
          }}
          className="h-7 px-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-[#F5F0E8]/70 text-[9px] font-bold uppercase tracking-wider transition-all duration-200 hover:bg-white/[0.06] hover:border-[#B8F55A]/50 hover:text-[#B8F55A] active:scale-[0.96] flex items-center gap-1.5 shrink-0 select-none"
          aria-label="Create new pocket"
          title="Create new pocket"
        >
          <Plus size={10} strokeWidth={2.5} />
          <span>Add Pocket</span>
        </button>
      </div>

      <div className="space-y-2.5">
        {sortedPockets.map((pocket) => {
          const pocketAssets = assets.filter((item) => item.pocket_id === pocket.id);
          const count = pocketAssets.length;

          const sourceLabel = `${pocket.source_type}${pocket.source ? ` ${pocket.source.toUpperCase()}` : ''}`;
          const subtitleLabel = `${sourceLabel} · ${count} ${count === 1 ? 'ASSET' : 'ASSETS'}`;
          const changePct = getPocketChangePct(chartSeriesByCacheKey[`${pocket.id}::${POCKET_LIST_CHANGE_TIMEFRAME}`] ?? []);
          const isPositiveChange = changePct !== null && changePct >= 0;

          return (
            <div
              key={pocket.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenPocket(pocket)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenPocket(pocket);
                }
              }}
              onMouseEnter={() => setHoveredPocketId(pocket.id)}
              onMouseLeave={() => setHoveredPocketId(null)}
              className="group relative block w-full rounded-2xl border border-transparent bg-[#1D1D1D] px-4 py-3 text-left transition-all duration-200 hover:translate-x-1 cursor-pointer"
              style={{
                borderColor: 'transparent',
                background: hoveredPocketId === pocket.id
                  ? `radial-gradient(circle at 100% 100%, ${pocket.color_theme}16, transparent 65%), linear-gradient(135deg, #24272D 0%, #18191D 100%)`
                  : `radial-gradient(circle at 100% 100%, ${pocket.color_theme}0E, transparent 65%), linear-gradient(135deg, #1E2025 0%, #151619 100%)`,
                boxShadow: '0 12px 35px -5px rgba(0, 0, 0, 0.45)',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Icon container */}
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      color: pocket.color_theme,
                      backgroundColor: `${pocket.color_theme}12`,
                    }}
                  >
                    <div className="scale-[0.8]">{renderPocketIcon(pocket.icon)}</div>
                  </div>

                  {/* Info Stack */}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[#F5F0E8] leading-tight">{pocket.name}</p>
                    <p className="text-[9px] font-black uppercase tracking-wider text-white/30 mt-0.5">{subtitleLabel}</p>
                  </div>
                </div>

                {/* Right side: Change & Edit Button */}
                <div className="flex items-center gap-3 shrink-0">
                  {changePct !== null && (
                    <span className={`text-sm font-bold ${isPositiveChange ? 'text-[#1B9066]' : 'text-[#B93E50]'}`}>
                      {formatPocketChangePct(changePct)}
                    </span>
                  )}

                  {/* Settings Ellipsis Button */}
                  <button
                    type="button"
                    aria-label={`Edit pocket ${pocket.name}`}
                    title="Pocket settings"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.04] transition-all active:scale-95"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(pocket);
                      setIsSheetOpen(true);
                    }}
                  >
                    <Ellipsis size={14} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <PocketSettingsSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        pocket={editing}
        onSave={async (input) => {
          if (editing) await updatePocket(editing.id, input);
          else await addPocket(input);
        }}
        onDelete={editing ? async () => deletePocket(editing.id) : undefined}
      />
    </div>
  );
};

export { PocketList };
