import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type ConnectionState, type RealtimeEvent, type Session } from '@/lib/api';
import type { AppNotification } from '@/lib/types';

// ── Toasts ───────────────────────────────────────────────────────────────
type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; title: string; body?: string }
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.kind === 'error' ? 7000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1100] flex flex-col items-center gap-2 p-4 pb-[calc(1rem+var(--safe-bottom))] sm:items-end" aria-live="polite" aria-atomic="false">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id} layout initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className="glass-strong pointer-events-auto flex w-full max-w-sm items-start gap-3 p-4"
            >
              {t.kind === 'success' ? <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden /> : t.kind === 'error' ? <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-critical" aria-hidden /> : <Info className="mt-0.5 h-5 w-5 shrink-0 text-cyan" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.body && <p className="mt-0.5 text-sm text-ink-2">{t.body}</p>}
              </div>
              <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="-m-1 grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:bg-white/5" aria-label="Dismiss notification"><X className="h-4 w-4" /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

// ── Auth ─────────────────────────────────────────────────────────────────
interface AuthCtxValue {
  session: Session | null;
  loading: boolean;
  refresh: () => Promise<void>;
}
const AuthCtx = createContext<AuthCtxValue>({ session: null, loading: true, refresh: async () => undefined });
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setSession(await api.getSession());
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return api.onAuthChange((s) => {
      setSession(s);
      setLoading(false);
    });
  }, [refresh]);
  const value = useMemo(() => ({ session, loading, refresh }), [session, loading, refresh]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

// ── Realtime ─────────────────────────────────────────────────────────────
const RealtimeCtx = createContext<{ state: ConnectionState; version: number; lastEvent: RealtimeEvent | null }>({ state: 'connecting', version: 0, lastEvent: null });
export const useRealtime = () => useContext(RealtimeCtx);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectionState>(api.getConnectionState());
  const [version, setVersion] = useState(0);
  const [lastEvent, setLast] = useState<RealtimeEvent | null>(null);
  const seen = useRef(new Set<string>());
  const toast = useToast();
  const { session } = useAuth();

  useEffect(() => api.onConnectionChange(setState), []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api.subscribe((e) => {
      // Deduplicate bursts of identical events.
      const key = e.type === 'notification' ? `n:${e.notification.id}` : e.type === 'hazard_upsert' ? `h:${e.hazard.id}:${e.hazard.updated_at}` : `u:${e.hazardId}:${Math.floor(Date.now() / 500)}`;
      if (seen.current.has(key)) return;
      seen.current.add(key);
      if (seen.current.size > 500) seen.current = new Set([...seen.current].slice(-200));
      setLast(e);
      if (e.type === 'notification' && e.notification.user_id === session?.user.id) toast({ kind: 'info', title: 'Update on your report', body: e.notification.message });
      clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 250);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [toast, session?.user.id]);

  // Auto-reconnect with backoff when the connection drops.
  useEffect(() => {
    if (state !== 'reconnecting' && state !== 'offline') return;
    const t = setTimeout(() => navigator.onLine && api.reconnect(), 4000);
    return () => clearTimeout(t);
  }, [state]);

  // Catch up after reconnecting (events may have been missed).
  const prev = useRef(state);
  useEffect(() => {
    if (prev.current !== 'live' && state === 'live') setVersion((v) => v + 1);
    prev.current = state;
  }, [state]);

  return <RealtimeCtx.Provider value={{ state, version, lastEvent }}>{children}</RealtimeCtx.Provider>;
}

// ── Notifications ────────────────────────────────────────────────────────
export function useNotifications() {
  const { session } = useAuth();
  const { version } = useRealtime();
  const [items, setItems] = useState<AppNotification[]>([]);
  const load = useCallback(async () => {
    if (!session) return setItems([]);
    try {
      setItems(await api.listNotifications());
    } catch {
      /* non-critical */
    }
  }, [session]);
  useEffect(() => {
    void load();
  }, [load, version]);
  return { items, unread: items.filter((n) => !n.read_at).length, reload: load };
}
