import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { getCachedPortfolioIdrRate, getPortfolioIdrRate, type PortfolioRateResult } from '../../lib/exchangeRate';
import { TOTAL_PORTFOLIO_CHART_KEY, usePortfolioStore } from '../../store/usePortfolioStore';
import { aggregateHoldingsByTicker, buildPortfolioAssetFingerprint } from '../../lib/portfolio-aggregation';
import { PortfolioAllocationBar } from './PortfolioAllocationBar';
import { PortfolioChart } from './PortfolioChart';

type Timeframe = '24H' | '1W' | '1M' | '1Y';

const FRAMES: Timeframe[] = ['24H', '1W', '1M', '1Y'];
const GLOBAL_ACCENT = '#B8F55A';
const TOTAL_ALLOCATION_ACCENT = '#D8DEE9';
const CHART_GAIN_COLOR = '#22C55E';
const CHART_LOSS_COLOR = '#EF4444';
const CHART_FLAT_COLOR = '#F5F0E8';
const CARD_LOSS_ACCENT = '#F87171';
const MINI_SPARKLINE_VIEWBOX_WIDTH = 220;
const MINI_SPARKLINE_VIEWBOX_HEIGHT = 96;
const MINI_SPARKLINE_REVEAL_DELAY_MS = 140;
const MINI_SPARKLINE_REVEAL_DURATION_MS = 2100;
const MINI_SPARKLINE_GLOW_DURATION_MS = 2700;
const TIMEFRAME_CHART_REVEAL_DURATION_MS = 360;
const EMPTY_CHART_DATA: { timestamp: number; value: number }[] = [];
const MINI_SPARKLINE_CURVE_TENSION = 0.18;
const TOTAL_PORTFOLIO_EXPANDED_STORAGE_KEY = 'keuanganku-total-portfolio-expanded';

interface TotalPortfolioCardProps {
  shouldAnimateMiniSparkline?: boolean;
  onMiniSparklineRevealComplete?: () => void;
}

function buildSmoothSparklinePath(coords: ReadonlyArray<readonly [number, number]>): string {
  if (coords.length === 0) return '';

  const [startX, startY] = coords[0];
  const segments = [`M ${startX.toFixed(2)} ${startY.toFixed(2)}`];

  for (let index = 0; index < coords.length - 1; index += 1) {
    const previous = coords[index - 1] ?? coords[index];
    const current = coords[index];
    const next = coords[index + 1];
    const afterNext = coords[index + 2] ?? next;
    const cp1X = current[0] + (next[0] - previous[0]) * MINI_SPARKLINE_CURVE_TENSION;
    const cp1Y = current[1] + (next[1] - previous[1]) * MINI_SPARKLINE_CURVE_TENSION;
    const cp2X = next[0] - (afterNext[0] - current[0]) * MINI_SPARKLINE_CURVE_TENSION;
    const cp2Y = next[1] - (afterNext[1] - current[1]) * MINI_SPARKLINE_CURVE_TENSION;

    segments.push(
      `C ${cp1X.toFixed(2)} ${cp1Y.toFixed(2)}, ${cp2X.toFixed(2)} ${cp2Y.toFixed(2)}, ${next[0].toFixed(2)} ${next[1].toFixed(2)}`,
    );
  }

  return segments.join(' ');
}

function buildMiniSparkline(points: { timestamp: number; value: number }[]): { line: string; area: string } | null {
  if (points.length < 2) return null;

  const width = MINI_SPARKLINE_VIEWBOX_WIDTH;
  const height = MINI_SPARKLINE_VIEWBOX_HEIGHT;
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

  const line = buildSmoothSparklinePath(coords);
  const area = `${line} L ${coords[coords.length - 1][0].toFixed(2)} ${height} L ${coords[0][0].toFixed(2)} ${height} Z`;

  return { line, area };
}

function getChartSeriesSignature(points: { timestamp: number; value: number }[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  return `${points.length}:${first?.timestamp ?? 0}:${last?.timestamp ?? 0}:${first?.value ?? 0}:${last?.value ?? 0}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeSparklineReveal(value: number): number {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeFullChartReveal(value: number): number {
  const t = clamp(value, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function getInitialExpandedState(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(TOTAL_PORTFOLIO_EXPANDED_STORAGE_KEY) === 'true';
}

const TotalPortfolioCard: React.FC<TotalPortfolioCardProps> = ({
  shouldAnimateMiniSparkline: shouldAnimateMiniSparklineProp = true,
  onMiniSparklineRevealComplete,
}) => {
  const assets = usePortfolioStore((s) => s.assets);
  const prices = usePortfolioStore((s) => s.prices);
  const chartByPocket = usePortfolioStore((s) => s.chartSeriesByPocket);
  const fetchAllPrices = usePortfolioStore((s) => s.fetchAllPrices);
  const refreshPrices = usePortfolioStore((s) => s.refreshPrices);
  const refreshTotalChartSeries = usePortfolioStore((s) => s.refreshTotalChartSeries);
  const [timeframe, setTimeframe] = useState<Timeframe>('24H');
  const [portfolioRateInfo, setPortfolioRateInfo] = useState<PortfolioRateResult | null>(() => getCachedPortfolioIdrRate());
  const [scrubPointValue, setScrubPointValue] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isRefreshPressed, setIsRefreshPressed] = useState(false);
  const [isRefreshAnimating, setIsRefreshAnimating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(getInitialExpandedState);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [fullChartReveal, setFullChartReveal] = useState<{ fromProgress: number; key: string } | null>(null);
  const [timeframeReveal, setTimeframeReveal] = useState<{ fromProgress: number; key: string } | null>(null);
  const [miniSparklineRevealProgress, setMiniSparklineRevealProgress] = useState(1);
  const [fullChartRevealProgress, setFullChartRevealProgress] = useState(1);
  const refreshReleaseTimerRef = useRef<number | null>(null);
  const refreshAnimationTimerRef = useRef<number | null>(null);
  const miniSparklineRevealStartedAtRef = useRef<number | null>(null);
  const miniSparklineRevealFrameRef = useRef<number | null>(null);
  const fullChartRevealFrameRef = useRef<number | null>(null);
  const pendingTimeframeRevealRef = useRef<{ timeframe: Timeframe; previousSignature: string } | null>(null);

  const resetScrubState = () => {
    setIsScrubbing(false);
    setScrubPointValue(null);
  };

  const refreshTotalChart = async () => {
    if (refreshAnimationTimerRef.current !== null) {
      window.clearTimeout(refreshAnimationTimerRef.current);
    }
    setIsRefreshAnimating(true);
    try {
      await refreshPrices(undefined, { force: true });
      await refreshTotalChartSeries(timeframe, { force: true });
    } finally {
      refreshAnimationTimerRef.current = window.setTimeout(() => {
        setIsRefreshAnimating(false);
        refreshAnimationTimerRef.current = null;
      }, 220);
    }
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
      if (refreshAnimationTimerRef.current !== null) {
        window.clearTimeout(refreshAnimationTimerRef.current);
      }
      if (miniSparklineRevealFrameRef.current !== null) {
        window.cancelAnimationFrame(miniSparklineRevealFrameRef.current);
        miniSparklineRevealFrameRef.current = null;
      }
      if (fullChartRevealFrameRef.current !== null) {
        window.cancelAnimationFrame(fullChartRevealFrameRef.current);
        fullChartRevealFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    handleChange();

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const totalUsd = aggregatedAssets.reduce((sum, asset) => sum + asset.totalUsdValue, 0);
  const chartData = chartByPocket[TOTAL_PORTFOLIO_CHART_KEY] ?? EMPTY_CHART_DATA;
  const chartSignature = useMemo(() => getChartSeriesSignature(chartData), [chartData]);
  const displayValue = totalUsd;
  const firstPointValue = chartData[0]?.value ?? 0;
  const latestPointValue = chartData[chartData.length - 1]?.value ?? 0;
  const displayedChangeProgress = isExpanded ? fullChartRevealProgress : easeSparklineReveal(miniSparklineRevealProgress);
  const shouldAnimateDisplayedChange = !isScrubbing && displayedChangeProgress < 1 && chartData.length > 1;
  const animatedPointIndex = shouldAnimateDisplayedChange ? Math.max(0, Math.min(chartData.length - 1, Math.round(displayedChangeProgress * (chartData.length - 1)))) : chartData.length - 1;
  const animatedPointValue = chartData[animatedPointIndex]?.value ?? latestPointValue;
  const endPointValue = isScrubbing ? (scrubPointValue ?? latestPointValue) : shouldAnimateDisplayedChange ? animatedPointValue : latestPointValue;
  const stableChangeValue = latestPointValue - firstPointValue;
  const stableChangePct = firstPointValue === 0 ? 0 : (stableChangeValue / firstPointValue) * 100;
  const changeValue = endPointValue - firstPointValue;
  const changePct = firstPointValue === 0 ? 0 : (changeValue / firstPointValue) * 100;
  const isStableChangeFlat = Math.abs(stableChangeValue) < 0.005 && Math.abs(stableChangePct) < 0.005;
  const isStableChangePositive = stableChangeValue >= 0;
  const isDisplayChangeFlat = Math.abs(changeValue) < 0.005 && Math.abs(changePct) < 0.005;
  const isDisplayChangePositive = changeValue >= 0;
  const changeColorClass = isDisplayChangeFlat ? 'text-[#F5F0E8]' : isDisplayChangePositive ? 'text-[#22C55E]' : 'text-[#EF4444]';
  const chartPerformanceColor = isStableChangeFlat ? CHART_FLAT_COLOR : isStableChangePositive ? CHART_GAIN_COLOR : CHART_LOSS_COLOR;
  const cardAccentColor = isStableChangePositive || isStableChangeFlat ? GLOBAL_ACCENT : CARD_LOSS_ACCENT;
  const miniSparkline = useMemo(() => buildMiniSparkline(chartData), [chartData]);
  const changeSign = changeValue >= 0 ? '+' : '-';
  const formatPortfolioIdrValue = useCallback(
    (usdValue: number) => (portfolioRateInfo ? formatCurrency(usdValue * portfolioRateInfo.rate, 'IDR') : 'Rp --'),
    [portfolioRateInfo],
  );
  const formatChartScrubValues = useCallback(
    (value: number) => [
      formatPortfolioIdrValue(value),
      formatCurrency(value, 'USD'),
    ],
    [formatPortfolioIdrValue],
  );
  const hasAssets = aggregatedAssets.length > 0 && totalUsd > 0;
  const shouldAnimateMiniSparkline = hasAssets && !!miniSparkline && shouldAnimateMiniSparklineProp && !prefersReducedMotion;

  useLayoutEffect(() => {
    const pendingReveal = pendingTimeframeRevealRef.current;
    if (!pendingReveal || pendingReveal.timeframe !== timeframe || pendingReveal.previousSignature === chartSignature) return;

    pendingTimeframeRevealRef.current = null;
    setTimeframeReveal({ fromProgress: 0, key: `${pendingReveal.timeframe}-${chartSignature}` });
  }, [chartSignature, timeframe]);

  useEffect(() => {
    if (!hasAssets || !miniSparkline || !shouldAnimateMiniSparklineProp) {
      const resetFrame = window.requestAnimationFrame(() => setMiniSparklineRevealProgress(1));
      return () => window.cancelAnimationFrame(resetFrame);
    }

    if (prefersReducedMotion) {
      miniSparklineRevealStartedAtRef.current = null;
      const resetFrame = window.requestAnimationFrame(() => setMiniSparklineRevealProgress(1));
      onMiniSparklineRevealComplete?.();
      return () => window.cancelAnimationFrame(resetFrame);
    }

    miniSparklineRevealStartedAtRef.current = performance.now();

    const animateProgress = () => {
      const startedAt = miniSparklineRevealStartedAtRef.current;
      if (startedAt === null) return;

      const elapsed = performance.now() - startedAt - MINI_SPARKLINE_REVEAL_DELAY_MS;
      const progress = clamp(elapsed / MINI_SPARKLINE_REVEAL_DURATION_MS, 0, 1);
      setMiniSparklineRevealProgress(progress);

      if (progress < 1) {
        miniSparklineRevealFrameRef.current = window.requestAnimationFrame(animateProgress);
      } else {
        miniSparklineRevealFrameRef.current = null;
      }
    };

    miniSparklineRevealFrameRef.current = window.requestAnimationFrame(animateProgress);

    const revealTimer = window.setTimeout(() => {
      miniSparklineRevealStartedAtRef.current = null;
      setMiniSparklineRevealProgress(1);
      onMiniSparklineRevealComplete?.();
    }, 2900);

    return () => {
      window.clearTimeout(revealTimer);
      miniSparklineRevealStartedAtRef.current = null;
      if (miniSparklineRevealFrameRef.current !== null) {
        window.cancelAnimationFrame(miniSparklineRevealFrameRef.current);
        miniSparklineRevealFrameRef.current = null;
      }
    };
  }, [hasAssets, miniSparkline, onMiniSparklineRevealComplete, prefersReducedMotion, shouldAnimateMiniSparklineProp]);

  useEffect(() => {
    if (!fullChartReveal || fullChartReveal.fromProgress >= 1 || MINI_SPARKLINE_REVEAL_DURATION_MS <= 0) {
      const resetFrame = window.requestAnimationFrame(() => setFullChartRevealProgress(1));
      return () => window.cancelAnimationFrame(resetFrame);
    }

    const startProgress = clamp(fullChartReveal.fromProgress, 0, 1);
    const duration = Math.max(80, MINI_SPARKLINE_REVEAL_DURATION_MS * (1 - startProgress));
    const startedAt = performance.now();

    const animateProgress = (now: number) => {
      const elapsed = now - startedAt;
      const progress = clamp(elapsed / duration, 0, 1);
      setFullChartRevealProgress(startProgress + (1 - startProgress) * easeFullChartReveal(progress));

      if (progress < 1) {
        fullChartRevealFrameRef.current = window.requestAnimationFrame(animateProgress);
      } else {
        fullChartRevealFrameRef.current = null;
      }
    };

    fullChartRevealFrameRef.current = window.requestAnimationFrame(animateProgress);

    return () => {
      if (fullChartRevealFrameRef.current !== null) {
        window.cancelAnimationFrame(fullChartRevealFrameRef.current);
        fullChartRevealFrameRef.current = null;
      }
    };
  }, [fullChartReveal]);

  const getMiniSparklineRevealProgress = () => {
    const startedAt = miniSparklineRevealStartedAtRef.current;
    if (startedAt === null) return 1;

    const elapsed = performance.now() - startedAt - MINI_SPARKLINE_REVEAL_DELAY_MS;
    return Math.max(0, Math.min(1, elapsed / MINI_SPARKLINE_REVEAL_DURATION_MS));
  };

  const toggleExpanded = () => {
    setIsExpanded((current) => {
      const nextExpanded = !current;
      if (!current) {
        const fromProgress = shouldAnimateMiniSparkline ? getMiniSparklineRevealProgress() : 1;
        setFullChartRevealProgress(fromProgress);
        setFullChartReveal(
          fromProgress < 1
            ? { fromProgress, key: `${timeframe}-${chartData.length}-${chartData[0]?.timestamp ?? 0}-${chartData[chartData.length - 1]?.timestamp ?? 0}` }
            : null
        );
      }
      if (current) {
        resetScrubState();
        setTimeframe('24H');
        setFullChartReveal(null);
        setFullChartRevealProgress(1);
      }
      window.localStorage.setItem(TOTAL_PORTFOLIO_EXPANDED_STORAGE_KEY, String(nextExpanded));
      return nextExpanded;
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
      className="relative cursor-pointer overflow-hidden rounded-lg shadow-[4px_4px_0_0_#969696] transition-[transform,box-shadow] duration-200 md:hover:-translate-y-0.5 md:hover:shadow-[6px_8px_0_0_#969696]"
      style={{
        background: `linear-gradient(124deg, #222326 10%, #262931 42%, ${cardAccentColor}4D 78%, ${cardAccentColor}66 100%)`,
      }}
    >
      {hasAssets && miniSparkline && (
        <>
          <div
            className={`pointer-events-none absolute inset-y-0 -right-[1px] z-0 w-[66%] transition-[opacity,transform,filter] duration-300 ease-out ${
              isExpanded ? 'translate-x-4 scale-[1.03] opacity-0 blur-sm delay-0' : 'translate-x-0 scale-100 opacity-75 blur-0 delay-100'
            }`}
          >
            <svg className="h-full w-full" viewBox="0 0 220 96" preserveAspectRatio="none" aria-hidden="true">
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
                  <stop offset="0%" stopColor={chartPerformanceColor} stopOpacity="0.38" />
                  <stop offset="30%" stopColor={chartPerformanceColor} stopOpacity="0.60" />
                  <stop offset="100%" stopColor={chartPerformanceColor} stopOpacity="0.92" />
                </linearGradient>
                <linearGradient id="total-portfolio-mini-glow" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={chartPerformanceColor} stopOpacity="0" />
                  <stop offset="72%" stopColor={chartPerformanceColor} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={chartPerformanceColor} stopOpacity="0.95" />
                </linearGradient>
                <linearGradient id="total-portfolio-mini-alpha" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="white" stopOpacity="0" />
                  <stop offset="24%" stopColor="white" stopOpacity="0.10" />
                  <stop offset="48%" stopColor="white" stopOpacity="0.82" />
                  <stop offset="100%" stopColor="white" stopOpacity="1" />
                </linearGradient>
                <linearGradient id="total-portfolio-mini-line-alpha" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="white" stopOpacity="0.58" />
                  <stop offset="24%" stopColor="white" stopOpacity="0.76" />
                  <stop offset="100%" stopColor="white" stopOpacity="1" />
                </linearGradient>
                <mask id="total-portfolio-mini-fill-mask">
                  <rect width="220" height="96" fill="url(#total-portfolio-mini-alpha)" />
                </mask>
                <mask id="total-portfolio-mini-line-mask">
                  <rect width="220" height="96" fill="url(#total-portfolio-mini-line-alpha)" />
                </mask>
                <clipPath id="total-portfolio-mini-reveal-clip">
                  <rect
                    width={shouldAnimateMiniSparkline ? 0 : MINI_SPARKLINE_VIEWBOX_WIDTH}
                    height={MINI_SPARKLINE_VIEWBOX_HEIGHT}
                  >
                    {shouldAnimateMiniSparkline && (
                      <animate
                        attributeName="width"
                        values={`0;${MINI_SPARKLINE_VIEWBOX_WIDTH}`}
                        dur={`${MINI_SPARKLINE_REVEAL_DURATION_MS / 1000}s`}
                        begin={`${MINI_SPARKLINE_REVEAL_DELAY_MS}ms`}
                        fill="freeze"
                        calcMode="spline"
                        keyTimes="0;1"
                        keySplines="0.4 0 0.2 1"
                      />
                    )}
                  </rect>
                </clipPath>
              </defs>
              <g clipPath="url(#total-portfolio-mini-reveal-clip)">
                <g mask="url(#total-portfolio-mini-fill-mask)">
                  <path d={miniSparkline.area} fill="url(#total-portfolio-mini-fill)" />
                  <path d={miniSparkline.area} fill="url(#total-portfolio-mini-depth)" />
                </g>
                <g mask="url(#total-portfolio-mini-line-mask)">
                  {shouldAnimateMiniSparkline && (
                    <path
                      d={miniSparkline.line}
                      fill="none"
                      stroke="url(#total-portfolio-mini-glow)"
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      opacity="0.38"
                      filter="blur(1.6px)"
                    >
                      <animate
                        attributeName="opacity"
                        values="0;0.28;0.38;0.34;0.22;0.08;0"
                        keyTimes="0;0.12;0.26;0.7;0.84;0.94;1"
                        dur={`${MINI_SPARKLINE_GLOW_DURATION_MS / 1000}s`}
                        begin={`${MINI_SPARKLINE_REVEAL_DELAY_MS}ms`}
                        fill="freeze"
                        calcMode="spline"
                        keySplines="0.22 0.61 0.36 1;0.22 0.61 0.36 1;0.4 0 0.2 1;0.33 0 0.2 1;0.45 0 0.2 1;0.4 0 0.2 1"
                      />
                    </path>
                  )}
                  <path
                    d={miniSparkline.line}
                    fill="none"
                    stroke="url(#total-portfolio-mini-line)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={shouldAnimateMiniSparkline ? 0.94 : 1}
                  />
                </g>
              </g>
            </svg>
          </div>
          <div
            className={`pointer-events-none absolute inset-y-0 left-0 right-0 z-0 bg-[linear-gradient(90deg,#222326_0%,rgba(34,35,38,0.94)_22%,rgba(34,35,38,0.52)_42%,rgba(34,35,38,0)_62%)] transition-opacity duration-300 ease-out ${
              isExpanded ? 'opacity-0 delay-0' : 'opacity-100 delay-75'
            }`}
          />
        </>
      )}
      <div className={`relative z-10 transition-[padding,transform] duration-300 ease-out ${isExpanded ? 'px-4 pt-4' : 'px-5 py-5'}`}>
        <div className={`flex items-start justify-between transition-[margin] duration-300 ease-out ${isExpanded ? 'mb-3' : 'mb-0'}`}>
          <div className={`transition-[transform,filter] duration-300 ease-out ${isExpanded ? 'translate-y-0 blur-0' : 'translate-y-0.5 blur-0'}`}>
            <p className={`text-xs font-black uppercase text-brutal-black/50 transition-[opacity,transform] duration-300 ease-out ${isExpanded ? 'translate-y-0 opacity-100 delay-75' : 'translate-y-0 opacity-90 delay-0'}`}>
              Total Pockets
            </p>
            <p className={`text-2xl font-black transition-[opacity,transform] duration-300 ease-out ${isExpanded ? 'translate-y-0 opacity-100 delay-100' : 'translate-y-0.5 opacity-100 delay-0'}`}>{formatPortfolioIdrValue(displayValue)}</p>
            <p className={`text-sm font-bold text-brutal-black/60 transition-[opacity,transform] duration-300 ease-out ${isExpanded ? 'translate-y-0 opacity-100 delay-100' : 'translate-y-0.5 opacity-95 delay-0'}`}>
              {formatCurrency(displayValue, 'USD')}
            </p>
            {hasAssets ? (
              <p
                className={`mt-1 text-sm font-black transition-[opacity,transform] duration-300 ease-out ${isExpanded ? 'translate-y-0 opacity-100 delay-150' : 'translate-y-1 opacity-100 delay-0'} ${changeColorClass}`}
              >{`${changeSign}${formatCurrency(Math.abs(changeValue), 'USD')} (${changeSign}${Math.abs(changePct).toFixed(2)}%) ${timeframe}`}</p>
            ) : (
              <p className={`mt-1 text-sm font-black text-[#F5F0E8] transition-[opacity,transform] duration-300 ease-out ${isExpanded ? 'translate-y-0 opacity-100 delay-150' : 'translate-y-1 opacity-100 delay-0'}`}>
                No pocket assets yet
              </p>
            )}
          </div>
        </div>
      </div>

      <div className={`grid transition-[grid-template-rows,opacity] duration-[360ms] ease-out ${isExpanded && hasAssets ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className={`overflow-hidden transition-[transform,filter] duration-300 ease-out ${isExpanded && hasAssets ? 'translate-y-0 scale-100 blur-0' : '-translate-y-2 scale-[0.985] blur-[1px]'}`}>
          <div className={`relative w-full transition-[opacity,transform] duration-300 ease-out ${isExpanded && hasAssets ? 'translate-y-0 opacity-100 delay-75' : '-translate-y-1 opacity-0 delay-0'}`} onClick={(event) => event.stopPropagation()}>
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
                      setFullChartReveal(null);
                      setFullChartRevealProgress(1);
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
                onClick={(event) => {
                  event.stopPropagation();
                  void refreshTotalChart();
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (refreshReleaseTimerRef.current !== null) {
                    window.clearTimeout(refreshReleaseTimerRef.current);
                  }
                  setIsRefreshPressed(true);
                }}
                onPointerUp={(event) => {
                  event.stopPropagation();
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
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshAnimating ? 'animate-[spin_700ms_linear_infinite] text-[#B8F55A]' : ''}`} strokeWidth={3} />
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
              revealFromProgress={fullChartReveal?.fromProgress ?? timeframeReveal?.fromProgress ?? null}
              revealDurationMs={fullChartReveal ? MINI_SPARKLINE_REVEAL_DURATION_MS : TIMEFRAME_CHART_REVEAL_DURATION_MS}
              revealKey={fullChartReveal?.key ?? timeframeReveal?.key}
            />
          </div>

          <div
            className={`px-4 pb-4 transition-[opacity,transform] duration-200 ease-out ${isExpanded && hasAssets ? 'translate-y-0 opacity-100 delay-100' : '-translate-y-1 opacity-0 delay-0'}`}
            onClick={(event) => event.stopPropagation()}
          >
            <PortfolioAllocationBar
              assets={aggregatedAssets.map((asset) => ({
                key: asset.key,
                ticker: asset.ticker,
                usdValue: asset.totalUsdValue,
              }))}
              colorTheme={TOTAL_ALLOCATION_ACCENT}
              collapsible
              tone="dark"
              minSegmentPercentage={1.6}
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export { TotalPortfolioCard };
