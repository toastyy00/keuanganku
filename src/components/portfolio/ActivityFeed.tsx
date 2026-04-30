import React, { useMemo, useState } from 'react';
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

function isDefaultOpen(label: string): boolean {
  return label === 'TODAY' || label === 'YESTERDAY';
}

const ActivityFeed: React.FC<ActivityFeedProps> = ({ logs, colorTheme = '#8FE06A' }) => {
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
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
      {grouped.map(([label, items]) => {
        const isOpen = openOverrides[label] ?? isDefaultOpen(label);
        return (
          <div key={label}>
            <button
              type="button"
              className="mb-2 flex w-full items-center gap-2 text-left"
              aria-expanded={isOpen}
              onClick={() => setOpenOverrides((current) => ({ ...current, [label]: !isOpen }))}
            >
              <p className="text-xs font-black uppercase" style={{ color: colorTheme }}>{label}</p>
              <div className="h-px flex-1" style={{ backgroundColor: `${colorTheme}73` }} />
              <p className="text-xs font-bold" style={{ color: colorTheme }}>{items.length} TX</p>
            </button>
            <div
              className={`grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out ${isOpen ? 'grid-rows-[1fr] opacity-100 translate-y-0' : 'grid-rows-[0fr] opacity-0 -translate-y-1'}`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="space-y-2">
                {items.map((item) => {
                  const positive = item.action === 'ADD';
                  const locationLabel = holdingLocationLabel(item);
                  return (
                    <div key={item.id} className="neo-card px-3 py-2 !shadow-none">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-black leading-none">
                            <Clock3 size={14} />
                            <span className={positive ? 'text-green-600' : 'text-red-500'}>{item.action}</span>
                            <span>{item.ticker}</span>
                            <span className="text-[10px] font-medium leading-none text-brutal-black/60">≈ ${item.price_at_time.toFixed(4)}</span>
                          </p>
                          <p className="mt-1.5 text-[10px] font-medium leading-tight text-brutal-black/60">
                            {new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(item.created_at))}
                            {locationLabel ? ` · ${locationLabel}` : ''}
                            {' · '}
                            <span className="font-bold">
                              Balance {formatPortfolioAmount(item.balance_after)} {item.ticker}
                            </span>
                          </p>
                          {item.note && (
                            <p className="mt-0.5 text-[10px] font-medium leading-tight text-brutal-black/70">{item.note}</p>
                          )}
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
            </div>
          </div>
        );
      })}
    </div>
  );
};

export { ActivityFeed };
