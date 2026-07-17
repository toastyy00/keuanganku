import { useMemo } from 'react';

export interface GlowConfig {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  width: number;   // px
  height: number;  // px
  color: string;   // rgba / hex
  blur: number;    // px
  opacity: number; // 0–1
  borderRadius: string;
}

const PALETTE = [
  '#B8F55A', // lime — brand primary
  '#5AF5C8', // teal/mint
  '#A5F55A', // yellow-green
  '#5AF5A0', // seafoam
  '#D4F55A', // yellow-lime
  '#00F0FF', // neon cyan
  '#8B5CF6', // electric violet
];

const rng = (min: number, max: number) =>
  Math.random() * (max - min) + min;

const rngInt = (min: number, max: number) =>
  Math.floor(rng(min, max + 1));

/**
 * Generates a stable-per-mount set of randomized ambient glow blobs
 * for a card. Uses useMemo so the layout doesn't shift on re-render.
 *
 * @param seed  – optional extra seed string to differentiate card instances
 */
export const useRandomGlows = (_seed?: string): GlowConfig[] => {
  return useMemo(() => {
    const count = rngInt(2, 4); // 2, 3, or 4 glows
    const glows: GlowConfig[] = [];

    // We divide the card corners into 4 zones and pick randomly from them
    // to ensure glows spread across the card rather than clustering.
    const zones: Array<{ top?: string; bottom?: string; left?: string; right?: string }> = [
      { top: `${rngInt(-30, -10)}px`, right: `${rngInt(-30, -10)}px` },   // top-right
      { bottom: `${rngInt(-30, -10)}px`, left: `${rngInt(-30, -10)}px` }, // bottom-left
      { top: `${rngInt(-20, 20)}px`, left: `${rngInt(-20, 20)}px` },      // top-left
      { bottom: `${rngInt(-20, 20)}px`, right: `${rngInt(-20, 20)}px` },  // bottom-right
    ];

    // Shuffle zones so each render picks differently
    zones.sort(() => Math.random() - 0.5);

    for (let i = 0; i < count; i++) {
      const zone = zones[i % zones.length];
      const w = rngInt(120, 240); // min 120px, max 240px
      const h = rngInt(100, 200);
      const color = PALETTE[rngInt(0, PALETTE.length - 1)];
      const blur = rngInt(50, 90);
      const opacity = parseFloat(rng(0.05, 0.13).toFixed(3));

      // Randomise aspect ratio for ellipse feel (not always round)
      const rx = rngInt(40, 60);
      const ry = rngInt(35, 55);
      const borderRadius = `${rx}% ${100 - rx}% ${100 - ry}% ${ry}% / ${ry}% ${rx}% ${100 - rx}% ${100 - ry}%`;

      glows.push({
        ...zone,
        width: w,
        height: h,
        color,
        blur,
        opacity,
        borderRadius,
      });
    }

    return glows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty deps → stable on mount, refreshes on full remount
};
