import { CATEGORY_META } from './categories';
import { SEVERITY_META } from './severity';
import type { AnalyticsDataset } from './api/types';
import { CATEGORIES, SEVERITY_LEVELS, type Hazard } from './types';
import { isOpen } from './workflow';

export interface AnalyticsFilter {
  from?: string;
  to?: string;
  category?: string;
  teamId?: string;
  locality?: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Short locality name from a location label ("…, Locality (demo)"). */
export const localityOf = (h: Hazard) => {
  const label = (h.location_label ?? '').replace(/\s*\(demo\)\s*/i, '');
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return 'Unlabelled';
  return parts.length > 2 ? parts[parts.length - 2] : parts[parts.length - 1];
};

export function filterDataset(ds: AnalyticsDataset, f: AnalyticsFilter): Hazard[] {
  return ds.hazards.filter((h) => {
    if (f.from && h.created_at < f.from) return false;
    if (f.to && h.created_at > f.to) return false;
    if (f.category && h.category !== f.category) return false;
    if (f.teamId && h.assigned_team_id !== f.teamId) return false;
    if (f.locality && localityOf(h) !== f.locality) return false;
    return true;
  });
}

export function computeAnalytics(ds: AnalyticsDataset, f: AnalyticsFilter, bucket: 'day' | 'week' | 'month' = 'day') {
  const hz = filterDataset(ds, f);
  const ids = new Set(hz.map((h) => h.id));
  const updates = ds.updates.filter((u) => ids.has(u.hazard_id));
  const verifs = ds.verifications.filter((v) => ids.has(v.hazard_id));

  const byCategory = CATEGORIES.map((c) => ({ key: c, name: CATEGORY_META[c].short, count: hz.filter((h) => h.category === c).length })).filter((x) => x.count > 0);
  const bySeverity = SEVERITY_LEVELS.map((s) => ({ key: s, name: SEVERITY_META[s].label, count: hz.filter((h) => h.severity_level === s).length, fill: SEVERITY_META[s].hex }));

  const keyFor = (iso: string) => {
    const d = new Date(iso);
    if (bucket === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (bucket === 'week') {
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
      return t.toISOString().slice(0, 10);
    }
    return iso.slice(0, 10);
  };
  const timeline = new Map<string, { period: string; reported: number; resolved: number }>();
  hz.forEach((h) => {
    const k = keyFor(h.created_at);
    timeline.set(k, { period: k, reported: (timeline.get(k)?.reported ?? 0) + 1, resolved: timeline.get(k)?.resolved ?? 0 });
    if (h.resolved_at) {
      const r = keyFor(h.resolved_at);
      const cur = timeline.get(r) ?? { period: r, reported: 0, resolved: 0 };
      timeline.set(r, { ...cur, resolved: cur.resolved + 1 });
    }
  });
  const overTime = [...timeline.values()].sort((a, b) => a.period.localeCompare(b.period));

  const resolved = hz.filter((h) => h.resolved_at);
  const resolutionHours = resolved.map((h) => (Date.parse(h.resolved_at!) - Date.parse(h.created_at)) / 3_600_000);
  const assignHours = hz
    .map((h) => {
      const a = ds.assignments.filter((x) => x.hazard_id === h.id).sort((x, y) => x.assigned_at.localeCompare(y.assigned_at))[0];
      return a ? (Date.parse(a.assigned_at) - Date.parse(h.created_at)) / 3_600_000 : null;
    })
    .filter((x): x is number => x !== null && x >= 0);

  const resolutionByCategory = CATEGORIES.map((c) => {
    const xs = resolved.filter((h) => h.category === c).map((h) => (Date.parse(h.resolved_at!) - Date.parse(h.created_at)) / 3_600_000);
    return { name: CATEGORY_META[c].short, hours: median(xs), n: xs.length };
  }).filter((x) => x.n > 0);

  const localities = new Map<string, { name: string; open: number; total: number; reopened: number }>();
  hz.forEach((h) => {
    const k = localityOf(h);
    const cur = localities.get(k) ?? { name: k, open: 0, total: 0, reopened: 0 };
    cur.total += 1;
    if (isOpen(h.status)) cur.open += 1;
    if (updates.some((u) => u.hazard_id === h.id && u.new_status === 'reopened')) cur.reopened += 1;
    localities.set(k, cur);
  });
  const byLocality = [...localities.values()].sort((a, b) => b.open - a.open || b.total - a.total);

  // Repeat-problem locations: grid cells (~110 m) with 2+ reports.
  const cells = new Map<string, { lat: number; lng: number; count: number; label: string }>();
  hz.forEach((h) => {
    const k = `${h.latitude.toFixed(3)},${h.longitude.toFixed(3)}`;
    const c = cells.get(k) ?? { lat: h.latitude, lng: h.longitude, count: 0, label: h.location_label ?? k };
    c.count += 1 + h.corroborations;
    cells.set(k, c);
  });
  const repeatLocations = [...cells.values()].filter((c) => c.count >= 2).sort((a, b) => b.count - a.count).slice(0, 8);

  const teamWorkload = ds.teams.map((t) => ({
    name: t.name.replace(/ — .*/, ''),
    open: hz.filter((h) => h.assigned_team_id === t.id && isOpen(h.status)).length,
    resolved: hz.filter((h) => h.assigned_team_id === t.id && h.status === 'verified_resolved').length,
  })).filter((t) => t.open + t.resolved > 0);

  const decided = verifs.filter((v) => v.decision !== 'photo_requested');
  const approved = decided.filter((v) => v.decision === 'approved').length;
  const reopenedCount = new Set(updates.filter((u) => u.new_status === 'reopened').map((u) => u.hazard_id)).size;

  // High-risk segments: severity-weighted open load per locality.
  const highRisk = byLocality
    .map((l) => ({ name: l.name, risk: hz.filter((h) => localityOf(h) === l.name && isOpen(h.status)).reduce((s, h) => s + h.severity_score, 0) }))
    .filter((x) => x.risk > 0)
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 6);

  return {
    total: hz.length,
    open: hz.filter((h) => isOpen(h.status)).length,
    hazards: hz,
    byCategory, bySeverity, overTime, byLocality, repeatLocations, teamWorkload, resolutionByCategory, highRisk,
    medianResolutionHours: median(resolutionHours),
    medianAssignHours: median(assignHours),
    verificationRate: decided.length ? approved / decided.length : null,
    verificationsDecided: decided.length,
    reopenedCount,
    localities: [...localities.keys()].sort(),
  };
}
