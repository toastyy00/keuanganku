import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Plus, RefreshCw } from 'lucide-react';
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
const CHART_GAIN_COLOR = '#1B9066';
const CHART_LOSS_COLOR = '#B93E50';
const CHART_FLAT_COLOR = '#F5F0E8';
const TIMEFRAME_CHART_REVEAL_DURATION_MS = 360;
const EMPTY_CHART_DATA: { timestamp: number; value: number }[] = [];

function getChartSeriesSignature(points: { timestamp: number; value: number }[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  return `${points.length}:${first?.timestamp ?? 0}:${last?.timestamp ?? 0}:${first?.value ?? 0}:${last?.value ?? 0}`;
}

function assetChangeColorClass(changePct: number): string {
  if (Math.abs(changePct) < 0.005) return 'text-white/40';
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
  const [isActivityExpanded, setIsActivityExpanded] = useState(false);
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
      <div className="sticky top-0 z-30 -mx-4 -mt-6 flex items-center justify-between bg-[#1A1A1A] px-4 pb-3 pt-6 md:-mx-6 md:px-6 select-none">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.08] hover:border-white/20 text-white/50 hover:text-white transition-all active:scale-95 shrink-0 shadow-sm"
          aria-label="Back to pockets"
        >
          <ArrowLeft size={16} strokeWidth={2.5} />
        </button>
        <div className="flex items-center gap-1.5 text-[15px] font-black uppercase tracking-[0.12em] text-right min-w-0">
          <span className="text-[#B8F55A]">Pockets</span>
          <span className="text-white/20 font-medium">/</span>
          <span className="truncate max-w-[120px] sm:max-w-[200px]" style={{ color: pocket.color_theme }}>{pocket.name}</span>
        </div>
      </div>

      <section
        className="rounded-2xl border overflow-hidden transition-[border-color,box-shadow] duration-200 hover:!border-white/[0.18]"
        style={{
          borderColor: `${pocket.color_theme}1C`,
          background: `radial-gradient(circle at 100% 100%, ${pocket.color_theme}12, transparent 65%), linear-gradient(135deg, #1E2025 0%, #151619 50%, #111214 100%)`,
          boxShadow: '0 12px 35px -5px rgba(0, 0, 0, 0.45)',
        }}
      >
        <div className="px-5 pt-5">
          <div className="mb-2 flex items-start">
            <div>
              <p className="text-xs font-black uppercase text-white/40">Total Assets</p>
              <p className="text-2xl font-black text-[#F5F0E8] mt-0.5 leading-tight">{formatPortfolioIdrValue(displayValue)}</p>
              <p className="text-sm font-bold text-white/50">${displayValue.toFixed(2)}</p>
              <p className={`mt-1.5 text-sm font-black ${changeColorClass}`}>{`${changeSign}$${Math.abs(changeValue).toFixed(2)} (${changeSign}${Math.abs(changePct).toFixed(2)}%) ${timeframe}`}</p>
            </div>
          </div>
        </div>

        <div className="relative w-full h-[135px]">
          <div
            className={`absolute right-5 top-1 z-10 flex items-center gap-1.5 text-[9px] font-black uppercase leading-none tracking-[0.04em] transition-opacity duration-150 ${isScrubbing ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
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

        <div className="px-5 pb-5 pt-1.5">
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 mr-4">
            <p className="shrink-0 text-xs font-black uppercase text-white/40">Assets</p>
            <div className="h-[1px] flex-1" style={{ backgroundColor: `${pocket.color_theme}1F` }} />
          </div>
          <button
            type="button"
            onClick={() => setIsAddOpen(true)}
            className="h-7 px-2.5 rounded-lg border text-[9px] font-black uppercase tracking-wider transition-all duration-200 hover:bg-white/[0.04] active:scale-[0.96] flex items-center gap-1.5 shrink-0 select-none"
            style={{
              borderColor: `${pocket.color_theme}4D`,
              color: pocket.color_theme,
            }}
          >
            <Plus size={10} strokeWidth={3} />
            <span>Add Asset</span>
          </button>
        </div>
        {aggregatedAssets.map((asset) => {
          const price = prices[asset.coingecko_id ?? '']?.usd ?? 0;
          const assetChange = asset.coingecko_id ? assetChanges[asset.coingecko_id] : undefined;
          return (
            <button
              key={asset.key}
              type="button"
              className="w-full rounded-2xl border bg-white/[0.01] hover:bg-white/[0.03] transition-all duration-200 px-4 py-3 flex items-center justify-between text-left cursor-pointer active:scale-[0.99] outline-none hover:translate-x-1"
              style={{
                borderColor: `${pocket.color_theme}1C`,
              }}
              onClick={() => setSelectedAggregateKey(asset.key)}
            >
              <div className="min-w-0">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-bold leading-none">
                  <span style={{ color: pocket.color_theme }}>{asset.ticker}</span>
                  <span className="text-[10px] font-semibold leading-none text-white/40">≈ ${price.toFixed(4)}</span>
                  {assetChange ? (
                    <span className={`text-[10px] font-semibold leading-none ${assetChangeColorClass(assetChange.changePct)}`}>
                      {formatAssetChangePct(assetChange.changePct)}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1.5 text-xs font-medium text-white/50">
                  {formatPortfolioAmount(asset.totalAmount)}
                </p>
              </div>
              <p className="text-sm font-bold text-[#F5F0E8]">{formatPortfolioIdrValue(asset.totalUsdValue)}</p>
            </button>
          );
        })}
      </section>

      <section className="pt-3">
        <button
          type="button"
          onClick={() => setIsActivityExpanded(!isActivityExpanded)}
          className="flex w-full items-center justify-between py-1.5 text-left outline-none group select-none"
        >
          <div className="flex items-center gap-3 flex-1 mr-4">
            <p className="shrink-0 text-xs font-black uppercase tracking-[0.2em] text-white/40 group-hover:text-white/60 transition-colors">
              Activity Feed
            </p>
            <div className="h-[1px] flex-1 transition-colors" style={{ backgroundColor: `${pocket.color_theme}1F` }} />
          </div>
          <span className="text-white/30 group-hover:text-white/60 transition-colors shrink-0">
            <ChevronDown
              size={15}
              strokeWidth={2.5}
              className={`transform transition-transform duration-200 ${isActivityExpanded ? 'rotate-180' : 'rotate-0'}`}
            />
          </span>
        </button>

        <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${isActivityExpanded ? 'grid-rows-[1fr] opacity-100 mt-2.5' : 'grid-rows-[0fr] opacity-0 mt-0'}`}>
          <div className="overflow-hidden">
            <ActivityFeed logs={pocketLogs} colorTheme={pocket.color_theme} />
          </div>
        </div>
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
