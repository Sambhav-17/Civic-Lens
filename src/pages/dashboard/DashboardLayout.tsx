import { ChartColumn, ClipboardCheck, Inbox, LayoutDashboard, ListOrdered, Map, Settings, UserCog, Users } from 'lucide-react';
import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { clsx } from 'clsx';
import { ConnectionPill, PageFallback } from '@/components/layout/AppShell';
import { useAuth } from '@/hooks/providers';

const NAV = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/dashboard/map', label: 'Live Hazard Map', icon: Map },
  { to: '/dashboard/queue', label: 'Priority Queue', icon: ListOrdered },
  { to: '/dashboard/reports', label: 'All Reports', icon: Inbox },
  { to: '/dashboard/assigned', label: 'Assigned to Me', icon: UserCog },
  { to: '/dashboard/verification', label: 'Repair Verification', icon: ClipboardCheck },
  { to: '/dashboard/analytics', label: 'Analytics', icon: ChartColumn },
  { to: '/dashboard/team', label: 'Team Management', icon: Users },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export default function DashboardLayout() {
  const { session } = useAuth();
  return (
    <div className="lg:flex">
      <aside className="z-20 border-b border-line bg-midnight/85 backdrop-blur-xl lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="hidden p-5 lg:block">
          <p className="eyebrow">Operations</p>
          <p className="mt-1 truncate text-sm font-semibold">{session?.user.display_name}</p>
          <p className="text-xs capitalize text-ink-2">{session?.user.role}</p>
          <div className="mt-3"><ConnectionPill /></div>
        </div>
        <nav aria-label="Dashboard" className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:overflow-visible lg:px-3 lg:py-0">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('flex min-h-[40px] shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition', isActive ? 'bg-cyan/12 bg-cyan/10 text-cyan' : 'text-ink-2 hover:bg-white/5 hover:text-ink')}>
              <n.icon className="h-4 w-4 shrink-0" aria-hidden />{n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Suspense fallback={<PageFallback />}><Outlet /></Suspense>
      </div>
    </div>
  );
}
