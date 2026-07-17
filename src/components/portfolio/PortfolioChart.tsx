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
  formatScrubValues?: (value: number) => string[];
  revealFromProgress?: number | null;
  revealDurationMs?: number;
  revealKey?: string;
  showLastPointMarker?: boolean;
}

const SCRUB_GAIN_COLOR = '#1B9066';
const SCRUB_LOSS_COLOR = '#B93E50';
const SCRUB_FLAT_COLOR = '#F5F0E8';
const CHART_PAD_TOP = 28;
const CHART_PAD_BOTTOM = 14;
const SMOOTH_CURVE_TENSION = 0.18;
const IDLE_MARKER_DELAY_MS = 90;
const IDLE_MARKER_REVEAL_MS = 340;

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

function hexToDeepRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${Math.round(r * 0.62)},${Math.round(g * 0.36)},${Math.round(b * 0.36)},${alpha})`;
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

function strokeRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
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
  ctx.stroke();
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

/**
 * Interpolates the precise Y on the smooth curve path at a given X by
 * finding the two adjacent canvas points that straddle X and lerping.
 * This keeps the scrub dot exactly on the visible line at all times.
 */
function getYAtX(x: number, points: CanvasPoint[]): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].y;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (x >= a.x && x <= b.x) {
      const spanX = b.x - a.x;
      if (spanX <= 0) return a.y;
      const t = (x - a.x) / spanX;
      // Cubic ease-in-out for a smoother interpolation matching bezier feel
      const tSmooth = t * t * (3 - 2 * t);
      return a.y + (b.y - a.y) * tSmooth;
    }
  }
  return points[points.length - 1].y;
}

function drawPulsingDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  intensity = 1,
  emergence = 1,
): void {
  const visibleIntensity = clamp(intensity, 0, 1);
  const visibleEmergence = clamp(emergence, 0, 1);
  if (visibleIntensity <= 0 || visibleEmergence <= 0) return;

  const haloRadius = 2.8 + (8.5 - 2.8) * visibleEmergence;
  const coreRadius = 2.3 + (5.2 - 2.3) * visibleEmergence;

  // Outer halo glow
  ctx.beginPath();
  ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(color, 0.22 * visibleIntensity);
  ctx.fill();

  // Core solid circle
  ctx.beginPath();
  ctx.arc(x, y, coreRadius, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(color, visibleIntensity);
  ctx.fill();

  // Subtle white outline for contrast pop
  ctx.beginPath();
  ctx.arc(x, y, coreRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.85 * visibleIntensity})`;
  ctx.lineWidth = 1.15;
  ctx.stroke();
}

const PortfolioChart: React.FC<PortfolioChartProps> = ({
  dataPoints,
  colorTheme,
  timeframe,
  onScrub,
  onScrubEnd,
  formatScrubValues,
  revealFromProgress = null,
  revealDurationMs = 0,
  revealKey,
  showLastPointMarker = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const scrubXRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const revealRafRef = useRef<number | null>(null);
  const pulseRafRef = useRef<number | null>(null);
  const idlePulseRafRef = useRef<number | null>(null);
  const pulseStartedAtRef = useRef(0);
  const idlePulseStartedAtRef = useRef(0);
  const idleMarkerStartedAtRef = useRef(0);
  const revealProgressRef = useRef(1);
  const lastRevealTokenRef = useRef<string | null>(null);
  const isScrubbingRef = useRef(false);
  const endScrubRef = useRef<() => void>(() => {});
  const scrubAtClientXRef = useRef<(clientX: number) => void>(() => {});

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
      depthGradient.addColorStop(0, `rgba(7, 9, 12, ${0.34 * alphaScale})`);
      depthGradient.addColorStop(0.42, `rgba(7, 9, 12, ${0.21 * alphaScale})`);
      depthGradient.addColorStop(0.66, `rgba(7, 9, 12, ${0.12 * alphaScale})`);
      depthGradient.addColorStop(0.88, `rgba(7, 9, 12, ${0.07 * alphaScale})`);
      depthGradient.addColorStop(1, 'rgba(7, 9, 12, 0)');
      fillChartArea();
      ctx.fillStyle = depthGradient;
      ctx.fill();

      const colorGradient = ctx.createLinearGradient(0, padTop, 0, height);
      colorGradient.addColorStop(0, hexToDeepRgba(color, 0.5 * alphaScale));
      colorGradient.addColorStop(0.18, rgba(color, 0.3 * alphaScale));
      colorGradient.addColorStop(0.42, rgba(color, 0.16 * alphaScale));
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
      // Precisely follow the bezier curve by interpolating Y at the actual pixel X
      const dotY = getYAtX(x, curvePoints);
      const scrubColor = getScrubPerformanceColor(dataPoints[0].value, point.value);
      const pointDate = new Date(point.timestamp);
      const dateStr = new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(pointDate);
      const timeStr = new Intl.DateTimeFormat('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(pointDate);
      const timeLabel = `${dateStr} · ${timeStr}`;
      const valueLabels = (formatScrubValues?.(point.value) ?? []).filter(Boolean).slice(0, 2);

      drawChartSegment(x, width, scrubColor, hexToDimmedRgba, 0.44, 2.5);
      drawChartSegment(0, x, scrubColor, hexToRgba, 1, 2.8);

      // Vertical solid guide line
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, height - padBottom);
      ctx.strokeStyle = hexToRgba(scrubColor, 0.28);
      ctx.lineWidth = 1;
      ctx.stroke();

      drawPulsingDot(ctx, x, dotY, scrubColor);

      // ── HUD-style scrub label ──────────────────────────────────────────
      const dateFont = '600 9.5px ui-monospace, "Cascadia Code", "SF Mono", monospace';
      const valueFont = '800 13.5px ui-sans-serif, system-ui, -apple-system, Segoe UI';
      const subFont = '600 9px ui-sans-serif, system-ui, -apple-system, Segoe UI';

      ctx.font = valueFont;
      const primaryW = valueLabels[0] ? ctx.measureText(valueLabels[0]).width : 0;
      ctx.font = subFont;
      const secondaryW = valueLabels[1] ? ctx.measureText(valueLabels[1]).width : 0;
      ctx.font = dateFont;
      const dateW = ctx.measureText(timeLabel).width;

      const labelPadX = 11;
      const labelPadY = 9;
      const lineGap = 4;
      const dateH = 11;
      const valueH = 16;
      const subH = valueLabels[1] ? 11 : 0;
      const labelH = labelPadY * 2 + dateH + lineGap + valueH + (subH > 0 ? lineGap + subH : 0);
      const labelW = Math.max(primaryW, secondaryW, dateW) + labelPadX * 2 + 2;

      const labelGap = 16;
      const preferRight = x + labelGap + labelW <= width - 4;
      const labelX = preferRight
        ? x + labelGap
        : Math.max(4, x - labelGap - labelW);
      const minLY = 6;
      const maxLY = Math.max(minLY, height - labelH - 8);
      const labelY = Math.min(maxLY, Math.max(minLY, dotY - labelH / 2));

      // Background
      ctx.fillStyle = 'rgba(10, 12, 16, 0.88)';
      fillRoundedRect(ctx, labelX, labelY, labelW, labelH, 5);

      // Border
      ctx.strokeStyle = `rgba(245,240,232,0.10)`;
      ctx.lineWidth = 0.8;
      strokeRoundedRect(ctx, labelX + 0.5, labelY + 0.5, labelW - 1, labelH - 1, 5);

      // Corner bracket decorations (top-left, top-right, bottom-left, bottom-right)
      const bLen = 6; // bracket arm length
      const bOff = 0; // inset from corner
      ctx.strokeStyle = 'rgba(245, 240, 232, 0.35)'; // Static dimmed cream-white matching the theme
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'square';

      // Top-left
      ctx.beginPath();
      ctx.moveTo(labelX + bOff + bLen, labelY + bOff);
      ctx.lineTo(labelX + bOff, labelY + bOff);
      ctx.lineTo(labelX + bOff, labelY + bOff + bLen);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(labelX + labelW - bOff - bLen, labelY + bOff);
      ctx.lineTo(labelX + labelW - bOff, labelY + bOff);
      ctx.lineTo(labelX + labelW - bOff, labelY + bOff + bLen);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(labelX + bOff, labelY + labelH - bOff - bLen);
      ctx.lineTo(labelX + bOff, labelY + labelH - bOff);
      ctx.lineTo(labelX + bOff + bLen, labelY + labelH - bOff);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(labelX + labelW - bOff - bLen, labelY + labelH - bOff);
      ctx.lineTo(labelX + labelW - bOff, labelY + labelH - bOff);
      ctx.lineTo(labelX + labelW - bOff, labelY + labelH - bOff - bLen);
      ctx.stroke();

      ctx.lineCap = 'butt';

      // Text content
      let textCursorY = labelY + labelPadY + dateH;
      ctx.font = dateFont;
      ctx.fillStyle = 'rgba(245,240,232,0.45)';
      ctx.fillText(timeLabel, labelX + labelPadX, textCursorY);

      textCursorY += lineGap + valueH;
      ctx.font = valueFont;
      ctx.fillStyle = 'rgba(245,240,232,0.97)';
      ctx.fillText(valueLabels[0] ?? timeLabel, labelX + labelPadX, textCursorY);

      if (valueLabels[1]) {
        textCursorY += lineGap + subH;
        ctx.font = subFont;
        ctx.fillStyle = 'rgba(245,240,232,0.45)';
        ctx.fillText(valueLabels[1], labelX + labelPadX, textCursorY);
      }

    } else {
      drawChartSegment(0, width, colorTheme, hexToRgba, 1, 2.5);
      const lastPoint = curvePoints[curvePoints.length - 1];
      const markerRevealProgress = shouldClipReveal ? 0 : clamp((performance.now() - idleMarkerStartedAtRef.current) / IDLE_MARKER_REVEAL_MS, 0, 1);
      const markerEase = 1 - Math.pow(1 - markerRevealProgress, 3);
      if (showLastPointMarker && lastPoint && markerEase > 0) {
        drawPulsingDot(
          ctx,
          lastPoint.x,
          lastPoint.y,
          colorTheme,
          0.92 * markerEase,
          markerEase,
        );
      }
    }
  }, [colorTheme, dataPoints, formatScrubValues, yRange.max, yRange.min]);

  const renderChart = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const dpr = window.devicePixelRatio || 1;
    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight || 200;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(width, height);
  }, [draw]);

  const stopIdlePulse = useCallback(() => {
    if (idlePulseRafRef.current !== null) {
      cancelAnimationFrame(idlePulseRafRef.current);
      idlePulseRafRef.current = null;
    }
  }, []);

  const startIdlePulse = useCallback(() => {
    if (idlePulseRafRef.current !== null || isScrubbingRef.current) return;
    if (!showLastPointMarker) return;
    idlePulseStartedAtRef.current = performance.now();

    const tickIdlePulse = () => {
      const wrapper = wrapperRef.current;
      if (isScrubbingRef.current || !wrapper) {
        idlePulseRafRef.current = null;
        return;
      }

      draw(wrapper.clientWidth, wrapper.clientHeight || 200);

      const now = performance.now();
      const elapsed = now - idleMarkerStartedAtRef.current;
      const animationFinished = elapsed >= IDLE_MARKER_REVEAL_MS;

      if (animationFinished) {
        idlePulseRafRef.current = null;
      } else {
        idlePulseRafRef.current = requestAnimationFrame(tickIdlePulse);
      }
    };

    idlePulseRafRef.current = requestAnimationFrame(tickIdlePulse);
  }, [draw, showLastPointMarker]);

  useLayoutEffect(() => {
    if (revealRafRef.current !== null) {
      cancelAnimationFrame(revealRafRef.current);
      revealRafRef.current = null;
    }

    if (revealFromProgress === null || revealFromProgress >= 1 || revealDurationMs <= 0) {
      revealProgressRef.current = 1;
      lastRevealTokenRef.current = null;
      renderChart();
      return;
    }

    const startProgress = clamp(revealFromProgress, 0, 1);
    const revealToken = revealKey ?? `${startProgress}:${revealDurationMs}`;
    if (lastRevealTokenRef.current === revealToken && revealProgressRef.current >= 1) {
      renderChart();
      return;
    }

    lastRevealTokenRef.current = revealToken;
    const duration = Math.max(80, revealDurationMs * (1 - startProgress));
    const startedAt = performance.now();
    idleMarkerStartedAtRef.current = startedAt + duration + IDLE_MARKER_DELAY_MS;
    idlePulseStartedAtRef.current = idleMarkerStartedAtRef.current + IDLE_MARKER_REVEAL_MS * 0.58;
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
        idleMarkerStartedAtRef.current = now + IDLE_MARKER_DELAY_MS;
        idlePulseStartedAtRef.current = idleMarkerStartedAtRef.current + IDLE_MARKER_REVEAL_MS * 0.58;
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
    startIdlePulse();
    return () => {
      ro.disconnect();
      stopIdlePulse();
    };
  }, [renderChart, startIdlePulse, stopIdlePulse]);

  const scrubAtClientX = (clientX: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper || dataPoints.length === 0) return;
    const rect = wrapper.getBoundingClientRect();
    const ratio = rect.width <= 0 ? 0 : clamp((clientX - rect.left) / rect.width, 0, 1);
    const x = ratio * wrapper.clientWidth;
    scrubXRef.current = x;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!isScrubbingRef.current) return;
      const idx = Math.max(0, Math.min(dataPoints.length - 1, Math.round(ratio * (dataPoints.length - 1))));
      onScrub?.(dataPoints[idx]);
      draw(wrapper.clientWidth, wrapper.clientHeight || 200);
    });
  };

  const beginScrub = () => {
    stopIdlePulse();
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
    
    // Reset marker reveal time so it starts animation again
    idleMarkerStartedAtRef.current = performance.now() + IDLE_MARKER_DELAY_MS;
    
    const wrapper = wrapperRef.current;
    if (wrapper) draw(wrapper.clientWidth, wrapper.clientHeight || 200);
    startIdlePulse();
  };

  useEffect(() => {
    endScrubRef.current = endScrub;
    scrubAtClientXRef.current = scrubAtClientX;
  });

  useEffect(() => {
    const end = () => endScrubRef.current();
    const move = (event: MouseEvent) => {
      if (!isScrubbingRef.current) return;
      scrubAtClientXRef.current(event.clientX);
    };
    window.addEventListener('mouseup', end);
    window.addEventListener('mousemove', move);
    window.addEventListener('touchend', end, { passive: true });
    window.addEventListener('touchcancel', end, { passive: true });
    return () => {
      window.removeEventListener('mouseup', end);
      window.removeEventListener('mousemove', move);
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
      if (idlePulseRafRef.current !== null) {
        cancelAnimationFrame(idlePulseRafRef.current);
        idlePulseRafRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="w-full h-full"
      onMouseDown={(e) => {
        beginScrub();
        scrubAtClientX(e.clientX);
      }}
      onMouseMove={(e) => {
        if (!isScrubbingRef.current) return;
        scrubAtClientX(e.clientX);
      }}
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
