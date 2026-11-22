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
const FinanceOverviewPage = lazy(() => import('@/modules/finance/FinanceOverviewPage'));
const TransactionsPage = lazy(() => import('@/modules/finance/TransactionsPage'));
const TransactionDetailPage = lazy(() => import('@/modules/finance/TransactionDetailPage'));
const FinanceApprovalsPage = lazy(() => import('@/modules/finance/ApprovalsPage'));
const BudgetsPage = lazy(() => import('@/modules/finance/BudgetsPage'));
const AccountsPage = lazy(() => import('@/modules/finance/AccountsPage'));
const PoliciesPage = lazy(() => import('@/modules/finance/PoliciesPage'));
const AssetsPage = lazy(() => import('@/modules/assets/AssetsPage'));
const AssetDetailPage = lazy(() => import('@/modules/assets/AssetDetailPage'));
const AssetApprovalsPage = lazy(() => import('@/modules/assets/AssetApprovalsPage'));
const ProgramsPage = lazy(() => import('@/modules/programs/ProgramsPage'));
const ProgramDetailPage = lazy(() => import('@/modules/programs/ProgramDetailPage'));
const AttendancePage = lazy(() => import('@/modules/attendance/AttendancePage'));
const DepartmentsPage = lazy(() => import('@/modules/departments/DepartmentsPage'));
const DepartmentDetailPage = lazy(() => import('@/modules/departments/DepartmentDetailPage'));
const NotificationsPage = lazy(() => import('@/modules/notifications/NotificationsPage'));
const AnnouncementsPage = lazy(() => import('@/modules/notifications/AnnouncementsPage'));
const ReportsPage = lazy(() => import('@/modules/reports/ReportsPage'));
const ReportDetailPage = lazy(() => import('@/modules/reports/ReportDetailPage'));
const DocumentsPage = lazy(() => import('@/modules/documents/DocumentsPage'));
const SyncCentrePage = lazy(() => import('@/modules/sync/SyncCentrePage'));
const UsersPage = lazy(() => import('@/modules/admin/UsersPage'));
const RolesPage = lazy(() => import('@/modules/admin/RolesPage'));
const SettingsPage = lazy(() => import('@/modules/admin/SettingsPage'));
const AuditPage = lazy(() => import('@/modules/admin/AuditPage'));
const PresenterPage = lazy(() => import('@/modules/presentation/PresenterPage'));
const MediaLibraryPage = lazy(() => import('@/modules/presentation/LibraryPage'));
const ProjectorPage = lazy(() => import('@/modules/presentation/OutputPage'));

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
  // The projector window shows only what the control desk on the same computer sends it.
  { path: '/presentation/output', element: s(<ProjectorPage />) },
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
      { path: 'finance', element: guarded('finance.view', <FinanceOverviewPage />) },
      { path: 'finance/transactions', element: guarded('finance.view', <TransactionsPage />) },
      { path: 'finance/transactions/:id', element: guarded('finance.view', <TransactionDetailPage />) },
      { path: 'finance/approvals', element: guarded(['finance.approve', 'budgets.approve'], <FinanceApprovalsPage />) },
      { path: 'finance/budgets', element: guarded('budgets.view', <BudgetsPage />) },
      { path: 'finance/accounts', element: guarded('finance.view', <AccountsPage />) },
      { path: 'finance/rules', element: guarded('finance.view', <PoliciesPage />) },
      { path: 'assets', element: guarded('assets.view', <AssetsPage />) },
      { path: 'assets/approvals', element: guarded('assets.approve', <AssetApprovalsPage />) },
      { path: 'assets/:id', element: guarded('assets.view', <AssetDetailPage />) },
      { path: 'programs', element: guarded('programs.view', <ProgramsPage />) },
      { path: 'programs/:id', element: guarded('programs.view', <ProgramDetailPage />) },
      { path: 'attendance', element: guarded('attendance.view', <AttendancePage />) },
      { path: 'departments', element: guarded('departments.view', <DepartmentsPage />) },
      { path: 'departments/:id', element: guarded('departments.view', <DepartmentDetailPage />) },
      { path: 'notifications', element: s(<NotificationsPage />) },
      { path: 'announcements', element: s(<AnnouncementsPage />) },
      { path: 'reports', element: guarded('reports.view', <ReportsPage />) },
      { path: 'reports/:id', element: guarded('reports.view', <ReportDetailPage />) },
      { path: 'documents', element: guarded('documents.view', <DocumentsPage />) },
      { path: 'presentation', element: guarded('media.view', <PresenterPage />) },
      { path: 'presentation/library', element: guarded('media.view', <MediaLibraryPage />) },
      { path: 'sync', element: s(<SyncCentrePage />) },
      { path: 'admin/users', element: guarded('users.view', <UsersPage />) },
      { path: 'admin/roles', element: guarded('roles.edit', <RolesPage />) },
      { path: 'admin/settings', element: guarded('settings.edit', <SettingsPage />) },
      { path: 'admin/audit', element: guarded('audit.view', <AuditPage />) },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
