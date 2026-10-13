import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from './providers';

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** True while refreshing data that is already shown. */
  refreshing: boolean;
  reload: () => Promise<void>;
  setData: (fn: (d: T | undefined) => T | undefined) => void;
}

/**
 * Small data-fetching hook. Re-runs when deps change and (optionally) when a
 * realtime event arrives, keeping the previous data on screen while refreshing.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[], opts: { live?: boolean; enabled?: boolean } = {}): QueryState<T> {
  const { live = true, enabled = true } = opts;
  const { version } = useRealtime();
  const [data, setDataState] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const hasData = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const id = ++seq.current;
    if (hasData.current) setRefreshing(true);
    else setLoading(true);
    try {
      const d = await fnRef.current();
      if (id !== seq.current) return;
      setDataState(d);
      hasData.current = true;
      setError(null);
    } catch (e) {
      if (id === seq.current) setError(e);
    } finally {
      if (id === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, live ? version : 0]);

  const setData = useCallback((f: (d: T | undefined) => T | undefined) => setDataState((d) => f(d)), []);
  return { data, error, loading, refreshing, reload: run, setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

let webglCache: boolean | null = null;
export function hasWebGL(): boolean {
  if (webglCache !== null) return webglCache;
  try {
    if (new URLSearchParams(location.search).has('nowebgl')) return (webglCache = false);
    const c = document.createElement('canvas');
    webglCache = Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    webglCache = false;
  }
  return webglCache;
}

export function usePageVisible(): boolean {
  const [v, setV] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const on = () => setV(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return v;
}
