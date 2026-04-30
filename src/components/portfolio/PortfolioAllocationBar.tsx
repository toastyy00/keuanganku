import React, { useMemo } from 'react';

interface AllocationAsset {
  ticker: string;
  usdValue: number;
}

interface PortfolioAllocationBarProps {
  assets: AllocationAsset[];
  colorTheme: string;
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

function buildThemeShades(colorTheme: string): string[] {
  const rgb = hexToRgb(colorTheme) ?? { r: 184, g: 245, b: 90 };
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const baseLightness = clamp(l, 0.42, 0.62);
  const lightnessSteps = [0.26, 0.16, 0.04, -0.08, -0.2];

  return lightnessSteps.map((shift) => {
    const lightness = clamp(baseLightness + shift, 0.28, 0.82) * 100;
    const saturation = clamp(s, 0.46, 0.9) * 100;
    return `hsl(${Math.round(h)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
  });
}

const PortfolioAllocationBar: React.FC<PortfolioAllocationBarProps> = ({ assets, colorTheme }) => {
  const allocation = useMemo(() => {
    const sortedAssets = assets
      .filter((asset) => Number.isFinite(asset.usdValue) && asset.usdValue > 0)
      .sort((a, b) => b.usdValue - a.usdValue);
    const total = sortedAssets.reduce((sum, asset) => sum + asset.usdValue, 0);
    const shades = buildThemeShades(colorTheme);

    return {
      total,
      assets: sortedAssets.map((asset, index) => ({
        ...asset,
        color: shades[index % shades.length],
        percentage: total > 0 ? (asset.usdValue / total) * 100 : 0,
      })),
    };
  }, [assets, colorTheme]);

  if (allocation.total <= 0 || allocation.assets.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-brutal-black/60">Allocation</p>
      <div className="flex h-[10px] w-full gap-[3px] overflow-hidden rounded-full bg-transparent">
        {allocation.assets.map((asset, index) => (
          <div
            key={asset.ticker}
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
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {allocation.assets.map((asset) => (
          <div key={asset.ticker} className="flex items-center leading-none">
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

