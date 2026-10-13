import { lazy, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useRouteError } from 'react-router-dom';
import { AppShell, PageFallback } from '@/components/layout/AppShell';
import { ButtonLink, ErrorState } from '@/components/ui';
import { AuthProvider, RealtimeProvider, ToastProvider, useAuth } from '@/hooks/providers';
import type { Role } from '@/lib/types';

const Landing = lazy(() => import('@/pages/Landing'));
const MapPage = lazy(() => import('@/pages/MapPage'));
const ReportPage = lazy(() => import('@/pages/ReportPage'));
const HazardPage = lazy(() => import('@/pages/HazardPage'));
const VerifyPage = lazy(() => import('@/pages/VerifyPage'));
const MyReports = lazy(() => import('@/pages/MyReports'));
const Profile = lazy(() => import('@/pages/Profile'));
const Login = lazy(() => import('@/pages/Auth').then((m) => ({ default: m.Login })));
const Signup = lazy(() => import('@/pages/Auth').then((m) => ({ default: m.Signup })));
const Admin = lazy(() => import('@/pages/Admin'));
const Legal = lazy(() => import('@/pages/Legal'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const DashboardLayout = lazy(() => import('@/pages/dashboard/DashboardLayout'));
const Overview = lazy(() => import('@/pages/dashboard/Overview'));
const Queue = lazy(() => import('@/pages/dashboard/Queue'));
const Analytics = lazy(() => import('@/pages/dashboard/Analytics'));
const LiveMap = lazy(() => import('@/pages/dashboard/LiveMap'));
const Team = lazy(() => import('@/pages/dashboard/Team'));
const Settings = lazy(() => import('@/pages/dashboard/Settings'));

/** Client-side guard for UX only — the backend enforces every permission. */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageFallback />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!roles.includes(session.user.role))
    return (
      <div className="container-x py-24">
        <ErrorState title="You don’t have access to this area" error="This section is for authorised municipal staff. If you work for the city, ask an administrator to grant your account the right role." />
        <div className="flex justify-center"><ButtonLink to="/" variant="secondary">Back to home</ButtonLink></div>
      </div>
    );
  return <>{children}</>;
}

function RouteError() {
  const err = useRouteError();
  return (
    <div className="container-x py-24">
      <ErrorState title="This page failed to load" error={err instanceof Error ? err.message : 'Unexpected error'} onRetry={() => location.reload()} />
    </div>
  );
}

const STAFF: Role[] = ['staff', 'reviewer', 'admin'];

const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/map', element: <MapPage /> },
      { path: '/report', element: <ReportPage /> },
      { path: '/hazards/:id', element: <HazardPage /> },
      { path: '/verify/:id', element: <RequireRole roles={STAFF}><VerifyPage /></RequireRole> },
      { path: '/my-reports', element: <MyReports /> },
      { path: '/profile', element: <RequireRole roles={['citizen', ...STAFF]}><Profile /></RequireRole> },
      { path: '/login', element: <Login /> },
      { path: '/signup', element: <Signup /> },
      { path: '/admin', element: <RequireRole roles={['admin']}><Admin /></RequireRole> },
      { path: '/legal/:doc', element: <Legal /> },
      {
        path: '/dashboard',
        element: <RequireRole roles={STAFF}><DashboardLayout /></RequireRole>,
        children: [
          { index: true, element: <Overview /> },
          { path: 'map', element: <LiveMap /> },
          { path: 'queue', element: <Queue mode="priority" /> },
          { path: 'reports', element: <Queue mode="all" /> },
          { path: 'assigned', element: <Queue mode="mine" /> },
          { path: 'verification', element: <Queue mode="verification" /> },
          { path: 'analytics', element: <Analytics /> },
          { path: 'team', element: <Team /> },
          { path: 'settings', element: <Settings /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <RealtimeProvider>
          <RouterProvider router={router} />
        </RealtimeProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
