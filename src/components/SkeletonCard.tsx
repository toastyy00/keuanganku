import React from 'react';

// ============================================================
//  SKELETON LOADING CARDS — neo-brutal pulse animation
// ============================================================

interface SkeletonCardProps {
  lines?: number;
  height?: string;
  className?: string;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  lines = 3,
  height,
  className = '',
}) => (
  <div
    className={`neo-card p-4 space-y-3 animate-pulse overflow-hidden ${className}`}
    style={height ? { height } : undefined}
    aria-hidden="true"
  >
    {Array.from({ length: lines }).map((_, i) => (
      <div
        key={i}
        className="h-4 bg-brutal-black/10 rounded-none"
        style={{ width: `${90 - i * 18}%` }}
      />
    ))}
  </div>
);

export const SkeletonRow: React.FC = () => (
  <div className="neo-card p-3 flex items-center gap-3 animate-pulse" aria-hidden="true">
    <div className="w-9 h-9 bg-brutal-black/10 shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-3.5 bg-brutal-black/10 w-3/4" />
      <div className="h-3 bg-brutal-black/10 w-1/2" />
    </div>
    <div className="h-4 w-20 bg-brutal-black/10 shrink-0" />
  </div>
);

interface SkeletonDashboardProps {
  count?: number;
}

export const SkeletonDashboard: React.FC<SkeletonDashboardProps> = ({ count = 4 }) => (
  <div className="section-pad max-w-2xl mx-auto space-y-4">
    {/* Big total card */}
    <SkeletonCard lines={2} height="100px" />
    {/* Split bar */}
    <SkeletonCard lines={2} height="80px" />
    {/* Month comparison */}
    <SkeletonCard lines={2} height="90px" />
    {/* Transaction rows */}
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  </div>
);
