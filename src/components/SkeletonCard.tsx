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
    className={`neo-card space-y-3 overflow-hidden p-4 ${tone === 'light' ? 'bg-[#F5F0E8] text-[#1A1A1A]' : 'bg-[#2A2A2A]'} ${className}`}
    style={height ? { height } : undefined}
    aria-hidden="true"
  >
    {children ?? Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`h-4 animate-pulse rounded-none ${tone === 'light' ? 'bg-[#1A1A1A]/12' : 'bg-[#F5F0E8]/12'}`}
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
    className={`animate-pulse rounded-none ${tone === 'light' ? 'bg-[#1A1A1A]/12' : 'bg-[#F5F0E8]/12'} ${className}`}
    aria-hidden="true"
  />
);

const SkeletonSummaryCard: React.FC = () => (
  <SkeletonCard className="!shadow-[4px_4px_0_0_#fafefe99]">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-3">
        <SkeletonBlock className="h-3 w-28" />
        <SkeletonBlock className="h-8 w-[78%]" />
        <SkeletonBlock className="h-3 w-36" />
      </div>
      <SkeletonBlock className="h-9 w-9 shrink-0" />
    </div>
  </SkeletonCard>
);

const SkeletonControlsCard: React.FC = () => (
  <SkeletonCard className="!shadow-[3px_3px_0_0_#fafefe99]">
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-1 gap-2">
        <SkeletonBlock className="h-9 flex-1" />
        <SkeletonBlock className="h-9 flex-1" />
      </div>
      <SkeletonBlock className="h-9 w-10 shrink-0" />
    </div>
  </SkeletonCard>
);

const SkeletonContentCard: React.FC = () => (
  <SkeletonCard className="!shadow-[4px_4px_0_0_#fafefe99]">
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <SkeletonBlock className="h-3 w-28" />
        <SkeletonBlock className="h-3 w-16" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SkeletonBlock className="h-16" />
        <SkeletonBlock className="h-16" />
        <SkeletonBlock className="h-16" />
      </div>
      <div className="space-y-2">
        <SkeletonBlock className="h-2 w-full" />
        <SkeletonBlock className="h-2 w-2/3" />
      </div>
    </div>
  </SkeletonCard>
);

export const SkeletonRow: React.FC = () => (
  <div className="neo-card flex items-center gap-2.5 px-3 py-1.5 !shadow-[1px_1px_0_0_#fafefe99]" aria-hidden="true">
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
  <div className="section-pad mx-auto max-w-2xl space-y-5 pt-5 pb-1">
    <div className="flex items-center justify-between gap-4 py-1">
      <SkeletonBlock className="h-5 w-32 bg-brutal-black/10" />
      <SkeletonBlock className="h-8 w-8 bg-brutal-black/10" />
    </div>
    <SkeletonSummaryCard />
    <SkeletonControlsCard />
    <SkeletonContentCard />
    <div className="space-y-2">
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
