import React, { useCallback, useEffect, useMemo, useRef } from 'react';

interface ChartPoint {
  timestamp: number;
  value: number;
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

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length !== 6) return `rgba(184,245,90,${alpha})`;
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getScrubPerformanceColor(firstValue: number, currentValue: number): string {
  const changeValue = currentValue - firstValue;
  const changePct = firstValue === 0 ? 0 : (changeValue / firstValue) * 100;
  const isFlat = Math.abs(changeValue) < 0.005 && Math.abs(changePct) < 0.005;
  if (isFlat) return SCRUB_FLAT_COLOR;
  return changeValue >= 0 ? SCRUB_GAIN_COLOR : SCRUB_LOSS_COLOR;
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
    const padY = 8;
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;

    const minTs = dataPoints[0].timestamp;
    const maxTs = dataPoints[dataPoints.length - 1].timestamp;
    const spanTs = Math.max(1, maxTs - minTs);
    const spanY = Math.max(1e-6, yRange.max - yRange.min);

    const toX = (timestamp: number) => padX + ((timestamp - minTs) / spanTs) * plotW;
    const toY = (value: number) => padY + (1 - (value - yRange.min) / spanY) * plotH;

    const revealProgress = scrubXRef.current === null ? Math.max(0, Math.min(1, revealProgressRef.current)) : 1;
    const shouldClipReveal = revealProgress < 1;

    if (shouldClipReveal) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width * revealProgress, height);
      ctx.clip();
    }

    const gradient = ctx.createLinearGradient(0, padY, 0, height);
    gradient.addColorStop(0, hexToRgba(colorTheme, 0.28));
    gradient.addColorStop(1, hexToRgba(colorTheme, 0.03));

    ctx.beginPath();
    dataPoints.forEach((point, idx) => {
      const x = toX(point.timestamp);
      const y = toY(point.value);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    const lastX = toX(dataPoints[dataPoints.length - 1].timestamp);
    const firstX = toX(dataPoints[0].timestamp);
    ctx.lineTo(lastX, height - padY);
    ctx.lineTo(firstX, height - padY);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    dataPoints.forEach((point, idx) => {
      const x = toX(point.timestamp);
      const y = toY(point.value);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = colorTheme;
    ctx.stroke();

    if (shouldClipReveal) {
      ctx.restore();
    }

    if (scrubXRef.current !== null) {
      const x = Math.min(width - padX, Math.max(padX, scrubXRef.current));
      const ratio = width <= 0 ? 0 : x / width;
      const idx = Math.max(0, Math.min(dataPoints.length - 1, Math.round(ratio * (dataPoints.length - 1))));
      const point = dataPoints[idx];
      const dotY = toY(point.value);
      const scrubColor = getScrubPerformanceColor(dataPoints[0].value, point.value);
      const timeLabel = new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(point.timestamp));

      const scrubGradient = ctx.createLinearGradient(0, padY, 0, height);
      scrubGradient.addColorStop(0, hexToRgba(scrubColor, 0.26));
      scrubGradient.addColorStop(1, hexToRgba(scrubColor, 0.02));

      ctx.beginPath();
      dataPoints.slice(0, idx + 1).forEach((segmentPoint, segmentIdx) => {
        const segmentX = toX(segmentPoint.timestamp);
        const segmentY = toY(segmentPoint.value);
        if (segmentIdx === 0) ctx.moveTo(segmentX, segmentY);
        else ctx.lineTo(segmentX, segmentY);
      });
      ctx.lineTo(x, dotY);
      ctx.lineTo(x, height - padY);
      ctx.lineTo(firstX, height - padY);
      ctx.closePath();
      ctx.fillStyle = scrubGradient;
      ctx.fill();

      ctx.beginPath();
      dataPoints.slice(0, idx + 1).forEach((segmentPoint, segmentIdx) => {
        const segmentX = toX(segmentPoint.timestamp);
        const segmentY = toY(segmentPoint.value);
        if (segmentIdx === 0) ctx.moveTo(segmentX, segmentY);
        else ctx.lineTo(segmentX, segmentY);
      });
      ctx.lineTo(x, dotY);
      ctx.lineWidth = 2.8;
      ctx.strokeStyle = scrubColor;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x, padY);
      ctx.lineTo(x, height - padY);
      ctx.strokeStyle = hexToRgba('#F5F0E8', 0.8);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, dotY, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = scrubColor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#F5F0E8';
      ctx.stroke();

      ctx.font = '700 11px ui-sans-serif, system-ui, -apple-system, Segoe UI';
      const textWidth = ctx.measureText(timeLabel).width;
      const labelPadX = 8;
      const labelH = 20;
      const labelW = textWidth + labelPadX * 2;
      const labelX = Math.min(width - labelW - 4, Math.max(4, x - labelW / 2));
      const topY = 6;
      const bottomY = Math.max(6, height - labelH - 8);
      const isNearTop = dotY <= (padY + labelH + 10);
      const labelY = isNearTop ? bottomY : topY;

      ctx.fillStyle = 'rgba(15, 15, 18, 0.88)';
      ctx.fillRect(labelX, labelY, labelW, labelH);
      ctx.strokeStyle = hexToRgba('#F5F0E8', 0.35);
      ctx.lineWidth = 1;
      ctx.strokeRect(labelX, labelY, labelW, labelH);
      ctx.fillStyle = '#F5F0E8';
      ctx.fillText(timeLabel, labelX + labelPadX, labelY + 14);
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

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    renderChart();
    const ro = new ResizeObserver(renderChart);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [renderChart]);

  useEffect(() => {
    if (revealRafRef.current !== null) {
      cancelAnimationFrame(revealRafRef.current);
      revealRafRef.current = null;
    }

    if (revealFromProgress === null || revealFromProgress >= 1 || revealDurationMs <= 0) {
      revealProgressRef.current = 1;
      renderChart();
      return;
    }

    const startProgress = Math.max(0, Math.min(1, revealFromProgress));
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

  const scrubAtClientX = (clientX: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper || dataPoints.length === 0) return;
    const rect = wrapper.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    scrubXRef.current = x;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const ratio = rect.width <= 0 ? 0 : x / rect.width;
      const idx = Math.max(0, Math.min(dataPoints.length - 1, Math.round(ratio * (dataPoints.length - 1))));
      onScrub?.(dataPoints[idx]);
      draw(rect.width, 200);
    });
  };

  const endScrub = () => {
    isScrubbingRef.current = false;
    scrubXRef.current = null;
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
    };
  });

  return (
    <div
      ref={wrapperRef}
      className="w-full"
      onMouseDown={(e) => {
        isScrubbingRef.current = true;
        scrubAtClientX(e.clientX);
      }}
      onMouseMove={(e) => {
        if (!isScrubbingRef.current) return;
        scrubAtClientX(e.clientX);
      }}
      onMouseLeave={endScrub}
      onMouseUp={endScrub}
      onTouchStart={(e) => {
        isScrubbingRef.current = true;
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
