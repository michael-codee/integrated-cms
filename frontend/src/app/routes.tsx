import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Link } from 'react-router-dom';
import { Layout } from './Layout';
import { RequireAuth, RequirePerm } from './RequireAuth';
import { PageLoader } from '@/components/ui';

const LoginPage = lazy(() => import('@/modules/auth/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@/modules/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/modules/auth/ResetPasswordPage'));
const ProfilePage = lazy(() => import('@/modules/auth/ProfilePage'));
const DashboardPage = lazy(() => import('@/modules/dashboard/DashboardPage'));
const StructurePage = lazy(() => import('@/modules/structure/StructurePage'));
const MembersPage = lazy(() => import('@/modules/members/MembersPage'));
const MemberDetailPage = lazy(() => import('@/modules/members/MemberDetailPage'));
const TransfersPage = lazy(() => import('@/modules/members/TransfersPage'));
const UsersPage = lazy(() => import('@/modules/admin/UsersPage'));
const RolesPage = lazy(() => import('@/modules/admin/RolesPage'));
const SettingsPage = lazy(() => import('@/modules/admin/SettingsPage'));
const AuditPage = lazy(() => import('@/modules/admin/AuditPage'));

const s = (el: ReactNode) => <Suspense fallback={<PageLoader />}>{el}</Suspense>;
const guarded = (perm: string | string[], el: ReactNode) => s(<RequirePerm perm={perm}>{el}</RequirePerm>);

function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Link to="/" className="mt-3 inline-block text-sm text-royal-700">Back to the dashboard</Link>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: s(<LoginPage />) },
  { path: '/forgot-password', element: s(<ForgotPasswordPage />) },
  { path: '/reset-password', element: s(<ResetPasswordPage />) },
  {
    path: '/',
    element: <RequireAuth><Layout /></RequireAuth>,
    children: [
      { index: true, element: s(<DashboardPage />) },
      { path: 'profile', element: s(<ProfilePage />) },
      { path: 'structure', element: guarded('org.view', <StructurePage />) },
      { path: 'members', element: guarded('members.view', <MembersPage />) },
      { path: 'members/transfers', element: guarded('members.view', <TransfersPage />) },
      { path: 'members/:id', element: guarded('members.view', <MemberDetailPage />) },
      { path: 'admin/users', element: guarded('users.view', <UsersPage />) },
      { path: 'admin/roles', element: guarded('roles.edit', <RolesPage />) },
      { path: 'admin/settings', element: guarded('settings.edit', <SettingsPage />) },
      { path: 'admin/audit', element: guarded('audit.view', <AuditPage />) },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
