import { lazy, Suspense, useState } from 'react';
import { HazardListItem } from '@/components/hazard';
import { useScene } from '@/components/three/sceneStore';
import { ButtonLink, Card, ErrorState, Segmented, Skeleton } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { api } from '@/lib/api';
import type { Hazard } from '@/lib/types';
import { OPEN_STATUSES } from '@/lib/workflow';

const HazardMap = lazy(() => import('@/components/map/HazardMap'));

export default function LiveMap() {
  useScene({ variant: 'dashboard', paused: true });
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [heat, setHeat] = useState<'markers' | 'heat'>('markers');
  const [sel, setSel] = useState<Hazard | null>(null);
  const q = useQuery(() => api.listHazards({ statuses: scope === 'open' ? OPEN_STATUSES : undefined, sort: 'severity', pageSize: 2000 }), [scope]);
  const items = q.data?.items ?? [];
  return (
    <div className="space-y-4">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Live hazard map</p>
          <h1 className="mt-2 text-3xl font-extrabold">{items.length} {scope === 'open' ? 'open ' : ''}incidents</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented label="Scope" value={scope} onChange={setScope} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
          <Segmented label="Layer" value={heat} onChange={setHeat} options={[{ value: 'markers', label: 'Markers' }, { value: 'heat', label: 'Heatmap' }]} />
        </div>
      </header>
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card className="h-[65vh] min-h-[420px] overflow-hidden p-1">
          {q.error ? <ErrorState error={q.error} onRetry={q.reload} /> : q.loading ? <Skeleton className="h-full w-full" /> : (
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <HazardMap hazards={items} heatmap={heat === 'heat'} selectedId={sel?.id} onSelect={setSel} fitKey={scope} className="h-full w-full overflow-hidden rounded-xl" label="Operations map" />
            </Suspense>
          )}
        </Card>
        <Card className="max-h-[65vh] overflow-y-auto p-3">
          {sel ? (
            <div className="space-y-3">
              <HazardListItem hazard={sel} to={`/hazards/${sel.id}`} />
              <div className="flex gap-2"><ButtonLink to={`/hazards/${sel.id}`} size="sm">Open incident</ButtonLink><button className="text-sm text-ink-2 hover:text-ink" onClick={() => setSel(null)}>Clear</button></div>
            </div>
          ) : <p className="p-2 text-sm text-ink-2">Select a marker to see the incident. Highest-severity incidents are listed below.</p>}
          <div className="mt-4 space-y-2">{items.slice(0, 20).map((h) => <HazardListItem key={h.id} hazard={h} active={h.id === sel?.id} onClick={() => setSel(h)} />)}</div>
        </Card>
      </div>
    </div>
  );
}
