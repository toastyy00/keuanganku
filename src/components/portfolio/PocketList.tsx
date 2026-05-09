import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BriefcaseBusiness, Ellipsis, Landmark, Link2, Shield, Wallet } from 'lucide-react';
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

function withAlpha(hex: string, alphaHex: string): string {
  const cleaned = hex.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(cleaned)) return '#1B1B1E';
  return `${cleaned}${alphaHex}`;
}

function buildPocketAccentGradient(colorTheme: string): string {
  return `linear-gradient(135deg, #1B1B1E 0%, #22252C 48%, ${withAlpha(colorTheme, '52')} 100%)`;
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
  const [settingsPressedId, setSettingsPressedId] = useState<string | null>(null);
  const [settingsTapId, setSettingsTapId] = useState<string | null>(null);
  const [cardTapId, setCardTapId] = useState<string | null>(null);
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
      <div className="sticky top-0 z-30 -mx-4 -mt-6 flex items-start justify-between bg-[#1A1A1A] px-4 pb-3 pt-6 md:-mx-6 md:px-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex h-9 w-9 items-center justify-center border-[3px] border-[#F5F0E8] bg-[#1E1E1E] text-[#F5F0E8] shadow-[4px_4px_0_0_#969696] transition-[transform,box-shadow] duration-150 md:hover:-translate-y-0.5 md:hover:shadow-[6px_8px_0_0_#969696] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none md:active:translate-x-[4px] md:active:translate-y-[4px] md:active:shadow-none"
        >
          <ArrowLeft size={16} strokeWidth={3.2} />
        </button>
        <div className="flex flex-col items-end gap-0 pt-0.5 text-right leading-none">
          <p className="text-[12px] font-black uppercase tracking-[0.18em] text-[#B8F55A]">Pockets</p>
          <p className="mt-[-6px] text-[24px] font-black uppercase tracking-[-0.01em] text-[#F5F0E8]">Tracker</p>
        </div>
      </div>

      <TotalPortfolioCard
        shouldAnimateMiniSparkline={shouldAnimateTotalSparkline}
        onMiniSparklineRevealComplete={onTotalSparklineRevealComplete}
      />

      <div className="flex items-center gap-3 pt-2">
        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#E9E5DD]">My Pockets</p>
        <div className="h-[2px] flex-1 bg-[#2E3138]" />
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setIsSheetOpen(true);
          }}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#E9E5DD] bg-[linear-gradient(145deg,#1B1B1E_0%,#23252A_52%,#2E3138_100%)] text-[#E9E5DD] shadow-[1px_1px_0_0_rgba(233,229,221,0.82)] transition-[transform,box-shadow] duration-150 md:hover:-translate-y-px md:hover:shadow-[2px_2px_0_0_rgba(233,229,221,0.82)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none md:active:translate-x-[1px] md:active:translate-y-[1px] md:active:shadow-none"
          aria-label="Create new pocket"
          title="Create new pocket"
        >
          <span className="sr-only">Add pocket</span>
          <span className="text-[24px] font-medium leading-none">+</span>
        </button>
      </div>

      <div className="space-y-2.5">
        {sortedPockets.map((pocket) => {
          const count = assets.filter((item) => item.pocket_id === pocket.id).length;
          const sourceLine = `${pocket.source_type}${pocket.source ? ` ${pocket.source.toUpperCase()}` : ''} - ${count} ASSETS`;
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
              className={`group relative block w-full rounded-lg bg-[#1D1D1D] px-2 py-2 text-left transition-[transform,box-shadow] duration-150 ${
                cardTapId === pocket.id ? 'translate-x-[4px] translate-y-[4px] shadow-none' : 'shadow-[4px_4px_0_0_#969696] md:hover:-translate-y-0.5 md:hover:shadow-[6px_8px_0_0_#969696]'
              }`}
              style={{
                background: `linear-gradient(124deg, #222326 10%, #262931 56%, ${pocket.color_theme}2E 86%, ${pocket.color_theme}4A 100%)`,
              }}
              onPointerDown={() => setCardTapId(pocket.id)}
              onPointerUp={() => setCardTapId((current) => (current === pocket.id ? null : current))}
              onPointerLeave={() => setCardTapId((current) => (current === pocket.id ? null : current))}
              onPointerCancel={() => setCardTapId((current) => (current === pocket.id ? null : current))}
            >
              <div className="flex min-h-[56px] items-center gap-2.5">
                <div
                  className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-md border-2"
                  style={{
                    borderColor: `${pocket.color_theme}`,
                    background: buildPocketAccentGradient(pocket.color_theme),
                  }}
                >
                  <div style={{ color: pocket.color_theme }}>
                    <div className="scale-[0.86]">{renderPocketIcon(pocket.icon)}</div>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-black leading-[0.95] tracking-[-0.01em] text-[#F5F0E8]">{pocket.name}</p>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <p className="truncate text-[8px] font-black uppercase tracking-[0.08em] text-[#F5F0E8]/90">{sourceLine}</p>
                    {changePct !== null && (
                      <span className="shrink-0 text-[8px] font-black leading-none tracking-[0.08em]" style={{ color: isPositiveChange ? '#22C55E' : '#EF4444' }}>
                        {formatPocketChangePct(changePct)}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  aria-label={`Edit pocket ${pocket.name}`}
                  title="Pocket settings"
                  className={`ml-1 inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md border-2 bg-[#1B1B1E] transition-[transform,box-shadow] duration-150 ${
                    settingsPressedId === pocket.id ? 'scale-90 rotate-6' : 'scale-100 rotate-0'
                  } ${settingsTapId === pocket.id ? 'translate-x-[4px] translate-y-[4px] shadow-[0_0_0_0_#969696]' : 'shadow-[3px_3px_0_0_#969696]'}`}
                  style={{
                    borderColor: `${pocket.color_theme}`,
                    color: pocket.color_theme,
                    background: buildPocketAccentGradient(pocket.color_theme),
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSettingsTapId(pocket.id);
                    setCardTapId((current) => (current === pocket.id ? null : current));
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    setSettingsTapId((current) => (current === pocket.id ? null : current));
                  }}
                  onPointerLeave={() => setSettingsTapId((current) => (current === pocket.id ? null : current))}
                  onPointerCancel={() => setSettingsTapId((current) => (current === pocket.id ? null : current))}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSettingsPressedId(pocket.id);
                    window.setTimeout(() => setSettingsPressedId((current) => (current === pocket.id ? null : current)), 180);
                    setEditing(pocket);
                    setIsSheetOpen(true);
                  }}
                >
                  <Ellipsis size={17} strokeWidth={2.8} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="pt-2 text-center text-[10px] font-black uppercase tracking-[0.18em] text-[#44474D]">
        Powered by{' '}
        <a
          href="https://www.coingecko.com/?utm_source=keuanganku&utm_medium=referral"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-[#44474D]/50 underline-offset-2"
          onClick={(event) => event.stopPropagation()}
        >
          CoinGecko API
        </a>
      </p>

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
