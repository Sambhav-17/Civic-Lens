import {
  Box, Copy, ExternalLink, Flame, Layers, List, LocateFixed, Map as MapIcon, Navigation, Search, SlidersHorizontal, X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { HazardListItem, HazardThumb } from '@/components/hazard';
import { sceneStore, useScene } from '@/components/three/sceneStore';
import { Badge, Button, ButtonLink, Card, Dialog, EmptyState, ErrorState, SeverityBadge, Skeleton, StatusBadge } from '@/components/ui';
import { useToast } from '@/hooks/providers';
import { hasWebGL, useDebounced, useMediaQuery, useQuery } from '@/hooks/useQuery';
import { api, type HazardFilter } from '@/lib/api';
import { CATEGORY_META } from '@/lib/categories';
import { distanceMeters, externalDirectionsUrl, formatDistance, getRoute, requestPosition, routingAvailable, searchPlaces, type GeoState, type GeocodeResult } from '@/lib/geo';
import { timeAgo } from '@/lib/format';
import { SEVERITY_META } from '@/lib/severity';
import { CATEGORIES, SEVERITY_LEVELS, type Category, type Hazard, type HazardStatus, type SeverityLevel } from '@/lib/types';
import { OPEN_STATUSES } from '@/lib/workflow';

const HazardMap = lazy(() => import('@/components/map/HazardMap'));

const SINCE = { '24h': 1, '7d': 7, '30d': 30, all: 0 } as const;
type Since = keyof typeof SINCE;
type View = 'map' | 'list' | '3d';

function useFilters() {
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? '';
  const f = {
    categories: get('cat').split(',').filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c)),
    severities: get('sev').split(',').filter((c): c is SeverityLevel => (SEVERITY_LEVELS as readonly string[]).includes(c)),
    status: (['open', 'resolved', 'all'].includes(get('status')) ? get('status') : 'open') as 'open' | 'resolved' | 'all',
    since: ((Object.keys(SINCE) as string[]).includes(get('since')) ? get('since') : 'all') as Since,
    q: get('q'),
    view: (['map', 'list', '3d'].includes(get('view')) ? get('view') : 'map') as View,
    heat: get('heat') === '1',
    id: get('id') || null,
  };
  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setSp((prev) => {
        const n = new URLSearchParams(prev);
        Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
        return n;
      }, { replace: true });
    },
    [setSp],
  );
  return { f, update };
}

function toggle<T extends string>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Filters({ f, update }: ReturnType<typeof useFilters>) {
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="label">Status</legend>
        <div className="flex flex-wrap gap-2">
          {(['open', 'resolved', 'all'] as const).map((s) => (
            <button key={s} aria-pressed={f.status === s} onClick={() => update({ status: s === 'open' ? null : s })} className={clsx('min-h-[36px] rounded-full border px-3 text-sm font-semibold capitalize', f.status === s ? 'border-cyan bg-cyan/15 text-cyan' : 'border-line text-ink-2 hover:text-ink')}>{s}</button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Severity</legend>
        <div className="flex flex-wrap gap-2">
          {SEVERITY_LEVELS.map((s) => {
            const on = f.severities.includes(s);
            return (
              <button key={s} aria-pressed={on} onClick={() => update({ sev: toggle(f.severities, s).join(',') || null })} className={clsx('inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-sm font-semibold', on ? 'bg-white/10' : 'border-line text-ink-2 hover:text-ink')} style={on ? { borderColor: SEVERITY_META[s].hex, color: SEVERITY_META[s].hex } : undefined}>
                <span aria-hidden className="text-[9px]">{SEVERITY_META[s].glyph}</span>{SEVERITY_META[s].label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Reported within</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SINCE) as Since[]).map((s) => (
            <button key={s} aria-pressed={f.since === s} onClick={() => update({ since: s === 'all' ? null : s })} className={clsx('min-h-[36px] rounded-full border px-3 text-sm font-semibold', f.since === s ? 'border-cyan bg-cyan/15 text-cyan' : 'border-line text-ink-2 hover:text-ink')}>{s === 'all' ? 'Any time' : `Last ${s}`}</button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Category</legend>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {CATEGORIES.map((c) => {
            const on = f.categories.includes(c);
            const Icon = CATEGORY_META[c].icon;
            return (
              <button key={c} aria-pressed={on} onClick={() => update({ cat: toggle(f.categories, c).join(',') || null })} className={clsx('flex min-h-[40px] items-center gap-2 rounded-xl border px-3 text-left text-sm', on ? 'border-cyan/60 bg-cyan/10 text-ink' : 'border-line text-ink-2 hover:text-ink')}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden />{CATEGORY_META[c].short}
              </button>
            );
          })}
        </div>
      </fieldset>
      {(f.categories.length || f.severities.length || f.since !== 'all' || f.status !== 'open' || f.q) && (
        <Button variant="ghost" size="sm" onClick={() => update({ cat: null, sev: null, since: null, status: null, q: null })}>Clear all filters</Button>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="glass-strong pointer-events-auto p-3 text-xs">
      <p className="mb-2 font-bold">Legend</p>
      <ul className="space-y-1.5">
        {SEVERITY_LEVELS.map((s) => (
          <li key={s} className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-white/80" style={{ background: SEVERITY_META[s].hex }} aria-hidden /><span aria-hidden className="w-4 text-[9px]">{SEVERITY_META[s].glyph}</span>{SEVERITY_META[s].label}</li>
        ))}
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-success bg-success/60" aria-hidden /><span className="w-4" />Verified resolved</li>
        <li className="flex items-center gap-2"><span className="relative h-3 w-3"><span className="absolute inset-0 animate-ping2 rounded-full bg-critical/60" /><span className="absolute inset-0 rounded-full bg-critical" /></span><span className="w-4" />Pulsing = critical</li>
      </ul>
    </div>
  );
}

function SelectedCard({ h, from, onClose, onRoute, routeInfo }: { h: Hazard; from: [number, number] | null; onClose: () => void; onRoute: () => void; routeInfo: string | null }) {
  const toast = useToast();
  return (
    <Card strong className="pointer-events-auto overflow-hidden" role="dialog" aria-label={`Selected hazard: ${CATEGORY_META[h.category].label}`}>
      <div className="relative">
        <HazardThumb hazard={h} className="h-36 w-full" />
        <button onClick={onClose} className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-midnight/80 text-ink backdrop-blur hover:bg-midnight" aria-label="Close details"><X className="h-4 w-4" /></button>
        {h.is_demo && <span className="absolute left-2 top-2 rounded-md bg-safety px-1.5 py-0.5 text-[10px] font-bold uppercase text-midnight">Demo data</span>}
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5"><SeverityBadge level={h.severity_level} score={h.severity_score} /><StatusBadge status={h.status} /></div>
        <div>
          <h2 className="text-lg font-bold">{CATEGORY_META[h.category].label}</h2>
          <p className="text-sm text-ink-2">{h.location_label ?? `${h.latitude.toFixed(5)}, ${h.longitude.toFixed(5)}`}</p>
        </div>
        {h.description && <p className="line-clamp-3 text-sm">{h.description}</p>}
        <p className="text-xs text-ink-3">Reported {timeAgo(h.created_at)}{from && ` · ${formatDistance(distanceMeters(from, [h.latitude, h.longitude]))} from you`} · {h.ref}</p>
        {routeInfo && <p className="rounded-lg border border-cyan/30 bg-cyan/5 p-2 text-xs text-ink-2" role="status">{routeInfo}</p>}
        <div className="flex flex-wrap gap-2">
          <ButtonLink to={`/hazards/${h.id}`} size="sm">Open details</ButtonLink>
          {routingAvailable() && from ? (
            <Button size="sm" variant="secondary" onClick={onRoute} icon={<Navigation className="h-4 w-4" aria-hidden />}>Route here</Button>
          ) : (
            <a className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold hover:border-cyan/50" href={externalDirectionsUrl(h.latitude, h.longitude)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden />Directions
            </a>
          )}
          <Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" aria-hidden />} onClick={async () => {
            try { await navigator.clipboard.writeText(`${location.origin}/hazards/${h.id}`); toast({ kind: 'success', title: 'Link copied' }); } catch { toast({ kind: 'error', title: 'Couldn’t copy the link' }); }
          }}>Copy link</Button>
        </div>
      </div>
    </Card>
  );
}

export default function MapPage() {
  const { f, update } = useFilters();
  const toast = useToast();
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [search, setSearch] = useState(f.q);
  const debounced = useDebounced(search, 350);
  const [places, setPlaces] = useState<GeocodeResult[]>([]);
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null);
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [route, setRoute] = useState<[number, number][] | null>(null);
  const [routeInfo, setRouteInfo] = useState<string | null>(null);
  const me: [number, number] | null = geo.status === 'granted' ? [geo.lat, geo.lng] : null;

  const filter: HazardFilter = useMemo(() => {
    const statuses: HazardStatus[] | undefined = f.status === 'open' ? OPEN_STATUSES : f.status === 'resolved' ? ['verified_resolved'] : undefined;
    return {
      categories: f.categories, severities: f.severities, statuses,
      since: SINCE[f.since] ? new Date(Date.now() - SINCE[f.since] * 86_400_000).toISOString() : undefined,
      search: f.q || undefined, sort: 'severity', pageSize: 1000,
    };
  }, [f.categories.join(), f.severities.join(), f.status, f.since, f.q]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = useQuery(() => api.listHazards(filter), [filter]);
  const items = q.data?.items ?? [];
  const selected = items.find((h) => h.id === f.id) ?? null;

  // Sync debounced search → URL + place lookup.
  useEffect(() => {
    if (debounced !== f.q) update({ q: debounced || null });
    if (debounced.trim().length < 3) return setPlaces([]);
    const ctl = new AbortController();
    searchPlaces(debounced, ctl.signal).then(setPlaces).catch(() => setPlaces([]));
    return () => ctl.abort();
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3D city view: feed real pins into the shared scene.
  const webgl = typeof window !== 'undefined' && hasWebGL();
  const view: View = f.view === '3d' && !webgl ? 'map' : f.view;
  useScene({ variant: view === '3d' ? 'map3d' : 'map3d', paused: view !== '3d', interactive: view === '3d' }, [view]);
  useEffect(() => {
    sceneStore.set({
      pins: items.map((h) => ({ id: h.id, lat: h.latitude, lng: h.longitude, level: h.severity_level, resolved: h.status === 'verified_resolved' })),
      focusId: f.id,
      onSelect: (id) => update({ id }),
    });
  }, [items, f.id, update]);

  const select = (h: Hazard | null) => {
    update({ id: h?.id ?? null });
    setRoute(null);
    setRouteInfo(null);
  };

  const locate = async () => {
    setGeo({ status: 'requesting' });
    const r = await requestPosition();
    setGeo(r);
    if (r.status === 'granted') setFlyTo([r.lat, r.lng]);
    else if (r.status !== 'requesting' && r.status !== 'idle') toast({ kind: 'error', title: 'Location unavailable', body: r.message });
  };

  const doRoute = async () => {
    if (!selected || !me) return;
    try {
      const r = await getRoute(me, [selected.latitude, selected.longitude], 'foot');
      if (!r) return setRouteInfo('No route found.');
      setRoute(r.coordinates);
      const near = items.filter((h) => h.id !== selected.id && h.status !== 'verified_resolved' && r.coordinates.some((c) => distanceMeters(c, [h.latitude, h.longitude]) < 30));
      setRouteInfo(`Walking route: ${formatDistance(r.distance)}, ~${Math.round(r.duration / 60)} min. ${near.length ? `It passes ${near.length} other reported hazard${near.length > 1 ? 's' : ''} — take care.` : 'No other reported hazards along it'} — unreported hazards may still exist.`);
    } catch (e) {
      setRouteInfo(e instanceof Error ? e.message : 'Routing failed.');
    }
  };

  const activeFilters = f.categories.length + f.severities.length + (f.since !== 'all' ? 1 : 0) + (f.status !== 'open' ? 1 : 0);

  const list = (
    <div className="space-y-2">
      {q.loading && Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)}
      {!!q.error && <ErrorState title="Couldn’t load hazards" error={q.error} onRetry={q.reload} />}
      {!q.loading && !q.error && items.length === 0 && <EmptyState title="No hazards match" body="Try widening the filters or time range." action={<Button variant="secondary" size="sm" onClick={() => update({ cat: null, sev: null, since: null, status: 'all', q: null })}>Show everything</Button>} />}
      {items.map((h) => <HazardListItem key={h.id} hazard={h} from={me} active={h.id === f.id} onClick={() => select(h)} />)}
    </div>
  );

  return (
    <div className="relative flex h-[calc(100dvh-4rem)] flex-col lg:flex-row">
      <h1 className="sr-only">Public hazard map</h1>
      {/* Side panel */}
      <aside className={clsx('pointer-events-auto relative z-20 flex flex-col border-line bg-midnight/85 backdrop-blur-xl lg:w-[400px] lg:border-r', view === 'list' && !desktop ? 'flex-1' : 'max-lg:shrink-0')}>
        <div className="space-y-3 border-b border-line p-3 sm:p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search locality, street or incident ID" className="input pl-9" aria-label="Search by locality, street or incident ID" />
            {places.length > 0 && (
              <ul className="glass-strong absolute inset-x-0 top-12 z-30 max-h-64 overflow-y-auto p-1" role="listbox" aria-label="Places">
                {places.map((p) => (
                  <li key={`${p.lat},${p.lng}`}>
                    <button className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5" onClick={() => { setFlyTo([p.lat, p.lng]); setPlaces([]); setSearch(''); update({ q: null, view: view === 'list' ? 'map' : f.view === 'map' ? null : f.view }); }}>
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="View" className="inline-flex rounded-xl border border-line bg-midnight/60 p-1">
              {([['map', MapIcon, 'Map'], ['list', List, 'List'], ['3d', Box, '3D city']] as const).map(([v, Icon, l]) => (
                <button key={v} role="radio" aria-checked={view === v} disabled={v === '3d' && !webgl} onClick={() => update({ view: v === 'map' ? null : v })} className={clsx('inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold disabled:opacity-40', view === v ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:text-ink')}>
                  <Icon className="h-4 w-4" aria-hidden />{l}
                </button>
              ))}
            </div>
            <Button size="sm" variant={activeFilters ? 'primary' : 'secondary'} onClick={() => setFiltersOpen(true)} icon={<SlidersHorizontal className="h-4 w-4" aria-hidden />} className="lg:hidden">
              Filters{activeFilters ? ` (${activeFilters})` : ''}
            </Button>
          </div>
          <p className="text-xs text-ink-2" role="status" aria-live="polite">
            {q.loading ? 'Loading hazards…' : `${items.length} hazard${items.length === 1 ? '' : 's'} shown`}{q.refreshing && ' · updating'}
            {api.mode === 'demo' && <Badge tone="orange" className="ml-2">Demo data</Badge>}
          </p>
        </div>
        <div className="hidden flex-1 overflow-y-auto p-4 lg:block">
          <details className="mb-4 rounded-2xl border border-line p-3" open>
            <summary className="cursor-pointer text-sm font-bold">Filters{activeFilters ? ` (${activeFilters})` : ''}</summary>
            <div className="mt-4"><Filters f={f} update={update} /></div>
          </details>
          {list}
        </div>
        {view === 'list' && !desktop && <div className="flex-1 overflow-y-auto p-3">{list}</div>}
      </aside>

      {/* Map / 3D */}
      <div className={clsx('relative flex-1', view === 'list' && !desktop && 'hidden')}>
        {view === '3d' ? (
          <div className="pointer-events-none absolute inset-0">
            <p className="glass-strong pointer-events-auto absolute left-3 top-3 max-w-xs p-3 text-xs text-ink-2">3D city view — each beacon is a real report positioned by its coordinates. Select one to see details, or switch to Map for exact streets.</p>
          </div>
        ) : (
          <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
            {q.error && !items.length ? <ErrorState title="Map data unavailable" error={q.error} onRetry={q.reload} /> : (
              <HazardMap hazards={items} selectedId={f.id} onSelect={select} heatmap={f.heat} userLocation={me} route={route} center={flyTo ?? (selected ? [selected.latitude, selected.longitude] : null)} fitKey={JSON.stringify(filter)} className="absolute inset-0" />
            )}
          </Suspense>
        )}
        <div className="pointer-events-none absolute right-3 top-3 z-[500] flex flex-col items-end gap-2">
          <Button size="sm" variant="secondary" className="pointer-events-auto" onClick={locate} loading={geo.status === 'requesting'} icon={<LocateFixed className="h-4 w-4" aria-hidden />}>My location</Button>
          {view === 'map' && <Button size="sm" variant={f.heat ? 'primary' : 'secondary'} className="pointer-events-auto" aria-pressed={f.heat} onClick={() => update({ heat: f.heat ? null : '1' })} icon={f.heat ? <Layers className="h-4 w-4" aria-hidden /> : <Flame className="h-4 w-4" aria-hidden />}>{f.heat ? 'Markers' : 'Heatmap'}</Button>}
          <Button size="sm" variant="secondary" className="pointer-events-auto" icon={<Copy className="h-4 w-4" aria-hidden />} onClick={async () => { try { await navigator.clipboard.writeText(location.href); toast({ kind: 'success', title: 'Filtered map link copied' }); } catch { toast({ kind: 'error', title: 'Couldn’t copy link' }); } }}>Share view</Button>
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] hidden sm:block"><Legend /></div>
        {selected && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[600] sm:left-auto sm:right-3 sm:w-[340px]">
            <SelectedCard h={selected} from={me} onClose={() => select(null)} onRoute={doRoute} routeInfo={routeInfo} />
          </div>
        )}
      </div>

      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter hazards" footer={<Button onClick={() => setFiltersOpen(false)}>Show {items.length} results</Button>}>
        <Filters f={f} update={update} />
      </Dialog>
      <p className="sr-only">
        Map markers are keyboard focusable; press Enter on a marker to open its details. The list view offers the same information without the map. <Link to="/map?view=list">Switch to list view</Link>
      </p>
    </div>
  );
}
