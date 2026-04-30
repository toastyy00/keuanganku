import React, { useEffect, useMemo, useRef, useState } from 'react';
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

const FRAMES: Array<'24H' | '1W' | '1M' | '1Y' | 'ALL'> = ['24H', '1W', '1M', '1Y', 'ALL'];
const CHART_GAIN_COLOR = '#22C55E';
const CHART_LOSS_COLOR = '#EF4444';
const CHART_FLAT_COLOR = '#F5F0E8';

const PocketDetail: React.FC<PocketDetailProps> = ({ pocketId, onBack }) => {
  const pockets = usePortfolioStore((s) => s.pockets);
  const assets = usePortfolioStore((s) => s.assets);
  const prices = usePortfolioStore((s) => s.prices);
  const logs = usePortfolioStore((s) => s.activityLogs);
  const chartByPocket = usePortfolioStore((s) => s.chartSeriesByPocket);
  const fetchPrices = usePortfolioStore((s) => s.fetchPrices);
  const refreshPrices = usePortfolioStore((s) => s.refreshPrices);
  const refreshChartSeries = usePortfolioStore((s) => s.refreshChartSeries);
  const addAsset = usePortfolioStore((s) => s.addAsset);
  const addHolding = usePortfolioStore((s) => s.addHolding);
  const updateAssetMetadata = usePortfolioStore((s) => s.updateAssetMetadata);
  const updateAssetAmount = usePortfolioStore((s) => s.updateAssetAmount);
  const removeAsset = usePortfolioStore((s) => s.removeAsset);
  const updatePocket = usePortfolioStore((s) => s.updatePocket);
  const deletePocket = usePortfolioStore((s) => s.deletePocket);
  const [timeframe, setTimeframe] = useState<'24H' | '1W' | '1M' | '1Y' | 'ALL'>('24H');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [assetAction, setAssetAction] = useState<PortfolioAsset | null>(null);
  const [selectedAggregateKey, setSelectedAggregateKey] = useState<string | null>(null);
  const [returnAggregateKey, setReturnAggregateKey] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const [scrubPointValue, setScrubPointValue] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isRefreshPressed, setIsRefreshPressed] = useState(false);
  const [portfolioRateInfo, setPortfolioRateInfo] = useState<PortfolioRateResult | null>(() => getCachedPortfolioIdrRate());
  const refreshReleaseTimerRef = useRef<number | null>(null);
  const resetScrubState = () => {
    setIsScrubbing(false);
    setScrubValue(null);
    setScrubPointValue(null);
  };

  const pocket = pockets.find((item) => item.id === pocketId) as PortfolioPocket | undefined;
  const pocketAssets = useMemo(() => assets.filter((item) => item.pocket_id === pocketId), [assets, pocketId]);
  const pocketLogs = useMemo(() => logs.filter((item) => item.pocket_id === pocketId).sort((a, b) => b.created_at.localeCompare(a.created_at)), [logs, pocketId]);
  const aggregatedAssets = useMemo<AggregatedPortfolioAsset[]>(() => aggregateHoldingsByTicker(pocketAssets, prices), [pocketAssets, prices]);
  const pocketAssetFingerprint = useMemo(() => buildPortfolioAssetFingerprint(pocketAssets), [pocketAssets]);
  const selectedAggregate = useMemo(() => aggregatedAssets.find((item) => item.key === selectedAggregateKey) ?? null, [aggregatedAssets, selectedAggregateKey]);
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
    };
  }, []);

  const totalUsd = pocketAssets.reduce((sum, item) => {
    const usd = prices[item.coingecko_id ?? '']?.usd ?? 0;
    return sum + usd * item.amount;
  }, 0);

  const chartData = chartByPocket[pocketId] ?? [];
  const displayValue = isScrubbing ? (scrubValue ?? totalUsd) : totalUsd;
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
  const formatPortfolioIdrValue = (usdValue: number) => (
    portfolioRateInfo ? formatCurrency(usdValue * portfolioRateInfo.rate, 'IDR') : 'Rp --'
  );

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
          <p className="text-[12px] font-black uppercase tracking-[0.18em] text-[#B8F55A]">Portfolio</p>
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
          <div className="mb-3 flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase text-brutal-black/50">Total Assets</p>
              <p className="text-2xl font-black">{formatPortfolioIdrValue(displayValue)}</p>
              <p className="text-sm font-bold text-brutal-black/60">${displayValue.toFixed(2)}</p>
              <p className={`mt-1 text-sm font-black ${changeColorClass}`}>{`${changeSign}$${Math.abs(changeValue).toFixed(2)} (${changeSign}${Math.abs(changePct).toFixed(2)}%) ${timeframe}`}</p>
            </div>
            <button
              type="button"
              className={`inline-flex h-9 w-9 items-center justify-center border-2 transition-[transform,box-shadow] duration-150 ease-out ${isRefreshPressed ? 'translate-x-1 translate-y-1' : ''}`}
              style={{
                borderColor: `${pocket.color_theme}`,
                color: `${pocket.color_theme}`,
                backgroundColor: 'rgba(20,20,24,0.45)',
                boxShadow: isRefreshPressed ? `inset 0 0 0 2px ${pocket.color_theme}` : `2px 2px 0 0 rgba(0,0,0,0.45), inset 0 0 0 1px ${pocket.color_theme}33`,
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
              onClick={() => void refreshPrices(pocketId)}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="w-full">
          <PortfolioChart
            dataPoints={chartData}
            colorTheme={chartPerformanceColor}
            timeframe={timeframe}
            onScrub={(point) => {
              setIsScrubbing(true);
              setScrubValue(point.value);
              setScrubPointValue(point.value);
            }}
            onScrubEnd={resetScrubState}
          />
        </div>

        <div className="px-4 pb-4">
          <div className="-mt-1 grid grid-cols-5 gap-1">
            {FRAMES.map((frame) => (
              <button
                key={frame}
                type="button"
                onClick={() => {
                  resetScrubState();
                  setTimeframe(frame);
                }}
                className="neo-btn-secondary px-2 py-1 text-[10px]"
                style={timeframe === frame ? { backgroundColor: pocket.color_theme, color: '#1A1A1A' } : undefined}
              >
                {frame}
              </button>
            ))}
          </div>
          <PortfolioAllocationBar
            assets={aggregatedAssets.map((asset) => ({
              ticker: asset.ticker,
              usdValue: asset.totalUsdValue,
            }))}
            colorTheme={pocket.color_theme}
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
          return (
            <button
              key={asset.key}
              type="button"
              className="neo-card portfolio-active-balance-card flex w-full items-center justify-between px-3 py-2 text-left"
              style={{
                '--portfolio-pocket-accent': pocket.color_theme,
                '--portfolio-pocket-accent-soft': `${pocket.color_theme}24`,
              } as React.CSSProperties}
              onClick={() => setSelectedAggregateKey(asset.key)}
            >
              <div>
                <p className="flex items-baseline gap-1.5 text-sm font-black">
                  <span>{asset.ticker}</span>
                  <span className="text-[10px] font-bold text-brutal-black/55">≈ ${price.toFixed(4)}</span>
                </p>
                <p className="text-xs font-medium text-brutal-black/60">
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
            coingecko_id: undefined,
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
        onSaveMetadata={async (assetId, input) => {
          await updateAssetMetadata(assetId, input);
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
