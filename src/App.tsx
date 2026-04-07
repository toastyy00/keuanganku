import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AddExpenseSheet } from './components/AddExpenseSheet';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SkeletonDashboard } from './components/SkeletonCard';
import { ProtectedRoute } from './components/ProtectedRoute';
import { appConfig, isDemoMode } from './lib/appConfig';
import { seedDemoData } from './lib/demoData';
import { useExpenseStore } from './store/useExpenseStore';
import { useAuthStore } from './store/useAuthStore';

// ============================================================
//  LAZY PAGES
// ============================================================

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const RecurringPage = lazy(() => import('./pages/RecurringPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const AdminApprovalPage = lazy(() => import('./pages/AdminApprovalPage'));

// ============================================================
//  APP LOADING SCREEN
//  Shown while the initial Supabase session is being resolved.
//  Prevents a flash of the login page for already-authenticated users.
// ============================================================

const AppLoadingScreen: React.FC = () => (
  <div
    className="min-h-dvh flex flex-col items-center justify-center gap-4"
    style={{ backgroundColor: '#1A1A1A' }}
  >
    <div className="flex flex-col items-center gap-3">
      <h1
        className="text-3xl font-black uppercase tracking-tight"
        style={{ color: '#F5F0E8' }}
      >
        Keuangan<span style={{ color: '#B8F55A' }}>ku</span>
      </h1>
      <span
        className="inline-block w-6 h-6 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: '#F5F0E8', borderTopColor: 'transparent' }}
        aria-label="Memuat..."
      />
    </div>
  </div>
);

// ============================================================
//  ROOT APP INNER (inside BrowserRouter)
// ============================================================

const AppInner: React.FC = () => {
  const { isInitializing, session, loadSession } = useAuthStore();
  const loadExpenses = useExpenseStore((s) => s.loadExpenses);
  const demoMode = isDemoMode();

  // 1. Resolve auth session on mount (must happen before render)
  useEffect(() => {
    if (demoMode) {
      seedDemoData();
    }
    loadSession();
  }, [demoMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Load data whenever auth state settles
  useEffect(() => {
    if (!isInitializing) {
      loadExpenses();
    }
  }, [isInitializing, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Block render until we know auth state — prevents flash of login for
  // users who are already authenticated
  if (isInitializing) {
    return <AppLoadingScreen />;
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<SkeletonDashboard />}>
        <Routes>
          {/* ── Auth routes (redirect to / if already logged in) ── */}
          <Route
            path="/login"
            element={
              <ProtectedRoute authOnly>
                <LoginPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/register"
            element={
              <ProtectedRoute authOnly>
                <RegisterPage />
              </ProtectedRoute>
            }
          />
          <Route path="/approval" element={<AdminApprovalPage />} />

          {/* ── Protected app routes ── */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/recurring" element={<RecurringPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>

      {/* Global modals — only shown when authenticated */}
      {(session || demoMode) && (
        <>
          <AddExpenseSheet />
          <PWAInstallBanner />
        </>
      )}
    </ErrorBoundary>
  );
};

const App: React.FC = () => {
  const Router = isDemoMode() ? HashRouter : BrowserRouter;
  const basename = isDemoMode()
    ? undefined
    : appConfig.basePath !== '/'
      ? appConfig.basePath.replace(/\/$/, '')
      : undefined;

  return (
    <Router basename={basename}>
      <AppInner />
    </Router>
  );
};

export default App;
