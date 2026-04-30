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

function buildMiniSparkline(points: { timestamp: number; value: number }[]): { line: string; area: string } | null {
  if (points.length < 2) return null;

  const width = 220;
  const height = 96;
  const paddingLeft = 4;
  const paddingRight = 0;
  const paddingY = 12;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const coords = points.map((point, index) => {
    const x = paddingLeft + (index / (points.length - 1)) * (width - paddingLeft - paddingRight);
    const y = paddingY + (1 - (point.value - min) / range) * (height - paddingY * 2);
    return [x, y] as const;
  });

  const line = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L ${coords[coords.length - 1][0].toFixed(2)} ${height} L ${coords[0][0].toFixed(2)} ${height} Z`;

  return { line, area };
}

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
  const [isExpanded, setIsExpanded] = useState(false);
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
  const miniSparkline = useMemo(() => buildMiniSparkline(chartData), [chartData]);
  const changeSign = changeValue >= 0 ? '+' : '-';
  const formatPortfolioIdrValue = (usdValue: number) => (
    portfolioRateInfo ? formatCurrency(usdValue * portfolioRateInfo.rate, 'IDR') : 'Rp --'
  );
  const hasAssets = aggregatedAssets.length > 0 && totalUsd > 0;
  const toggleExpanded = () => {
    setIsExpanded((current) => {
      if (current) {
        resetScrubState();
        setTimeframe('24H');
      }
      return !current;
    });
  };

  return (
    <section
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onClick={toggleExpanded}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleExpanded();
        }
      }}
      className="relative cursor-pointer overflow-hidden shadow-[4px_4px_0_0_#969696] transition-[transform,box-shadow] duration-200 md:hover:-translate-y-0.5 md:hover:shadow-[6px_8px_0_0_#969696]"
      style={{
        background: `linear-gradient(124deg, #222326 10%, #262931 42%, ${GLOBAL_ACCENT}4D 78%, ${GLOBAL_ACCENT}66 100%)`,
      }}
    >
      {hasAssets && miniSparkline && (
        <>
          <div className={`pointer-events-none absolute inset-y-0 -right-[1px] z-0 w-[66%] transition-[opacity,transform,filter] duration-300 ease-out ${
            isExpanded ? 'translate-x-4 scale-[1.03] opacity-0 blur-sm delay-0' : 'translate-x-0 scale-100 opacity-75 blur-0 delay-100'
          }`}>
            <svg
              className="h-full w-full"
              viewBox="0 0 220 96"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="total-portfolio-mini-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartPerformanceColor} stopOpacity="0.08" />
                  <stop offset="58%" stopColor={chartPerformanceColor} stopOpacity="0.04" />
                  <stop offset="100%" stopColor={chartPerformanceColor} stopOpacity="0" />
                </linearGradient>
                <linearGradient id="total-portfolio-mini-depth" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={chartPerformanceColor} stopOpacity="0" />
                  <stop offset="50%" stopColor={chartPerformanceColor} stopOpacity="0.01" />
                  <stop offset="100%" stopColor={chartPerformanceColor} stopOpacity="0.20" />
                </linearGradient>
                <linearGradient id="total-portfolio-mini-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={chartPerformanceColor} stopOpacity="0.28" />
                  <stop offset="34%" stopColor={chartPerformanceColor} stopOpacity="0.56" />
                  <stop offset="100%" stopColor={chartPerformanceColor} stopOpacity="0.92" />
                </linearGradient>
                <linearGradient id="total-portfolio-mini-alpha" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="white" stopOpacity="0" />
                  <stop offset="24%" stopColor="white" stopOpacity="0.10" />
                  <stop offset="48%" stopColor="white" stopOpacity="0.82" />
                  <stop offset="100%" stopColor="white" stopOpacity="1" />
                </linearGradient>
                <linearGradient id="total-portfolio-mini-line-alpha" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="white" stopOpacity="0.48" />
                  <stop offset="28%" stopColor="white" stopOpacity="0.68" />
                  <stop offset="100%" stopColor="white" stopOpacity="1" />
                </linearGradient>
                <mask id="total-portfolio-mini-fill-mask">
                  <rect width="220" height="96" fill="url(#total-portfolio-mini-alpha)" />
                </mask>
                <mask id="total-portfolio-mini-line-mask">
                  <rect width="220" height="96" fill="url(#total-portfolio-mini-line-alpha)" />
                </mask>
              </defs>
              <g mask="url(#total-portfolio-mini-fill-mask)">
                <path d={miniSparkline.area} fill="url(#total-portfolio-mini-fill)" />
                <path d={miniSparkline.area} fill="url(#total-portfolio-mini-depth)" />
              </g>
              <g mask="url(#total-portfolio-mini-line-mask)">
                <path
                  d={miniSparkline.line}
                  fill="none"
                  stroke="url(#total-portfolio-mini-line)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            </svg>
          </div>
          <div className={`pointer-events-none absolute inset-y-0 left-0 right-0 z-0 bg-[linear-gradient(90deg,#222326_0%,#222326_34%,rgba(34,35,38,0.72)_48%,rgba(34,35,38,0)_72%)] transition-opacity duration-300 ease-out ${
            isExpanded ? 'opacity-0 delay-0' : 'opacity-100 delay-75'
          }`} />
        </>
      )}
      <div className={`${isExpanded ? 'relative z-10 px-4 pt-4' : 'relative z-10 px-5 py-5'}`}>
        <div className={`${isExpanded ? 'mb-3' : ''} flex items-start justify-between`}>
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
            aria-hidden={!isExpanded}
            tabIndex={isExpanded ? 0 : -1}
            className={`inline-flex h-9 w-9 items-center justify-center border-2 transition-[opacity,transform,box-shadow,filter] duration-300 ease-out ${
              isExpanded
                ? 'translate-x-0 translate-y-0 scale-100 opacity-100 blur-0 delay-100'
                : 'translate-x-2 -translate-y-1 scale-90 opacity-0 blur-[1px] delay-0 pointer-events-none'
            } ${isRefreshPressed ? 'translate-x-1 translate-y-1' : ''}`}
            style={{
              borderColor: GLOBAL_ACCENT,
              color: GLOBAL_ACCENT,
              backgroundColor: 'rgba(20,20,24,0.45)',
              boxShadow: isRefreshPressed ? 'inset 0 0 0 2px #969696' : `2px 2px 0 0 #969696, inset 0 0 0 1px ${GLOBAL_ACCENT}33`,
            }}
            onClick={async (event) => {
              event.stopPropagation();
              if (!isExpanded) return;
              await refreshPrices(undefined, { force: true });
              await refreshTotalChartSeries(timeframe, { force: true });
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (!isExpanded) return;
              if (refreshReleaseTimerRef.current !== null) {
                window.clearTimeout(refreshReleaseTimerRef.current);
              }
              setIsRefreshPressed(true);
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              if (!isExpanded) return;
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
          >
            <RefreshCw className={`transition-transform duration-300 ease-out ${isExpanded ? 'rotate-0 delay-100' : '-rotate-45 delay-0'}`} size={14} />
          </button>
        </div>
      </div>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-[360ms] ease-out ${
          isExpanded && hasAssets ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className={`overflow-hidden transition-[transform,filter] duration-300 ease-out ${
          isExpanded && hasAssets ? 'translate-y-0 scale-100 blur-0' : '-translate-y-2 scale-[0.985] blur-[1px]'
        }`}>
          <div
            className={`w-full transition-[opacity,transform] duration-300 ease-out ${
              isExpanded && hasAssets ? 'translate-y-0 opacity-100 delay-75' : '-translate-y-1 opacity-0 delay-0'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
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

          <div
            className={`px-4 pb-4 transition-[opacity,transform] duration-200 ease-out ${
              isExpanded && hasAssets ? 'translate-y-0 opacity-100 delay-100' : '-translate-y-1 opacity-0 delay-0'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
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
        </div>
      </div>
    </section>
  );
};

export { TotalPortfolioCard };
