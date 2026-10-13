import { ArrowRight } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { HazardListItem, Timeline } from '@/components/hazard';
import { sceneStore, useScene } from '@/components/three/sceneStore';
import { ButtonLink, Card, EmptyState, ErrorState, Skeleton, Stat } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { computeAnalytics } from '@/lib/analytics';
import { api } from '@/lib/api';
import { durationLabel } from '@/lib/format';
import { sortHazards } from '@/lib/api/query';
import { SEVERITY_META } from '@/lib/severity';
import { SEVERITY_LEVELS } from '@/lib/types';
import { isOpen } from '@/lib/workflow';

export default function Overview() {
  useScene({ variant: 'dashboard' });
  const q = useQuery(() => api.getAnalytics(), []);
  const ds = q.data;
  const a = useMemo(() => (ds ? computeAnalytics(ds, {}) : null), [ds]);

  useEffect(() => {
    if (ds) sceneStore.set({ pins: ds.hazards.filter((h) => h.status !== 'dismissed').map((h) => ({ id: h.id, lat: h.latitude, lng: h.longitude, level: h.severity_level, resolved: !isOpen(h.status) })) });
  }, [ds]);

  if (q.error) return <ErrorState title="Couldn’t load operations data" error={q.error} onRetry={q.reload} />;
  const hz = ds?.hazards ?? [];
  const open = hz.filter((h) => isOpen(h.status));
  const critical = sortHazards(open.filter((h) => h.severity_level === 'critical'), 'severity');
  const recent = [...(ds?.updates ?? [])].sort((x, y) => y.created_at.localeCompare(x.created_at)).slice(0, 8)
    .map((u) => ({ ...u, note: `${hz.find((h) => h.id === u.hazard_id)?.ref ?? ''} ${u.note ?? ''}`.trim() }));

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Operations overview</p>
          <h1 className="mt-2 text-3xl font-extrabold">City hazard status</h1>
        </div>
        <ButtonLink to="/dashboard/queue">Open priority queue <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat loading={q.loading} label="Open incidents" value={open.length} />
        <Stat loading={q.loading} tone="red" label="Critical (open)" value={critical.length} />
        <Stat loading={q.loading} tone="orange" label="Awaiting assignment" value={open.filter((h) => h.status === 'reported' || h.status === 'triaged' || h.status === 'reopened').length} />
        <Stat loading={q.loading} tone="orange" label="Awaiting verification" value={hz.filter((h) => h.status === 'verification_pending').length} />
        <Stat loading={q.loading} tone="green" label="Verified resolved" value={hz.filter((h) => h.status === 'verified_resolved').length} />
        <Stat loading={q.loading} label="Median time to assignment" value={a?.medianAssignHours != null ? durationLabel(a.medianAssignHours * 3_600_000) : '—'} hint={a?.medianAssignHours == null ? 'No assignments yet' : undefined} />
        <Stat loading={q.loading} label="Median time to resolution" value={a?.medianResolutionHours != null ? durationLabel(a.medianResolutionHours * 3_600_000) : '—'} hint={a?.medianResolutionHours == null ? 'No resolutions yet' : undefined} />
        <Stat loading={q.loading} tone="green" label="Verification approval rate" value={a?.verificationRate != null ? `${Math.round(a.verificationRate * 100)}%` : '—'} hint={a ? `${a.verificationsDecided} decisions` : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card className="relative min-h-[360px] overflow-hidden !bg-transparent !backdrop-blur-none">
          <div className="absolute left-4 top-4 z-10 rounded-xl bg-midnight/80 p-3 backdrop-blur">
            <p className="text-sm font-bold">Digital twin</p>
            <p className="text-xs text-ink-2">Columns show incident clusters; colour = highest open severity.</p>
            <ul className="mt-2 flex flex-wrap gap-2 text-[11px]">
              {SEVERITY_LEVELS.map((s) => <li key={s} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_META[s].hex }} />{SEVERITY_META[s].label}</li>)}
              <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />Resolved</li>
            </ul>
          </div>
          <div className="h-full min-h-[360px]" aria-hidden />
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between"><h2 className="font-bold">Critical, open</h2><ButtonLink to="/dashboard/queue?sev=critical" variant="ghost" size="sm">View all</ButtonLink></div>
          <div className="mt-3 space-y-2">
            {q.loading ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />) : critical.length === 0 ? <EmptyState title="No open critical incidents" body="Great — nothing critical is waiting." /> : critical.slice(0, 4).map((h) => <HazardListItem key={h.id} hazard={h} to={`/hazards/${h.id}`} />)}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-bold">Recent activity</h2>
        <div className="mt-4">{q.loading ? <Skeleton className="h-40" /> : <Timeline updates={recent} />}</div>
      </Card>
    </div>
  );
}
