import type {
  AppNotification, Category, EvidenceType, Hazard, HazardAssignment, HazardDetail, HazardStatus, HazardUpdate,
  Profile, RepairVerification, Role, SeverityLevel, Team, VerificationDecision,
} from '../types';
import type { NewHazardInput } from '../validation';

export type BackendMode = 'supabase' | 'demo';

export interface Session {
  user: Profile;
}

export interface HazardFilter {
  categories?: Category[];
  severities?: SeverityLevel[];
  statuses?: HazardStatus[];
  /** ISO date; only hazards created at or after this time. */
  since?: string;
  search?: string;
  assignedTeamId?: string;
  reporterId?: string;
  bbox?: [number, number, number, number];
  sort?: 'severity' | 'newest' | 'oldest' | 'updated';
  page?: number;
  pageSize?: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PublicStats {
  total: number;
  criticalOpen: number;
  verifiedRepairs: number;
  /** Mean hours from report to verified resolution; null when nothing has been resolved yet. */
  avgResolutionHours: number | null;
}

export interface AnalyticsDataset {
  hazards: Hazard[];
  updates: HazardUpdate[];
  assignments: HazardAssignment[];
  verifications: RepairVerification[];
  teams: Team[];
}

export type MediaUploadProgress = (fileIndex: number, fraction: number) => void;

export interface SubmitResult {
  hazard: Hazard;
  /** Media that failed to upload; the report itself was saved. */
  failedUploads: string[];
}

export type RealtimeEvent =
  | { type: 'hazard_upsert'; hazard: Hazard }
  | { type: 'hazard_update'; hazardId: string }
  | { type: 'notification'; notification: AppNotification };

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'local';

export class ApiError extends Error {
  constructor(message: string, public code: 'unauthorized' | 'forbidden' | 'not_found' | 'invalid' | 'rate_limited' | 'conflict' | 'network' | 'unknown' = 'unknown') {
    super(message);
  }
}

export interface CivicApi {
  mode: BackendMode;

  // ── Auth ─────────────────────────────────────────────
  getSession(): Promise<Session | null>;
  onAuthChange(cb: (s: Session | null) => void): () => void;
  signIn(email: string, password: string): Promise<Session>;
  signUp(email: string, password: string, displayName: string): Promise<{ session: Session | null; needsEmailVerification: boolean }>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updateProfile(patch: Partial<Pick<Profile, 'display_name' | 'notify_email'>>): Promise<Profile>;

  // ── Hazards (public) ─────────────────────────────────
  listHazards(filter?: HazardFilter): Promise<Paged<Hazard>>;
  getHazard(id: string): Promise<HazardDetail | null>;
  findDuplicates(category: Category, lat: number, lng: number): Promise<Hazard[]>;
  submitHazard(input: NewHazardInput, files: File[], onProgress?: MediaUploadProgress): Promise<SubmitResult>;
  corroborate(hazardId: string): Promise<Hazard>;
  flagHazard(hazardId: string, reason: string): Promise<void>;
  getPublicStats(): Promise<PublicStats>;

  // ── Municipal workflow (server-enforced roles) ──────
  transition(hazardId: string, to: HazardStatus, note?: string): Promise<Hazard>;
  assign(hazardId: string, teamId: string, note?: string): Promise<Hazard>;
  overrideSeverity(hazardId: string, level: SeverityLevel, reason: string): Promise<Hazard>;
  addNote(hazardId: string, note: string, internal: boolean): Promise<void>;
  recordInspection(hazardId: string, plannedFor: string, note: string): Promise<void>;
  uploadEvidence(hazardId: string, files: File[], evidence: EvidenceType, onProgress?: MediaUploadProgress): Promise<void>;
  submitRepair(hazardId: string, summary: string, completedAt: string, files: File[], onProgress?: MediaUploadProgress): Promise<Hazard>;
  decideVerification(hazardId: string, decision: VerificationDecision, notes: string): Promise<Hazard>;
  setMediaPublic(mediaId: string, isPublic: boolean): Promise<void>;
  getAnalytics(): Promise<AnalyticsDataset>;

  // ── Teams & people ───────────────────────────────────
  listTeams(): Promise<Team[]>;
  upsertTeam(team: Partial<Team> & { name: string; service_area: string }): Promise<Team>;
  listProfiles(): Promise<Profile[]>;
  setRole(userId: string, role: Role, teamId: string | null): Promise<void>;

  // ── Notifications ────────────────────────────────────
  listNotifications(): Promise<AppNotification[]>;
  markNotificationRead(id: string | 'all'): Promise<void>;

  // ── Realtime ─────────────────────────────────────────
  subscribe(cb: (e: RealtimeEvent) => void): () => void;
  onConnectionChange(cb: (s: ConnectionState) => void): () => void;
  getConnectionState(): ConnectionState;
  reconnect(): void;

  // ── Demo only ────────────────────────────────────────
  resetDemo?(): Promise<void>;
}
