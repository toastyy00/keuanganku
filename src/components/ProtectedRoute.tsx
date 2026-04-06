import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';

// ============================================================
//  PROTECTED ROUTE
//  - Unauthenticated users → /login
//  - Authenticated users on /login or /register → /
// ============================================================

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** If true, this is an auth route (login/register) — redirect away if already authenticated */
  authOnly?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, authOnly = false }) => {
  const session = useAuthStore((s) => s.session);
  const location = useLocation();

  if (authOnly) {
    // Auth pages: redirect authenticated users to dashboard
    if (session) {
      return <Navigate to="/" replace />;
    }
    return <>{children}</>;
  }

  // Protected pages: redirect unauthenticated users to login
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export { ProtectedRoute };
