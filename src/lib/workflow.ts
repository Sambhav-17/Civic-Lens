import type { HazardStatus, Role } from './types';

/**
 * Incident lifecycle. Mirrored server-side in `transition_hazard` (SQL) and
 * the demo backend; the client uses it only to decide which buttons to show.
 *
 * Reported → Triaged → Assigned → In Progress → Repair Submitted →
 * Verification Pending → Verified Resolved   (+ Reopened, Dismissed)
 */
export const TRANSITIONS: Record<HazardStatus, HazardStatus[]> = {
  reported: ['triaged', 'dismissed'],
  triaged: ['assigned', 'dismissed'],
  assigned: ['in_progress', 'triaged'],
  in_progress: ['repair_submitted', 'assigned'],
  repair_submitted: ['verification_pending', 'in_progress'],
  verification_pending: ['verified_resolved', 'reopened'],
  verified_resolved: ['reopened'],
  reopened: ['triaged', 'assigned'],
  dismissed: ['reopened'],
};

/** Which roles may move an incident INTO a status. */
const REQUIRED_ROLE: Record<HazardStatus, Role[]> = {
  reported: [],
  triaged: ['staff', 'reviewer', 'admin'],
  assigned: ['staff', 'reviewer', 'admin'],
  in_progress: ['staff', 'reviewer', 'admin'],
  repair_submitted: ['staff', 'reviewer', 'admin'],
  verification_pending: ['staff', 'reviewer', 'admin'],
  // Only an authorised reviewer can confirm a repair or reopen after review.
  verified_resolved: ['reviewer', 'admin'],
  reopened: ['reviewer', 'admin'],
  dismissed: ['staff', 'reviewer', 'admin'],
};

export function canTransition(from: HazardStatus, to: HazardStatus, role: Role | null | undefined): boolean {
  if (!role) return false;
  return TRANSITIONS[from].includes(to) && REQUIRED_ROLE[to].includes(role);
}

export function allowedNext(from: HazardStatus, role: Role | null | undefined): HazardStatus[] {
  return TRANSITIONS[from].filter((to) => canTransition(from, to, role));
}

export const isStaff = (role?: Role | null) => role === 'staff' || role === 'reviewer' || role === 'admin';
export const isReviewer = (role?: Role | null) => role === 'reviewer' || role === 'admin';
export const isAdmin = (role?: Role | null) => role === 'admin';

export const OPEN_STATUSES: HazardStatus[] = ['reported', 'triaged', 'assigned', 'in_progress', 'repair_submitted', 'verification_pending', 'reopened'];
export const isOpen = (s: HazardStatus) => OPEN_STATUSES.includes(s);

export const LIFECYCLE: HazardStatus[] = ['reported', 'triaged', 'assigned', 'in_progress', 'repair_submitted', 'verification_pending', 'verified_resolved'];

export const STATUS_META: Record<HazardStatus, { label: string; tone: 'cyan' | 'orange' | 'red' | 'green' | 'muted' }> = {
  reported: { label: 'Reported', tone: 'orange' },
  triaged: { label: 'Triaged', tone: 'cyan' },
  assigned: { label: 'Assigned', tone: 'cyan' },
  in_progress: { label: 'In progress', tone: 'cyan' },
  repair_submitted: { label: 'Repair submitted', tone: 'cyan' },
  verification_pending: { label: 'Verification pending', tone: 'orange' },
  verified_resolved: { label: 'Verified resolved', tone: 'green' },
  reopened: { label: 'Reopened', tone: 'red' },
  dismissed: { label: 'Dismissed', tone: 'muted' },
};
