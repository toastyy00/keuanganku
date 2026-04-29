import React, { useMemo } from 'react';
import { Clock3 } from 'lucide-react';
import { formatPortfolioAmount } from '../../lib/utils';
import type { PortfolioActivityLog } from '../../types';

interface ActivityFeedProps {
  logs: PortfolioActivityLog[];
  colorTheme?: string;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yday = new Date(Date.now() - 86_400_000);

  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (key(date) === key(today)) return 'TODAY';
  if (key(date) === key(yday)) return 'YESTERDAY';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(date).toUpperCase();
}

function holdingLocationLabel(log: PortfolioActivityLog): string | null {
  return log.location ?? null;
}

const ActivityFeed: React.FC<ActivityFeedProps> = ({ logs, colorTheme = '#8FE06A' }) => {
  const grouped = useMemo(() => {
    const map = new Map<string, PortfolioActivityLog[]>();
    for (const log of logs) {
      const label = dayLabel(log.created_at);
      if (!map.has(label)) map.set(label, []);
      map.get(label)?.push(log);
    }
    return Array.from(map.entries());
  }, [logs]);

  return (
    <div className="space-y-4">
      {grouped.map(([label, items]) => (
        <div key={label}>
          <div className="mb-2 flex items-center gap-2">
            <p className="text-xs font-black uppercase" style={{ color: colorTheme }}>{label}</p>
            <div className="h-px flex-1" style={{ backgroundColor: `${colorTheme}73` }} />
            <p className="text-xs font-bold" style={{ color: colorTheme }}>{items.length} TX</p>
          </div>
          <div className="space-y-2">
            {items.map((item) => {
              const positive = item.action === 'ADD';
              const locationLabel = holdingLocationLabel(item);
              return (
                <div key={item.id} className="neo-card px-3 py-2 !shadow-none">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-black">
                        <Clock3 size={14} />
                        <span>{item.ticker}</span>
                        <span className={positive ? 'text-green-600' : 'text-red-500'}>{item.action}</span>
                      </p>
                      <p className="mt-1 text-[10px] font-medium leading-tight text-brutal-black/60">
                        {new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(item.created_at))}
                        {' · '}
                        ${item.price_at_time.toFixed(4)}
                      </p>
                      {item.note && (
                        <p className="mt-0.5 text-[10px] font-medium leading-tight text-brutal-black/70">{item.note}</p>
                      )}
                      <p className="mt-0.5 text-[10px] font-bold leading-tight text-brutal-black/60">
                        Balance {formatPortfolioAmount(item.balance_after)} {item.ticker}
                        {locationLabel ? ` · ${locationLabel}` : ''}
                      </p>
                    </div>
                    <p className={`text-sm font-black ${positive ? 'text-green-600' : 'text-red-500'}`}>
                      {positive ? '+' : '-'}{formatPortfolioAmount(item.amount_change)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export { ActivityFeed };
