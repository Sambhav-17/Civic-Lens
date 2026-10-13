import { AnimatePresence, motion } from 'framer-motion';
import { Bell, LayoutDashboard, LogOut, Menu, Radio, ShieldCheck, User, X } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { isAdmin, isStaff } from '@/lib/workflow';
import { useAuth, useNotifications, useRealtime, useToast } from '@/hooks/providers';
import { Button, ButtonLink, Spinner } from '../ui';
import { SceneLayer } from './SceneLayer';
import { useSceneState } from '../three/sceneStore';

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={clsx('flex items-center gap-2.5 font-extrabold tracking-tight', className)} aria-label="CivicLens home">
      <span className="relative grid h-9 w-9 place-items-center rounded-xl border border-cyan/40 bg-cyan/10 shadow-glow">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
          <circle cx="12" cy="10.5" r="5.5" stroke="#36D9FF" strokeWidth="2" />
          <circle cx="12" cy="10.5" r="2" fill="#FF9D42" />
          <path d="M12 16v5" stroke="#36D9FF" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-lg">Civic<span className="text-cyan">Lens</span></span>
    </Link>
  );
}

export function ConnectionPill() {
  const { state } = useRealtime();
  const meta = {
    live: { label: 'Live', cls: 'text-success border-success/30 bg-success/10', dot: 'bg-success' },
    local: { label: 'Demo · local sync', cls: 'text-safety border-safety/30 bg-safety/10', dot: 'bg-safety' },
    connecting: { label: 'Connecting', cls: 'text-ink-2 border-line bg-white/5', dot: 'bg-ink-3' },
    reconnecting: { label: 'Reconnecting', cls: 'text-safety border-safety/30 bg-safety/10', dot: 'bg-safety' },
    offline: { label: 'Offline', cls: 'text-critical border-critical/30 bg-critical/10', dot: 'bg-critical' },
  }[state];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', meta.cls)} role="status" aria-label={`Connection: ${meta.label}`}>
      <span className={clsx('relative h-1.5 w-1.5 rounded-full', meta.dot)}>{state === 'live' && <span className="absolute inset-0 animate-ping2 rounded-full bg-success" />}</span>
      {state === 'live' ? <Radio className="hidden h-3 w-3 sm:block" aria-hidden /> : null}
      {meta.label}
    </span>
  );
}

function NotificationsMenu() {
  const { items, unread, reload } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative grid h-11 w-11 place-items-center rounded-xl text-ink-2 hover:bg-white/5 hover:text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}>
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-2 top-2 grid h-4 min-w-4 place-items-center rounded-full bg-critical px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="glass-strong absolute right-0 top-12 z-50 w-[min(22rem,calc(100vw-2rem))] p-2">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-sm font-bold">Notifications</p>
            {unread > 0 && <button className="text-xs font-semibold text-cyan hover:underline" onClick={async () => { await api.markNotificationRead('all'); void reload(); }}>Mark all read</button>}
          </div>
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-ink-2">No notifications yet. You’ll hear here when your reports change status.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    to={n.hazard_id ? `/hazards/${n.hazard_id}` : '/my-reports'}
                    onClick={async () => { setOpen(false); if (!n.read_at) { await api.markNotificationRead(n.id); void reload(); } }}
                    className="flex gap-3 rounded-xl px-2 py-2.5 hover:bg-white/5"
                  >
                    <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-cyan')} aria-hidden />
                    <span>
                      <span className="block text-sm">{n.message}</span>
                      <span className="text-xs text-ink-3">{timeAgo(n.created_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { session } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (!session) return <ButtonLink to="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">Sign in</ButtonLink>;
  const u = session.user;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="flex h-11 items-center gap-2 rounded-xl px-2 hover:bg-white/5" aria-expanded={open} aria-label="Account menu">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-cyan/30 to-safety/20 text-sm font-bold">{u.display_name.slice(0, 1).toUpperCase()}</span>
        <span className="hidden max-w-[8rem] truncate text-sm font-semibold 2xl:block">{u.display_name}</span>
      </button>
      {open && (
        <div className="glass-strong absolute right-0 top-12 z-50 w-56 p-1.5">
          <p className="px-3 py-2 text-xs text-ink-2">Signed in as <span className="font-semibold capitalize text-ink">{u.role}</span></p>
          <Link to="/profile" className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-white/5"><User className="h-4 w-4" />Profile</Link>
          <Link to="/my-reports" className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-white/5"><Bell className="h-4 w-4" />My reports</Link>
          {isStaff(u.role) && <Link to="/dashboard" className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-white/5"><LayoutDashboard className="h-4 w-4" />Operations dashboard</Link>}
          {isAdmin(u.role) && <Link to="/admin" className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-white/5"><ShieldCheck className="h-4 w-4" />Admin</Link>}
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-critical hover:bg-critical/10"
            onClick={async () => { await api.signOut(); toast({ kind: 'success', title: 'Signed out' }); nav('/'); }}
          >
            <LogOut className="h-4 w-4" />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const NAV = [
  { to: '/map', label: 'Explore Map' },
  { to: '/report', label: 'Report Hazard' },
  { to: '/#how', label: 'How It Works' },
  { to: '/#impact', label: 'Impact' },
];

export function Header() {
  const { session } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobile, setMobile] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => setMobile(false), [loc.pathname, loc.hash]);
  const links = [...NAV, ...(isStaff(session?.user.role) ? [{ to: '/dashboard', label: 'Dashboard' }] : [])];

  return (
    <header className={clsx('sticky top-0 z-40 border-b pt-[var(--safe-top)] transition-colors duration-300', scrolled || mobile ? 'border-line bg-midnight/80 backdrop-blur-xl' : 'border-transparent bg-transparent')}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-cyan focus:px-4 focus:py-2 focus:text-midnight">Skip to content</a>
      <div className="container-x flex h-16 items-center justify-between gap-3">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 xl:flex">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => clsx('whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition', isActive && !l.to.includes('#') ? 'text-ink bg-white/5' : 'text-ink-2 hover:text-ink')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <span className="hidden xl:inline-flex"><ConnectionPill /></span>
          {session && <NotificationsMenu />}
          <UserMenu />
          <ButtonLink to="/report" size="sm" className="hidden sm:inline-flex">Report a Hazard</ButtonLink>
          <button className="grid h-11 w-11 place-items-center rounded-xl text-ink hover:bg-white/5 xl:hidden" onClick={() => setMobile((m) => !m)} aria-expanded={mobile} aria-controls="mobile-nav" aria-label={mobile ? 'Close menu' : 'Open menu'}>
            {mobile ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {mobile && (
          <motion.nav id="mobile-nav" aria-label="Mobile" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-line xl:hidden">
            <div className="container-x flex flex-col gap-1 py-3">
              {links.map((l) => (
                <Link key={l.to} to={l.to} className="rounded-xl px-3 py-3 font-semibold text-ink-2 hover:bg-white/5 hover:text-ink">{l.label}</Link>
              ))}
              {!session && <Link to="/login" className="rounded-xl px-3 py-3 font-semibold text-ink-2 hover:bg-white/5">Sign in</Link>}
              <div className="flex items-center justify-between px-3 pt-2"><ConnectionPill /></div>
              <ButtonLink to="/report" className="mt-2">Report a Hazard</ButtonLink>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

export function DemoBanner() {
  if (api.mode !== 'demo') return null;
  return (
    <div className="relative z-40 border-b border-safety/25 bg-safety/10 text-center text-xs text-safety">
      <div className="container-x py-1.5">
        <strong>Demo mode</strong> — fictional incidents stored only in this browser. Connect Supabase to go live (see README).
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="relative z-10 mt-24 border-t border-line bg-midnight/85 backdrop-blur-xl">
      <div className="container-x grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-sm text-ink-2">Spot a hazard. Pin the problem. Make your city safer.</p>
          <p className="mt-4 max-w-sm rounded-xl border border-critical/25 bg-critical/5 p-3 text-xs text-ink-2">
            <strong className="text-critical">Not an emergency service.</strong> CivicLens is a civic reporting platform. If someone is in immediate danger, call your local emergency number (112 in India).
          </p>
        </div>
        {[
          ['Product', [['Explore map', '/map'], ['Report a hazard', '/report'], ['My reports', '/my-reports'], ['How it works', '/#how']]],
          ['For cities', [['Operations dashboard', '/dashboard'], ['Analytics', '/dashboard/analytics'], ['Severity model', '/#severity'], ['Staff sign in', '/login']]],
          ['Trust', [['Privacy', '/legal/privacy'], ['Accessibility', '/legal/accessibility'], ['Terms', '/legal/terms'], ['Contact', '/legal/contact']]],
        ].map(([title, items]) => (
          <div key={title as string}>
            <p className="text-sm font-bold">{title as string}</p>
            <ul className="mt-3 space-y-2">
              {(items as string[][]).map(([l, to]) => (
                <li key={to}><Link to={to} className="text-sm text-ink-2 hover:text-ink">{l}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="container-x flex flex-col justify-between gap-2 border-t border-line py-5 pb-[calc(1.25rem+var(--safe-bottom))] text-xs text-ink-3 sm:flex-row">
        <span>© {new Date().getFullYear()} CivicLens. Open civic infrastructure.</span>
        <span>Map data © OpenStreetMap contributors</span>
      </div>
    </footer>
  );
}

export function PageFallback() {
  return <div className="grid min-h-[60vh] place-items-center"><Spinner label="Loading page" /></div>;
}

export function AppShell() {
  const loc = useLocation();
  const bare = loc.pathname.startsWith('/dashboard') || loc.pathname === '/map';
  const { interactive } = useSceneState();
  useEffect(() => {
    if (loc.hash) {
      const el = document.getElementById(loc.hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 80);
    } else window.scrollTo({ top: 0 });
  }, [loc.pathname, loc.hash]);
  return (
    <div className="relative min-h-dvh">
      <SceneLayer />
      <DemoBanner />
      <Header />
      <main id="main" className={clsx('relative z-10', interactive && 'pointer-events-none')}>
        <AnimatePresence mode="wait">
          <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>
      {!bare && <Footer />}
    </div>
  );
}

export { Button };
