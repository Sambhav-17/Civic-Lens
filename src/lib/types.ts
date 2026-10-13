export const CATEGORIES = [
  'open_manhole',
  'electrical_wire',
  'pothole',
  'broken_footpath',
  'waterlogging',
  'drain_cover',
  'fallen_tree',
  'traffic_signal',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low'] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

export const STATUSES = [
  'reported',
  'triaged',
  'assigned',
  'in_progress',
  'repair_submitted',
  'verification_pending',
  'verified_resolved',
  'reopened',
  'dismissed',
] as const;
export type HazardStatus = (typeof STATUSES)[number];

export const ROLES = ['citizen', 'staff', 'reviewer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export type Exposure = 'pedestrians' | 'vehicles' | 'both' | 'unknown';

export interface Profile {
  id: string;
  display_name: string;
  email?: string;
  role: Role;
  team_id: string | null;
  email_verified: boolean;
  notify_email: boolean;
  created_at: string;
}

export interface Hazard {
  id: string;
  /** Human-friendly incident reference, e.g. CL-7K2Q9M */
  ref: string;
  reporter_id: string | null;
  category: Category;
  description: string;
  latitude: number;
  longitude: number;
  location_label: string | null;
  severity_score: number;
  severity_level: SeverityLevel;
  severity_overridden: boolean;
  immediate_danger: boolean;
  blocks_road: boolean;
  exposure: Exposure;
  accessibility_note: string | null;
  corroborations: number;
  status: HazardStatus;
  assigned_team_id: string | null;
  thumbnail_url: string | null;
  is_demo: boolean;
  flagged: boolean;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export type MediaType = 'image' | 'video' | 'audio';
export type EvidenceType = 'report' | 'before_repair' | 'after_repair' | 'supporting';

export interface HazardMedia {
  id: string;
  hazard_id: string;
  url: string;
  media_type: MediaType;
  evidence_type: EvidenceType;
  uploaded_by: string | null;
  uploader_name?: string | null;
  is_public: boolean;
  created_at: string;
}

export type UpdateKind = 'status' | 'note' | 'assignment' | 'severity_override' | 'corroboration' | 'verification' | 'inspection' | 'evidence' | 'flag';

export interface HazardUpdate {
  id: string;
  hazard_id: string;
  actor_id: string | null;
  actor_name: string | null;
  kind: UpdateKind;
  previous_status: HazardStatus | null;
  new_status: HazardStatus | null;
  note: string | null;
  internal: boolean;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  service_area: string;
  active: boolean;
}

export interface HazardAssignment {
  id: string;
  hazard_id: string;
  team_id: string;
  assigned_by: string;
  assigned_at: string;
}

export type VerificationDecision = 'approved' | 'rejected' | 'photo_requested';

export interface RepairVerification {
  id: string;
  hazard_id: string;
  reviewer_id: string;
  reviewer_name?: string | null;
  decision: VerificationDecision;
  notes: string;
  created_at: string;
}

export interface RepairSubmission {
  summary: string;
  completed_at: string;
  submitted_by: string;
  submitted_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  hazard_id: string | null;
  notification_type: 'status_change' | 'assignment' | 'verification' | 'system';
  message: string;
  read_at: string | null;
  created_at: string;
}

export interface HazardDetail extends Hazard {
  media: HazardMedia[];
  updates: HazardUpdate[];
  verifications: RepairVerification[];
  assignments: HazardAssignment[];
  repair: RepairSubmission | null;
  team: Team | null;
}
