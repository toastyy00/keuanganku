import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus, ChevronRight, CalendarClock } from 'lucide-react';
import { Card, CardBody } from '../components/ui/Card';
import NumberFlow, { continuous } from '@number-flow/react';
import { Badge } from '../components/ui/Badge';
import { SkeletonDashboard } from '../components/SkeletonCard';
import { useExpenseStore } from '../store/useExpenseStore';
import { useUIStore } from '../store/useAppStore';
import {
  formatCurrency,
  calcNeedsWantsSplit,
  monthLabel,
  friendlyDate,
} from '../lib/utils';
import { getExchangeRate, convertAmount, type RateResult } from '../lib/exchangeRate';
import type { Currency, Expense } from '../types';

// ============================================================
//  HELPERS
// ============================================================

function haptic() { if ('vibrate' in navigator) navigator.vibrate(10); }

// ── Swipeable Card Carousel ─────────────────────────────────
const SWIPE_HINT_KEY = 'dashboard_swipe_hint_seen';

function hasSeenSwipeHint(): boolean {
  return sessionStorage.getItem(SWIPE_HINT_KEY) === '1';
}

function markSwipeHintSeen(): void {
  sessionStorage.setItem(SWIPE_HINT_KEY, '1');
}

function SwipeCarousel({
  slides,
  accentColors,
}: {
  slides: React.ReactNode[];
  /** Per-slide indicator dot accent color. Defaults to #B8F55A */
  accentColors?: string[];
}) {
  const [active, setActive] = useState(0);
  const startX = useRef<number | null>(null);
  const isDragging = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [hintPx, setHintPx] = useState(0);

  useEffect(() => {
    if (slides.length <= 1 || hasSeenSwipeHint()) return;

    // Set to true after delay to avoid React 18 Strict Mode double-mount cancellation
    const t1 = setTimeout(() => {
      markSwipeHintSeen();
      setHintPx(-50);
    }, 1600);
    const t2 = setTimeout(() => setHintPx(0), 2200);

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [slides.length]);

  const accent = accentColors?.[active] ?? '#B8F55A';

  const markHintSeen = () => {
    markSwipeHintSeen();
    setHintPx(0);
  };

  const goTo = (i: number) => {
    haptic();
    markHintSeen();
    setActive(Math.max(0, Math.min(i, slides.length - 1)));
  };

  // Touch handlers
  const onTouchStart = (e: React.TouchEvent) => {
    markHintSeen();
    startX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (Math.abs(dx) > 40) goTo(active + (dx < 0 ? 1 : -1));
    startX.current = null;
  };

  // Mouse drag handlers (desktop)
  const onMouseDown = (e: React.MouseEvent) => {
    markHintSeen();
    startX.current = e.clientX;
    isDragging.current = false;
    setDragging(false);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (startX.current !== null && Math.abs(e.clientX - startX.current) > 5) {
      isDragging.current = true;
      setDragging(true);
    }
  };
  const onMouseUp = (e: React.MouseEvent) => {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    if (isDragging.current && Math.abs(dx) > 40) goTo(active + (dx < 0 ? 1 : -1));
    startX.current = null;
    isDragging.current = false;
    setDragging(false);
  };

  return (
    <div
      className="relative overflow-hidden select-none"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
    >
      {/* Slide track */}
      <div
        className="flex transition-transform duration-500 ease-out"
        style={{ transform: `translateX(calc(-${active * 100}% + ${hintPx}px))` }}
      >
        {slides.map((slide, i) => (
          <div key={i} className="w-full flex-shrink-0 flex items-stretch">
            <div className="flex-1 min-w-0">
              {slide}
            </div>
          </div>
        ))}
      </div>

      {/* Indicator lines — minimal, inside bottom of carousel */}
      {slides.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px]">
          {/* Base track (clickable areas) */}
          <div className="absolute inset-0 flex">
            {slides.map((_, i) => (
              <button
                key={i}
                className="pointer-events-auto flex-1 h-full"
                style={{ backgroundColor: 'rgba(0,0,0,0.12)' }}
                onClick={(e) => { e.stopPropagation(); goTo(i); }}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
          {/* Animated active sliding line */}
          <div
            className="absolute top-0 left-0 h-full transition-transform duration-500 ease-out z-10 pointer-events-none"
            style={{
              width: `${100 / slides.length}%`,
              transform: `translateX(calc(${active * 100}% + ${active === 0 ? Math.abs(hintPx) / 4 : 0}px))`,
              backgroundColor: accent
            }}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
//  AnimatedNumberFlow — Wraps NumberFlow with IntersectionObserver
//  so it transitions from 0 only when the element is visible
// ============================================================

import { ComponentProps } from 'react';

type NumberFlowProps = ComponentProps<typeof NumberFlow>;

const globalPrevValues = new Map<string, number>();
let hasAnimatedGlobal = false;

function AnimatedNumberFlow({ value, initialDelay = 200, id, ...props }: NumberFlowProps & { initialDelay?: number; id?: string }) {
  const [displayValue, setDisplayValue] = useState(() => {
    if (!hasAnimatedGlobal) return 0;
    if (id && globalPrevValues.has(id)) return globalPrevValues.get(id)!;
    return value;
  });

  const ref = useRef<any>(null);

  useEffect(() => {
    if (id) globalPrevValues.set(id, value);
  }, [id, value]);

  useEffect(() => {
    if (!hasAnimatedGlobal) {
      const el = ref.current;
      if (!el) {
        // Fallback in case NumberFlow doesn't forward the ref
        const t = setTimeout(() => {
          setDisplayValue(value);
          hasAnimatedGlobal = true;
        }, initialDelay);
        return () => clearTimeout(t);
      }
      let timer: ReturnType<typeof setTimeout>;
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          timer = setTimeout(() => {
            setDisplayValue(value);
            hasAnimatedGlobal = true;
          }, initialDelay);
          observer.disconnect();
        }
      }, { threshold: 0.5 });

      observer.observe(el);
      return () => {
        observer.disconnect();
        clearTimeout(timer);
      };
    } else {
      // Already animated globally. Animate to new value if changed.
      if (displayValue !== value) {
        const t = setTimeout(() => setDisplayValue(value), 50);
        return () => clearTimeout(t);
      }
    }
  }, [value, initialDelay, displayValue]);

  return <NumberFlow ref={ref} value={displayValue} {...props} />;
}

// ============================================================
//  DASHBOARD PAGE
// ============================================================

const DashboardPage: React.FC = () => {
  useEffect(() => { document.title = 'Dashboard — Keuanganku'; return () => { document.title = 'Keuanganku'; }; }, []);

  const { expenses, categories, currency: globalCurrency, isLoading, loadExpenses } =
    useExpenseStore();
  const { activeYear: year, activeMonth: month, resetToCurrentMonth } = useUIStore();

  // Dashboard display currency (saved to localStorage, independent of global default)
  const [dashCurrency, setDashCurrency] = useState<Currency>(() => {
    const saved = localStorage.getItem('dashboard_currency_preference');
    return (saved === 'USD' ? 'USD' : 'IDR') as Currency;
  });

  // Exchange rate state
  const [rateInfo, setRateInfo] = useState<RateResult>({ rate: 16000, isFallback: true });

  const handleDashCurrencyToggle = () => {
    haptic();
    const next: Currency = dashCurrency === 'IDR' ? 'USD' : 'IDR';
    setDashCurrency(next);
    localStorage.setItem('dashboard_currency_preference', next);
  };

  // Load data + exchange rate on mount
  useEffect(() => {
    loadExpenses();
    getExchangeRate().then(setRateInfo);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Conversion helper
  const toDisplay = useCallback(
    (exp: Expense) => convertAmount(exp.amount, exp.currency, dashCurrency, rateInfo.rate),
    [dashCurrency, rateInfo.rate]
  );

  const fmt = (amount: number) => formatCurrency(amount, dashCurrency);

  // ── Month prefix ──────────────────────────────────────────
  const nowDate = new Date();
  const isCurrentMonth = year === nowDate.getFullYear() && month === nowDate.getMonth() + 1;
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  // Last month
  const lastMonthDate = new Date(year, month - 2, 1);
  const lastMonthPrefix = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  // ── This month expenses ───────────────────────────────────
  const monthExpenses = useMemo(
    () => expenses.filter((e) => e.date.startsWith(monthPrefix)),
    [expenses, monthPrefix]
  );

  // TRANSFER this month
  const transferExpenses = useMemo(
    () => monthExpenses.filter((e) => e.type === 'TRANSFER'),
    [monthExpenses]
  );
  const transferTotal = useMemo(
    () => transferExpenses.reduce((s, e) => s + toDisplay(e), 0),
    [transferExpenses, toDisplay]
  );
  const uniqueDestinations = useMemo(
    () => [...new Set(transferExpenses.map((e) => e.destination).filter(Boolean))].slice(0, 3) as string[],
    [transferExpenses]
  );

  // NEED + WANT only (excludes TRANSFER) for all spending metrics
  const spendingExpenses = useMemo(
    () => monthExpenses.filter((e) => e.type !== 'TRANSFER'),
    [monthExpenses]
  );

  const monthTotal = useMemo(
    () => spendingExpenses.reduce((s, e) => s + toDisplay(e), 0),
    [spendingExpenses, toDisplay]
  );

  // ── Needs vs Wants split ──────────────────────────────────
  const split = useMemo(() => calcNeedsWantsSplit(monthExpenses), [monthExpenses]);

  // ── Bulan Ini vs Bulan Lalu ───────────────────────────────
  const lastMonthSpending = useMemo(() => {
    return expenses
      .filter((e) => e.date.startsWith(lastMonthPrefix) && e.type !== 'TRANSFER')
      .reduce((s, e) => s + toDisplay(e), 0);
  }, [expenses, lastMonthPrefix, toDisplay]);

  const delta = lastMonthSpending === 0 ? null : monthTotal - lastMonthSpending;
  const deltaPct = delta !== null && lastMonthSpending > 0
    ? Math.round((delta / lastMonthSpending) * 100)
    : null;
  const trend: 'up' | 'down' | 'same' = delta === null || delta === 0 ? 'same' : delta > 0 ? 'up' : 'down';

  // ── Top 3 categories (NEED + WANT only) ──────────────────
  const topCategories = useMemo(() => {
    const totals: Record<string, number> = {};
    spendingExpenses.forEach((e) => {
      totals[e.category] = (totals[e.category] ?? 0) + toDisplay(e);
    });
    return Object.entries(totals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([slug, amount]) => ({
        slug, amount,
        cat: categories.find((c) => c.slug === slug),
        pct: monthTotal > 0 ? Math.round((amount / monthTotal) * 100) : 0,
      }));
  }, [spendingExpenses, categories, monthTotal, toDisplay]);

  // ── Recent 5 transactions (all types) ────────────────────
  const recentExpenses = useMemo(() => expenses.slice(0, 5), [expenses]);



  if (isLoading && expenses.length === 0) return <SkeletonDashboard />;

  return (
    <div className="section-pad space-y-5 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <h2
          className={`text-sm font-black uppercase tracking-wider text-brutal-black/60 transition-all duration-150 ${!isCurrentMonth ? 'cursor-pointer underline underline-offset-2 hover:text-brutal-black' : ''}`}
          onClick={() => { if (!isCurrentMonth) resetToCurrentMonth(); }}
          title={!isCurrentMonth ? 'Kembali ke bulan ini' : undefined}
        >
          {monthLabel(year, month)}
        </h2>
      </div>

      {/* ── Stats Carousel (Total Bulan Ini + vs Bulan Lalu) ── */}
      {/* neo-card border/shadow wrapper, overflow-hidden so slides clip properly */}
      <div className="neo-card overflow-hidden !p-0">
        <SwipeCarousel
          accentColors={['#1A1A1A', '#B8F55A']}
          slides={[
            /* ── Slide 1: Total Bulan Ini — Yellow highlight background ── */
            <div className="h-full p-5 pt-4 pb-5 bg-brutal-yellow text-[#1A1A1A] flex flex-col justify-between" style={{ minHeight: 148 }}>
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-[#1A1A1A]/60">
                  Total Bulan Ini
                </p>
              </div>
              <div>
                <AnimatedNumberFlow
                  id="dash-total-1"
                  value={monthTotal}
                  initialDelay={200}
                  locales="id-ID"
                  format={dashCurrency === 'IDR'
                    ? { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }
                    : { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }
                  }
                  plugins={[continuous]}
                  spinTiming={{ duration: 1100, easing: 'ease-out' }}
                  className="block text-[40px] font-black leading-none tracking-tight translate-y-1"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                />
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-xs font-black uppercase text-[#1A1A1A]/60">
                    {spendingExpenses.length} transaksi
                  </p>
                  <div className="flex items-center gap-2">
                    {dashCurrency === 'USD' && (
                      <p className="text-[10px] font-medium text-[#1A1A1A]/45 text-right relative -top-0.5">
                        {rateInfo.isFallback
                          ? `≈ Rp ${rateInfo.rate.toLocaleString('id-ID')}`
                          : `= Rp ${rateInfo.rate.toLocaleString('id-ID')}`
                        }
                      </p>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDashCurrencyToggle(); }}
                      className="px-2.5 py-0.5 border-4 font-black text-xs uppercase transition-all duration-150"
                      style={{ borderColor: '#1A1A1A', backgroundColor: '#1A1A1A', color: '#B8F55A' }}
                    >
                      {dashCurrency}
                    </button>
                  </div>
                </div>
              </div>
            </div>,

            /* ── Slide 2: Bulan Ini vs Bulan Lalu — Dark card background ── */
            <div className="h-full p-5 flex flex-col justify-between" style={{ backgroundColor: '#2A2A2A', minHeight: 148 }}>
              <div className="flex items-center justify-between gap-1.5 sm:gap-4 flex-1">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] sm:text-xs font-bold uppercase text-brutal-black/50 mb-1 truncate">
                    {monthLabel(year, month)}
                  </p>
                  <AnimatedNumberFlow
                    id="dash-total-2"
                    value={monthTotal}
                    initialDelay={200}
                    locales="id-ID"
                    format={dashCurrency === 'IDR'
                      ? { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }
                      : { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }
                    }
                    plugins={[continuous]}
                    spinTiming={{ duration: 1000, easing: 'ease-out' }}
                    className="block text-[22px] sm:text-[28px] font-black leading-none tracking-tighter truncate text-white"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  />
                </div>
                <div className="flex items-center justify-center shrink-0 px-1 sm:px-2 mt-1 sm:mt-2">
                  {trend === 'up' && <TrendingUp size={24} strokeWidth={2.5} className="text-red-500" />}
                  {trend === 'down' && <TrendingDown size={24} strokeWidth={2.5} className="text-green-600" />}
                  {trend === 'same' && <Minus size={24} strokeWidth={2.5} className="text-brutal-black/40" />}
                </div>
                <div className="flex-1 min-w-0 text-right">
                  <p className="text-[11px] sm:text-xs font-bold uppercase text-brutal-black/50 mb-1 truncate">
                    {monthLabel(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1)}
                  </p>
                  {lastMonthSpending === 0 ? (
                    <p className="text-sm font-bold text-brutal-black/40 italic">Belum ada data</p>
                  ) : (
                    <AnimatedNumberFlow
                      id="dash-last-month"
                      value={lastMonthSpending}
                      initialDelay={400}
                      locales="id-ID"
                      format={dashCurrency === 'IDR'
                        ? { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }
                        : { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }
                      }
                      plugins={[continuous]}
                      spinTiming={{ duration: 1000, easing: 'ease-out' }}
                      className="block text-[22px] sm:text-[28px] font-black leading-none tracking-tighter truncate text-white"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    />
                  )}
                </div>
              </div>
              {delta !== null && delta !== 0 && lastMonthSpending > 0 && (
                <div
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 p-2 sm:p-2.5 border-2 w-full mt-2"
                  style={{ borderColor: '#F5F0E8', backgroundColor: delta > 0 ? 'rgba(248,113,113,0.15)' : 'rgba(74,222,128,0.12)' }}
                >
                  <div className="flex items-center gap-1.5 shrink-0">
                    {delta > 0
                      ? <TrendingUp size={16} strokeWidth={2.5} className="text-red-500" />
                      : <TrendingDown size={16} strokeWidth={2.5} className="text-green-600" />
                    }
                    <span className={`text-[11px] sm:text-sm font-black whitespace-nowrap ${delta > 0 ? 'text-red-500' : 'text-green-600'}`}>
                      {delta > 0 ? '+' : ''}
                      <AnimatedNumberFlow
                        id="dash-delta-pct"
                        value={deltaPct ?? 0}
                        initialDelay={600}
                        plugins={[continuous]}
                        spinTiming={{ duration: 800, easing: 'ease-out' }}
                        className="inline-block leading-none"
                      />
                      % ({delta > 0 ? '+' : ''}
                      <AnimatedNumberFlow
                        id="dash-delta-abs"
                        value={Math.abs(delta)}
                        initialDelay={600}
                        locales="id-ID"
                        format={dashCurrency === 'IDR'
                          ? { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }
                          : { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }
                        }
                        plugins={[continuous]}
                        spinTiming={{ duration: 1000, easing: 'ease-out' }}
                        className="inline-block leading-none"
                      />
                      )
                    </span>
                  </div>
                  <span className="text-[11px] sm:text-xs text-brutal-black/50 font-bold whitespace-nowrap">
                    {delta > 0 ? 'lebih banyak' : 'lebih hemat'} dr bulan lalu
                  </span>
                </div>
              )}
            </div>,
          ]}
        />
      </div>

      {/* ── TRANSFER Widget (only when transfers exist) ───── */}
      {transferExpenses.length > 0 && (
        <Card className="border-[#555555] bg-[#242424]">
          <CardBody>
            <div className="flex items-start gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wider mb-1 text-brutal-black/60">
                  Cashout
                </p>
                <p className="text-2xl font-black">{fmt(transferTotal)}</p>
                <p className="text-xs font-medium text-[#F5F0E8]/50 mt-0.5">
                  {transferExpenses.length} transaksi
                  {uniqueDestinations.length > 0 && ` · ${uniqueDestinations.join(', ')}`}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Needs vs Wants Split Bar ──────────────────────── */}
      <Card>
        <CardBody>
          <p className="text-xs font-black uppercase tracking-wider mb-3 text-brutal-black/60">
            Needs vs Wants
          </p>
          <div className="flex h-6 border-2 border-[#555555] overflow-hidden mb-3">
            {split.needsPct > 0 && (
              <div className="bg-blue-500 transition-all duration-500" style={{ width: `${split.needsPct}%` }} />
            )}
            {split.wantsPct > 0 && (
              <div className="bg-pink-500 transition-all duration-500" style={{ width: `${split.wantsPct}%` }} />
            )}
            {split.needs === 0 && split.wants === 0 && (
              <div className="flex-1 bg-brutal-black/10 flex items-center justify-center">
                <span className="text-[10px] font-bold text-brutal-black/40 uppercase">
                  Belum ada pengeluaran bulan ini
                </span>
              </div>
            )}
          </div>
          <div className="flex justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 bg-blue-500 border-2 border-[#555555]" />
                <span className="text-xs font-bold uppercase">Need</span>
                <span className="text-xs font-black">{split.needsPct}%</span>
              </div>
              <p className="text-sm font-bold mt-0.5">{fmt(convertAmount(split.needs, globalCurrency, dashCurrency, rateInfo.rate))}</p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 justify-end">
                <span className="text-xs font-black">{split.wantsPct}%</span>
                <span className="text-xs font-bold uppercase">Want</span>
                <div className="w-3 h-3 bg-pink-500 border-2 border-[#555555]" />
              </div>
              <p className="text-sm font-bold mt-0.5">{fmt(convertAmount(split.wants, globalCurrency, dashCurrency, rateInfo.rate))}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Top 3 Categories ───────────────────────────────── */}
      {topCategories.length > 0 && (
        <div>
          <p className="text-xs font-black uppercase tracking-wider mb-3 text-brutal-black/60">
            Top Kategori Terboros
          </p>
          <div className="space-y-2">
            {topCategories.map(({ slug, amount, cat, pct }) => (
              <Card key={slug} className="!shadow-[4px_4px_0_0_#000] p-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl w-9 shrink-0 text-center">{cat?.emoji ?? '🛍️'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold truncate">{cat?.label ?? slug}</span>
                      <span className="text-sm font-black shrink-0 ml-2">{fmt(amount)}</span>
                    </div>
                    <div className="h-2 border-2 border-[#555555] overflow-hidden">
                      <div className="h-full bg-brutal-black transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="text-xs font-black text-brutal-black/50 shrink-0 w-8 text-right">{pct}%</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent Transactions ────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-black uppercase tracking-wider text-brutal-black/60">
            Transaksi Terakhir
          </p>
          <Link
            to="/history"
            className="text-xs font-black uppercase tracking-wider text-brutal-black flex items-center gap-1 hover:underline"
          >
            Lihat Semua <ChevronRight size={12} strokeWidth={2.5} />
          </Link>
        </div>

        {recentExpenses.length === 0 ? (
          <Card flat className="p-6 text-center">
            <CalendarClock size={32} strokeWidth={2} className="mx-auto mb-2 text-brutal-black/30" />
            <p className="text-sm font-bold text-brutal-black/50 uppercase">
              Belum ada pengeluaran bulan ini
            </p>
            <p className="text-xs text-brutal-black/40 mt-1">Tap + untuk mulai mencatat!</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentExpenses.map((e) => {
              const cat = categories.find((c) => c.slug === e.category);
              const badgeVariant = e.type === 'NEED' ? 'need' : e.type === 'WANT' ? 'want' : 'transfer';
              return (
                <Card key={e.id} className="!shadow-[4px_4px_0_0_#000]">
                  <div className="flex items-center gap-3 p-3">
                    <span className="text-2xl w-9 shrink-0 text-center">
                      {e.type === 'TRANSFER' ? '💸' : (cat?.emoji ?? '🛍️')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate leading-tight">{e.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge variant={badgeVariant} size="sm">{e.type}</Badge>
                        {e.type === 'TRANSFER' && e.destination && (
                          <span className="text-[10px] text-brutal-black/50 font-medium">→ {e.destination}</span>
                        )}
                        <span className="text-[10px] text-brutal-black/50 font-medium">
                          {friendlyDate(e.date)}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm font-black shrink-0">{fmt(toDisplay(e))}</p>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="h-4" />
    </div>
  );
};

export default DashboardPage;
