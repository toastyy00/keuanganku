import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { getCachedPortfolioIdrRate, getPortfolioIdrRate, type PortfolioRateResult } from '../../lib/exchangeRate';
import { TOTAL_PORTFOLIO_CHART_KEY, usePortfolioStore } from '../../store/usePortfolioStore';
import { aggregateHoldingsByTicker, buildPortfolioAssetFingerprint } from '../../lib/portfolio-aggregation';
import { PortfolioAllocationBar } from './PortfolioAllocationBar';
import { PortfolioChart } from './PortfolioChart';

type Timeframe = '24H' | '1W' | '1M' | '1Y' | 'ALL';

const FRAMES: Timeframe[] = ['24H', '1W', '1M', '1Y', 'ALL'];
const GLOBAL_ACCENT = '#B8F55A';
const CHART_GAIN_COLOR = '#22C55E';
const CHART_LOSS_COLOR = '#EF4444';
const CHART_FLAT_COLOR = '#F5F0E8';

const TotalPortfolioCard: React.FC = () => {
  const assets = usePortfolioStore((s) => s.assets);
  const prices = usePortfolioStore((s) => s.prices);
  const chartByPocket = usePortfolioStore((s) => s.chartSeriesByPocket);
  const fetchAllPrices = usePortfolioStore((s) => s.fetchAllPrices);
  const refreshPrices = usePortfolioStore((s) => s.refreshPrices);
  const refreshTotalChartSeries = usePortfolioStore((s) => s.refreshTotalChartSeries);
  const [timeframe, setTimeframe] = useState<Timeframe>('24H');
  const [portfolioRateInfo, setPortfolioRateInfo] = useState<PortfolioRateResult | null>(() => getCachedPortfolioIdrRate());
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const [scrubPointValue, setScrubPointValue] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isRefreshPressed, setIsRefreshPressed] = useState(false);
  const refreshReleaseTimerRef = useRef<number | null>(null);

  const resetScrubState = () => {
    setIsScrubbing(false);
    setScrubValue(null);
    setScrubPointValue(null);
  };

  const aggregatedAssets = useMemo(() => aggregateHoldingsByTicker(assets, prices), [assets, prices]);

  const assetFingerprint = useMemo(() => buildPortfolioAssetFingerprint(assets), [assets]);

  useEffect(() => {
    void fetchAllPrices();
  }, [assetFingerprint, fetchAllPrices]);

  useEffect(() => {
    void refreshTotalChartSeries(timeframe);
  }, [assetFingerprint, refreshTotalChartSeries, timeframe]);

  useEffect(() => {
    let isCancelled = false;
    getPortfolioIdrRate().then((rateInfo) => {
      if (!isCancelled && rateInfo) setPortfolioRateInfo(rateInfo);
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (refreshReleaseTimerRef.current !== null) {
        window.clearTimeout(refreshReleaseTimerRef.current);
      }
    };
  }, []);

  const totalUsd = aggregatedAssets.reduce((sum, asset) => sum + asset.totalUsdValue, 0);
  const chartData = chartByPocket[TOTAL_PORTFOLIO_CHART_KEY] ?? [];
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
  const hasAssets = aggregatedAssets.length > 0 && totalUsd > 0;

  return (
    <section
      className="overflow-hidden shadow-[4px_4px_0_0_#969696]"
      style={{
        background: `linear-gradient(124deg, #222326 10%, #262931 42%, ${GLOBAL_ACCENT}4D 78%, ${GLOBAL_ACCENT}66 100%)`,
      }}
    >
      <div className="px-4 pt-4">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <p className="text-xs font-black uppercase text-brutal-black/50">Total Portfolio</p>
            <p className="text-2xl font-black">{formatPortfolioIdrValue(displayValue)}</p>
            <p className="text-sm font-bold text-brutal-black/60">${displayValue.toFixed(2)}</p>
            {hasAssets ? (
              <p className={`mt-1 text-sm font-black ${changeColorClass}`}>{`${changeSign}$${Math.abs(changeValue).toFixed(2)} (${changeSign}${Math.abs(changePct).toFixed(2)}%) ${timeframe}`}</p>
            ) : (
              <p className="mt-1 text-sm font-black text-[#F5F0E8]">No portfolio assets yet</p>
            )}
          </div>
          <button
            type="button"
            className={`inline-flex h-9 w-9 items-center justify-center border-2 transition-[transform,box-shadow] duration-150 ease-out ${isRefreshPressed ? 'translate-x-1 translate-y-1' : ''}`}
            style={{
              borderColor: GLOBAL_ACCENT,
              color: GLOBAL_ACCENT,
              backgroundColor: 'rgba(20,20,24,0.45)',
              boxShadow: isRefreshPressed ? `inset 0 0 0 2px ${GLOBAL_ACCENT}` : `2px 2px 0 0 rgba(0,0,0,0.45), inset 0 0 0 1px ${GLOBAL_ACCENT}33`,
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
            onClick={async () => {
              await refreshPrices();
              await refreshTotalChartSeries(timeframe);
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {hasAssets && (
        <>
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
                  style={timeframe === frame ? { backgroundColor: GLOBAL_ACCENT, color: '#1A1A1A' } : undefined}
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
              colorTheme={GLOBAL_ACCENT}
              collapsible
            />
          </div>
        </>
      )}
    </section>
  );
};

export { TotalPortfolioCard };
