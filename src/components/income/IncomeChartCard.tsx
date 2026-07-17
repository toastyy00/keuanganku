import React, { useMemo } from 'react';
import { PortfolioChart } from '../portfolio/PortfolioChart';
import { useExpenseStore } from '../../store/useExpenseStore';
import type { IncomeEntry } from '../../types';
import { useRandomGlows } from '../../hooks/useRandomGlows';

interface IncomeChartCardProps {
  monthIncomes: IncomeEntry[];
  year: number;
  month: number;
}

export const IncomeChartCard = React.memo(({ monthIncomes, year, month }: IncomeChartCardProps) => {
  const { currency } = useExpenseStore();
  const glows = useRandomGlows('chart');

  const getNetValue = (i: IncomeEntry) => {
    if (currency === 'IDR') {
      return i.has_cost_basis ? (i.value_idr - (i.cost_value_idr ?? 0)) : i.value_idr;
    } else {
      return i.has_cost_basis ? (i.value_usd - (i.cost_value_usd ?? 0)) : i.value_usd;
    }
  };

  const totalRevenueUsd = monthIncomes.reduce((sum, i) => {
    const pnlUsd = i.has_cost_basis ? (i.value_usd - (i.cost_value_usd ?? 0)) : i.value_usd;
    return sum + pnlUsd;
  }, 0);

  const totalRevenueIdr = monthIncomes.reduce((sum, i) => {
    const pnlIdr = i.has_cost_basis ? (i.value_idr - (i.cost_value_idr ?? 0)) : i.value_idr;
    return sum + pnlIdr;
  }, 0);

  const impliedRate = totalRevenueUsd > 0 ? totalRevenueIdr / totalRevenueUsd : 15600;

  // Calculate days count to find daily average
  const lastDayDate = new Date(year, month, 0);
  const lastDay = lastDayDate.getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && (today.getMonth() + 1) === month;
  const maxDay = isCurrentMonth ? today.getDate() : lastDay;

  const avgIdr = totalRevenueIdr / (maxDay || 1);
  const avgUsd = totalRevenueUsd / (maxDay || 1);

  const dataPoints = useMemo(() => {
    const chartPoints: { timestamp: number; value: number }[] = [];
    let runningTotal = 0;

    // Group incomes by day of month
    const incomesByDay: Record<number, number> = {};
    monthIncomes.forEach((i) => {
      const dayNum = Number(i.date.substring(8, 10));
      const netVal = getNetValue(i);
      incomesByDay[dayNum] = (incomesByDay[dayNum] ?? 0) + netVal;
    });

    // Start the chart at 00:00:00 on the first day of the active month
    const startOfMonth = new Date(year, month - 1, 1, 0, 0, 0).getTime();
    chartPoints.push({ timestamp: startOfMonth, value: 0 });

    for (let d = 1; d <= maxDay; d++) {
      const dayVal = incomesByDay[d] ?? 0;
      runningTotal += dayVal;

      // Register each day's cumulative value at 23:59:59 of that day
      const dayTimestamp = new Date(year, month - 1, d, 23, 59, 59).getTime();
      chartPoints.push({
        timestamp: dayTimestamp,
        value: runningTotal,
      });
    }

    return chartPoints;
  }, [monthIncomes, year, month, currency, maxDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatScrubValues = (value: number) => {
    if (currency === 'IDR') {
      return [
        `Rp ${Math.round(value).toLocaleString('id-ID')}`,
        `≈ $${(value / impliedRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      ];
    } else {
      return [
        `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        `≈ Rp ${Math.round(value * impliedRate).toLocaleString('id-ID')}`
      ];
    }
  };

  return (
    <div className="relative w-full h-full rounded-3xl border border-white/[0.10] bg-gradient-to-br from-[#1A1A1A] via-[#131313] to-[#0E0E0E] pt-5 pb-3 flex flex-col justify-start text-[#F5F0E8] shadow-[0_12px_30px_rgba(0,0,0,0.25)] overflow-hidden">
      {/* Noise texture overlay to eliminate color banding (dithering) */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.03] mix-blend-overlay z-10"
        style={{
          backgroundImage: `url("data:image/png;base64,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")`,
        }}
      />

      {/* Randomised ambient glows */}
      {glows.map((g, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            top: g.top,
            bottom: g.bottom,
            left: g.left,
            right: g.right,
            width: g.width,
            height: g.height,
            background: g.color,
            opacity: g.opacity,
            borderRadius: g.borderRadius,
            filter: `blur(${g.blur}px)`,
            willChange: 'filter, transform',
            transform: 'translate3d(0,0,0)',
          }}
        />
      ))}
      {/* Top edge shimmer */}
      <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent pointer-events-none" />
      <div className="flex flex-col gap-0.5 z-10 px-5">
        <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">
          Income Growth
        </p>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="text-2xl font-bold tracking-tight text-white">
            {currency === 'IDR'
              ? `Rp ${Math.round(avgIdr).toLocaleString('id-ID')}`
              : `$${avgUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
          <span className="text-xs text-white/30 font-medium">/day</span>
        </div>
        <p className="text-[10px] text-white/45 font-medium mt-0.5">
          Daily average this month
        </p>
      </div>

      <div className="absolute inset-0 w-full h-full pt-12 pb-2 z-0">
        {dataPoints.length <= 1 ? (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-xs text-white/20 italic">No income data logged</p>
          </div>
        ) : (
          <PortfolioChart
            dataPoints={dataPoints}
            colorTheme="#B8F55A"
            timeframe="1M"
            formatScrubValues={formatScrubValues}
            showLastPointMarker={false}
          />
        )}
      </div>
    </div>
  );
});
