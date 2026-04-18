import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus, CalendarClock, Target } from 'lucide-react';
import { Card, CardBody } from '../components/ui/Card';
import NumberFlow, { continuous } from '@number-flow/react';
import { SkeletonDashboard } from '../components/SkeletonCard';
import { useExpenseStore } from '../store/useExpenseStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useAppStore';
import {
  formatCurrency,
  calcNeedsWantsSplit,
  monthLabel,
} from '../lib/utils';
import { getExchangeRate, convertAmount, type RateResult } from '../lib/exchangeRate';
import type { Currency, Expense } from '../types';

// ============================================================
//  HELPERS
// ============================================================

function haptic() { if ('vibrate' in navigator) navigator.vibrate(10); }

// Swipeable Card Carousel
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
  variant = 'lines',
  disableHint = false,
}: {
  slides: React.ReactNode[];
  /** Per-slide indicator dot accent color. Defaults to #B8F55A */
  accentColors?: string[];
  variant?: 'lines' | 'dots';
  disableHint?: boolean;
}) {
  const [active, setActive] = useState(0);
  const startX = useRef<number | null>(null);
  const isDragging = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [hintPx, setHintPx] = useState(0);
  const hintTimeouts = useRef<{ t1?: NodeJS.Timeout; t2?: NodeJS.Timeout }>({});

  useEffect(() => {
    if (disableHint || slides.length <= 1 || hasSeenSwipeHint()) return;

    // Set to true after delay to avoid React 18 Strict Mode double-mount cancellation
    hintTimeouts.current.t1 = setTimeout(() => {
      markSwipeHintSeen();
      setHintPx(-30);
    }, 2000);
    hintTimeouts.current.t2 = setTimeout(() => setHintPx(0), 2600);

    return () => {
      clearTimeout(hintTimeouts.current.t1);
      clearTimeout(hintTimeouts.current.t2);
    };
  }, [slides.length]);

  const accent = accentColors?.[active] ?? '#B8F55A';

  const markHintSeen = () => {
    clearTimeout(hintTimeouts.current.t1);
    clearTimeout(hintTimeouts.current.t2);
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
      data-no-swipe="true"
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

      {/* Indicator lines - minimal, inside bottom of carousel (variant: lines) */}
      {slides.length > 1 && variant === 'lines' && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px]">
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

      {/* Indicator dots - floating bottom-center, adds no extra height (variant: dots) */}
      {slides.length > 1 && variant === 'dots' && (
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex items-center gap-1 z-10">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); goTo(i); }}
              className="p-1 -m-1" // extend clickable area
              aria-label={`Go to slide ${i + 1}`}
            >
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ease-out ${active === i ? 'w-3.5 opacity-100' : 'w-1.5 opacity-40 bg-white'}`}
                style={active === i ? { backgroundColor: accentColors?.[i] ?? '#FFFFFF' } : undefined}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  AnimatedNumberFlow wraps NumberFlow with IntersectionObserver
//  so it transitions from 0 only when the element is visible
// ============================================================

type NumberFlowProps = ComponentProps<typeof NumberFlow>;
type NumberFlowValue = NumberFlowProps['value'];

const globalPrevValues = new Map<string, NumberFlowValue>();
const globalAnimated = new Set<string>();

function AnimatedNumberFlow({ value, initialDelay = 200, id, ...props }: NumberFlowProps & { initialDelay?: number; id?: string }) {
  const [localHasAnimated, setLocalHasAnimated] = useState(() => id ? globalAnimated.has(id) : false);

  const [displayValue, setDisplayValue] = useState<NumberFlowValue>(() => {
    if (!localHasAnimated) return 0;
    if (id && globalPrevValues.has(id)) return globalPrevValues.get(id)!;
    return value;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    if (id) globalPrevValues.set(id, value);
  }, [id, value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsIntersecting(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry.isIntersecting);
    }, { threshold: 0.1 });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!localHasAnimated) {
      if (isIntersecting) {
        const t = setTimeout(() => {
          setDisplayValue(value);
          setLocalHasAnimated(true);
          if (id) globalAnimated.add(id);
        }, initialDelay);
        return () => clearTimeout(t);
      }
    } else {
      if (isIntersecting && displayValue !== value) {
        const t = setTimeout(() => setDisplayValue(value), 50);
        return () => clearTimeout(t);
      }
    }
  }, [value, initialDelay, displayValue, isIntersecting, localHasAnimated, id]);

  return <NumberFlow ref={ref} value={displayValue} {...props} />;
}

// Module-level rate cache persists across Dashboard re-mounts so amounts
// don't flash from the default 16000 fallback rate on each navigation return.
let _cachedRateInfo: RateResult = { rate: 16000, isFallback: true };

// ============================================================
//  DASHBOARD PAGE
// ============================================================

const DashboardPage: React.FC = () => {
  useEffect(() => { document.title = 'Dashboard - KeuanganKu'; return () => { document.title = 'Keuanganku'; }; }, []);

  const { expenses, categories, isLoading } =
    useExpenseStore();
  const { activeYear: year, activeMonth: month, resetToCurrentMonth, prevMonth, nextMonth } = useUIStore();
  const { personalMonthlyBudget, familySupportMonthlyBudget } = useSettingsStore();

  // Swipe Handlers for Month Header
  const headerStartX = useRef<number | null>(null);
  const suppressHeaderClickRef = useRef(false);
  const clearHeaderClickSuppressTimerRef = useRef<number | null>(null);
  const [dateDragging, setDateDragging] = useState(false);

  useEffect(() => {
    return () => {
      if (clearHeaderClickSuppressTimerRef.current !== null) {
        window.clearTimeout(clearHeaderClickSuppressTimerRef.current);
      }
    };
  }, []);

  const onHeaderTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (clearHeaderClickSuppressTimerRef.current !== null) {
      window.clearTimeout(clearHeaderClickSuppressTimerRef.current);
      clearHeaderClickSuppressTimerRef.current = null;
    }
    suppressHeaderClickRef.current = false;
    headerStartX.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
    setDateDragging(false);
  };

  const onHeaderTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (headerStartX.current !== null) {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      if (Math.abs(clientX - headerStartX.current) > 5) {
        setDateDragging(true);
      }
    }
  };

  const onHeaderTouchEnd = (e: React.TouchEvent | React.MouseEvent) => {
    if (headerStartX.current === null) return;
    const endX = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
    const dx = endX - headerStartX.current;
    const didSwipeMonth = Math.abs(dx) > 40;

    if (didSwipeMonth) {
      suppressHeaderClickRef.current = true;
      if (dx > 0) prevMonth();
      else nextMonth();
      haptic();

      clearHeaderClickSuppressTimerRef.current = window.setTimeout(() => {
        suppressHeaderClickRef.current = false;
        clearHeaderClickSuppressTimerRef.current = null;
      }, 250);
    }
    headerStartX.current = null;
    setDateDragging(false);
  };

  // Dashboard display currency (saved to localStorage, independent of global default)
  const [dashCurrency, setDashCurrency] = useState<Currency>(() => {
    const saved = localStorage.getItem('dashboard_currency_preference');
    return (saved === 'USD' ? 'USD' : 'IDR') as Currency;
  });

  // Exchange rate state - init from cache to avoid flash on re-mount
  const [rateInfo, setRateInfo] = useState<RateResult>(() => _cachedRateInfo);

  const handleDashCurrencyToggle = () => {
    haptic();
    const next: Currency = dashCurrency === 'IDR' ? 'USD' : 'IDR';
    setDashCurrency(next);
    localStorage.setItem('dashboard_currency_preference', next);
  };

  // Load data + exchange rate on mount
  useEffect(() => {
    getExchangeRate().then((res) => {
      _cachedRateInfo = res;
      setRateInfo(res);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Conversion helper
  const toDisplay = useCallback(
    (exp: Expense) => convertAmount(exp.amount, exp.currency, dashCurrency, rateInfo.rate),
    [dashCurrency, rateInfo.rate]
  );

  const fmt = (amount: number) => formatCurrency(amount, dashCurrency);

  // Month prefixes used for filtering
  const nowDate = new Date();
  const isCurrentMonth = year === nowDate.getFullYear() && month === nowDate.getMonth() + 1;
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  // Last month
  const lastMonthDate = new Date(year, month - 2, 1);
  const lastMonthPrefix = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  // This month expenses
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

  // Needs vs Wants split
  const split = useMemo(() => calcNeedsWantsSplit(
    monthExpenses
      .filter((e) => e.category !== 'keluarga')
      .map((e) => ({ ...e, amount: toDisplay(e) }))
  ), [monthExpenses, toDisplay]);

  // Bulan Ini vs Bulan Lalu
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

  // Budget calculations and base values
  const familySupportSpent = useMemo(
    () => spendingExpenses
      .filter((e) => e.category === 'keluarga')
      .reduce((s, e) => s + toDisplay(e), 0),
    [spendingExpenses, toDisplay]
  );

  // personalSpent excludes keluarga category (tracked separately)
  const personalSpent = monthTotal - familySupportSpent;

  // Top 3 categories (NEED + WANT only, exclude keluarga)
  const topCategories = useMemo(() => {
    const totals: Record<string, number> = {};
    spendingExpenses
      .filter((e) => e.category !== 'keluarga')
      .forEach((e) => {
        totals[e.category] = (totals[e.category] ?? 0) + toDisplay(e);
      });
    return Object.entries(totals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([slug, amount]) => ({
        slug, amount,
        cat: categories.find((c) => c.slug === slug),
        pct: personalSpent > 0 ? Math.round((amount / personalSpent) * 100) : 0,
      }));
  }, [spendingExpenses, categories, personalSpent, toDisplay]);

  // Recent 5 transactions (all types)
  const recentExpenses = useMemo(() => expenses.slice(0, 5), [expenses]);

  const budgetSpentPct = personalMonthlyBudget > 0
    ? Math.round((personalSpent / personalMonthlyBudget) * 100)
    : 0;
  const budgetRemaining = personalMonthlyBudget - personalSpent;
  const familySpentPct = familySupportMonthlyBudget > 0
    ? Math.round((familySupportSpent / familySupportMonthlyBudget) * 100)
    : 0;
  const familyRemaining = familySupportMonthlyBudget - familySupportSpent;

  function budgetColor(pct: number) {
    if (pct > 100) return { text: 'text-red-500', bar: '#DC2626', swatch: 'bg-red-500', over: true };
    if (pct >= 90) return { text: 'text-orange-400', bar: '#FB923C', swatch: 'bg-orange-400', over: false };
    if (pct >= 70) return { text: 'text-yellow-400', bar: '#FACC15', swatch: 'bg-yellow-400', over: false };
    return { text: 'text-green-400', bar: '#4ADE80', swatch: 'bg-green-400', over: false };
  }
  const bc = budgetColor(budgetSpentPct);
  const fc = budgetColor(familySpentPct);

  const hasBudget = personalMonthlyBudget > 0 || familySupportMonthlyBudget > 0;
  const dashboardDarkShadow = '3px 3px 0px 0px #746C62';



  if (isLoading && expenses.length === 0) return <SkeletonDashboard />;

  return (
    <div className="section-pad space-y-5 max-w-2xl mx-auto">
      {/* Header */}
      <div
        className="flex items-center justify-between py-1 -mt-1 -mx-2 px-2 select-none"
        data-no-swipe="true"
        onTouchStart={onHeaderTouchStart}
        onTouchMove={onHeaderTouchMove}
        onTouchEnd={onHeaderTouchEnd}
        onMouseDown={onHeaderTouchStart}
        onMouseMove={onHeaderTouchMove}
        onMouseUp={onHeaderTouchEnd}
        onMouseLeave={onHeaderTouchEnd}
        style={{ cursor: dateDragging ? 'grabbing' : 'grab' }}
      >
        <div className="flex items-center gap-2">
          <h2
            key={monthPrefix}
            className={`text-sm font-black uppercase tracking-wider text-brutal-black/60 transition-all duration-150 page-fade-in ${!isCurrentMonth ? 'cursor-pointer underline underline-offset-2 hover:text-brutal-black' : ''}`}
            onClick={() => {
              // Ignore the synthetic click that follows a successful swipe gesture.
              if (suppressHeaderClickRef.current || dateDragging) return;
              if (!isCurrentMonth) resetToCurrentMonth();
            }}
            title={!isCurrentMonth ? 'Kembali ke bulan ini' : undefined}
          >
            {monthLabel(year, month)}
          </h2>
        </div>
      </div>

      {/* Stats Carousel (Total Bulan Ini + vs Bulan Lalu) */}
      {/* neo-card border/shadow wrapper, overflow-hidden so slides clip properly */}
      <div className="neo-card overflow-hidden !p-0">
        <SwipeCarousel
          accentColors={['#1A1A1A', '#B8F55A']}
          slides={[
            /* Slide 1: Total Bulan Ini - yellow highlight background */
            <div className="h-full p-5 pt-4 pb-5 bg-brutal-yellow text-[#1A1A1A] flex flex-col justify-between" style={{ minHeight: 148 }}>
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-[#1A1A1A]/60">
                  Total Bulan Ini
                </p>
              </div>
              <div>
                <AnimatedNumberFlow
                  key="dash-total-1"
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
                          ? `~ Rp ${rateInfo.rate.toLocaleString('id-ID')}`
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

            /* Slide 2: Bulan Ini vs Bulan Lalu - dark card background */
            <div className="h-full p-5 flex flex-col justify-between" style={{ backgroundColor: '#2A2A2A', minHeight: 148 }}>
              <div className="flex items-center justify-between gap-1.5 sm:gap-4 flex-1">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] sm:text-xs font-bold uppercase text-brutal-black/50 mb-1 truncate">
                    {monthLabel(year, month)}
                  </p>
                  <AnimatedNumberFlow
                    key="dash-total-2"
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
                      key="dash-last-month"
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
                        key="dash-delta-pct"
                        id="dash-delta-pct"
                        value={deltaPct ?? 0}
                        initialDelay={600}
                        plugins={[continuous]}
                        spinTiming={{ duration: 800, easing: 'ease-out' }}
                        className="inline-block leading-none"
                      />
                      % ({delta > 0 ? '+' : ''}
                      <AnimatedNumberFlow
                        key="dash-delta-abs"
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

      {/* Needs vs Wants + Budget Carousel */}
      <div className="neo-card overflow-hidden !p-0" style={{ boxShadow: dashboardDarkShadow }}>
        <SwipeCarousel
          variant="dots"
          disableHint
          accentColors={hasBudget ? ['#FFFFFF', '#FFFFFF'] : ['#FFFFFF']}
          slides={[
            /* Slide 1: Needs vs Wants */
            <div className="px-4 py-3">
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
                  <p className="text-sm font-bold mt-0.5">{fmt(split.needs)}</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1.5 justify-end">
                    <span className="text-xs font-black">{split.wantsPct}%</span>
                    <span className="text-xs font-bold uppercase">Want</span>
                    <div className="w-3 h-3 bg-pink-500 border-2 border-[#555555]" />
                  </div>
                  <p className="text-sm font-bold mt-0.5">{fmt(split.wants)}</p>
                </div>
              </div>
            </div>,

            /* Slide 2: Budget Bulanan - mirrors Need vs Want layout */
            ...(hasBudget ? [
              <div className="px-4 py-3">
                {/* Title row matches the Needs vs Wants label height */}
                <p className="text-xs font-black uppercase tracking-wider mb-3 text-brutal-black/60 flex items-center gap-1.5">
                  <Target size={11} strokeWidth={2.5} className="shrink-0" />
                  Budget Bulanan
                </p>

                {/* Progress bars: 2 columns if both exist, 1 column if solo */}
                <div className={`grid ${personalMonthlyBudget > 0 && familySupportMonthlyBudget > 0 ? 'grid-cols-2 gap-4' : 'grid-cols-1'} min-h-[72px]`}>

                  {/* Left/Only: Personal Budget */}
                  {personalMonthlyBudget > 0 && (
                    <div className="flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 border border-[#555555] ${bc.swatch}`} />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-brutal-black/60">Pribadi</span>
                          </div>
                          <span className={`text-[11px] font-black ${bc.text}`}>{budgetSpentPct}%</span>
                        </div>
                        <div className="h-2 border-2 border-[#555555] overflow-hidden bg-[#111111]">
                          <div
                            className="h-full transition-all duration-700 ease-out"
                            style={{
                              width: `${Math.min(100, budgetSpentPct)}%`,
                              backgroundColor: bc.bar,
                              ...(bc.over ? {
                                backgroundImage: `repeating-linear-gradient(
                                  -45deg,
                                  transparent,
                                  transparent 3px,
                                  rgba(0,0,0,0.3) 3px,
                                  rgba(0,0,0,0.3) 6px
                                )`,
                              } : {}),
                            }}
                          />
                        </div>
                      </div>
                      <div className="mt-2">
                        <p className="text-sm font-bold leading-none">{fmt(personalSpent)}</p>
                        <p className={`text-[10px] font-medium mt-1 ${budgetRemaining < 0 ? 'text-red-400 font-bold' : 'text-brutal-black/40'}`}>
                          {budgetRemaining >= 0 ? `sisa ${fmt(budgetRemaining)}` : `lebih ${fmt(Math.abs(budgetRemaining))}`}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Right: Keluarga Budget */}
                  {familySupportMonthlyBudget > 0 && (
                    <div className="flex flex-col justify-between">
                      <div>
                        {/* Reversed Header for Right Alignment */}
                        <div className="flex items-center justify-between mb-1.5 flex-row-reverse">
                          <div className="flex items-center gap-1.5 flex-row-reverse">
                            <div className={`w-2 h-2 border border-[#555555] ${fc.swatch}`} />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-brutal-black/60">Keluarga</span>
                          </div>
                          <span className={`text-[11px] font-black ${fc.text}`}>{familySpentPct}%</span>
                        </div>
                        <div className="h-2 border-2 border-[#555555] overflow-hidden bg-[#111111]">
                          <div
                            className="h-full transition-all duration-700 ease-out float-right"
                            style={{
                              width: `${Math.min(100, familySpentPct)}%`,
                              backgroundColor: fc.bar,
                              ...(fc.over ? {
                                backgroundImage: `repeating-linear-gradient(
                                  -45deg,
                                  transparent,
                                  transparent 3px,
                                  rgba(0,0,0,0.3) 3px,
                                  rgba(0,0,0,0.3) 6px
                                )`,
                              } : {}),
                            }}
                          />
                        </div>
                      </div>
                      <div className="mt-2 text-right">
                        <p className="text-sm font-bold leading-none">{fmt(familySupportSpent)}</p>
                        <p className={`text-[10px] font-medium mt-1 ${familyRemaining < 0 ? 'text-red-400 font-bold' : 'text-brutal-black/40'}`}>
                          {familyRemaining >= 0 ? `sisa ${fmt(familyRemaining)}` : `lebih ${fmt(Math.abs(familyRemaining))}`}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ] : []),
          ]}
        />
      </div>

      {/* Transfer widget (only when transfers exist) */}
      {transferExpenses.length > 0 && (
        <Link
          to="/history"
          state={{ fromDashboardCashout: true }}
          className="block group select-none"
        >
          <Card className="border-[#555555] bg-[#242424] transition-all duration-150 group-hover:-translate-y-0.5 group-hover:!shadow-[4px_6px_0_0_#000] group-active:translate-y-[4px] group-active:translate-x-[4px] group-active:!shadow-none" style={{ boxShadow: dashboardDarkShadow }}>
            <CardBody>
              <div className="flex items-start gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-wider mb-1 text-brutal-black/60">
                    Cashout
                  </p>
                  <p className="text-2xl font-black">{fmt(transferTotal)}</p>
                  <p className="text-xs font-medium text-[#F5F0E8]/50 mt-0.5">
                    {transferExpenses.length} transaksi
                    {uniqueDestinations.length > 0 && ` - ${uniqueDestinations.join(', ')}`}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        </Link>
      )}

      {/* Top 3 Categories */}
      {topCategories.length > 0 && (
        <div>
          <p className="text-xs font-black uppercase tracking-wider mb-2 text-brutal-black/60">
            Top Kategori Terboros
          </p>
          <div className="space-y-2">
            {topCategories.map(({ slug, amount, cat, pct }) => (
              <Link
                key={slug}
                to="/history"
                state={{ categorySlug: slug, fromDashboardTop: true }}
                className="block group select-none"
                aria-label={`Lihat semua pengeluaran ${cat?.label ?? slug}`}
              >
                <Card className="!shadow-[4px_4px_0_0_#000] p-3 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:!shadow-[4px_6px_0_0_#000] group-active:translate-y-[4px] group-active:translate-x-[4px] group-active:!shadow-none">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl w-9 shrink-0 text-center">{cat?.emoji ?? '\u{1F6CD}\uFE0F'}</span>
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
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-black uppercase tracking-wider text-brutal-black/60">
            Pengeluaran Terakhir
          </p>
          <Link
            to="/history"
            className="text-xs font-black uppercase tracking-wider text-brutal-black flex items-center gap-1 hover:underline"
          >
            Lihat Semua {'\u25b8'}
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
              return (
                <Card key={e.id} className="!shadow-[4px_4px_0_0_#000]">
                  <div className="flex items-center gap-2.5 px-3 py-1.5">
                    <span className="text-xl w-8 shrink-0 text-center">
                      {e.type === 'TRANSFER' ? '\u{1F4B8}' : (cat?.emoji ?? '\u{1F6CD}\uFE0F')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold truncate leading-tight">{e.name}</p>
                      </div>
                    </div>
                    <p className="text-[13px] font-black shrink-0">{fmt(toDisplay(e))}</p>
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
