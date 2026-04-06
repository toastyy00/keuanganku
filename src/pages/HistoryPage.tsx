import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { Search, ChevronLeft, ChevronRight, Trash2, PackageOpen, ChevronDown } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { useExpenseStore } from '../store/useExpenseStore';
import { useUIStore } from '../store/useAppStore';
import { formatCurrency, groupExpensesByDate } from '../lib/utils';
import { getExchangeRate, convertAmount, type RateResult } from '../lib/exchangeRate';
import type { ExpenseType, Expense } from '../types';

// ============================================================
//  HISTORY PAGE
// ============================================================

type TypeFilter = 'ALL' | ExpenseType;

function haptic() { if ('vibrate' in navigator) navigator.vibrate(10); }

function longDate(isoDate: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(isoDate + 'T00:00:00'));
}

const HistoryPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Riwayat — Keuanganku';
    return () => { document.title = 'Keuanganku'; };
  }, []);

  const { expenses, categories, currency, deleteExpense, loadExpenses } = useExpenseStore();
  const { setActiveExpense } = useUIStore();

  const { activeYear: viewYear, activeMonth: viewMonth, prevMonth, nextMonth } = useUIStore();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [catFilter, setCatFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [catFilterOpen, setCatFilterOpen] = useState(false);
  const [rateInfo, setRateInfo] = useState<RateResult>({ rate: 16000, isFallback: true });

  useEffect(() => { 
    loadExpenses(); 
    getExchangeRate().then((res) => setRateInfo(res));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toDisplay = useCallback(
    (exp: Expense) => convertAmount(exp.amount, exp.currency, currency, rateInfo.rate),
    [currency, rateInfo.rate]
  );


  const monthPrefix = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;
  const monthLabelStr = new Intl.DateTimeFormat('id-ID', {
    month: 'long', year: 'numeric',
  }).format(new Date(viewYear, viewMonth - 1, 1));

  // Filtered
  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (!e.date.startsWith(monthPrefix)) return false;
      if (typeFilter !== 'ALL' && e.type !== typeFilter) return false;
      if (catFilter.size > 0 && !catFilter.has(e.category)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchDest = (e.destination ?? '').toLowerCase().includes(q);
        if (!e.name.toLowerCase().includes(q) && !(e.note ?? '').toLowerCase().includes(q) && !matchDest) return false;
      }
      return true;
    });
  }, [expenses, monthPrefix, typeFilter, catFilter, search]);

  const grouped = useMemo(() => groupExpensesByDate(filtered), [filtered]);
  const dateKeys = Object.keys(grouped);

  const toggleCat = (slug: string) => {
    setCatFilter((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    haptic();
    await deleteExpense(id);
    setDeletingId(null);
  };

  const monthTotal = useMemo(
    () => filtered
      .filter((e) => typeFilter === 'TRANSFER' ? true : e.type !== 'TRANSFER')
      .reduce((s, e) => s + toDisplay(e), 0),
    [filtered, typeFilter, toDisplay]
  );

  const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
    { value: 'ALL', label: 'Semua' },
    { value: 'NEED', label: 'NEED' },
    { value: 'WANT', label: 'WANT' },
    { value: 'TRANSFER', label: 'TRANSFER' },
  ];


  return (
    <div className="flex flex-col min-h-full max-w-2xl mx-auto w-full">
      {/* ── Sticky filter bar ─────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b-4" style={{ backgroundColor: '#1A1A1A', borderColor: '#F5F0E8' }}>
        {/* Month navigator */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b-4 sm:px-4 sm:py-3" style={{ borderColor: '#3A3A3A' }}>
          <button
            onClick={prevMonth}
            className="neo-btn neo-btn-primary p-2 min-w-[40px] min-h-[40px] sm:min-w-[44px] sm:min-h-[44px] flex items-center justify-center"
            aria-label="Bulan sebelumnya"
          >
            <ChevronLeft size={18} strokeWidth={2.5} />
          </button>
          <div className="text-center flex-1 mx-2">
            <p className="text-sm font-black uppercase tracking-wide leading-tight">{monthLabelStr}</p>
            <p className="text-[11px] font-bold text-brutal-black/50 mt-0.5">
              {filtered.length} transaksi
              <span className="hidden xs:inline"> · {formatCurrency(monthTotal, currency)}</span>
            </p>
            <p className="text-[11px] font-bold text-brutal-black/50 xs:hidden">
              {formatCurrency(monthTotal, currency)}
            </p>
          </div>
          <button
            onClick={nextMonth}
            className="neo-btn neo-btn-primary p-2 min-w-[40px] min-h-[40px] sm:min-w-[44px] sm:min-h-[44px] flex items-center justify-center"
            aria-label="Bulan berikutnya"
          >
            <ChevronRight size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Type filter pills — always in a single scroll row */}
        <div className="flex gap-1.5 px-3 pt-2.5 pb-1.5 border-b-2 overflow-x-auto sm:px-4" style={{ borderColor: '#3A3A3A' }}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`shrink-0 px-3 py-1 text-xs font-bold uppercase tracking-wider border-[3px] transition-all duration-150 min-h-[34px] ${typeFilter === f.value
                ? 'text-[#1A1A1A]'
                : ''
                }`}
              style={typeFilter === f.value
                ? { borderColor: '#F5F0E8', backgroundColor: f.value === 'ALL' ? '#F5F0E8' : f.value === 'NEED' ? '#5B9CF6' : f.value === 'WANT' ? '#F472B6' : '#FBBF24', color: f.value === 'TRANSFER' ? '#1A1A1A' : f.value === 'ALL' ? '#1A1A1A' : '#fff' }
                : { borderColor: '#3A3A3A', backgroundColor: '#2A2820' }
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Category filter — collapsible section */}
        <div className="border-b-4" style={{ borderColor: '#3A3A3A' }}>
          {/* Header row with toggle */}
          <button
            type="button"
            onClick={() => setCatFilterOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 sm:px-4 transition-colors duration-150"
            style={{ backgroundColor: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(245,240,232,0.05)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            aria-expanded={catFilterOpen}
          >
            <span className="text-[10px] font-black uppercase tracking-wider text-brutal-black/60">
              Filter Kategori
              {catFilter.size > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-brutal-yellow text-[9px] font-black">
                  {catFilter.size} dipilih
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              {catFilter.size > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(ev) => { ev.stopPropagation(); setCatFilter(new Set()); }}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); setCatFilter(new Set()); } }}
                  className="text-[10px] font-bold text-red-500 underline"
                >
                  Reset
                </span>
              )}
              <ChevronDown
                size={14}
                strokeWidth={2.5}
                className="text-brutal-black/50 transition-transform duration-200"
                style={{ transform: catFilterOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </div>
          </button>

          {/* Expandable pills */}
          {catFilterOpen && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2.5 pt-1 sm:px-4">
              {categories.map((cat) => (
                <button
                  key={cat.slug}
                  onClick={() => toggleCat(cat.slug)}
                  className={`shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-bold border-[3px] transition-all duration-150 min-h-[32px]`}
                  style={catFilter.has(cat.slug)
                    ? { borderColor: '#F5F0E8', backgroundColor: '#F5F0E8', color: '#1A1A1A' }
                    : { borderColor: '#3A3A3A', backgroundColor: '#2A2820', color: '#F5F0E8' }
                  }
                >
                  <span>{cat.emoji}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="px-3 py-2.5 relative sm:px-4">
          <Search size={16} strokeWidth={2.5} className="absolute left-6 top-1/2 -translate-y-1/2 text-brutal-black/40 pointer-events-none sm:left-7" />
          <input
            type="search"
            placeholder="Cari transaksi..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="neo-input pl-9"
            style={{ fontSize: '16px' }}
            aria-label="Cari transaksi"
          />
        </div>
      </div>

      {/* ── Expense list ──────────────────────────────────── */}
      <div className="flex-1 section-pad pb-24">
        {dateKeys.length === 0 ? (
          <div className="neo-card p-8 text-center mt-4">
            <PackageOpen size={40} strokeWidth={1.5} className="mx-auto mb-3 text-brutal-black/30" />
            <p className="font-black uppercase text-brutal-black/50">Tidak ada transaksi</p>
            <p className="text-sm text-brutal-black/40 font-medium mt-1">
              {search ? 'Coba kata kunci lain' : 'Tidak ada transaksi yang cocok dengan filter ini.'}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {dateKeys.map((dateKey) => {
              const dayExpenses = grouped[dateKey];
              const dayTotal = dayExpenses
                .filter((e) => typeFilter === 'TRANSFER' ? true : e.type !== 'TRANSFER')
                .reduce((s, e) => s + toDisplay(e), 0);

              return (
                <div key={dateKey}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-black uppercase text-brutal-black/60 capitalize">
                      {longDate(dateKey)}
                    </p>
                    <p className="text-xs font-black text-brutal-black/60">
                      {formatCurrency(dayTotal, currency)}
                    </p>
                  </div>

                  <div className="space-y-2">
                    {dayExpenses.map((e) => {
                      const cat = categories.find((c) => c.slug === e.category);
                      const isDeleting = deletingId === e.id;
                      const badgeVariant = e.type === 'NEED' ? 'need' : e.type === 'WANT' ? 'want' : 'transfer';

                      return (
                        <div key={e.id} className="neo-card overflow-hidden">
                          {isDeleting ? (
                            <div className="flex items-center gap-3 p-3 bg-red-500">
                              <p className="flex-1 text-sm font-bold text-white uppercase">
                                Hapus "{e.name}"?
                              </p>
                              <button
                                onClick={() => handleDelete(e.id)}
                                className="px-3 py-1.5 bg-white text-red-500 border-2 border-white font-black text-xs uppercase min-h-[36px]"
                              >
                                Hapus
                              </button>
                              <button
                                onClick={() => setDeletingId(null)}
                                className="px-3 py-1.5 bg-red-500 text-white border-2 border-white font-black text-xs uppercase min-h-[36px]"
                              >
                                Batal
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setActiveExpense(e.id)}
                              className="w-full flex items-center gap-3 p-3 text-left transition-all duration-150"
                              style={{ color: '#F5F0E8' }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(245,240,232,0.05)')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                            >
                              <span className="text-2xl w-9 shrink-0 text-center">
                                {e.type === 'TRANSFER' ? '💸' : (cat?.emoji ?? '📦')}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold truncate leading-tight">{e.name}</p>
                                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                  <Badge variant={badgeVariant} size="sm">{e.type}</Badge>
                                  {e.type === 'TRANSFER' && e.destination ? (
                                    <span className="text-[10px] text-brutal-black/50 font-medium">→ {e.destination}</span>
                                  ) : (
                                    <Badge variant="neutral" size="sm">
                                      {cat?.emoji} {cat?.label ?? e.category}
                                    </Badge>
                                  )}
                                  {e.note && (
                                    <span className="text-[10px] text-brutal-black/40 italic truncate max-w-[100px]">
                                      {e.note}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <p className="text-sm font-black">{formatCurrency(e.amount, e.currency)}</p>
                                <button
                                  onClick={(ev) => { ev.stopPropagation(); haptic(); setDeletingId(e.id); }}
                                  className="p-2 text-brutal-black/40 hover:text-red-500 hover:bg-red-50 transition-colors duration-150 min-w-[36px] min-h-[36px] flex items-center justify-center"
                                  aria-label={`Hapus ${e.name}`}
                                >
                                  <Trash2 size={16} strokeWidth={2.5} />
                                </button>
                              </div>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryPage;
