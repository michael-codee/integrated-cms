import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { PageLoader } from '@/components/ui';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><PageLoader label="Starting…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.must_change_password && location.pathname !== '/profile') return <Navigate to="/profile?tab=password&required=1" replace />;
  return <>{children}</>;
}

export function RequirePerm({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { can, canAny } = useAuth();
  const ok = Array.isArray(perm) ? canAny(...perm) : can(perm);
  if (!ok) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-lg font-semibold">Not authorised</h1>
        <p className="mt-2 text-sm text-slate-500">Your role does not give you access to this page. Contact your administrator if you believe this is a mistake.</p>
      </div>
    );
  }
  return <>{children}</>;
}
