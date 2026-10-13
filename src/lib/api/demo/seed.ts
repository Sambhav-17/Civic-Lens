import { computeSeverity } from '../../severity';
import type {
  AppNotification, Category, Exposure, Hazard, HazardAssignment, HazardMedia, HazardStatus, HazardUpdate,
  Profile, RepairSubmission, RepairVerification, Team,
} from '../../types';
import { LIFECYCLE } from '../../workflow';
import { demoImage } from './images';

/**
 * DEMO DATA — every incident below is fictional and flagged `is_demo: true`.
 * It is only ever loaded in local demo mode and never mixed with live reports.
 */

export interface StoredProfile extends Profile {
  password_hash: string;
  salt: string;
}

export interface DemoDB {
  version: number;
  profiles: StoredProfile[];
  teams: Team[];
  hazards: Hazard[];
  media: HazardMedia[];
  updates: HazardUpdate[];
  assignments: HazardAssignment[];
  verifications: RepairVerification[];
  repairs: Record<string, RepairSubmission>;
  notifications: AppNotification[];
  flags: { hazard_id: string; reason: string; by: string | null; at: string }[];
  rateLog: number[];
  sessionUserId: string | null;
}

export const DEMO_VERSION = 3;

/** Test accounts for demo mode (documented in README). */
export const DEMO_PASSWORD = 'Demo-pass-2026';
export const DEMO_ACCOUNTS = [
  { email: 'citizen@demo.civiclens.app', name: 'Asha (demo citizen)', role: 'citizen' as const, team: null },
  { email: 'staff@demo.civiclens.app', name: 'Ravi (demo roads crew)', role: 'staff' as const, team: 'team-roads' },
  { email: 'reviewer@demo.civiclens.app', name: 'Meera (demo reviewer)', role: 'reviewer' as const, team: null },
  { email: 'admin@demo.civiclens.app', name: 'Admin (demo)', role: 'admin' as const, team: null },
];

export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const TEAMS: Team[] = [
  { id: 'team-roads', name: 'Roads & Footpaths — East', service_area: 'East zone', active: true },
  { id: 'team-electric', name: 'Electrical Safety Cell', service_area: 'City-wide', active: true },
  { id: 'team-drains', name: 'Stormwater & Drains', service_area: 'Central & South', active: true },
  { id: 'team-forestry', name: 'Urban Forestry', service_area: 'City-wide', active: true },
  { id: 'team-traffic', name: 'Traffic Engineering', service_area: 'City-wide', active: true },
];

const TEAM_FOR: Record<Category, string> = {
  open_manhole: 'team-drains', drain_cover: 'team-drains', waterlogging: 'team-drains',
  electrical_wire: 'team-electric', pothole: 'team-roads', broken_footpath: 'team-roads',
  fallen_tree: 'team-forestry', traffic_signal: 'team-traffic', other: 'team-roads',
};

type SeedRow = [Category, string, number, number, HazardStatus, number, boolean, boolean, Exposure, string];
// [category, location, dLat, dLng, status, daysAgo, immediateDanger, blocksRoad, exposure, description]
const ROWS: SeedRow[] = [
  ['open_manhole', 'Near bus stop, 80 Feet Road (demo)', 0.012, 0.031, 'reported', 0.2, true, false, 'pedestrians', 'Manhole cover missing next to the bus stop. Hard to see after dark.'],
  ['electrical_wire', 'Service lane behind market (demo)', -0.006, 0.011, 'assigned', 1.1, true, false, 'both', 'Cable hanging low across the lane after last night’s storm.'],
  ['pothole', 'Junction near metro pillar 112 (demo)', 0.021, -0.004, 'in_progress', 4, false, true, 'vehicles', 'Deep pothole in the left lane, two-wheelers swerving.'],
  ['waterlogging', 'Underpass, Ring Road (demo)', -0.018, -0.022, 'triaged', 0.6, false, true, 'both', 'Knee-deep water in the underpass after rain.'],
  ['broken_footpath', 'School street footpath (demo)', 0.004, -0.017, 'verified_resolved', 19, false, false, 'pedestrians', 'Three slabs broken outside the school gate.'],
  ['drain_cover', 'Corner of 4th Cross (demo)', -0.011, 0.024, 'verification_pending', 6, false, false, 'pedestrians', 'Drain grate snapped, opening about 40 cm wide.'],
  ['fallen_tree', 'Park road (demo)', 0.027, 0.018, 'verified_resolved', 12, false, true, 'vehicles', 'Large branch blocking one lane.'],
  ['traffic_signal', 'Hospital junction (demo)', -0.002, -0.031, 'assigned', 2.5, true, false, 'both', 'Signal is blinking amber on all sides during peak hours.'],
  ['pothole', 'Main road outside mall (demo)', 0.016, 0.006, 'reported', 1.8, false, false, 'vehicles', 'Cluster of potholes across both lanes.'],
  ['open_manhole', 'Residential lane, 7th Main (demo)', -0.024, 0.008, 'repair_submitted', 3.2, false, false, 'pedestrians', 'Manhole partially open, cover cracked.'],
  ['electrical_wire', 'Transformer near playground (demo)', 0.008, 0.039, 'verified_resolved', 25, true, false, 'pedestrians', 'Transformer box door open with exposed wiring.'],
  ['waterlogging', 'Low-lying stretch near lake (demo)', -0.031, 0.029, 'reported', 0.1, false, true, 'both', 'Road flooded, water still rising.'],
  ['broken_footpath', 'Station approach (demo)', 0.033, -0.012, 'triaged', 7, false, false, 'pedestrians', 'Footpath caved in near the steps.'],
  ['other', 'Construction site edge (demo)', -0.014, -0.009, 'dismissed', 9, false, false, 'unknown', 'Debris near the road — duplicate of an earlier report.'],
  ['pothole', 'Flyover ramp (demo)', 0.002, 0.021, 'reopened', 15, false, true, 'vehicles', 'Pothole reappeared a week after patching.'],
  ['drain_cover', 'Market back lane (demo)', 0.019, 0.027, 'reported', 0.9, false, false, 'pedestrians', 'Grate missing, gap covered with a cardboard sheet.'],
  ['fallen_tree', 'College road (demo)', -0.028, -0.016, 'in_progress', 1.4, false, true, 'both', 'Whole tree down across the road after wind.'],
  ['traffic_signal', 'Ring road crossing (demo)', 0.025, -0.027, 'verified_resolved', 31, false, false, 'vehicles', 'Pedestrian signal head broken.'],
  ['pothole', 'Temple street (demo)', -0.007, -0.025, 'verified_resolved', 40, false, false, 'vehicles', 'Small pothole near the speed breaker.'],
  ['waterlogging', 'Bus depot entrance (demo)', 0.011, -0.036, 'assigned', 2.1, false, false, 'both', 'Standing water for 3 days, smells of sewage.'],
  ['electrical_wire', 'Street light pole 23 (demo)', -0.021, 0.036, 'reported', 0.4, false, false, 'pedestrians', 'Junction box open at the base of the light pole.'],
  ['broken_footpath', 'Hospital footpath (demo)', -0.004, -0.038, 'assigned', 5, false, false, 'pedestrians', 'Uneven slabs, difficult for wheelchairs.'],
  ['open_manhole', 'Market entrance (demo)', 0.029, 0.033, 'verified_resolved', 22, true, false, 'pedestrians', 'Open manhole right in the walking path.'],
  ['pothole', 'Outer lane, Service Road (demo)', -0.035, -0.003, 'triaged', 3.6, false, false, 'vehicles', 'Pothole about 1 m wide.'],
];

export async function buildSeed(center: [number, number]): Promise<DemoDB> {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const DAY = 86_400_000;

  const profiles: StoredProfile[] = [];
  for (const [i, a] of DEMO_ACCOUNTS.entries()) {
    const salt = `demo-salt-${i}`;
    profiles.push({
      id: `user-${a.role}`,
      display_name: a.name,
      email: a.email,
      role: a.role,
      team_id: a.team,
      email_verified: true,
      notify_email: false,
      created_at: iso(60 * DAY),
      salt,
      password_hash: await hashPassword(DEMO_PASSWORD, salt),
    });
  }

  const hazards: Hazard[] = [];
  const media: HazardMedia[] = [];
  const updates: HazardUpdate[] = [];
  const assignments: HazardAssignment[] = [];
  const verifications: RepairVerification[] = [];
  const repairs: Record<string, RepairSubmission> = {};
  const staff = profiles.find((p) => p.role === 'staff')!;
  const reviewer = profiles.find((p) => p.role === 'reviewer')!;
  const citizen = profiles.find((p) => p.role === 'citizen')!;

  ROWS.forEach(([category, label, dLat, dLng, status, daysAgo, danger, blocks, exposure, desc], i) => {
    const id = `demo-${String(i + 1).padStart(3, '0')}`;
    const createdMs = daysAgo * DAY;
    const created = iso(createdMs);
    const corroborations = i % 5 === 0 ? 3 : i % 3 === 0 ? 1 : 0;
    const resolved = status === 'verified_resolved';
    const sev = computeSeverity({
      category, immediateDanger: danger, blocksRoad: blocks, exposure, hasPhoto: true, hasDescription: true,
      reportCount: 1 + corroborations, daysOpen: resolved ? 0 : daysAgo,
    });

    // Build a consistent status history up to the current status.
    const path: HazardStatus[] =
      status === 'dismissed' ? ['reported', 'dismissed']
      : status === 'reopened' ? [...LIFECYCLE, 'reopened']
      : LIFECYCLE.slice(0, LIFECYCLE.indexOf(status) + 1);
    const step = createdMs / (path.length + 0.5);
    let teamId: string | null = null;
    path.forEach((s, k) => {
      const at = iso(createdMs - step * k);
      if (k === 0) {
        updates.push({ id: `${id}-u0`, hazard_id: id, actor_id: i % 4 === 0 ? null : citizen.id, actor_name: i % 4 === 0 ? 'Anonymous reporter' : citizen.display_name, kind: 'status', previous_status: null, new_status: 'reported', note: 'Report submitted', internal: false, created_at: at });
        return;
      }
      const actor = s === 'verified_resolved' || s === 'reopened' ? reviewer : staff;
      if (s === 'assigned') {
        teamId = TEAM_FOR[category];
        assignments.push({ id: `${id}-a`, hazard_id: id, team_id: teamId, assigned_by: staff.id, assigned_at: at });
      }
      if (s === 'repair_submitted') {
        repairs[id] = { summary: 'Area barricaded, damaged section replaced and surface levelled.', completed_at: at, submitted_by: staff.id, submitted_at: at };
        media.push({ id: `${id}-m-after`, hazard_id: id, url: demoImage(category, 'repaired', i + 1), media_type: 'image', evidence_type: 'after_repair', uploaded_by: staff.id, uploader_name: staff.display_name, is_public: true, created_at: at });
      }
      if (s === 'verified_resolved' || s === 'reopened') {
        verifications.push({ id: `${id}-v${k}`, hazard_id: id, reviewer_id: reviewer.id, reviewer_name: reviewer.display_name, decision: s === 'verified_resolved' ? 'approved' : 'rejected', notes: s === 'verified_resolved' ? 'After-repair photo matches the reported location; surface restored.' : 'Hazard has returned at the same spot — reopening.', created_at: at });
      }
      updates.push({
        id: `${id}-u${k}`, hazard_id: id, actor_id: actor.id, actor_name: actor.display_name, kind: s === 'assigned' ? 'assignment' : s === 'verified_resolved' ? 'verification' : 'status',
        previous_status: path[k - 1], new_status: s,
        note: s === 'triaged' ? 'Location confirmed from photo.' : s === 'assigned' ? `Assigned to ${TEAMS.find((t) => t.id === teamId)?.name}` : s === 'dismissed' ? 'Duplicate of an existing report.' : null,
        internal: false, created_at: at,
      });
    });

    media.unshift({ id: `${id}-m0`, hazard_id: id, url: demoImage(category, 'damaged', i + 1), media_type: 'image', evidence_type: 'report', uploaded_by: null, uploader_name: null, is_public: true, created_at: created });

    const lastUpdate = updates.filter((u) => u.hazard_id === id).at(-1)!.created_at;
    hazards.push({
      id,
      ref: `CL-DEMO${String(i + 1).padStart(2, '0')}`,
      reporter_id: i % 4 === 0 ? null : citizen.id,
      category,
      description: desc,
      latitude: center[0] + dLat,
      longitude: center[1] + dLng,
      location_label: label,
      severity_score: sev.score,
      severity_level: sev.level,
      severity_overridden: false,
      immediate_danger: danger,
      blocks_road: blocks,
      exposure,
      accessibility_note: category === 'broken_footpath' ? 'Wheelchair users must use the road here.' : null,
      corroborations,
      status,
      assigned_team_id: path.includes('assigned') && status !== 'dismissed' ? TEAM_FOR[category] : null,
      thumbnail_url: demoImage(category, 'damaged', i + 1),
      is_demo: true,
      flagged: false,
      created_at: created,
      updated_at: lastUpdate,
      resolved_at: resolved ? lastUpdate : null,
    });
  });

  const notifications: AppNotification[] = [
    { id: 'n1', user_id: citizen.id, hazard_id: 'demo-005', notification_type: 'verification', message: 'Your report CL-DEMO05 was verified as repaired.', read_at: null, created_at: iso(2 * DAY) },
    { id: 'n2', user_id: citizen.id, hazard_id: 'demo-003', notification_type: 'status_change', message: 'Repair work started on CL-DEMO03.', read_at: null, created_at: iso(DAY) },
  ];

  return {
    version: DEMO_VERSION, profiles, teams: TEAMS, hazards, media, updates, assignments, verifications, repairs,
    notifications, flags: [], rateLog: [], sessionUserId: null,
  };
}
