import { CATEGORY_META } from '../categories';
import { SEVERITY_META } from '../severity';
import type { Hazard } from '../types';
import type { HazardFilter, Paged } from './types';

export function matchesFilter(h: Hazard, f: HazardFilter): boolean {
  if (f.categories?.length && !f.categories.includes(h.category)) return false;
  if (f.severities?.length && !f.severities.includes(h.severity_level)) return false;
  if (f.statuses?.length && !f.statuses.includes(h.status)) return false;
  if (f.since && Date.parse(h.created_at) < Date.parse(f.since)) return false;
  if (f.assignedTeamId && h.assigned_team_id !== f.assignedTeamId) return false;
  if (f.reporterId && h.reporter_id !== f.reporterId) return false;
  if (f.bbox) {
    const [s, w, n, e] = f.bbox;
    if (h.latitude < s || h.latitude > n || h.longitude < w || h.longitude > e) return false;
  }
  if (f.search) {
    const q = f.search.toLowerCase().trim();
    const hay = [h.ref, h.location_label ?? '', h.description, CATEGORY_META[h.category].label].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function sortHazards(list: Hazard[], sort: HazardFilter['sort'] = 'severity'): Hazard[] {
  const out = [...list];
  switch (sort) {
    case 'newest':
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case 'oldest':
      return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
    case 'updated':
      return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    default:
      return out.sort(
        (a, b) =>
          SEVERITY_META[b.severity_level].rank - SEVERITY_META[a.severity_level].rank ||
          b.severity_score - a.severity_score ||
          a.created_at.localeCompare(b.created_at),
      );
  }
}

export function paginate<T>(items: T[], page = 1, pageSize = 500): Paged<T> {
  const p = Math.max(1, page);
  return { items: items.slice((p - 1) * pageSize, p * pageSize), total: items.length, page: p, pageSize };
}
