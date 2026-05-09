import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { formatCurrency, formatPortfolioAmount } from '../../lib/utils';
import { getCachedPortfolioIdrRate, getPortfolioIdrRate, type PortfolioRateResult } from '../../lib/exchangeRate';
import { aggregateHoldingsByTicker, buildPortfolioAssetFingerprint } from '../../lib/portfolio-aggregation';
import { usePortfolioStore } from '../../store/usePortfolioStore';
import { AddAssetSheet } from './AddAssetSheet';
import { AssetActionSheet } from './AssetActionSheet';
import { ActivityFeed } from './ActivityFeed';
import { HoldingsBottomSheet, type AggregatedPortfolioAsset } from './HoldingsBottomSheet';
import { PocketSettingsSheet } from './PocketSettingsSheet';
import { PortfolioAllocationBar } from './PortfolioAllocationBar';
import { PortfolioChart } from './PortfolioChart';
import type { PortfolioAsset, PortfolioPocket } from '../../types';

interface PocketDetailProps {
  pocketId: string;
  onBack: () => void;
}

const FRAMES: Array<'24H' | '1W' | '1M' | '1Y'> = ['24H', '1W', '1M', '1Y'];
const CHART_GAIN_COLOR = '#22C55E';
const CHART_LOSS_COLOR = '#EF4444';
const CHART_FLAT_COLOR = '#F5F0E8';
const TIMEFRAME_CHART_REVEAL_DURATION_MS = 360;
const EMPTY_CHART_DATA: { timestamp: number; value: number }[] = [];

function getChartSeriesSignature(points: { timestamp: number; value: number }[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  return `${points.length}:${first?.timestamp ?? 0}:${last?.timestamp ?? 0}:${first?.value ?? 0}:${last?.value ?? 0}`;
}

function assetChangeColorClass(changePct: number): string {
  if (Math.abs(changePct) < 0.005) return 'text-brutal-black/45';
  return changePct > 0 ? 'text-[#22C55E]/75' : 'text-[#EF4444]/75';
}

function formatAssetChangePct(changePct: number): string {
  if (Math.abs(changePct) < 0.005) return '0.00%';
  const sign = changePct > 0 ? '+' : '-';
  return `${sign}${Math.abs(changePct).toFixed(2)}%`;
}

const PocketDetail: React.FC<PocketDetailProps> = ({ pocketId, onBack }) => {
  const pockets = usePortfolioStore((s) => s.pockets);
  const assets = usePortfolioStore((s) => s.assets);
  const prices = usePortfolioStore((s) => s.prices);
  const logs = usePortfolioStore((s) => s.activityLogs);
  const chartByPocket = usePortfolioStore((s) => s.chartSeriesByPocket);
  const assetChangesByScope = usePortfolioStore((s) => s.assetChangesByScope);
  const fetchPrices = usePortfolioStore((s) => s.fetchPrices);
  const refreshPrices = usePortfolioStore((s) => s.refreshPrices);
  const refreshChartSeries = usePortfolioStore((s) => s.refreshChartSeries);
  const addAsset = usePortfolioStore((s) => s.addAsset);
  const addHolding = usePortfolioStore((s) => s.addHolding);
  const updateAssetAmount = usePortfolioStore((s) => s.updateAssetAmount);
  const removeAsset = usePortfolioStore((s) => s.removeAsset);
  const updatePocket = usePortfolioStore((s) => s.updatePocket);
  const deletePocket = usePortfolioStore((s) => s.deletePocket);
  const [timeframe, setTimeframe] = useState<'24H' | '1W' | '1M' | '1Y'>('24H');
  const [timeframeReveal, setTimeframeReveal] = useState<{ fromProgress: number; key: string } | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [assetAction, setAssetAction] = useState<PortfolioAsset | null>(null);
  const [selectedAggregateKey, setSelectedAggregateKey] = useState<string | null>(null);
  const [returnAggregateKey, setReturnAggregateKey] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [scrubPointValue, setScrubPointValue] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isRefreshPressed, setIsRefreshPressed] = useState(false);
  const [isRefreshAnimating, setIsRefreshAnimating] = useState(false);
  const [portfolioRateInfo, setPortfolioRateInfo] = useState<PortfolioRateResult | null>(() => getCachedPortfolioIdrRate());
  const refreshReleaseTimerRef = useRef<number | null>(null);
  const refreshAnimationTimerRef = useRef<number | null>(null);
  const pendingTimeframeRevealRef = useRef<{ timeframe: typeof timeframe; previousSignature: string } | null>(null);
  const resetScrubState = () => {
    setIsScrubbing(false);
    setScrubPointValue(null);
  };

  const refreshPocketChart = async () => {
    if (refreshAnimationTimerRef.current !== null) {
      window.clearTimeout(refreshAnimationTimerRef.current);
    }
    setIsRefreshAnimating(true);
    try {
      await refreshPrices(pocketId, { force: true });
      await refreshChartSeries(pocketId, timeframe, { force: true });
    } finally {
      refreshAnimationTimerRef.current = window.setTimeout(() => {
        setIsRefreshAnimating(false);
        refreshAnimationTimerRef.current = null;
      }, 220);
    }
  };

  const pocket = pockets.find((item) => item.id === pocketId) as PortfolioPocket | undefined;
  const pocketAssets = useMemo(() => assets.filter((item) => item.pocket_id === pocketId), [assets, pocketId]);
  const pocketLogs = useMemo(() => logs.filter((item) => item.pocket_id === pocketId).sort((a, b) => b.created_at.localeCompare(a.created_at)), [logs, pocketId]);
  const aggregatedAssets = useMemo<AggregatedPortfolioAsset[]>(() => aggregateHoldingsByTicker(pocketAssets, prices), [pocketAssets, prices]);
  const pocketAssetFingerprint = useMemo(() => buildPortfolioAssetFingerprint(pocketAssets), [pocketAssets]);
  const selectedAggregate = useMemo(() => aggregatedAssets.find((item) => item.key === selectedAggregateKey) ?? null, [aggregatedAssets, selectedAggregateKey]);
  const assetChanges = assetChangesByScope[`${pocketId}::${timeframe}`] ?? {};
  const selectedHoldingLogs = useMemo(() => {
    if (!assetAction) return [];
    return pocketLogs.filter((log) => log.asset_id === assetAction.id);
  }, [assetAction, pocketLogs]);

  useEffect(() => {
    void fetchPrices(pocketId);
  }, [pocketId, fetchPrices, pocketAssetFingerprint]);

  useEffect(() => {
    void refreshChartSeries(pocketId, timeframe);
  }, [pocketId, timeframe, refreshChartSeries, pocketAssetFingerprint]);

  useEffect(() => {
    let isCancelled = false;
    getPortfolioIdrRate().then((rateInfo) => {
      if (!isCancelled && rateInfo) setPortfolioRateInfo(rateInfo);
    });
    return () => {
      isCancelled = true;
    };
  }, [pocketId]);

  useEffect(() => {
    return () => {
      if (refreshReleaseTimerRef.current !== null) {
        window.clearTimeout(refreshReleaseTimerRef.current);
      }
      if (refreshAnimationTimerRef.current !== null) {
        window.clearTimeout(refreshAnimationTimerRef.current);
      }
    };
  }, []);

  const totalUsd = pocketAssets.reduce((sum, item) => {
    const usd = prices[item.coingecko_id ?? '']?.usd ?? 0;
    return sum + usd * item.amount;
  }, 0);

  const chartData = chartByPocket[pocketId] ?? EMPTY_CHART_DATA;
  const chartSignature = useMemo(() => getChartSeriesSignature(chartData), [chartData]);
  const displayValue = totalUsd;
  const firstPointValue = chartData[0]?.value ?? 0;
  const latestPointValue = chartData[chartData.length - 1]?.value ?? 0;
  const endPointValue = isScrubbing ? (scrubPointValue ?? latestPointValue) : latestPointValue;
  const stableChangeValue = latestPointValue - firstPointValue;
  const stableChangePct = firstPointValue === 0 ? 0 : (stableChangeValue / firstPointValue) * 100;
  const changeValue = endPointValue - firstPointValue;
  const changePct = firstPointValue === 0 ? 0 : (changeValue / firstPointValue) * 100;
  const isStableChangeFlat = Math.abs(stableChangeValue) < 0.005 && Math.abs(stableChangePct) < 0.005;
  const isStableChangePositive = stableChangeValue >= 0;
  const isDisplayChangeFlat = Math.abs(changeValue) < 0.005 && Math.abs(changePct) < 0.005;
  const isDisplayChangePositive = changeValue >= 0;
  const changeColorClass = isDisplayChangeFlat ? 'text-[#F5F0E8]' : (isDisplayChangePositive ? 'text-[#22C55E]' : 'text-[#EF4444]');
  const chartPerformanceColor = isStableChangeFlat ? CHART_FLAT_COLOR : (isStableChangePositive ? CHART_GAIN_COLOR : CHART_LOSS_COLOR);
  const changeSign = changeValue >= 0 ? '+' : '-';
  const formatPortfolioIdrValue = useCallback(
    (usdValue: number) => (
      portfolioRateInfo ? formatCurrency(usdValue * portfolioRateInfo.rate, 'IDR') : 'Rp --'
    ),
    [portfolioRateInfo],
  );
  const formatChartScrubValues = useCallback(
    (value: number) => [
      formatPortfolioIdrValue(value),
      formatCurrency(value, 'USD'),
    ],
    [formatPortfolioIdrValue],
  );

  useLayoutEffect(() => {
    const pendingReveal = pendingTimeframeRevealRef.current;
    if (!pendingReveal || pendingReveal.timeframe !== timeframe || pendingReveal.previousSignature === chartSignature) return;

    pendingTimeframeRevealRef.current = null;
    setTimeframeReveal({ fromProgress: 0, key: `${pendingReveal.timeframe}-${chartSignature}` });
  }, [chartSignature, timeframe]);

  if (!pocket) return null;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-30 -mx-4 -mt-6 flex items-start justify-between bg-[#1A1A1A] px-4 pb-3 pt-6 md:-mx-6 md:px-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 w-9 items-center justify-center border-[3px] border-[#F5F0E8] bg-[#1E1E1E] text-[#F5F0E8] shadow-[4px_4px_0_0_#969696] transition-[transform,box-shadow] duration-150 md:hover:-translate-y-0.5 md:hover:shadow-[6px_8px_0_0_#969696] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none md:active:translate-x-[4px] md:active:translate-y-[4px] md:active:shadow-none"
        >
          <ArrowLeft size={16} strokeWidth={3.2} />
        </button>
        <div className="flex max-w-[70%] flex-col items-end gap-0 pt-0.5 text-right leading-none">
          <p className="text-[12px] font-black uppercase tracking-[0.18em] text-[#B8F55A]">Pockets</p>
          <p className="mt-[-6px] w-full truncate text-[24px] font-black uppercase tracking-[-0.01em] text-[#F5F0E8]">{pocket.name}</p>
        </div>
      </div>

      <section
        className="neo-card !border-0 overflow-hidden"
        style={{
          background: `linear-gradient(124deg, #222326 10%, #262931 42%, ${pocket.color_theme}58 78%, ${pocket.color_theme}75 100%)`,
        }}
      >
        <div className="px-4 pt-4">
          <div className="mb-3 flex items-start">
            <div>
              <p className="text-xs font-black uppercase text-brutal-black/50">Total Assets</p>
              <p className="text-2xl font-black">{formatPortfolioIdrValue(displayValue)}</p>
              <p className="text-sm font-bold text-brutal-black/60">${displayValue.toFixed(2)}</p>
              <p className={`mt-1 text-sm font-black ${changeColorClass}`}>{`${changeSign}$${Math.abs(changeValue).toFixed(2)} (${changeSign}${Math.abs(changePct).toFixed(2)}%) ${timeframe}`}</p>
            </div>
          </div>
        </div>

        <div className="relative w-full">
          <div
            className={`absolute right-4 top-1.5 z-10 flex items-center gap-1.5 text-[9px] font-black uppercase leading-none tracking-[0.04em] transition-opacity duration-150 ${isScrubbing ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
            aria-label="Chart timeframe"
          >
            {FRAMES.map((frame, index) => (
              <React.Fragment key={frame}>
                {index > 0 ? <span className="h-2.5 w-px bg-[#F5F0E8]/25" aria-hidden="true" /> : null}
                <button
                  type="button"
                  aria-pressed={timeframe === frame}
                  onClick={() => {
                    if (timeframe === frame) return;
                    resetScrubState();
                    pendingTimeframeRevealRef.current = { timeframe: frame, previousSignature: chartSignature };
                    setTimeframeReveal(null);
                    setTimeframe(frame);
                  }}
                  className={`px-0.5 py-1 text-[9px] font-black uppercase leading-none transition-colors ${timeframe === frame ? 'text-[#F5F0E8]' : 'text-[#F5F0E8]/45 hover:text-[#F5F0E8]/80'}`}
                >
                  {frame}
                </button>
              </React.Fragment>
            ))}
            <span className="h-2.5 w-px bg-[#F5F0E8]/25" aria-hidden="true" />
            <button
              type="button"
              aria-label="Refresh chart"
              onClick={() => {
                void refreshPocketChart();
              }}
              onPointerDown={() => {
                if (refreshReleaseTimerRef.current !== null) {
                  window.clearTimeout(refreshReleaseTimerRef.current);
                }
                setIsRefreshPressed(true);
              }}
              onPointerUp={() => {
                if (refreshReleaseTimerRef.current !== null) {
                  window.clearTimeout(refreshReleaseTimerRef.current);
                }
                refreshReleaseTimerRef.current = window.setTimeout(() => {
                  setIsRefreshPressed(false);
                }, 120);
              }}
              onPointerLeave={() => setIsRefreshPressed(false)}
              onPointerCancel={() => setIsRefreshPressed(false)}
              onBlur={() => setIsRefreshPressed(false)}
              className={`inline-flex h-4 w-4 items-center justify-center text-[#F5F0E8]/45 transition-[color,transform,opacity] duration-150 hover:text-[#F5F0E8]/80 ${isRefreshPressed ? 'scale-90 opacity-80' : 'scale-100 opacity-100'}`}
              style={isRefreshAnimating ? { color: pocket.color_theme } : undefined}
            >
              <RefreshCw className={isRefreshAnimating ? 'h-3 w-3 animate-[spin_700ms_linear_infinite]' : 'h-3 w-3'} strokeWidth={3} />
            </button>
          </div>
          <PortfolioChart
            dataPoints={chartData}
            colorTheme={chartPerformanceColor}
            timeframe={timeframe}
            onScrub={(point) => {
              setIsScrubbing(true);
              setScrubPointValue(point.value);
            }}
            onScrubEnd={resetScrubState}
            formatScrubValues={formatChartScrubValues}
            revealFromProgress={timeframeReveal?.fromProgress ?? null}
            revealDurationMs={TIMEFRAME_CHART_REVEAL_DURATION_MS}
            revealKey={timeframeReveal?.key}
          />
        </div>

        <div className="px-4 pb-4">
          <PortfolioAllocationBar
            assets={aggregatedAssets.map((asset) => ({
              key: asset.key,
              ticker: asset.ticker,
              usdValue: asset.totalUsdValue,
            }))}
            colorTheme={pocket.color_theme}
            minSegmentPercentage={1.6}
          />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="shrink-0 text-xs font-black uppercase text-brutal-black/60">Assets</p>
          <div
            className="h-px flex-1"
            style={{ backgroundColor: `${pocket.color_theme}73` }}
          />
          <button
            type="button"
            className="portfolio-add-asset-button shrink-0 border-2 px-3 py-1 text-xs font-black uppercase tracking-wider text-[#1A1A1A]"
            style={{
              '--portfolio-pocket-accent': pocket.color_theme,
              backgroundColor: pocket.color_theme,
            } as React.CSSProperties}
            onClick={() => setIsAddOpen(true)}
          >
            ADD ASSET
          </button>
        </div>
        {aggregatedAssets.map((asset) => {
          const price = prices[asset.coingecko_id ?? '']?.usd ?? 0;
          const assetChange = asset.coingecko_id ? assetChanges[asset.coingecko_id] : undefined;
          return (
            <button
              key={asset.key}
              type="button"
              className="neo-card portfolio-active-balance-card flex w-full items-center justify-between px-3 py-2.5 text-left"
              style={{
                '--portfolio-pocket-accent': pocket.color_theme,
                '--portfolio-pocket-accent-soft': `${pocket.color_theme}24`,
              } as React.CSSProperties}
              onClick={() => setSelectedAggregateKey(asset.key)}
            >
              <div className="min-w-0">
                <p className="flex min-w-0 items-center gap-1 text-sm font-black leading-none">
                  <span>{asset.ticker}</span>
                  <span className="text-[10px] font-bold leading-none text-brutal-black/55">≈ ${price.toFixed(4)}</span>
                  {assetChange ? (
                    <span className={`text-[10px] font-bold leading-none ${assetChangeColorClass(assetChange.changePct)}`}>
                      {formatAssetChangePct(assetChange.changePct)}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs font-medium text-brutal-black/60">
                  {formatPortfolioAmount(asset.totalAmount)}
                </p>
              </div>
              <p className="text-sm font-black">{formatPortfolioIdrValue(asset.totalUsdValue)}</p>
            </button>
          );
        })}
      </section>

      <section className="pt-3">
        <p className="mb-2 text-xs font-black uppercase text-brutal-black/60">Activity Feed</p>
        <ActivityFeed logs={pocketLogs} colorTheme={pocket.color_theme} />
      </section>

      <AddAssetSheet
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        colorTheme={pocket.color_theme}
        onAdd={async (input) => {
          await addAsset({
            pocket_id: pocketId,
            ticker: input.ticker,
            amount: input.amount,
            coingecko_id: input.coingecko_id,
            location: input.location,
            holding_type: input.holding_type,
            chain: input.chain,
            note: input.note,
          }, input.note);
          await refreshPrices(pocketId);
          await refreshChartSeries(pocketId, timeframe);
        }}
      />

      <HoldingsBottomSheet
        isOpen={!!selectedAggregate}
        onClose={() => setSelectedAggregateKey(null)}
        aggregate={selectedAggregate}
        currentPriceUsd={selectedAggregate ? prices[selectedAggregate.coingecko_id ?? '']?.usd : undefined}
        idrRate={portfolioRateInfo?.rate}
        colorTheme={pocket.color_theme}
        onAddHolding={async (input) => {
          if (!selectedAggregate) return;
          await addHolding(
            {
              pocket_id: selectedAggregate.pocket_id,
              ticker: selectedAggregate.ticker,
              coingecko_id: selectedAggregate.coingecko_id,
            },
            {
              amount: input.amount,
              location: input.location,
              holding_type: input.holding_type,
              chain: input.chain,
              note: input.note,
            },
            input.note,
          );
          await refreshPrices(pocketId);
          await refreshChartSeries(pocketId, timeframe);
        }}
        onSelectHolding={(holding) => {
          setReturnAggregateKey(selectedAggregate?.key ?? null);
          setSelectedAggregateKey(null);
          setAssetAction(holding);
        }}
      />

      <AssetActionSheet
        isOpen={!!assetAction}
        onClose={() => {
          setAssetAction(null);
          setReturnAggregateKey(null);
        }}
        onBack={() => {
          setAssetAction(null);
          setSelectedAggregateKey(returnAggregateKey);
          setReturnAggregateKey(null);
        }}
        asset={assetAction}
        activityLogs={selectedHoldingLogs}
        currentPriceUsd={assetAction ? prices[assetAction.coingecko_id ?? '']?.usd : undefined}
        colorTheme={pocket.color_theme}
        onApply={async (assetId, newAmount, action, note) => {
          await updateAssetAmount(assetId, newAmount, action, note);
          await refreshPrices(pocketId);
          await refreshChartSeries(pocketId, timeframe);
        }}
        onRemove={async (assetId) => {
          await removeAsset(assetId);
          await refreshPrices(pocketId);
          await refreshChartSeries(pocketId, timeframe);
        }}
      />

      <PocketSettingsSheet
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        pocket={pocket}
        onSave={async (input) => {
          await updatePocket(pocket.id, input);
        }}
        onDelete={async () => {
          await deletePocket(pocket.id);
          onBack();
        }}
      />
    </div>
  );
};

export { PocketDetail };
