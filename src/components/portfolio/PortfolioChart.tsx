import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

interface ChartPoint {
  timestamp: number;
  value: number;
}

interface CanvasPoint {
  x: number;
  y: number;
}

interface PortfolioChartProps {
  dataPoints: ChartPoint[];
  colorTheme: string;
  timeframe: '24H' | '1W' | '1M' | '1Y' | 'ALL';
  onScrub?: (point: ChartPoint) => void;
  onScrubEnd?: () => void;
  revealFromProgress?: number | null;
  revealDurationMs?: number;
  revealKey?: string;
}

const SCRUB_GAIN_COLOR = '#22C55E';
const SCRUB_LOSS_COLOR = '#EF4444';
const SCRUB_FLAT_COLOR = '#F5F0E8';
const CHART_PAD_TOP = 28;
const CHART_PAD_BOTTOM = 14;
const SMOOTH_CURVE_TENSION = 0.18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length !== 6) return { r: 184, g: 245, b: 90 };
  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16),
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function hexToDimmedRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const luminance = r * 0.299 + g * 0.587 + b * 0.114;
  const saturation = 0.38;
  const dimR = Math.round(luminance + (r - luminance) * saturation);
  const dimG = Math.round(luminance + (g - luminance) * saturation);
  const dimB = Math.round(luminance + (b - luminance) * saturation);
  return `rgba(${dimR},${dimG},${dimB},${alpha})`;
}

function getScrubPerformanceColor(firstValue: number, currentValue: number): string {
  const changeValue = currentValue - firstValue;
  const changePct = firstValue === 0 ? 0 : (changeValue / firstValue) * 100;
  const isFlat = Math.abs(changeValue) < 0.005 && Math.abs(changePct) < 0.005;
  if (isFlat) return SCRUB_FLAT_COLOR;
  return changeValue >= 0 ? SCRUB_GAIN_COLOR : SCRUB_LOSS_COLOR;
}

function fillRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function drawSmoothPath(ctx: CanvasRenderingContext2D, points: CanvasPoint[], minY: number, maxY: number): void {
  if (points.length === 0) return;

  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) return;

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] ?? next;
    const cp1X = current.x + (next.x - previous.x) * SMOOTH_CURVE_TENSION;
    const cp1Y = Math.min(maxY, Math.max(minY, current.y + (next.y - previous.y) * SMOOTH_CURVE_TENSION));
    const cp2X = next.x - (afterNext.x - current.x) * SMOOTH_CURVE_TENSION;
    const cp2Y = Math.min(maxY, Math.max(minY, next.y - (afterNext.y - current.y) * SMOOTH_CURVE_TENSION));

    ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, next.x, next.y);
  }
}

const PortfolioChart: React.FC<PortfolioChartProps> = ({
  dataPoints,
  colorTheme,
  timeframe,
  onScrub,
  onScrubEnd,
  revealFromProgress = null,
  revealDurationMs = 0,
  revealKey,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const scrubXRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const revealRafRef = useRef<number | null>(null);
  const pulseRafRef = useRef<number | null>(null);
  const pulseStartedAtRef = useRef(0);
  const revealProgressRef = useRef(1);
  const isScrubbingRef = useRef(false);

  const yRange = useMemo(() => {
    if (dataPoints.length === 0) return { min: 0, max: 1 };
    const values = dataPoints.map((item) => item.value);
    const min = Math.min(...values);
    const max = Math.max(...values);

    if (timeframe === '24H' || timeframe === '1W') {
      const padMin = min * 0.998;
      const padMax = max * 1.002;
      return { min: Math.min(padMin, min), max: Math.max(padMax, max) };
    }

    const baseline = Math.max(0, Math.min(min * 0.98, min - (max - min) * 0.2));
    return { min: baseline, max: Math.max(max, baseline + 1) };
  }, [dataPoints, timeframe]);

  const draw = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    if (dataPoints.length === 0) return;

    const padX = 0;
    const padTop = CHART_PAD_TOP;
    const padBottom = CHART_PAD_BOTTOM;
    const plotW = width - padX * 2;
    const plotH = height - padTop - padBottom;

    const minTs = dataPoints[0].timestamp;
    const maxTs = dataPoints[dataPoints.length - 1].timestamp;
    const spanTs = Math.max(1, maxTs - minTs);
    const spanY = Math.max(1e-6, yRange.max - yRange.min);

    const toX = (timestamp: number) => padX + ((timestamp - minTs) / spanTs) * plotW;
    const toY = (value: number) => padTop + (1 - (value - yRange.min) / spanY) * plotH;
    const curvePoints = dataPoints.map((point) => ({
      x: toX(point.timestamp),
      y: toY(point.value),
    }));

    const revealProgress = scrubXRef.current === null ? clamp(revealProgressRef.current, 0, 1) : 1;
    const shouldClipReveal = revealProgress < 1;
    const firstX = curvePoints[0].x;
    const lastX = curvePoints[curvePoints.length - 1].x;

    const drawChartSegment = (
      fromX: number,
      toX: number,
      color: string,
      rgba: (hex: string, alpha: number) => string,
      alphaScale: number,
      lineWidth: number,
    ) => {
      const left = clamp(Math.min(fromX, toX), 0, width);
      const right = clamp(Math.max(fromX, toX), 0, width);
      if (right - left <= 0.5) return;

      ctx.save();
      ctx.beginPath();
      ctx.rect(left, 0, right - left, height);
      ctx.clip();

      if (shouldClipReveal) {
        ctx.beginPath();
        ctx.rect(0, 0, width * revealProgress, height);
        ctx.clip();
      }

      const fillChartArea = () => {
        ctx.beginPath();
        drawSmoothPath(ctx, curvePoints, padTop, height - padBottom);
        ctx.lineTo(lastX, height - padBottom);
        ctx.lineTo(firstX, height - padBottom);
        ctx.closePath();
      };

      const depthGradient = ctx.createLinearGradient(0, padTop, 0, height);
      depthGradient.addColorStop(0, `rgba(7, 9, 12, ${0.28 * alphaScale})`);
      depthGradient.addColorStop(0.54, `rgba(7, 9, 12, ${0.18 * alphaScale})`);
      depthGradient.addColorStop(0.88, `rgba(7, 9, 12, ${0.07 * alphaScale})`);
      depthGradient.addColorStop(1, 'rgba(7, 9, 12, 0)');
      fillChartArea();
      ctx.fillStyle = depthGradient;
      ctx.fill();

      const colorGradient = ctx.createLinearGradient(0, padTop, 0, height);
      colorGradient.addColorStop(0, rgba(color, 0.34 * alphaScale));
      colorGradient.addColorStop(0.42, rgba(color, 0.14 * alphaScale));
      colorGradient.addColorStop(0.78, rgba(color, 0.035 * alphaScale));
      colorGradient.addColorStop(1, rgba(color, 0));
      fillChartArea();
      ctx.fillStyle = colorGradient;
      ctx.fill();

      ctx.beginPath();
      drawSmoothPath(ctx, curvePoints, padTop, height - padBottom);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = rgba(color, alphaScale);
      ctx.stroke();

      ctx.restore();
    };

    if (scrubXRef.current !== null) {
      const x = clamp(scrubXRef.current, padX, width - padX);
      const ratio = width <= 0 ? 0 : x / width;
      const idx = Math.max(0, Math.min(dataPoints.length - 1, Math.round(ratio * (dataPoints.length - 1))));
      const point = dataPoints[idx];
      const dotY = curvePoints[idx]?.y ?? toY(point.value);
      const scrubColor = getScrubPerformanceColor(dataPoints[0].value, point.value);
      const timeLabel = new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(point.timestamp));

      drawChartSegment(x, width, scrubColor, hexToDimmedRgba, 0.44, 2.5);
      drawChartSegment(0, x, scrubColor, hexToRgba, 1, 2.8);

      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, height - padBottom);
      ctx.setLineDash([1.8, 1.7]);
      ctx.lineDashOffset = -((performance.now() / 120) % 3.5);
      ctx.strokeStyle = hexToRgba(scrubColor, 0.74);
      ctx.lineWidth = 1.05;
      ctx.stroke();
      ctx.setLineDash([]);

      const pulseElapsed = performance.now() - pulseStartedAtRef.current;
      const pulsePhase = (pulseElapsed % 1040) / 1040;
      const pulseEase = 1 - Math.pow(1 - pulsePhase, 2.4);
      const pulseFade = Math.pow(1 - pulsePhase, 1.7);
      const pulseRadius = 6.4 + pulseEase * 8.8;
      const pulseAlpha = Math.max(0, 0.58 * pulseFade);

      ctx.beginPath();
      ctx.arc(x, dotY, pulseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(scrubColor, pulseAlpha);
      ctx.lineWidth = 2.4 + pulseFade * 0.6;
      ctx.shadowColor = hexToRgba(scrubColor, pulseAlpha * 0.65);
      ctx.shadowBlur = 5 + pulseFade * 3;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(x, dotY, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(scrubColor, 0.26);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, dotY, 5.2, 0, Math.PI * 2);
      ctx.fillStyle = scrubColor;
      ctx.fill();

      ctx.font = '700 11px ui-sans-serif, system-ui, -apple-system, Segoe UI';
      const textWidth = ctx.measureText(timeLabel).width;
      const labelPadX = 8;
      const labelH = 20;
      const labelW = textWidth + labelPadX * 2;
      const labelX = Math.min(width - labelW - 4, Math.max(4, x - labelW / 2));
      const labelGap = 11;
      const minLabelY = 6;
      const maxLabelY = Math.max(minLabelY, height - labelH - 8);
      const labelAboveY = dotY - labelH - labelGap;
      const labelBelowY = dotY + labelGap;
      const preferredLabelY = labelAboveY >= minLabelY ? labelAboveY : labelBelowY;
      const labelY = Math.min(maxLabelY, Math.max(minLabelY, preferredLabelY));

      ctx.fillStyle = 'rgba(245, 240, 232, 0.96)';
      fillRoundedRect(ctx, labelX, labelY, labelW, labelH, 6);
      ctx.fillStyle = '#1A1A1A';
      ctx.fillText(timeLabel, labelX + labelPadX, labelY + 14);
    } else {
      drawChartSegment(0, width, colorTheme, hexToRgba, 1, 2.5);
    }
  }, [colorTheme, dataPoints, yRange.max, yRange.min]);

  const renderChart = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const dpr = window.devicePixelRatio || 1;
    const width = wrapper.clientWidth;
    const height = 200;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(width, height);
  }, [draw]);

  useLayoutEffect(() => {
    if (revealRafRef.current !== null) {
      cancelAnimationFrame(revealRafRef.current);
      revealRafRef.current = null;
    }

    if (revealFromProgress === null || revealFromProgress >= 1 || revealDurationMs <= 0) {
      revealProgressRef.current = 1;
      renderChart();
      return;
    }

    const startProgress = clamp(revealFromProgress, 0, 1);
    const duration = Math.max(80, revealDurationMs * (1 - startProgress));
    const startedAt = performance.now();
    revealProgressRef.current = startProgress;
    renderChart();

    const easeOut = (value: number) => 1 - Math.pow(1 - value, 3);
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / duration);
      revealProgressRef.current = startProgress + (1 - startProgress) * easeOut(progress);
      renderChart();

      if (progress < 1) {
        revealRafRef.current = requestAnimationFrame(tick);
      } else {
        revealRafRef.current = null;
      }
    };

    revealRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (revealRafRef.current !== null) {
        cancelAnimationFrame(revealRafRef.current);
        revealRafRef.current = null;
      }
    };
  }, [renderChart, revealDurationMs, revealFromProgress, revealKey]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    renderChart();
    const ro = new ResizeObserver(renderChart);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [renderChart]);

  const scrubAtClientX = (clientX: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper || dataPoints.length === 0) return;
    const rect = wrapper.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    scrubXRef.current = x;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!isScrubbingRef.current) return;
      const ratio = rect.width <= 0 ? 0 : x / rect.width;
      const idx = Math.max(0, Math.min(dataPoints.length - 1, Math.round(ratio * (dataPoints.length - 1))));
      onScrub?.(dataPoints[idx]);
      draw(rect.width, 200);
    });

    if (pulseRafRef.current === null) {
      const tickPulse = () => {
        const pulseWrapper = wrapperRef.current;
        if (!isScrubbingRef.current || scrubXRef.current === null || !pulseWrapper) {
          pulseRafRef.current = null;
          return;
        }

        draw(pulseWrapper.clientWidth, 200);
        pulseRafRef.current = requestAnimationFrame(tickPulse);
      };
      pulseRafRef.current = requestAnimationFrame(tickPulse);
    }
  };

  const beginScrub = () => {
    if (!isScrubbingRef.current) {
      pulseStartedAtRef.current = performance.now();
    }
    isScrubbingRef.current = true;
  };

  const endScrub = () => {
    isScrubbingRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pulseRafRef.current !== null) {
      cancelAnimationFrame(pulseRafRef.current);
      pulseRafRef.current = null;
    }
    scrubXRef.current = null;
    pulseStartedAtRef.current = 0;
    onScrubEnd?.();
    const wrapper = wrapperRef.current;
    if (wrapper) draw(wrapper.clientWidth, 200);
  };

  useEffect(() => {
    const end = () => endScrub();
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end, { passive: true });
    window.addEventListener('touchcancel', end, { passive: true });
    return () => {
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (pulseRafRef.current !== null) {
        cancelAnimationFrame(pulseRafRef.current);
        pulseRafRef.current = null;
      }
    };
  });

  return (
    <div
      ref={wrapperRef}
      className="w-full"
      onMouseDown={(e) => {
        beginScrub();
        scrubAtClientX(e.clientX);
      }}
      onMouseMove={(e) => {
        if (!isScrubbingRef.current) return;
        scrubAtClientX(e.clientX);
      }}
      onMouseLeave={endScrub}
      onMouseUp={endScrub}
      onTouchStart={(e) => {
        beginScrub();
        scrubAtClientX(e.touches[0].clientX);
      }}
      onTouchMove={(e) => {
        if (!isScrubbingRef.current) return;
        scrubAtClientX(e.touches[0].clientX);
      }}
      onTouchEnd={endScrub}
      onTouchCancel={endScrub}
    >
      <canvas ref={canvasRef} className="block w-full" />
    </div>
  );
};

export { PortfolioChart };
