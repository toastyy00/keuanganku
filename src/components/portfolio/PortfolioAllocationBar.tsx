import React, { useMemo, useState } from 'react';

interface AllocationAsset {
  key: string;
  ticker: string;
  usdValue: number;
}

interface PortfolioAllocationBarProps {
  assets: AllocationAsset[];
  colorTheme: string;
  collapsible?: boolean;
  tone?: 'default' | 'dark';
  minSegmentPercentage?: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === nr) h = (ng - nb) / d + (ng < nb ? 6 : 0);
  else if (max === ng) h = (nb - nr) / d + 2;
  else h = (nr - ng) / d + 4;

  return { h: h * 60, s, l };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildThemeShades(
  colorTheme: string,
  count: number, // ← tambah parameter ini
  tone: 'default' | 'dark' = 'default',
): string[] {
  const rgb = hexToRgb(colorTheme) ?? { r: 184, g: 245, b: 90 };
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const isDarkTone = tone === 'dark';

  const baseLightness = isDarkTone ? clamp(l - 0.14, 0.24, 0.42) : clamp(l, 0.42, 0.62);

  const lMin = isDarkTone ? 0.18 : 0.28;
  const lMax = isDarkTone ? 0.54 : 0.82;
  const sMin = isDarkTone ? 0.34 : 0.46;
  const sMax = isDarkTone ? 0.72 : 0.9;
  const sBase = isDarkTone ? s * 0.78 : s;

  return Array.from({ length: count }, (_, i) => {
    const t = count <= 1 ? 0 : i / (count - 1); // 0..1

    // Lightness: dari terang ke gelap secara linear dalam range yang aman
    const lSpread = isDarkTone ? 0.26 : 0.46;
    const lightness = clamp(baseLightness + lSpread / 2 - t * lSpread, lMin, lMax) * 100;

    // Zig-zag saturation: genap vivid, ganjil muted — biar shade berdekatan tidak menyatu
    const satZigzag = i % 2 === 0 ? 1.0 : 0.84;
    const saturation = clamp(sBase * satZigzag, sMin, sMax) * 100;

    // Hue shift sempit ±12° total, tetap satu family
    const hueShift = (t - 0.5) * 24; // -12° sampai +12°
    const hue = (h + hueShift + 360) % 360;

    return `hsl(${Math.round(hue)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
  });
}

function balanceSegmentPercentages(percentages: number[], minPercentage: number): number[] {
  if (percentages.length === 0 || minPercentage <= 0) return percentages;

  const cappedMin = Math.min(minPercentage, 100 / percentages.length);
  const smallTotal = percentages.reduce((sum, percentage) => sum + (percentage < cappedMin ? cappedMin : 0), 0);
  const largeTotal = percentages.reduce((sum, percentage) => sum + (percentage >= cappedMin ? percentage : 0), 0);
  const remaining = Math.max(0, 100 - smallTotal);

  return percentages.map((percentage) => {
    if (percentage < cappedMin) return cappedMin;
    if (largeTotal <= 0) return remaining / percentages.length;
    return (percentage / largeTotal) * remaining;
  });
}

const PortfolioAllocationBar: React.FC<PortfolioAllocationBarProps> = ({ assets, colorTheme, collapsible = false, tone = 'default', minSegmentPercentage = 0 }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const allocation = useMemo(() => {
    const assetsByTicker = new Map<string, AllocationAsset>();

    for (const asset of assets) {
      if (!Number.isFinite(asset.usdValue) || asset.usdValue <= 0) continue;

      const ticker = asset.ticker.trim().toUpperCase();
      if (!ticker) continue;

      const current = assetsByTicker.get(ticker);
      if (current) {
        current.usdValue += asset.usdValue;
      } else {
        assetsByTicker.set(ticker, {
          key: ticker,
          ticker,
          usdValue: asset.usdValue,
        });
      }
    }

    const sortedAssets = Array.from(assetsByTicker.values()).sort((a, b) => b.usdValue - a.usdValue);
    const total = sortedAssets.reduce((sum, asset) => sum + asset.usdValue, 0);
    const shades = buildThemeShades(colorTheme, sortedAssets.length, tone);

    const percentages = sortedAssets.map((asset) => (total > 0 ? (asset.usdValue / total) * 100 : 0));
    const visualPercentages = balanceSegmentPercentages(percentages, minSegmentPercentage);

    return {
      total,
      assets: sortedAssets.map((asset, index) => ({
        ...asset,
        color: shades[index],
        percentage: percentages[index],
        visualPercentage: visualPercentages[index],
      })),
    };
  }, [assets, colorTheme, minSegmentPercentage, tone]);

  if (allocation.total <= 0 || allocation.assets.length === 0) return null;

  const isCollapsed = collapsible && !isExpanded;
  const legendAssets = isCollapsed ? allocation.assets.filter((asset) => asset.percentage >= 1) : allocation.assets;

  return (
    <div
      className={collapsible ? 'mt-3 cursor-pointer select-none' : 'mt-3'}
      role={collapsible ? 'button' : undefined}
      tabIndex={collapsible ? 0 : undefined}
      onClick={collapsible ? () => setIsExpanded((current) => !current) : undefined}
      onKeyDown={
        collapsible
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setIsExpanded((current) => !current);
              }
            }
          : undefined
      }
    >
      <p className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-brutal-black/60">Allocation</p>
      <div className="flex h-[10px] w-full overflow-hidden rounded-full bg-transparent">
        {allocation.assets.map((asset, index) => (
          <div
            key={asset.key}
            className="h-full min-w-[3px]"
            style={{
              width: `${asset.visualPercentage}%`,
              backgroundColor: asset.color,
              borderTopLeftRadius: index === 0 ? '999px' : 0,
              borderBottomLeftRadius: index === 0 ? '999px' : 0,
              borderTopRightRadius: index === allocation.assets.length - 1 ? '999px' : 0,
              borderBottomRightRadius: index === allocation.assets.length - 1 ? '999px' : 0,
            }}
            aria-label={`${asset.ticker} ${asset.percentage.toFixed(1)}%`}
          />
        ))}
      </div>
      <div
        className={`mt-2.5 flex items-center gap-x-2 gap-y-1.5 overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-out ${
          isCollapsed ? 'max-h-[10px] flex-nowrap opacity-90 translate-y-0' : 'max-h-28 flex-wrap opacity-100 translate-y-0.5'
        }`}
      >
        {legendAssets.map((asset) => (
          <div key={asset.key} className="flex shrink-0 items-center leading-none">
            <span className="mr-0.5 text-[8px] leading-none" style={{ color: asset.color }}>
              {'\u25CF'}
            </span>
            <span className="mr-1 text-[9px] font-medium uppercase text-brutal-black/70">{asset.ticker}</span>
            <span className="text-[9px] font-black text-brutal-black">{asset.percentage.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export { PortfolioAllocationBar };
