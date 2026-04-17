import React from 'react';
import { cn } from '../../lib/utils';

// ============================================================
//  BADGE COMPONENT
// ============================================================

export type BadgeVariant = 'need' | 'want' | 'transfer' | 'neutral' | 'category';
export type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: React.ReactNode;
  className?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  need:     'bg-blue-500 text-white border-blue-500',
  want:     'bg-pink-500 text-white border-pink-500',
  transfer: 'bg-orange-400 text-brutal-black border-orange-400',
  neutral:  'bg-brutal-yellow-light text-brutal-black border-[#555555]',
  category: 'bg-brutal-black text-brutal-yellow border-[#555555]',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-0.5 py-0 text-[9px] leading-[13px] border-2',
  md: 'px-1.5 py-0.5 text-xs leading-4 border-2',
};

const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  size = 'md',
  children,
  className,
}) => (
  <span
    className={cn(
      'inline-flex items-center font-black uppercase tracking-wider',
      VARIANT_CLASSES[variant],
      SIZE_CLASSES[size],
      className
    )}
  >
    {children}
  </span>
);

export { Badge };
export type { BadgeProps };
