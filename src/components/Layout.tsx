import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  History,
  RefreshCcw,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { isDemoMode } from '../lib/appConfig';
import { useUIStore } from '../store';

// ============================================================
//  NAV ITEMS config
// ============================================================

const NAV_ITEMS = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
  { label: 'History', to: '/history', icon: History, end: false },
  { label: 'Recurring', to: '/recurring', icon: RefreshCcw, end: false },
  { label: 'Settings', to: '/settings', icon: Settings, end: false },
] as const;

// ============================================================
//  LAYOUT COMPONENT
// ============================================================

const Layout: React.FC = () => {
  const openAddSheet = useUIStore((s) => s.openAddSheet);
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === '/';
  const demoMode = isDemoMode();

  const [isMinimized, setIsMinimized] = useState(
    () => localStorage.getItem('sidebar_min') === 'true'
  );

  const toggleMinimize = () => {
    setIsMinimized((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_min', String(next));
      return next;
    });
  };

  const handleFAB = () => {
    openAddSheet();
    navigate('/');
  };

  return (
    <div className="flex h-dvh overflow-hidden" style={{ backgroundColor: '#1A1A1A' }}>

      {/*
        ── Desktop sidebar ──────────────────────────────────────
        KEY: sidebar is a regular flex column child (NOT position:fixed).
        This means <main> gets exactly the remaining viewport width,
        so max-w-2xl + mx-auto inside pages always centers correctly.
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
        {/* Toggle button — floats over right edge */}
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

        {/* Nav links */}
        <nav className="flex flex-col flex-1 overflow-y-auto" aria-label="Main navigation">
          {NAV_ITEMS.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
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
        flex-1 + min-w-0 → fills whatever width the sidebar leaves behind.
        Pages can then safely use max-w-2xl mx-auto to center their content
        in precisely this area.
      */}
      <main id="main-content" className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
        {/* Spacer so mobile content is not hidden behind bottom nav */}
        <div
          className="md:hidden"
          style={{ height: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}
          aria-hidden="true"
        />
      </main>

      {/* ── FAB — Dashboard only ── */}
      {isDashboard && (
        <button
          id="fab-add-expense"
          onClick={handleFAB}
          aria-label="Add new expense"
          className={cn(
            'fixed z-50',
            'bottom-[5.5rem] right-5',
            'md:bottom-8 md:right-8',
            'neo-btn neo-btn-primary',
            'w-16 h-16 rounded-full p-0',
            'flex items-center justify-center',
          )}
          style={{ bottom: `calc(5.5rem + env(safe-area-inset-bottom, 0px))` }}
        >
          <Plus size={28} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}

      {/* ── Mobile bottom navigation ── */}
      <nav
        aria-label="Mobile navigation"
        className={cn(
          'md:hidden',
          'fixed bottom-0 left-0 right-0 z-30',
          'flex items-stretch border-t-4',
        )}
        style={{
          backgroundColor: '#1A1A1A',
          borderColor: '#F5F0E8',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {NAV_ITEMS.map(({ label, to, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn('nav-item flex-1', isActive && 'active')}
            style={{ minHeight: '72px' }}
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={22}
                  strokeWidth={2.5}
                  aria-hidden="true"
                  style={{ color: isActive ? '#1A1A1A' : '#F5F0E8' }}
                />
                <span
                  style={{ color: isActive ? '#1A1A1A' : '#F5F0E8' }}
                  className="text-[10px]"
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}


      </nav>
    </div>
  );
};

export { Layout };
