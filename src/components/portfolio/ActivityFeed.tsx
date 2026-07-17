import React, { useMemo, useState } from 'react';
import { ChevronDown, Clock3 } from 'lucide-react';
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

const ActivityFeed: React.FC<ActivityFeedProps> = ({ logs, colorTheme: _colorTheme = '#8FE06A' }) => {
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
              className="mb-2 flex w-full items-center justify-between text-left group select-none"
              aria-expanded={isOpen}
              onClick={() => setOpenOverrides((current) => ({ ...current, [label]: !isOpen }))}
            >
              <div className="flex items-center gap-2 flex-1 mr-4">
                <ChevronDown
                  size={12}
                  strokeWidth={2.5}
                  className={`text-white/30 group-hover:text-white/60 transition-all duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                />
                <p className="text-[10px] font-black uppercase tracking-wider text-white/40 group-hover:text-white/60 transition-colors">{label}</p>
                <div className="h-[1px] flex-1 bg-white/[0.06]" />
              </div>
              <p className="text-[10px] font-semibold text-white/30 group-hover:text-white/60 transition-colors">{items.length} TX</p>
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
                    <div key={item.id} className="rounded-xl border border-white/[0.04] bg-white/[0.01] px-3.5 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-bold leading-none text-[#F5F0E8]">
                            <Clock3 size={13} className="text-white/30" />
                            <span className={positive ? 'text-emerald-400' : 'text-red-400'}>{item.action}</span>
                            <span>{item.ticker}</span>
                            <span className="text-[10px] font-semibold leading-none text-white/40">≈ ${item.price_at_time.toFixed(4)}</span>
                          </p>
                          <p className="mt-1.5 text-[10px] font-medium leading-tight text-white/40">
                            {new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(item.created_at))}
                            {locationLabel ? ` · ${locationLabel}` : ''}
                            {' · '}
                            <span className="font-bold text-white/50">
                              Balance {formatPortfolioAmount(item.balance_after)} {item.ticker}
                            </span>
                          </p>
                          {item.note && (
                            <p className="mt-1 text-[10px] font-medium leading-tight text-white/50">{item.note}</p>
                          )}
                        </div>
                        <p className={`text-sm font-bold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
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
