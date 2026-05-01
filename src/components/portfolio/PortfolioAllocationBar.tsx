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

function buildThemeShades(colorTheme: string, tone: 'default' | 'dark' = 'default'): string[] {
  const rgb = hexToRgb(colorTheme) ?? { r: 184, g: 245, b: 90 };
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const isDarkTone = tone === 'dark';
  const baseLightness = isDarkTone ? clamp(l - 0.14, 0.24, 0.42) : clamp(l, 0.42, 0.62);
  const lightnessSteps = isDarkTone ? [0.1, 0.03, -0.04, -0.1, -0.16] : [0.26, 0.16, 0.04, -0.08, -0.2];

  return lightnessSteps.map((shift) => {
    const lightness = clamp(baseLightness + shift, isDarkTone ? 0.18 : 0.28, isDarkTone ? 0.54 : 0.82) * 100;
    const saturation = clamp(isDarkTone ? s * 0.78 : s, isDarkTone ? 0.34 : 0.46, isDarkTone ? 0.72 : 0.9) * 100;
    return `hsl(${Math.round(h)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
  });
}

const PortfolioAllocationBar: React.FC<PortfolioAllocationBarProps> = ({ assets, colorTheme, collapsible = false, tone = 'default' }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const allocation = useMemo(() => {
    const sortedAssets = assets
      .filter((asset) => Number.isFinite(asset.usdValue) && asset.usdValue > 0)
      .sort((a, b) => b.usdValue - a.usdValue);
    const total = sortedAssets.reduce((sum, asset) => sum + asset.usdValue, 0);
    const shades = buildThemeShades(colorTheme, tone);

    return {
      total,
      assets: sortedAssets.map((asset, index) => ({
        ...asset,
        color: shades[index % shades.length],
        percentage: total > 0 ? (asset.usdValue / total) * 100 : 0,
      })),
    };
  }, [assets, colorTheme, tone]);

  if (allocation.total <= 0 || allocation.assets.length === 0) return null;

  const isCollapsed = collapsible && !isExpanded;

  return (
    <div
      className={collapsible ? 'mt-3 cursor-pointer select-none' : 'mt-3'}
      role={collapsible ? 'button' : undefined}
      tabIndex={collapsible ? 0 : undefined}
      onClick={collapsible ? () => setIsExpanded((current) => !current) : undefined}
      onKeyDown={collapsible ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setIsExpanded((current) => !current);
        }
      } : undefined}
    >
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-brutal-black/60">Allocation</p>
      <div className="flex h-[10px] w-full overflow-hidden rounded-full bg-transparent">
        {allocation.assets.map((asset, index) => (
          <div
            key={asset.key}
            className="h-full min-w-[3px]"
            style={{
              width: `${asset.percentage}%`,
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
        {allocation.assets.map((asset) => (
          <div key={asset.key} className="flex shrink-0 items-center leading-none">
            <span
              className="mr-0.5 text-[8px] leading-none"
              style={{ color: asset.color }}
            >
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

