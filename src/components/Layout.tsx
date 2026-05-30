import React, { useState, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  RefreshCcw,
  Settings,
  Wallet,
  Plus,
  LineChart,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { isDemoMode } from '../lib/appConfig';
import { useUIStore } from '../store';
import { useAuthStore } from '../store/useAuthStore';

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
type SidebarNavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  end: boolean;
  index: number;
};
const DESKTOP_POCKET_ITEM: SidebarNavItem = {
  label: 'Pockets',
  to: '/pockets',
  icon: Wallet,
  end: false,
  index: 4,
};
const DESKTOP_MAIN_ITEMS = [...LEFT_ITEMS, RIGHT_ITEMS[0], DESKTOP_POCKET_ITEM];
const DESKTOP_SETTINGS_ITEM = RIGHT_ITEMS[1];

const SWIPE_MIN_DISTANCE_BASE = 72;
const SWIPE_MIN_DISTANCE_MAX = 96;
const SWIPE_MIN_DISTANCE_SCREEN_RATIO = 0.18;
const SWIPE_FLICK_MIN_DISTANCE = 44;
const SWIPE_FLICK_MIN_VELOCITY = 0.55; // px/ms
const SWIPE_HORIZONTAL_RATIO = 1.8;
const SWIPE_FLICK_HORIZONTAL_RATIO = 1.4;
const SWIPE_SCROLL_GUARD_PX = 16;

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
  const user = useAuthStore((state) => state.user);

  const navigate = useNavigate();
  const location = useLocation();
  const isPortfolioRoute =
    location.pathname === '/pockets'
    || location.pathname.startsWith('/pockets/');
  const isDashboardRoute = location.pathname === '/';
  const demoMode = isDemoMode();
  const sidebarUserName = (() => {
    const fromMeta = typeof user?.user_metadata?.display_name === 'string'
      ? user.user_metadata.display_name.trim()
      : '';
    if (fromMeta) return fromMeta;

    const fromEmail = user?.email?.split('@')[0]?.trim() ?? '';
    if (fromEmail) return fromEmail;

    return demoMode ? 'Demo User' : 'User';
  })();
  const sidebarUserInitials = sidebarUserName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';
  const sidebarUserSubtitle = demoMode ? 'Demo mode' : (user?.email ?? 'Local account');

  const [isMinimized, setIsMinimized] = useState(
    () => localStorage.getItem('sidebar_min') === 'true'
  );

  // ── True Scroll Restoration ──────────────────────────────
  const mainContentRef = useRef<HTMLElement | null>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const scrollBoundaryTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchGestureMetaRef = useRef<{ startedAt: number; maxAbsX: number; maxAbsY: number } | null>(null);
  const isPinchGestureRef = useRef(false);
  const activeScrollPathRef = useRef(location.pathname);
  const restoreFrameRef = useRef<number | null>(null);
  const isRestoringScrollRef = useRef(false);

  React.useEffect(() => {
    return () => {
      if (restoreFrameRef.current !== null) {
        cancelAnimationFrame(restoreFrameRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    const mainEl = mainContentRef.current;
    if (!mainEl) return;

    const shouldGuardScrollBoundary = isDashboardRoute || isPortfolioRoute;

    const onTouchStart = (event: TouchEvent) => {
      if (!shouldGuardScrollBoundary || event.touches.length !== 1) {
        scrollBoundaryTouchStartRef.current = null;
        return;
      }

      const touch = event.touches[0];
      scrollBoundaryTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!shouldGuardScrollBoundary) return;
      if (document.body.dataset.bottomSheetOpen === 'true') return;
      if (event.touches.length !== 1 || !scrollBoundaryTouchStartRef.current) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - scrollBoundaryTouchStartRef.current.x;
      const deltaY = touch.clientY - scrollBoundaryTouchStartRef.current.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      const isMostlyVertical = absY > 4 && absY > absX * 1.15;
      if (!isMostlyVertical) return;

      const isAtBottom = mainEl.scrollTop + mainEl.clientHeight >= mainEl.scrollHeight - 1;
      const isPushingPastBottom = isAtBottom && deltaY < 0;

      if (isPushingPastBottom && event.cancelable) {
        mainEl.scrollTop = Math.max(0, mainEl.scrollHeight - mainEl.clientHeight);
        event.preventDefault();
      }
    };

    const onTouchEnd = () => {
      scrollBoundaryTouchStartRef.current = null;
    };

    mainEl.addEventListener('touchstart', onTouchStart, { passive: true });
    mainEl.addEventListener('touchmove', onTouchMove, { passive: false });
    mainEl.addEventListener('touchend', onTouchEnd, { passive: true });
    mainEl.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      mainEl.removeEventListener('touchstart', onTouchStart);
      mainEl.removeEventListener('touchmove', onTouchMove);
      mainEl.removeEventListener('touchend', onTouchEnd);
      mainEl.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isDashboardRoute, isPortfolioRoute]);

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
  const [pageTransitionClass, setPageTransitionClass] = useState('page-fade-in');
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
  const clearSwipeTracking = () => {
    touchStartRef.current = null;
    touchGestureMetaRef.current = null;
  };
  const shouldContainPortfolioBottomOverscroll = (e: React.TouchEvent<HTMLElement>) => {
    if (!isPortfolioRoute) return false;
    if (!mainContentRef.current || !touchStartRef.current || e.touches.length !== 1) return false;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const mainEl = mainContentRef.current;
    const isAtBottom = mainEl.scrollTop + mainEl.clientHeight >= mainEl.scrollHeight - 2;
    const isTryingToScrollBelowBottom = deltaY < -6;
    const isMostlyVertical = absY > absX * 1.2;

    return isAtBottom && isTryingToScrollBelowBottom && isMostlyVertical;
  };
  const getSwipeMinDistance = () => {
    if (typeof window === 'undefined') return SWIPE_MIN_DISTANCE_BASE;
    const adaptiveDistance = Math.round(window.innerWidth * SWIPE_MIN_DISTANCE_SCREEN_RATIO);
    return Math.min(SWIPE_MIN_DISTANCE_MAX, Math.max(SWIPE_MIN_DISTANCE_BASE, adaptiveDistance));
  };

  React.useEffect(() => {
    const prev = previousActiveIndexRef.current;
    const nextClass =
      prev === null
      || prev === -1
      || activeIndex === -1
      || prev === activeIndex
        ? 'page-fade-in'
        : activeIndex > prev
          ? 'page-slide-in-from-right'
          : 'page-slide-in-from-left';
    setPageTransitionClass(nextClass);
    previousActiveIndexRef.current = activeIndex;
  }, [activeIndex]);

  const renderDesktopNavItem = (
    { label, to, icon: Icon, end }: SidebarNavItem,
    options: { iconOnlyActive?: boolean } = {},
  ) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      title={label}
      onClick={preventIfAlreadyActive(isRouteActive(to, end))}
      className={({ isActive }) =>
        cn(
          'relative block h-12 overflow-hidden',
          'transition-[background-color] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
          isActive && !options.iconOnlyActive && 'bg-[linear-gradient(270deg,rgba(184,245,90,0.08),transparent)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && !options.iconOnlyActive && (
            <span
              aria-hidden="true"
              className="absolute right-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-l-[2px] bg-[#B8F55A]"
            />
          )}
          <span
            className={cn(
              'absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center',
              'transition-[left,transform] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
              isMinimized ? 'left-1/2 -translate-x-1/2' : 'left-4 translate-x-0',
            )}
          >
            <Icon
              size={isMinimized ? 22 : 20}
              strokeWidth={2.5}
              aria-hidden="true"
              className="transition-colors duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={{ color: isActive ? '#B8F55A' : 'rgba(255,255,255,0.28)' }}
            />
          </span>
          <span
            className={cn(
              'absolute left-[60px] top-1/2 -translate-y-1/2 whitespace-nowrap text-sm font-bold uppercase tracking-wider',
              'transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
              isMinimized
                ? 'pointer-events-none translate-x-[-8px] opacity-0 delay-0'
                : 'translate-x-0 opacity-100 delay-[70ms]',
            )}
            style={{
              color: isActive && !options.iconOnlyActive
                ? '#B8F55A'
                : 'rgba(255,255,255,0.28)',
            }}
          >
            {label}
          </span>
        </>
      )}
    </NavLink>
  );


  return (
    <div className="flex h-dvh min-h-0 overflow-hidden" style={{ backgroundColor: '#1A1A1A' }}>

      {/*
        ── Desktop sidebar ──────────────────────────────────────
      */}
      <aside
        className={cn(
          'hidden md:flex flex-col flex-shrink-0 relative z-30',
          'bg-[#141414]',
          'transition-[width] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
          isMinimized ? 'w-20' : 'w-[232px]',
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 right-0 top-0 z-30"
          style={{ width: '0.5px', backgroundColor: 'rgba(255,255,255,0.07)' }}
        />

        {/* Header logo */}
        <div className="relative h-[92px] overflow-hidden">
          <h1
            className={cn(
              'absolute left-1/2 top-[30px] -translate-x-1/2 font-black uppercase leading-none tracking-tight text-[#F5F0E8]',
              'transition-[opacity,transform] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
              isMinimized
                ? 'scale-100 opacity-100'
                : 'scale-90 opacity-0',
            )}
            aria-hidden={!isMinimized}
          >
            K<span className="text-[#B8F55A]">K</span>
          </h1>
          <h1
            className={cn(
              'absolute left-5 top-[30px] font-black uppercase leading-none tracking-tight text-[#F5F0E8]',
              'transition-[opacity,transform] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
              isMinimized
                ? 'translate-x-2 scale-[0.98] opacity-0'
                : 'translate-x-0 scale-100 opacity-100 delay-[40ms]',
            )}
            aria-hidden={isMinimized}
          >
            Keuangan<span className="text-[#B8F55A]">ku</span>
          </h1>
          <p
            className={cn(
              'absolute left-5 top-[55px] whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.15em] text-[#A09890]',
              'transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
              isMinimized
                ? 'pointer-events-none translate-x-2 opacity-0 delay-0'
                : 'translate-x-0 opacity-100 delay-[70ms]',
            )}
          >
            {demoMode ? 'Live demo mode' : 'Track your expenses'}
          </p>
        </div>

        {/* Toggle button */}
        <button
          onClick={toggleMinimize}
          className="absolute -right-4 top-[26px] z-40 flex h-8 w-8 items-center justify-center rounded-full border-4 transition-colors duration-150"
          style={{ backgroundColor: '#B8F55A', borderColor: '#1A1A1A' }}
          aria-label={isMinimized ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isMinimized
            ? <ChevronRight size={16} strokeWidth={3} className="text-[#1A1A1A]" aria-hidden="true" />
            : <ChevronLeft size={16} strokeWidth={3} className="text-[#1A1A1A]" aria-hidden="true" />}
        </button>

        {/* Nav links (desktop) */}
        <nav className="flex flex-1 flex-col overflow-hidden py-2" aria-label="Main navigation">
          <div className="space-y-0.5">
            {DESKTOP_MAIN_ITEMS.map((item) => renderDesktopNavItem(item))}
          </div>
        </nav>

        <div
          className="relative py-2 before:absolute before:left-4 before:right-4 before:top-0 before:h-px before:scale-y-50 before:bg-white/[0.06] before:content-['']"
        >
          {renderDesktopNavItem(DESKTOP_SETTINGS_ITEM, { iconOnlyActive: true })}
        </div>

        {/* Footer: account name */}
        <div
          className="relative h-[51px] border-t-[0.5px]"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <div
            className={cn(
              'absolute top-1/2 flex h-[26px] w-[26px] -translate-y-1/2 items-center justify-center rounded-full bg-[#B8F55A] text-[10px] font-black text-[#111]',
              'transition-[left,transform] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
              isMinimized ? 'left-1/2 -translate-x-1/2' : 'left-4 translate-x-0',
            )}
          >
            {sidebarUserInitials}
          </div>
          <div
            className={cn(
              'absolute left-[54px] top-1/2 min-w-0 -translate-y-1/2',
              'transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
              isMinimized
                ? 'pointer-events-none translate-x-[-8px] opacity-0 delay-0'
                : 'translate-x-0 opacity-100 delay-[70ms]',
            )}
          >
            <p className="truncate text-[11px] font-bold leading-tight text-white/50">
              {sidebarUserName}
            </p>
            <p className="truncate text-[9px] leading-tight text-white/25">
              {sidebarUserSubtitle}
            </p>
          </div>
        </div>
      </aside>

      {/*
        ── Main content ─────────────────────────────────────────
      */}
      <main
        id="main-content"
        ref={mainContentRef}
        className={cn(
          'flex-1 min-h-0 min-w-0',
          location.pathname === '/history' ? 'overflow-hidden' : 'overflow-y-auto',
        )}
        onScroll={(e) => {
          if (isDashboardRoute || isPortfolioRoute) {
            const maxScrollTop = Math.max(0, e.currentTarget.scrollHeight - e.currentTarget.clientHeight);
            if (e.currentTarget.scrollTop > maxScrollTop) {
              e.currentTarget.scrollTop = maxScrollTop;
              return;
            }
          }
          if (isRestoringScrollRef.current) return;
          if (location.pathname === '/history') return; // history manages its own scroll
          scrollPositions.current[activeScrollPathRef.current] = e.currentTarget.scrollTop;
        }}
        onTouchStart={(e) => {
          if (isBottomSheetActive()) {
            clearSwipeTracking();
            isPinchGestureRef.current = false;
            return;
          }
          if ((e.target as HTMLElement).closest('[data-no-swipe="true"]')) {
            clearSwipeTracking();
            isPinchGestureRef.current = false;
            return;
          }
          if (e.touches.length > 1) {
            clearSwipeTracking();
            isPinchGestureRef.current = true;
            return;
          }
          isPinchGestureRef.current = false;
          const touch = e.touches[0];
          touchStartRef.current = { x: touch.clientX, y: touch.clientY };
          touchGestureMetaRef.current = {
            startedAt: Date.now(),
            maxAbsX: 0,
            maxAbsY: 0,
          };
        }}
        onTouchMove={(e) => {
          if (e.touches.length > 1) {
            clearSwipeTracking();
            isPinchGestureRef.current = true;
            return;
          }
          if (!touchStartRef.current || !touchGestureMetaRef.current) return;
          if (shouldContainPortfolioBottomOverscroll(e)) {
            e.preventDefault();
          }
          const deltaX = e.touches[0].clientX - touchStartRef.current.x;
          const deltaY = e.touches[0].clientY - touchStartRef.current.y;
          touchGestureMetaRef.current.maxAbsX = Math.max(touchGestureMetaRef.current.maxAbsX, Math.abs(deltaX));
          touchGestureMetaRef.current.maxAbsY = Math.max(touchGestureMetaRef.current.maxAbsY, Math.abs(deltaY));
        }}
        onTouchEnd={(e) => {
          if (isBottomSheetActive()) {
            clearSwipeTracking();
            isPinchGestureRef.current = false;
            return;
          }
          if ((e.target as HTMLElement).closest('[data-no-swipe="true"]')) {
            clearSwipeTracking();
            isPinchGestureRef.current = false;
            return;
          }
          if (isPinchGestureRef.current) {
            clearSwipeTracking();
            isPinchGestureRef.current = false;
            return;
          }
          if (!touchStartRef.current) return;

          const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
          const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
          const absX = Math.abs(deltaX);
          const absY = Math.abs(deltaY);
          const elapsedMs = Math.max(1, Date.now() - (touchGestureMetaRef.current?.startedAt ?? Date.now()));
          const velocityX = absX / elapsedMs;
          const horizontalRatio = absY === 0 ? Number.POSITIVE_INFINITY : absX / absY;
          const minDistance = getSwipeMinDistance();
          const isLongIntentionalSwipe =
            absX >= minDistance && horizontalRatio >= SWIPE_HORIZONTAL_RATIO;
          const isIntentionalFlick =
            absX >= SWIPE_FLICK_MIN_DISTANCE &&
            velocityX >= SWIPE_FLICK_MIN_VELOCITY &&
            horizontalRatio >= SWIPE_FLICK_HORIZONTAL_RATIO;
          const isLikelyVerticalScroll =
            (touchGestureMetaRef.current?.maxAbsY ?? absY) >= SWIPE_SCROLL_GUARD_PX &&
            (touchGestureMetaRef.current?.maxAbsY ?? absY) >
              (touchGestureMetaRef.current?.maxAbsX ?? absX);

          clearSwipeTracking();

          if ((isLongIntentionalSwipe || isIntentionalFlick) && !isLikelyVerticalScroll) {
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
        <div key={location.pathname} className={location.pathname === '/history' ? `${pageTransitionClass} h-full min-h-0` : pageTransitionClass}>
          <Outlet />
        </div>
        {/* Spacer so mobile content clears the bottom nav/FAB — not needed for /history which manages its own */}
        {location.pathname !== '/history' && !isPortfolioRoute && (
          <div
            className="md:hidden"
            style={{ height: 'calc(76px + env(safe-area-inset-bottom, 0px))' }}
            aria-hidden="true"
          />
        )}
      </main>

      {/* ── Desktop FAB ── */}
      {!isPortfolioRoute && (
        <>
      <button
        className="fab hidden md:flex"
        onClick={fab.action}
        aria-label={fab.label}
      >
        <div key={location.pathname} className="animate-pop-rotate flex items-center justify-center">
          {fab.icon}
        </div>
      </button>

      {/* Mobile bottom navigation: dark glass dock + detached route-aware FAB */}
      <div className="mobile-nav-shell md:hidden">
        <nav
          aria-label="Mobile navigation"
          className="mobile-glass-dock"
          style={{
            '--mobile-active-x': `calc(${Math.max(0, activeIndex)} * var(--mobile-item-width))`,
          } as React.CSSProperties}
        >
          {ALL_ITEMS.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              onClick={preventIfAlreadyActive(isRouteActive(to, end))}
              className={({ isActive }) => cn('mobile-dock-item', isActive && 'active')}
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.75 : 2.25}
                    aria-hidden="true"
                    className="mobile-dock-icon"
                  />
                  <span className="mobile-dock-label">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <button
          id="mobile-fab"
          onClick={fab.action}
          aria-label={fab.label}
          className="mobile-detached-fab"
        >
          <div key={location.pathname} className="animate-pop-rotate flex items-center justify-center">
            {fab.icon}
          </div>
        </button>
      </div>
        </>
      )}
    </div>
  );
};

export { Layout };
