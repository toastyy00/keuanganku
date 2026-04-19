import React, { useState, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  RefreshCcw,
  Settings,
  Plus,
  LineChart,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { isDemoMode } from '../lib/appConfig';
import { useUIStore } from '../store';

// ============================================================
//  NAV ITEMS config  (without FAB slot — inserted via JSX)
//  Layout: [Dashboard] [History] [FAB] [Recurring] [Settings]
// ============================================================

const LEFT_ITEMS = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true, index: 0 },
  { label: 'History',   to: '/history', icon: CalendarDays,   end: false, index: 1 },
] as const;

const RIGHT_ITEMS = [
  { label: 'Recurring', to: '/recurring', icon: RefreshCcw, end: false, index: 2 },
  { label: 'Settings',  to: '/settings',  icon: Settings,  end: false, index: 3 },
] as const;

// All items in order — used for slide-direction calculation
const ALL_ITEMS = [...LEFT_ITEMS, ...RIGHT_ITEMS];

// ============================================================
//  Per-route FAB icon & action config
// ============================================================

type FABConfig = {
  icon: React.ReactNode;
  label: string;
  action: () => void;
};

// ============================================================
//  LAYOUT COMPONENT
// ============================================================

const Layout: React.FC = () => {
  const {
    openAddSheet, closeAddSheet, isAddSheetOpen,
    openHistoryInsight,
    openRecurringSheet,
  } = useUIStore();

  const navigate = useNavigate();
  const location = useLocation();
  const demoMode = isDemoMode();

  const [isMinimized, setIsMinimized] = useState(
    () => localStorage.getItem('sidebar_min') === 'true'
  );

  // ── True Scroll Restoration ──────────────────────────────
  const mainContentRef = useRef<HTMLElement | null>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isPinchGestureRef = useRef(false);
  const lastPathRef = useRef(location.pathname);
  const activeScrollPathRef = useRef(location.pathname);
  const restoreFrameRef = useRef<number | null>(null);
  const isRestoringScrollRef = useRef(false);

  if (lastPathRef.current !== location.pathname) {
    isRestoringScrollRef.current = true;
    lastPathRef.current = location.pathname;
  }

  React.useEffect(() => {
    return () => {
      if (restoreFrameRef.current !== null) {
        cancelAnimationFrame(restoreFrameRef.current);
      }
    };
  }, []);

  React.useLayoutEffect(() => {
    const mainEl = mainContentRef.current;
    if (!mainEl) return;

    // /history manages its own scroll container — skip Layout scroll restoration
    if (location.pathname === '/history') {
      activeScrollPathRef.current = location.pathname;
      isRestoringScrollRef.current = false;
      return;
    }

    if (restoreFrameRef.current !== null) {
      cancelAnimationFrame(restoreFrameRef.current);
    }

    const nextScrollTop = scrollPositions.current[location.pathname] ?? 0;
    isRestoringScrollRef.current = true;
    mainEl.scrollTop = nextScrollTop;

    restoreFrameRef.current = requestAnimationFrame(() => {
      if (mainContentRef.current) {
        mainContentRef.current.scrollTop = nextScrollTop;
      }
      restoreFrameRef.current = requestAnimationFrame(() => {
        if (mainContentRef.current) {
          mainContentRef.current.scrollTop = nextScrollTop;
        }
        activeScrollPathRef.current = location.pathname;
        isRestoringScrollRef.current = false;
        restoreFrameRef.current = null;
      });
    });
  }, [location.pathname]);



  const toggleMinimize = () => {
    setIsMinimized((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_min', String(next));
      return next;
    });
  };

  // ── FAB config per route ─────────────────────────────────
  const getFABConfig = (): FABConfig => {
    switch (location.pathname) {
      case '/history':
        return {
          icon: <LineChart size={26} strokeWidth={2.5} aria-hidden="true" />,
          label: 'Buka insight pengeluaran',
          action: openHistoryInsight,
        };
      case '/recurring':
        return {
          icon: <RefreshCcw size={24} strokeWidth={2.5} aria-hidden="true" />,
          label: 'Tambah pengeluaran rutin',
          action: openRecurringSheet,
        };
      default:
        return {
          icon: (
            <Plus
              size={33}
              strokeWidth={2.5}
              aria-hidden="true"
              className={cn(
                'transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
                isAddSheetOpen ? 'rotate-[135deg]' : 'rotate-0'
              )}
            />
          ),
          label: isAddSheetOpen ? 'Tutup form' : 'Tambah pengeluaran baru',
          action: () => {
            if (isAddSheetOpen) closeAddSheet();
            else openAddSheet();
          },
        };
    }
  };

  const fab = getFABConfig();

  // ── Active pill indicator index ──────────────────────────
  const activeIndex = ALL_ITEMS.findIndex((i) =>
    i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)
  );
  const previousActiveIndexRef = useRef<number | null>(null);
  // eslint-disable-next-line react-hooks/refs
  const prev = previousActiveIndexRef.current;
  const pageTransitionClass =
    prev === null
    || prev === -1
    || activeIndex === -1
    || prev === activeIndex
      ? 'page-fade-in'
      : activeIndex > prev
        ? 'page-slide-in-from-right'
        : 'page-slide-in-from-left';
  const isRouteActive = (to: string, end: boolean) => (
    end ? location.pathname === to : location.pathname.startsWith(to)
  );
  const preventIfAlreadyActive = (isActive: boolean) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isActive) {
      e.preventDefault();
    }
  };

  const isBottomSheetActive = () =>
    document.body.dataset.bottomSheetOpen === 'true';

  React.useEffect(() => {
    previousActiveIndexRef.current = activeIndex;
  }, [activeIndex]);


  return (
    <div className="flex h-dvh overflow-hidden" style={{ backgroundColor: '#1A1A1A' }}>

      {/*
        ── Desktop sidebar ──────────────────────────────────────
      */}
      <aside
        className={cn(
          'hidden md:flex flex-col flex-shrink-0 relative',
          'transition-all duration-300 ease-in-out',
          isMinimized ? 'w-20' : 'w-64',
          'border-r-4 z-30',
        )}
        style={{ backgroundColor: '#1A1A1A', borderColor: '#F5F0E8' }}
      >
        {/* Toggle button */}
        <button
          onClick={toggleMinimize}
          className="absolute -right-4 top-6 w-8 h-8 rounded-full border-4 flex items-center justify-center z-40 transition-colors duration-150"
          style={{ backgroundColor: '#B8F55A', borderColor: '#1A1A1A' }}
          aria-label={isMinimized ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isMinimized
            ? <ChevronRight size={16} strokeWidth={3} className="text-[#1A1A1A]" />
            : <ChevronLeft size={16} strokeWidth={3} className="text-[#1A1A1A]" />}
        </button>

        {/* Brand */}
        <div
          className={cn(
            'py-5 border-b-4 h-[92px] flex flex-col justify-center',
            isMinimized ? 'px-2 items-center' : 'px-5',
          )}
          style={{ borderColor: '#3A3A3A' }}
        >
          <h1 className="font-black uppercase tracking-tight leading-none" style={{ color: '#F5F0E8' }}>
            {isMinimized
              ? <>K<span style={{ color: '#B8F55A' }}>K</span></>
              : <>Keuangan<span style={{ color: '#B8F55A' }}>ku</span></>}
          </h1>
          {!isMinimized && (
            <p
              className="text-[11px] font-bold uppercase tracking-[0.15em] mt-1 whitespace-nowrap"
              style={{ color: '#A09890' }}
            >
              {demoMode ? 'Live demo mode' : 'Track your expenses'}
            </p>
          )}
        </div>

        {demoMode && !isMinimized && (
          <div className="px-4 py-3 border-b-4" style={{ borderColor: '#3A3A3A' }}>
            <div className="border-2 border-[#F5F0E8] bg-[#202020] px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-brutal-yellow">
                Demo Mode
              </p>
              <p className="mt-1 text-[11px] leading-4 text-brutal-bone-dim">
                Data contoh lokal. Tidak terhubung ke akun atau Supabase.
              </p>
            </div>
          </div>
        )}

        {/* Nav links (desktop) */}
        <nav className="flex flex-col flex-1 overflow-y-auto" aria-label="Main navigation">
          {ALL_ITEMS.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              onClick={preventIfAlreadyActive(isRouteActive(to, end))}
              className={({ isActive }) =>
                cn('sidebar-item', isActive && 'active', isMinimized && 'justify-center !px-0')
              }
            >
              <Icon size={20} strokeWidth={2.5} aria-hidden="true" />
              {!isMinimized && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer: version */}
        {!isMinimized && (
          <div
            className="py-3 px-4 border-t-4"
            style={{ borderColor: '#3A3A3A' }}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#3A3A3A' }}>
              v0.1.0-alpha
            </p>
          </div>
        )}
      </aside>

      {/*
        ── Main content ─────────────────────────────────────────
      */}
      <main
        id="main-content"
        ref={mainContentRef}
        className={`flex-1 min-w-0 ${location.pathname === '/history' ? 'overflow-hidden' : 'overflow-y-auto'}`}
        onScroll={(e) => {
          if (isRestoringScrollRef.current) return;
          if (location.pathname === '/history') return; // history manages its own scroll
          scrollPositions.current[activeScrollPathRef.current] = e.currentTarget.scrollTop;
        }}
        onTouchStart={(e) => {
          if (isBottomSheetActive()) {
            touchStartRef.current = null;
            isPinchGestureRef.current = false;
            return;
          }
          if ((e.target as HTMLElement).closest('[data-no-swipe="true"]')) return;
          if (e.touches.length > 1) {
            touchStartRef.current = null;
            isPinchGestureRef.current = true;
            return;
          }
          isPinchGestureRef.current = false;
          const touch = e.touches[0];
          touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchMove={(e) => {
          if (e.touches.length > 1) {
            touchStartRef.current = null;
            isPinchGestureRef.current = true;
          }
        }}
        onTouchEnd={(e) => {
          if (isBottomSheetActive()) {
            touchStartRef.current = null;
            isPinchGestureRef.current = false;
            return;
          }
          if ((e.target as HTMLElement).closest('[data-no-swipe="true"]')) return;
          if (isPinchGestureRef.current) {
            touchStartRef.current = null;
            isPinchGestureRef.current = false;
            return;
          }
          if (!touchStartRef.current) return;
          
          const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
          const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
          touchStartRef.current = null;
          
          // Require mostly horizontal movement and a minimum distance (e.g. 50px)
          if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            if (activeIndex !== -1) {
              if (deltaX > 0 && activeIndex > 0) {
                // Swipe right -> go to previous
                navigate(ALL_ITEMS[activeIndex - 1].to);
              } else if (deltaX < 0 && activeIndex < ALL_ITEMS.length - 1) {
                // Swipe left -> go to next
                navigate(ALL_ITEMS[activeIndex + 1].to);
              }
            }
          }
        }}
      >
        <div key={location.pathname} className={location.pathname === '/history' ? `${pageTransitionClass} h-full` : pageTransitionClass}>
          <Outlet />
        </div>
        {/* Spacer so mobile content clears the bottom nav/FAB — not needed for /history which manages its own */}
        {location.pathname !== '/history' && (
          <div
            className="md:hidden"
            style={{ height: 'calc(76px + env(safe-area-inset-bottom, 0px))' }}
            aria-hidden="true"
          />
        )}
      </main>

      {/* ── Desktop FAB ── */}
      <button
        className="fab hidden md:flex"
        onClick={fab.action}
        aria-label={fab.label}
      >
        <div key={location.pathname} className="animate-pop-rotate flex items-center justify-center">
          {fab.icon}
        </div>
      </button>

      {/* ══ Mobile bottom navigation — Single Full Pill + Floating FAB ══ */}
      {/* Wrapper: positions the pill and anchors the floating FAB */}
      <div
        className="md:hidden fixed z-[45] bottom-0 left-0 right-0 w-full"
      >
        {/* ── Floating FAB — absolute, center-top, overlaps pill ── */}
        <button
          id="mobile-fab"
          onClick={fab.action}
          aria-label={fab.label}
          className="fab-tap absolute left-1/2 flex items-center justify-center rounded-full z-[50]"
          style={{
            width: '60px',
            height: '60px',
            transform: 'translateX(-50%) translateY(-20%)',
            top: 0,
            backgroundColor: '#232019',
            borderTop: '3px solid #9FD65C',
            borderLeft: '3px solid #9FD65C',
            borderRight: '3px solid #9FD65C',
            borderBottom: '3px solid #0A0A0A',
            boxShadow: '0 5px 0 #17130F',
            color: '#9FD65C',
            transition: 'transform 0.15s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.15s ease',
          }}
        >
          <div key={location.pathname} className="animate-pop-rotate flex items-center justify-center">
            {fab.icon}
          </div>
        </button>

        {/* ── Flat Bottom Bar ── */}
        <nav
          aria-label="Mobile navigation"
          className="relative flex items-center w-full px-2 pt-1.5 border-t-2 overflow-hidden"
          style={{
            paddingBottom: 'calc(6px + env(safe-area-inset-bottom, 0px))',
            backgroundColor: '#0A0A0A',
            borderColor: '#3A3A3A',
            boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
          }}
        >
          {/* Nav items with FAB-width spacer in the middle */}
          <div className="relative z-10 flex w-full items-center">
            {/* Left 2 items */}
             {ALL_ITEMS.slice(0, 2).map(({ label, to, icon: Icon, end }) => (
               <NavLink
                 key={to}
                 to={to}
                 end={end}
                 onClick={preventIfAlreadyActive(isRouteActive(to, end))}
                 className={({ isActive }) => cn('nav-item flex-1', isActive && 'active')}
               >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={21}
                      strokeWidth={isActive ? 2.55 : 2.05}
                      aria-hidden="true"
                      className="nav-item-icon"
                      style={{ color: isActive ? '#F5F0E8' : 'currentColor' }}
                    />
                    <span className="nav-item-label" style={{ color: isActive ? '#F5F0E8' : 'currentColor' }}>
                      {label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}

            {/* Transparent spacer matching FAB footprint — prevents nav items colliding with FAB */}
            <div aria-hidden="true" style={{ width: '60px', flexShrink: 0 }} />

            {/* Right 2 items */}
             {ALL_ITEMS.slice(2).map(({ label, to, icon: Icon, end }) => (
               <NavLink
                 key={to}
                 to={to}
                 end={end}
                 onClick={preventIfAlreadyActive(isRouteActive(to, end))}
                 className={({ isActive }) => cn('nav-item flex-1', isActive && 'active')}
               >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={21}
                      strokeWidth={isActive ? 2.55 : 2.05}
                      aria-hidden="true"
                      className="nav-item-icon"
                      style={{ color: isActive ? '#F5F0E8' : 'currentColor' }}
                    />
                    <span className="nav-item-label" style={{ color: isActive ? '#F5F0E8' : 'currentColor' }}>
                      {label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
};

export { Layout };
