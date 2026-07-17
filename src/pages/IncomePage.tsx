import React, { useEffect, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CalendarDays, ArrowLeft } from 'lucide-react';
import { useUIStore } from '../store/useAppStore';
import { useIncomeStore } from '../store/useIncomeStore';
import { useAuthStore } from '../store/useAuthStore';
import { GUEST_DATA_SCOPE } from '../lib/dataScope';
import { monthLabel } from '../lib/utils';
import { IncomeEntryCard } from '../components/income/IncomeEntryCard';
import { IncomeCardStack } from '../components/income/IncomeCardStack';

const IncomePage: React.FC = () => {
  const { incomes, loadIncomes, isLoading, _hasHydrated, cacheScope, ensureScope } = useIncomeStore();
  const {
    activeYear: year,
    activeMonth: month,
    prevMonth,
    nextMonth,
    resetToCurrentMonth,
    openAddIncomeSheet,
  } = useUIStore();
  
  const user = useAuthStore((s) => s.user);
  const activeScope = user?.id ?? GUEST_DATA_SCOPE;

  // Set document title
  useEffect(() => {
    document.title = 'Income - KeuanganKu';
    return () => {
      document.title = 'Keuanganku';
    };
  }, []);

  // Ensure scope and load data
  useEffect(() => {
    if (_hasHydrated) {
      ensureScope(activeScope);
    }
  }, [_hasHydrated, activeScope, ensureScope]);

  useEffect(() => {
    if (_hasHydrated && cacheScope === activeScope) {
      void loadIncomes();
    }
  }, [_hasHydrated, cacheScope, activeScope, loadIncomes]);

  const [activeFilter, setActiveFilter] = React.useState<{ type: 'FIAT' | 'CRYPTO_SOURCE'; value: string } | null>(null);

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  
  const monthIncomes = useMemo(() => {
    return incomes.filter((i) => i.date.startsWith(monthPrefix));
  }, [incomes, monthPrefix]);

  const filteredIncomes = useMemo(() => {
    if (!activeFilter) return monthIncomes;
    if (activeFilter.type === 'FIAT') {
      return monthIncomes.filter((i) => i.asset_type === 'FIAT');
    }
    if (activeFilter.type === 'CRYPTO_SOURCE') {
      return monthIncomes.filter((i) => i.asset_type === 'CRYPTO' && i.source_type === activeFilter.value);
    }
    return monthIncomes;
  }, [monthIncomes, activeFilter]);

  // Reset filter if activeMonth changes
  useEffect(() => {
    setActiveFilter(null);
  }, [month, year]);

  const nowDate = new Date();
  const isCurrentMonth = year === nowDate.getFullYear() && month === nowDate.getMonth() + 1;

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col px-4 pt-4 pb-2 md:px-6 overflow-hidden">
      {/* Sticky Top Header Section */}
      <div className="shrink-0 flex flex-col">
        {/* Page Title & Back Button */}
        <div className="flex items-center justify-between py-1 mb-2 select-none">
          <NavLink
            to="/"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.08] hover:border-white/20 text-white/50 hover:text-white transition-all active:scale-95 shrink-0 shadow-sm"
            aria-label="Back to home"
          >
            <ArrowLeft size={16} strokeWidth={2.5} />
          </NavLink>
          
          <div className="flex items-center gap-1.5 text-[15px] font-black uppercase tracking-[0.12em] text-right">
            <span className="text-[#B8F55A]">Income</span>
            <span className="text-[#F5F0E8]">Tracker</span>
          </div>
        </div>

        {/* Tinder Summary Card Deck */}
        <IncomeCardStack
          monthIncomes={monthIncomes}
          year={year}
          month={month}
          activeFilter={activeFilter}
          onToggleFilter={setActiveFilter}
        />

        {/* Sticky Title Bar & Add Entry Row (With divider line) */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mt-5">
          {/* Left Column: Title Info & Month Selector placed side-by-side */}
          <div className="flex flex-col gap-0.5 min-w-0">
            {/* Title and Month Selector Row */}
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/40 truncate">
                Income History
              </p>
              
              {/* Compact Mini Month Selector (directly next to the title, borderless to match typography style) */}
              <div className="flex items-center gap-0.5 select-none shrink-0">
                <button 
                  type="button"
                  onClick={prevMonth} 
                  className="p-0.5 text-white/30 hover:text-white transition-colors"
                  aria-label="Previous month"
                >
                  <ChevronLeft size={13} strokeWidth={2.5} />
                </button>
                
                <span 
                  className={`text-[9px] font-bold text-white/50 uppercase tracking-wider text-center transition-colors ${
                    !isCurrentMonth ? "cursor-pointer hover:text-white underline underline-offset-2" : ""
                  }`}
                  onClick={() => {
                    if (!isCurrentMonth) resetToCurrentMonth();
                  }}
                  title={!isCurrentMonth ? "Return to current month" : undefined}
                >
                  {monthLabel(year, month)}
                </span>
                
                <button 
                  type="button"
                  onClick={nextMonth} 
                  className="p-0.5 text-white/30 hover:text-white transition-colors"
                  aria-label="Next month"
                >
                  <ChevronRight size={13} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Records count stacked cleanly below */}
            <span className="text-[9px] text-white/20 font-bold uppercase tracking-wider">
              {activeFilter ? `${filteredIncomes.length} of ` : ''}{monthIncomes.length} Inflow{monthIncomes.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Right Column: Add Entry button */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={openAddIncomeSheet}
              className="h-7 px-2.5 rounded-lg bg-[#B8F55A] hover:bg-[#a5e04c] text-[#1A1A1A] text-[9px] font-bold uppercase tracking-wider transition-all active:scale-[0.95] flex items-center gap-1 shadow-sm shrink-0"
            >
              <span>Add Income</span>
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable History List Section */}
      <div className="flex-1 overflow-y-auto pr-1 -mr-1 flex flex-col gap-3 pt-3 pb-6 scrollbar-none">
        {isLoading && monthIncomes.length === 0 ? (
          <div className="text-center py-10">
            <span className="inline-block w-6 h-6 border-4 border-t-transparent border-[#B8F55A] rounded-full animate-spin" />
            <p className="text-xs text-white/40 uppercase font-bold mt-2">Loading history...</p>
          </div>
        ) : filteredIncomes.length === 0 ? (
          <div className="p-10 text-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01]">
            <CalendarDays size={32} className="mx-auto mb-2 text-white/20" />
            <p className="text-sm font-semibold text-white/40 uppercase">
              No entries found
            </p>
            {activeFilter ? (
              <button
                type="button"
                onClick={() => setActiveFilter(null)}
                className="mt-2 text-xs text-[#B8F55A] hover:underline"
              >
                Clear active filter
              </button>
            ) : (
              <p className="text-xs text-white/30 mt-1">Tap the button above to log your first income!</p>
            )}
          </div>
        ) : (
          filteredIncomes.map((income) => (
            <IncomeEntryCard key={income.id} income={income} />
          ))
        )}
      </div>
    </div>
  );
};

export default IncomePage;
