import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HazardThumb } from '@/components/hazard';
import { useScene } from '@/components/three/sceneStore';
import { Badge, Button, ButtonLink, Card, Dialog, EmptyState, ErrorState, Field, Input, Select, SeverityBadge, Skeleton, StatusBadge } from '@/components/ui';
import { useAuth, useToast } from '@/hooks/providers';
import { useDebounced, useQuery } from '@/hooks/useQuery';
import { api, type HazardFilter } from '@/lib/api';
import { CATEGORY_META } from '@/lib/categories';
import { durationLabel, timeAgo } from '@/lib/format';
import { CATEGORIES, SEVERITY_LEVELS, STATUSES, type Category, type Hazard, type HazardStatus, type SeverityLevel } from '@/lib/types';
import { OPEN_STATUSES, STATUS_META } from '@/lib/workflow';

type Mode = 'priority' | 'all' | 'mine' | 'verification';
const TITLES: Record<Mode, [string, string]> = {
  priority: ['Priority queue', 'Open incidents ranked by severity — highest risk first.'],
  all: ['All reports', 'Every incident, including resolved and dismissed.'],
  mine: ['Assigned to me', 'Open incidents assigned to your team.'],
  verification: ['Repair verification', 'Repairs submitted by crews and waiting for review.'],
};
const PAGE = 15;

export default function Queue({ mode }: { mode: Mode }) {
  useScene({ variant: 'dashboard' }, [mode]);
  const { session } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get('q') ?? '');
  const debounced = useDebounced(search, 300);
  const page = Math.max(1, Number(sp.get('page') ?? 1));
  const sev = (sp.get('sev') ?? '') as SeverityLevel | '';
  const cat = (sp.get('cat') ?? '') as Category | '';
  const status = (sp.get('status') ?? '') as HazardStatus | '';
  const team = sp.get('team') ?? '';
  const sort = (sp.get('sort') ?? (mode === 'all' ? 'newest' : 'severity')) as NonNullable<HazardFilter['sort']>;
  const set = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); v ? n.set(k, v) : n.delete(k); if (k !== 'page') n.delete('page'); return n; }, { replace: true });

  const teams = useQuery(() => api.listTeams(), [], { live: false });
  const myTeam = session?.user.team_id ?? null;

  const filter: HazardFilter = useMemo(() => ({
    statuses: status ? [status] : mode === 'verification' ? ['verification_pending'] : mode === 'all' ? undefined : OPEN_STATUSES,
    severities: sev ? [sev] : undefined,
    categories: cat ? [cat] : undefined,
    assignedTeamId: mode === 'mine' ? myTeam ?? undefined : team || undefined,
    search: debounced || undefined,
    sort, page, pageSize: PAGE,
  }), [status, mode, sev, cat, myTeam, team, debounced, sort, page]);

  const q = useQuery(() => api.listHazards(filter), [filter], { enabled: mode !== 'mine' || !!myTeam });
  const teamName = (id: string | null) => teams.data?.find((t) => t.id === id)?.name.replace(/ — .*/, '') ?? '—';
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / PAGE)) : 1;

  const [assigning, setAssigning] = useState<Hazard | null>(null);
  const [teamPick, setTeamPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doAssign = async () => {
    if (!assigning) return;
    setBusy(true);
    setErr(null);
    // Optimistic update with rollback on failure.
    const prev = q.data;
    q.setData((d) => d && { ...d, items: d.items.map((h) => (h.id === assigning.id ? { ...h, assigned_team_id: teamPick, status: h.status === 'triaged' || h.status === 'reopened' ? 'assigned' : h.status } : h)) });
    try {
      await api.assign(assigning.id, teamPick);
      toast({ kind: 'success', title: `Assigned ${assigning.ref}` });
      setAssigning(null);
    } catch (e) {
      q.setData(() => prev);
      setErr(e instanceof Error ? e.message : 'Assignment failed.');
    } finally {
      setBusy(false);
    }
  };

  const [title, sub] = TITLES[mode];

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Municipal queue</p>
        <h1 className="mt-2 text-3xl font-extrabold">{title}</h1>
        <p className="mt-1 text-ink-2">{sub}</p>
      </header>

      {mode === 'mine' && !myTeam && (
        <Card className="p-4 text-sm text-ink-2">Your account isn’t linked to a team yet. Ask an administrator to add you to one in <Link className="link" to="/admin">Admin</Link>.</Card>
      )}

      <Card className="p-3 sm:p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); set('page', ''); }} placeholder="Search ID, location, description" className="pl-9" aria-label="Search incidents" />
          </div>
          <Select aria-label="Severity" value={sev} onChange={(e) => set('sev', e.target.value)}><option value="">All severities</option>{SEVERITY_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
          <Select aria-label="Category" value={cat} onChange={(e) => set('cat', e.target.value)}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].short}</option>)}</Select>
          {mode !== 'verification' && <Select aria-label="Status" value={status} onChange={(e) => set('status', e.target.value)}><option value="">{mode === 'all' ? 'All statuses' : 'All open'}</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</Select>}
          {mode !== 'mine' && <Select aria-label="Team" value={team} onChange={(e) => set('team', e.target.value)}><option value="">All teams</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
          <Select aria-label="Sort by" value={sort} onChange={(e) => set('sort', e.target.value)}>
            <option value="severity">Sort: severity</option><option value="oldest">Sort: longest unresolved</option><option value="newest">Sort: newest</option><option value="updated">Sort: recently updated</option>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {q.loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={q.reload} />
        ) : !q.data?.items.length ? (
          <EmptyState title={mode === 'verification' ? 'Nothing awaiting verification' : 'No incidents match'} body="Try adjusting the filters." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{title}</caption>
                <thead className="border-b border-line text-xs uppercase tracking-wider text-ink-3">
                  <tr>
                    {['ID', '', 'Category', 'Location', 'Severity', 'Unresolved', 'Status', 'Team', 'Updated', ''].map((h, i) => <th key={i} scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {q.data.items.map((h) => (
                    <tr key={h.id} className="hover:bg-white/[.03]">
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs"><Link to={`/hazards/${h.id}`} className="text-cyan hover:underline">{h.ref}</Link>{h.is_demo && <Badge tone="orange" className="ml-1 !px-1 !py-0 text-[9px]">demo</Badge>}</td>
                      <td className="px-1 py-2"><HazardThumb hazard={h} className="h-10 w-10 rounded-lg" /></td>
                      <td className="whitespace-nowrap px-3 py-2.5">{CATEGORY_META[h.category].short}</td>
                      <td className="max-w-[220px] truncate px-3 py-2.5 text-ink-2" title={h.location_label ?? ''}>{h.location_label ?? '—'}</td>
                      <td className="px-3 py-2.5"><SeverityBadge level={h.severity_level} score={h.severity_score} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{h.resolved_at ? '—' : durationLabel(Date.now() - Date.parse(h.created_at))}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={h.status} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{teamName(h.assigned_team_id)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink-3">{timeAgo(h.updated_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        {mode === 'verification' ? <ButtonLink to={`/verify/${h.id}`} size="sm">Review</ButtonLink> : (
                          <div className="flex justify-end gap-1">
                            {['triaged', 'reopened', 'assigned'].includes(h.status) && <Button size="sm" variant="ghost" onClick={() => { setAssigning(h); setTeamPick(h.assigned_team_id ?? ''); setErr(null); }}>Assign</Button>}
                            <ButtonLink to={`/hazards/${h.id}`} size="sm" variant="secondary">Open</ButtonLink>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {q.data.items.map((h) => (
                <li key={h.id}>
                  <Link to={mode === 'verification' ? `/verify/${h.id}` : `/hazards/${h.id}`} className="flex gap-3 p-3 hover:bg-white/[.03]">
                    <HazardThumb hazard={h} className="h-14 w-14 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap gap-1.5"><SeverityBadge level={h.severity_level} /><StatusBadge status={h.status} /></div>
                      <p className="mt-1 truncate text-sm font-semibold">{h.ref} · {CATEGORY_META[h.category].short}</p>
                      <p className="truncate text-xs text-ink-2">{h.location_label} · {teamName(h.assigned_team_id)} · {timeAgo(h.created_at)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line p-3 text-sm">
              <span className="text-ink-2">{q.data.total} incident{q.data.total === 1 ? '' : 's'} · page {page} of {pages}{q.refreshing ? ' · updating…' : ''}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => set('page', String(page - 1))} aria-label="Previous page" icon={<ChevronLeft className="h-4 w-4" />} />
                <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => set('page', String(page + 1))} aria-label="Next page" icon={<ChevronRight className="h-4 w-4" />} />
              </div>
            </div>
          </>
        )}
      </Card>

      <Dialog open={!!assigning} onClose={() => setAssigning(null)} title={`Assign ${assigning?.ref ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setAssigning(null)}>Cancel</Button><Button loading={busy} disabled={!teamPick} onClick={doAssign}>Assign</Button></>}>
        <Field label="Team" error={err}>{(p) => (
          <Select {...p} value={teamPick} onChange={(e) => setTeamPick(e.target.value)}>
            <option value="">Choose a team…</option>
            {teams.data?.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        )}</Field>
      </Dialog>
    </div>
  );
}
