import React from 'react';

// ============================================================
//  SKELETON LOADING CARDS — neo-brutal pulse animation
// ============================================================

interface SkeletonCardProps {
  lines?: number;
  height?: string;
  className?: string;
  tone?: 'dark' | 'light';
  children?: React.ReactNode;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  lines = 3,
  height,
  className = '',
  tone = 'dark',
  children,
}) => (
  <div
    className={`skeleton-card neo-card space-y-3 overflow-hidden p-4 !shadow-[2px_2px_0_0_rgba(245,240,232,0.24)] ${tone === 'light' ? 'bg-[#F5F0E8] text-[#1A1A1A]' : 'bg-[#2A2A2A]'} ${className}`}
    style={height ? { height } : undefined}
    aria-hidden="true"
  >
    {children ?? Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`skeleton-block h-4 rounded-none ${tone === 'light' ? 'bg-[#1A1A1A]/12' : 'bg-[#F5F0E8]/12'}`}
          style={{ width: `${90 - i * 18}%` }}
        />
      ))}
  </div>
);

const SkeletonBlock: React.FC<{
  className?: string;
  tone?: 'dark' | 'light';
}> = ({ className = '', tone = 'dark' }) => (
  <div
    className={`skeleton-block rounded-none ${tone === 'light' ? 'bg-[#1A1A1A]/12' : 'bg-[#F5F0E8]/12'} ${className}`}
    aria-hidden="true"
  />
);

const skeletonShadow = '!shadow-[2px_2px_0_0_rgba(245,240,232,0.24)]';

const SkeletonToolbar: React.FC = () => (
  <div className="flex items-center gap-2" aria-hidden="true">
    <SkeletonBlock className="h-9 flex-1 bg-brutal-black/10" />
    <SkeletonBlock className="h-9 w-20 bg-brutal-black/10" />
    <SkeletonBlock className="h-9 w-9 bg-brutal-black/10" />
  </div>
);

const SkeletonPanel: React.FC<{ variant?: 'compact' | 'medium' | 'list' }> = ({ variant = 'medium' }) => (
  <SkeletonCard className={skeletonShadow}>
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <SkeletonBlock className="h-3 w-24" />
        <SkeletonBlock className="h-5 w-5" />
      </div>
      {variant === 'compact' ? (
        <div className="space-y-2">
          <SkeletonBlock className="h-5 w-3/4" />
          <SkeletonBlock className="h-3 w-1/2" />
        </div>
      ) : variant === 'list' ? (
        <div className="space-y-2">
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-[88%]" />
          <SkeletonBlock className="h-4 w-[62%]" />
        </div>
      ) : (
        <div className="space-y-3">
          <SkeletonBlock className="h-7 w-[70%]" />
          <SkeletonBlock className="h-2 w-full" />
          <div className="grid grid-cols-2 gap-2">
            <SkeletonBlock className="h-10" />
            <SkeletonBlock className="h-10" />
          </div>
        </div>
      )}
    </div>
  </SkeletonCard>
);

export const SkeletonRow: React.FC = () => (
  <div className="skeleton-card neo-card flex items-center gap-2.5 overflow-hidden px-3 py-1.5 !shadow-[1px_1px_0_0_rgba(245,240,232,0.2)]" aria-hidden="true">
    <SkeletonBlock className="h-8 w-8 shrink-0" />
    <div className="min-w-0 flex-1">
      <SkeletonBlock className="h-3.5 w-3/4" />
    </div>
    <SkeletonBlock className="h-4 w-20 shrink-0" />
  </div>
);

interface SkeletonDashboardProps {
  count?: number;
}

export const SkeletonDashboard: React.FC<SkeletonDashboardProps> = ({ count = 4 }) => (
  <div className="section-pad mx-auto max-w-2xl space-y-4 pt-5 pb-1">
    <div className="flex items-center justify-between gap-4 py-1">
      <SkeletonBlock className="h-5 w-32 bg-brutal-black/10" />
      <SkeletonBlock className="h-8 w-8 bg-brutal-black/10" />
    </div>
    <SkeletonToolbar />
    <div className="grid gap-3">
      <SkeletonPanel variant="medium" />
      <SkeletonPanel variant="compact" />
      <SkeletonPanel variant="list" />
    </div>
    <div className="space-y-2 pt-1">
      <div className="mb-2 flex items-center justify-between">
        <SkeletonBlock className="h-3 w-36 bg-brutal-black/10" />
        <SkeletonBlock className="h-3 w-20 bg-brutal-black/10" />
      </div>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  </div>
);
