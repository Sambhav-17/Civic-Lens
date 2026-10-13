import { Check, Clock, MapPin, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { CATEGORY_META } from '@/lib/categories';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { computeSeverity, SEVERITY_META } from '@/lib/severity';
import type { Hazard, HazardDetail, HazardUpdate } from '@/lib/types';
import { LIFECYCLE, STATUS_META } from '@/lib/workflow';
import { CategoryIcon, SeverityBadge, StatusBadge } from './ui';

export function HazardThumb({ hazard, className }: { hazard: Hazard; className?: string }) {
  return hazard.thumbnail_url ? (
    <img src={hazard.thumbnail_url} alt={`Photo of reported ${CATEGORY_META[hazard.category].label.toLowerCase()}`} loading="lazy" decoding="async" className={clsx('object-cover', className)} />
  ) : (
    <div className={clsx('grid place-items-center bg-surface-2 text-ink-3', className)}>
      <CategoryIcon category={hazard.category} className="h-6 w-6" />
    </div>
  );
}

export function HazardListItem({ hazard, from, active, onClick, to }: { hazard: Hazard; from?: [number, number] | null; active?: boolean; onClick?: () => void; to?: string }) {
  const body = (
    <>
      <HazardThumb hazard={hazard} className="h-16 w-16 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityBadge level={hazard.severity_level} />
          <StatusBadge status={hazard.status} />
        </div>
        <p className="mt-1.5 truncate font-semibold">{CATEGORY_META[hazard.category].label}</p>
        <p className="flex items-center gap-1 truncate text-xs text-ink-2">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
          {hazard.location_label ?? `${hazard.latitude.toFixed(4)}, ${hazard.longitude.toFixed(4)}`}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
          <span>{timeAgo(hazard.created_at)}</span>
          {from && <span>· {formatDistance(distanceMeters(from, [hazard.latitude, hazard.longitude]))} away</span>}
          {hazard.is_demo && <span className="rounded bg-safety/15 px-1 text-[10px] font-bold uppercase text-safety">demo</span>}
        </p>
      </div>
    </>
  );
  const cls = clsx('flex w-full gap-3 rounded-2xl border p-3 text-left transition', active ? 'border-cyan/60 bg-cyan/5' : 'border-line bg-surface/60 hover:border-cyan/30 hover:bg-surface-2/70');
  if (to) return <Link to={to} className={cls}>{body}</Link>;
  return <button type="button" onClick={onClick} aria-pressed={active} className={cls}>{body}</button>;
}

export function SeverityBreakdown({ hazard }: { hazard: Hazard | HazardDetail }) {
  const hasPhoto = 'media' in hazard ? hazard.media.some((m) => m.evidence_type === 'report' && m.media_type === 'image') : Boolean(hazard.thumbnail_url);
  const open = hazard.status !== 'verified_resolved' && hazard.status !== 'dismissed';
  const r = computeSeverity({
    category: hazard.category, immediateDanger: hazard.immediate_danger, blocksRoad: hazard.blocks_road, exposure: hazard.exposure,
    hasPhoto, hasDescription: hazard.description.trim().length > 0, reportCount: 1 + hazard.corroborations,
    daysOpen: open ? (Date.now() - Date.parse(hazard.created_at)) / 86_400_000 : 0,
  });
  const m = SEVERITY_META[hazard.severity_level];
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-2">{hazard.severity_overridden ? 'Priority set by municipal staff' : 'Preliminary automated assessment'}</p>
          <p className="mt-1 flex items-baseline gap-2"><span className="font-mono text-4xl font-semibold" style={{ color: m.hex }}>{hazard.severity_score}</span><span className="text-ink-2">/ 100</span></p>
        </div>
        <SeverityBadge level={hazard.severity_level} />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${hazard.severity_score}%`, background: `linear-gradient(90deg, #36D9FF, ${m.hex})` }} />
      </div>
      {!hazard.severity_overridden && (
        <ul className="mt-4 space-y-1.5 text-sm">
          {r.factors.map((f) => (
            <li key={f.key} className="flex justify-between gap-3"><span className="text-ink-2">{f.label}</span><span className="font-mono">+{f.points}</span></li>
          ))}
          {r.floorApplied && <li className="rounded-lg border border-critical/30 bg-critical/5 px-2.5 py-1.5 text-xs text-critical">{r.floorApplied}</li>}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-3">Automated scores are preliminary. Only authorised municipal personnel confirm official urgency.</p>
    </div>
  );
}

export function LifecycleTracker({ status }: { status: Hazard['status'] }) {
  if (status === 'dismissed') return <p className="text-sm text-ink-2">This report was closed by moderators (for example as a duplicate).</p>;
  const reopened = status === 'reopened';
  const idx = reopened ? 1 : LIFECYCLE.indexOf(status);
  return (
    <ol className="grid grid-cols-7 gap-1" aria-label="Incident lifecycle">
      {LIFECYCLE.map((s, i) => {
        const done = i < idx || status === 'verified_resolved';
        const current = i === idx && status !== 'verified_resolved';
        return (
          <li key={s} className="flex flex-col items-center gap-1.5 text-center" aria-current={current ? 'step' : undefined}>
            <span className={clsx('grid h-7 w-7 place-items-center rounded-full border text-[11px] font-bold', done ? 'border-success bg-success text-midnight' : current ? 'border-cyan bg-cyan/15 text-cyan shadow-glow' : 'border-line text-ink-3')}>
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={clsx('hidden text-[10px] leading-tight sm:block', current ? 'text-ink' : 'text-ink-3')}>{STATUS_META[s].label}</span>
            <span className="sr-only">{STATUS_META[s].label}{done ? ' (done)' : current ? ' (current)' : ''}</span>
          </li>
        );
      })}
      {reopened && <li className="col-span-7 mt-2 text-center text-xs text-critical">Reopened after review — back in triage</li>}
    </ol>
  );
}

export function Timeline({ updates }: { updates: HazardUpdate[] }) {
  if (!updates.length) return <p className="text-sm text-ink-2">No activity yet.</p>;
  return (
    <ol className="relative space-y-5 border-l border-line pl-5">
      {updates.map((u) => (
        <li key={u.id} className="relative">
          <span className={clsx('absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-midnight', u.new_status === 'verified_resolved' ? 'bg-success' : u.kind === 'severity_override' || u.new_status === 'reopened' ? 'bg-critical' : u.internal ? 'bg-ink-3' : 'bg-cyan')} aria-hidden />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">
              {u.new_status ? STATUS_META[u.new_status].label : { note: 'Note', assignment: 'Assignment', severity_override: 'Priority override', corroboration: 'Confirmed by another person', verification: 'Verification', inspection: 'Inspection planned', evidence: 'Evidence added', flag: 'Flagged', status: 'Update' }[u.kind]}
            </span>
            {u.internal && <span className="rounded bg-white/10 px-1.5 text-[10px] font-bold uppercase text-ink-2">internal</span>}
          </div>
          {u.note && <p className="mt-0.5 text-sm text-ink-2">{u.note}</p>}
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
            <Clock className="h-3 w-3" aria-hidden />
            <time dateTime={u.created_at}>{fmtDateTime(u.created_at)}</time>
            {u.actor_name && <><Users className="ml-1 h-3 w-3" aria-hidden />{u.actor_name}</>}
          </p>
        </li>
      ))}
    </ol>
  );
}
