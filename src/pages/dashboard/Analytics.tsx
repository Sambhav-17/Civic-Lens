import { Download, Table2, ChartColumn } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps,
} from 'recharts';
import { sceneStore, useScene } from '@/components/three/sceneStore';
import { Button, Card, EmptyState, ErrorState, Segmented, Select, Skeleton, Stat } from '@/components/ui';
import { useAuth, useToast } from '@/hooks/providers';
import { useQuery } from '@/hooks/useQuery';
import { computeAnalytics, localityOf, type AnalyticsFilter } from '@/lib/analytics';
import { api } from '@/lib/api';
import { CATEGORY_META } from '@/lib/categories';
import { durationLabel, toCsv } from '@/lib/format';
import { SEVERITY_META } from '@/lib/severity';
import { CATEGORIES } from '@/lib/types';
import { isStaff, STATUS_META } from '@/lib/workflow';

// Validated (dark surface #101827): lightness band, chroma, CVD ΔE 13.4, normal ΔE 19.8, contrast ≥ 3:1.
const C1 = '#1BA2D2';
const C2 = '#7B5AE0';
const GRID = 'rgba(154,168,189,.12)';
const TICK = { fill: '#9AA8BD', fontSize: 12 };

function ChartTooltip({ active, payload, label, unit }: TooltipProps<number, string> & { unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface/95 px-3 py-2 text-xs shadow-panel backdrop-blur">
      {label !== undefined && <p className="mb-1 font-semibold text-ink">{label}</p>}
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: (p.payload?.fill as string) ?? p.color }} aria-hidden />
          <span>{p.name}</span><span className="ml-auto pl-3 font-mono text-ink">{typeof p.value === 'number' ? Math.round(p.value * 10) / 10 : p.value}{unit ?? ''}</span>
        </p>
      ))}
    </div>
  );
}

/** Chart card with a table alternative for accessibility. */
function ChartCard({ title, desc, children, rows, empty, className }: { title: string; desc?: string; children: ReactNode; rows: Record<string, string | number | null>[]; empty?: boolean; className?: string }) {
  const [table, setTable] = useState(false);
  return (
    <Card className={`p-5 ${className ?? ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">{title}</h2>
          {desc && <p className="mt-0.5 text-xs text-ink-2">{desc}</p>}
        </div>
        {!empty && (
          <button onClick={() => setTable((t) => !t)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-white/5 hover:text-ink" aria-label={table ? `Show ${title} as chart` : `Show ${title} as table`} aria-pressed={table}>
            {table ? <ChartColumn className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          </button>
        )}
      </div>
      <div className="mt-4">
        {empty ? <EmptyState title="No data for these filters" /> : table ? (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-3"><tr>{Object.keys(rows[0] ?? {}).map((k) => <th key={k} scope="col" className="py-1.5 pr-3 font-semibold">{k}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{rows.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className="py-1.5 pr-3 font-mono text-xs">{v ?? '—'}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : <div className="h-64">{children}</div>}
      </div>
    </Card>
  );
}

export default function Analytics() {
  useScene({ variant: 'analytics' });
  const { session } = useAuth();
  const toast = useToast();
  const q = useQuery(() => api.getAnalytics(), []);
  const [range, setRange] = useState<'30' | '90' | '365' | 'all'>('90');
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('week');
  const [category, setCategory] = useState('');
  const [teamId, setTeamId] = useState('');
  const [locality, setLocality] = useState('');

  const f: AnalyticsFilter = useMemo(() => ({
    from: range === 'all' ? undefined : new Date(Date.now() - Number(range) * 86_400_000).toISOString(),
    category: category || undefined, teamId: teamId || undefined, locality: locality || undefined,
  }), [range, category, teamId, locality]);
  const a = useMemo(() => (q.data ? computeAnalytics(q.data, f, bucket) : null), [q.data, f, bucket]);
  const allLocalities = useMemo(() => [...new Set((q.data?.hazards ?? []).map(localityOf))].sort(), [q.data]);

  useEffect(() => {
    if (!a) return;
    const max = Math.max(1, ...a.byCategory.map((c) => c.count));
    sceneStore.set({ bars: CATEGORIES.map((c) => (a.byCategory.find((x) => x.key === c)?.count ?? 0) / max) });
  }, [a]);

  const exportCsv = () => {
    if (!isStaff(session?.user.role) || !a) return toast({ kind: 'error', title: 'Export not permitted' });
    const csv = toCsv(a.hazards.map((h) => ({
      incident_id: h.ref, category: CATEGORY_META[h.category].label, severity: h.severity_level, score: h.severity_score,
      status: STATUS_META[h.status].label, locality: localityOf(h), latitude: h.latitude, longitude: h.longitude,
      team: q.data?.teams.find((t) => t.id === h.assigned_team_id)?.name ?? '', reported_at: h.created_at, resolved_at: h.resolved_at ?? '',
      confirmations: h.corroborations, demo: h.is_demo,
    })));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const el = document.createElement('a');
    el.href = url;
    el.download = `civiclens-incidents-${new Date().toISOString().slice(0, 10)}.csv`;
    el.click();
    URL.revokeObjectURL(url);
    toast({ kind: 'success', title: `Exported ${a.hazards.length} incidents` });
  };

  if (q.error) return <ErrorState title="Couldn’t load analytics" error={q.error} onRetry={q.reload} />;

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <p className="eyebrow">Civic safety analytics</p>
          <h1 className="mt-2 text-3xl font-extrabold">What the data shows</h1>
          <p className="mt-1 text-sm text-ink-2">All figures are computed from stored incidents{api.mode === 'demo' ? ' (demo database — fictional)' : ''}. No projections.</p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!a} icon={<Download className="h-4 w-4" aria-hidden />}>Export CSV</Button>
      </header>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Segmented label="Date range" value={range} onChange={setRange} options={[{ value: '30', label: '30d' }, { value: '90', label: '90d' }, { value: '365', label: '1y' }, { value: 'all', label: 'All' }]} />
        <Segmented label="Group by" value={bucket} onChange={setBucket} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="!w-auto"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].short}</option>)}</Select>
        <Select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="!w-auto"><option value="">All teams</option>{q.data?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Select aria-label="Locality" value={locality} onChange={(e) => setLocality(e.target.value)} className="!w-auto"><option value="">All localities</option>{allLocalities.map((l) => <option key={l} value={l}>{l}</option>)}</Select>
      </Card>

      {q.loading || !a ? (
        <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Incidents in range" value={a.total} hint={`${a.open} still open`} />
            <Stat tone="orange" label="Median resolution time" value={a.medianResolutionHours != null ? durationLabel(a.medianResolutionHours * 3_600_000) : '—'} hint={a.medianResolutionHours == null ? 'No verified repairs in range' : 'Report → verified'} />
            <Stat tone="green" label="Verification approval rate" value={a.verificationRate != null ? `${Math.round(a.verificationRate * 100)}%` : '—'} hint={`${a.verificationsDecided} reviewed`} />
            <Stat tone="red" label="Reopened incidents" value={a.reopenedCount} hint="Failed verification or hazard returned" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Reports vs verified repairs" desc={`Per ${bucket}`} empty={!a.overTime.length} rows={a.overTime.map((r) => ({ period: r.period, reported: r.reported, resolved: r.resolved }))} className="lg:col-span-2">
              <ResponsiveContainer>
                <AreaChart data={a.overTime} margin={{ left: -16, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C1} stopOpacity={0.35} /><stop offset="1" stopColor={C1} stopOpacity={0} /></linearGradient>
                    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C2} stopOpacity={0.35} /><stop offset="1" stopColor={C2} stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="period" tick={TICK} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#9AA8BD', strokeDasharray: '3 3' }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#9AA8BD' }} iconType="circle" />
                  <Area type="monotone" dataKey="reported" name="Reported" stroke={C1} strokeWidth={2} fill="url(#g1)" activeDot={{ r: 5, strokeWidth: 2, stroke: '#101827' }} />
                  <Area type="monotone" dataKey="resolved" name="Verified resolved" stroke={C2} strokeWidth={2} fill="url(#g2)" activeDot={{ r: 5, strokeWidth: 2, stroke: '#101827' }} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Hazards by category" empty={!a.byCategory.length} rows={a.byCategory.map((c) => ({ category: c.name, count: c.count }))}>
              <ResponsiveContainer>
                <BarChart data={a.byCategory} margin={{ left: -16, right: 8, top: 8 }} barCategoryGap="22%">
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={false} interval={0} angle={-25} textAnchor="end" height={56} />
                  <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Bar dataKey="count" name="Incidents" fill={C1} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Severity distribution" desc="Colour plus label — never colour alone" empty={!a.total} rows={a.bySeverity.map((s) => ({ severity: s.name, count: s.count }))}>
              <ResponsiveContainer>
                <BarChart data={a.bySeverity} layout="vertical" margin={{ left: 8, right: 24 }} barCategoryGap="28%">
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={TICK} tickLine={false} axisLine={false} width={96} tickFormatter={(v: string) => `${SEVERITY_META[v.toLowerCase() as keyof typeof SEVERITY_META]?.glyph ?? ''} ${v}`} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Bar dataKey="count" name="Incidents" radius={[0, 4, 4, 0]} maxBarSize={28} label={{ position: 'right', fill: '#9AA8BD', fontSize: 12 }}>
                    {a.bySeverity.map((s) => <Cell key={s.key} fill={s.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Median resolution time by category" desc="Hours from report to verified repair" empty={!a.resolutionByCategory.length} rows={a.resolutionByCategory.map((r) => ({ category: r.name, median_hours: r.hours != null ? Math.round(r.hours) : null, resolved: r.n }))}>
              <ResponsiveContainer>
                <BarChart data={a.resolutionByCategory} margin={{ left: -8, right: 8, top: 8 }} barCategoryGap="22%">
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={false} interval={0} angle={-25} textAnchor="end" height={56} />
                  <YAxis tick={TICK} tickLine={false} axisLine={false} unit="h" />
                  <Tooltip content={<ChartTooltip unit=" h" />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Bar dataKey="hours" name="Median" fill={C1} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Open hazards by locality" empty={!a.byLocality.length} rows={a.byLocality.map((l) => ({ locality: l.name, open: l.open, total: l.total, reopened: l.reopened }))}>
              <ResponsiveContainer>
                <BarChart data={a.byLocality.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap="24%">
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={TICK} tickLine={false} axisLine={false} width={130} tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + '…' : v)} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Bar dataKey="open" name="Open" fill={C1} radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Team workload" desc="Open vs verified resolved" empty={!a.teamWorkload.length} rows={a.teamWorkload.map((t) => ({ team: t.name, open: t.open, resolved: t.resolved }))}>
              <ResponsiveContainer>
                <BarChart data={a.teamWorkload} margin={{ left: -16, right: 8, top: 8 }} barCategoryGap="24%" barGap={2}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#9AA8BD' }} iconType="circle" />
                  <Bar dataKey="open" name="Open" fill={C1} radius={[4, 4, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="resolved" name="Verified resolved" fill={C2} radius={[4, 4, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="High-risk road segments" desc="Sum of severity scores of open incidents" empty={!a.highRisk.length} rows={a.highRisk.map((r) => ({ locality: r.name, risk_load: r.risk }))}>
              <ResponsiveContainer>
                <BarChart data={a.highRisk} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap="24%">
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={TICK} tickLine={false} axisLine={false} width={130} tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + '…' : v)} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Bar dataKey="risk" name="Risk load" fill={C1} radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <Card className="p-5 lg:col-span-2">
              <h2 className="font-bold">Repeat-problem locations</h2>
              <p className="mt-0.5 text-xs text-ink-2">~100 m cells with two or more reports (including confirmations)</p>
              {a.repeatLocations.length === 0 ? <EmptyState title="No repeat locations in range" /> : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-ink-3"><tr><th scope="col" className="py-2 pr-4">Location</th><th scope="col" className="py-2 pr-4">Reports</th><th scope="col" className="py-2">Coordinates</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {a.repeatLocations.map((r) => (
                        <tr key={`${r.lat},${r.lng}`}><td className="py-2 pr-4">{r.label}</td><td className="py-2 pr-4 font-mono">{r.count}</td><td className="py-2 font-mono text-xs text-ink-2">{r.lat.toFixed(4)}, {r.lng.toFixed(4)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
