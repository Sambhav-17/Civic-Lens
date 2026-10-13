import { config, LIMITS } from '../../config';
import { distanceMeters } from '../../geo';
import { makeRef, uuid } from '../../format';
import { compressImage, fileToDataUrl, sniffImage, validateMedia, withTimeout } from '../../media';
import { computeSeverity, levelFor, DEFAULT_WEIGHTS } from '../../severity';
import type {
  AppNotification, Hazard, HazardDetail, HazardMedia, HazardStatus, HazardUpdate, Profile, SeverityLevel, UpdateKind,
} from '../../types';
import { canTransition, isAdmin, isReviewer, isStaff } from '../../workflow';
import { newHazardSchema, noteSchema, reasonSchema, repairSchema, teamSchema } from '../../validation';
import { matchesFilter, paginate, sortHazards } from '../query';
import { ApiError, type CivicApi, type ConnectionState, type RealtimeEvent, type Session } from '../types';
import { blobs } from './blobs';
import { buildSeed, DEMO_VERSION, hashPassword, type DemoDB, type StoredProfile } from './seed';

/**
 * Local DEMO backend.
 *
 * Emulates the Supabase backend inside the browser so the whole product can be
 * explored without credentials. It applies the same rules as the SQL functions
 * (role checks, workflow transitions, server-side severity, rate limits,
 * duplicate detection) using the session it holds — never a role or score
 * supplied by the caller. It is NOT a security boundary: real enforcement lives
 * in Postgres RLS + SECURITY DEFINER functions (supabase/migrations).
 */
const KEY = 'civiclens-demo-db';
const CHANNEL = 'civiclens-demo-sync';

const strip = (p: StoredProfile): Profile => {
  const { password_hash: _h, salt: _s, ...rest } = p;
  void _h; void _s;
  return rest;
};

export function createDemoApi(storage: Storage = localStorage): CivicApi {
  let db: DemoDB | null = null;
  const authListeners = new Set<(s: Session | null) => void>();
  const listeners = new Set<(e: RealtimeEvent) => void>();
  const connListeners = new Set<(s: ConnectionState) => void>();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;

  channel?.addEventListener('message', (ev: MessageEvent<RealtimeEvent | { type: 'reload' }>) => {
    db = null; // another tab wrote — reload lazily from storage
    if (ev.data.type === 'reload') {
      void getSession().then((s) => authListeners.forEach((l) => l(s)));
      return;
    }
    listeners.forEach((l) => l(ev.data as RealtimeEvent));
  });

  async function load(): Promise<DemoDB> {
    if (db) return db;
    const raw = storage.getItem(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as DemoDB;
        if (parsed.version === DEMO_VERSION) return (db = parsed);
      } catch {
        /* fall through and reseed */
      }
    }
    db = await buildSeed(config.defaultCenter);
    save();
    return db;
  }

  function save() {
    if (!db) return;
    try {
      storage.setItem(KEY, JSON.stringify(db));
    } catch {
      throw new ApiError('Local demo storage is full. Reset the demo data from your profile page.', 'unknown');
    }
  }

  function emit(e: RealtimeEvent) {
    listeners.forEach((l) => l(e));
    channel?.postMessage(e);
  }

  async function me(): Promise<StoredProfile | null> {
    const d = await load();
    return d.profiles.find((p) => p.id === d.sessionUserId) ?? null;
  }

  async function requireUser(): Promise<StoredProfile> {
    const u = await me();
    if (!u) throw new ApiError('Please sign in to continue.', 'unauthorized');
    return u;
  }

  async function requireStaff(): Promise<StoredProfile> {
    const u = await requireUser();
    if (!isStaff(u.role)) throw new ApiError('Only municipal staff can do this.', 'forbidden');
    return u;
  }

  function getHazardOrThrow(d: DemoDB, id: string): Hazard {
    const h = d.hazards.find((x) => x.id === id || x.ref === id);
    if (!h) throw new ApiError('Incident not found.', 'not_found');
    return h;
  }

  function log(d: DemoDB, h: Hazard, actor: Profile | null, kind: UpdateKind, note: string | null, prev: HazardStatus | null = null, next: HazardStatus | null = null, internal = false) {
    d.updates.push({ id: uuid(), hazard_id: h.id, actor_id: actor?.id ?? null, actor_name: actor?.display_name ?? 'Anonymous reporter', kind, previous_status: prev, new_status: next, note, internal, created_at: new Date().toISOString() });
    h.updated_at = new Date().toISOString();
  }

  function notifyReporter(d: DemoDB, h: Hazard, message: string, type: AppNotification['notification_type'] = 'status_change') {
    if (!h.reporter_id) return;
    const n: AppNotification = { id: uuid(), user_id: h.reporter_id, hazard_id: h.id, notification_type: type, message, read_at: null, created_at: new Date().toISOString() };
    d.notifications.push(n);
    emit({ type: 'notification', notification: n });
  }

  /** Recompute the automated score (unless an authorised override is in force). */
  function rescore(d: DemoDB, h: Hazard) {
    if (h.severity_overridden) return;
    const hasPhoto = d.media.some((m) => m.hazard_id === h.id && m.evidence_type === 'report' && m.media_type === 'image');
    const open = h.status !== 'verified_resolved' && h.status !== 'dismissed';
    const r = computeSeverity({
      category: h.category, immediateDanger: h.immediate_danger, blocksRoad: h.blocks_road, exposure: h.exposure,
      hasPhoto, hasDescription: h.description.trim().length > 0, reportCount: 1 + h.corroborations,
      daysOpen: open ? (Date.now() - Date.parse(h.created_at)) / 86_400_000 : 0,
    });
    h.severity_score = r.score;
    h.severity_level = r.level;
  }

  async function storeFiles(d: DemoDB, h: Hazard, files: File[], evidence: HazardMedia['evidence_type'], uploader: Profile | null, onProgress?: (i: number, f: number) => void) {
    const failed: string[] = [];
    for (const [i, raw] of files.entries()) {
      try {
        const type = validateMedia(raw);
        if (type === 'image' && !(await sniffImage(raw))) throw new Error(`“${raw.name}” doesn’t look like a real image file.`);
        onProgress?.(i, 0.1);
        const file = type === 'image' ? await compressImage(raw, (p) => onProgress?.(i, 0.1 + (p / 100) * 0.6)) : raw;
        const dataUrl = await fileToDataUrl(file);
        const id = uuid();
        await blobs.put(id, dataUrl);
        d.media.push({ id, hazard_id: h.id, url: `idb:${id}`, media_type: type, evidence_type: evidence, uploaded_by: uploader?.id ?? null, uploader_name: uploader?.display_name ?? null, is_public: evidence !== 'supporting' || type !== 'audio', created_at: new Date().toISOString() });
        if (type === 'image' && !h.thumbnail_url && evidence === 'report') h.thumbnail_url = await makeThumb(dataUrl);
        onProgress?.(i, 1);
      } catch (e) {
        failed.push(e instanceof Error ? e.message : raw.name);
        onProgress?.(i, -1);
      }
    }
    return failed;
  }

  async function resolveMedia(m: HazardMedia): Promise<HazardMedia> {
    if (!m.url.startsWith('idb:')) return m;
    const url = (await blobs.get(m.url.slice(4)).catch(() => undefined)) ?? '';
    return { ...m, url };
  }

  async function getSession(): Promise<Session | null> {
    const u = await me();
    return u ? { user: strip(u) } : null;
  }

  const setConn = (s: ConnectionState) => connListeners.forEach((l) => l(s));

  const api: CivicApi = {
    mode: 'demo',

    getSession,
    onAuthChange(cb) {
      authListeners.add(cb);
      return () => authListeners.delete(cb);
    },
    async signIn(email, password) {
      const d = await load();
      const p = d.profiles.find((x) => x.email?.toLowerCase() === email.trim().toLowerCase());
      if (!p || (await hashPassword(password, p.salt)) !== p.password_hash) throw new ApiError('Email or password is incorrect.', 'unauthorized');
      d.sessionUserId = p.id;
      save();
      const s = { user: strip(p) };
      authListeners.forEach((l) => l(s));
      channel?.postMessage({ type: 'reload' });
      return s;
    },
    async signUp(email, password, displayName) {
      const d = await load();
      if (d.profiles.some((x) => x.email?.toLowerCase() === email.trim().toLowerCase())) throw new ApiError('An account with this email already exists.', 'conflict');
      const salt = uuid();
      const p: StoredProfile = {
        id: uuid(), display_name: displayName.trim(), email: email.trim(), role: 'citizen', team_id: null,
        email_verified: false, notify_email: true, created_at: new Date().toISOString(), salt, password_hash: await hashPassword(password, salt),
      };
      d.profiles.push(p);
      d.sessionUserId = p.id;
      save();
      const s = { user: strip(p) };
      authListeners.forEach((l) => l(s));
      return { session: s, needsEmailVerification: false };
    },
    async signOut() {
      const d = await load();
      d.sessionUserId = null;
      save();
      authListeners.forEach((l) => l(null));
      channel?.postMessage({ type: 'reload' });
    },
    async requestPasswordReset() {
      throw new ApiError('Password reset emails need the Supabase backend. In demo mode, use one of the demo accounts listed on the sign-in page.', 'invalid');
    },
    async updateProfile(patch) {
      const d = await load();
      const u = await requireUser();
      if (patch.display_name !== undefined) {
        const name = patch.display_name.trim();
        if (name.length < 2 || name.length > 60) throw new ApiError('Display name must be 2–60 characters.', 'invalid');
        u.display_name = name;
      }
      if (patch.notify_email !== undefined) u.notify_email = patch.notify_email;
      save();
      const s = { user: strip(u) };
      authListeners.forEach((l) => l(s));
      void d;
      return s.user;
    },

    async listHazards(filter = {}) {
      const d = await load();
      const u = await me();
      // Reporter history is private: only the reporter (or staff) may filter by reporter.
      if (filter.reporterId && filter.reporterId !== u?.id && !isStaff(u?.role)) throw new ApiError('Not allowed.', 'forbidden');
      d.hazards.forEach((h) => rescore(d, h));
      const visible = d.hazards.filter((h) => isStaff(u?.role) || h.status !== 'dismissed' || h.reporter_id === u?.id);
      const list = sortHazards(visible.filter((h) => matchesFilter(h, filter)), filter.sort);
      const page = paginate(list, filter.page, filter.pageSize);
      // Never expose reporter identity publicly.
      if (!isStaff(u?.role)) page.items = page.items.map((h) => ({ ...h, reporter_id: h.reporter_id === u?.id ? h.reporter_id : null }));
      return page;
    },

    async getHazard(id) {
      const d = await load();
      const u = await me();
      const h = d.hazards.find((x) => x.id === id || x.ref === id);
      if (!h) return null;
      rescore(d, h);
      const staff = isStaff(u?.role);
      const media = await Promise.all(d.media.filter((m) => m.hazard_id === h.id && (staff || m.is_public)).map(resolveMedia));
      const updates = d.updates
        .filter((x) => x.hazard_id === h.id && (staff || !x.internal))
        .map((x) => (staff ? x : { ...x, actor_name: x.actor_id && x.actor_id === h.reporter_id ? 'Reporter' : x.actor_id ? 'Municipal team' : 'Anonymous reporter' }))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const detail: HazardDetail = {
        ...h,
        reporter_id: staff || h.reporter_id === u?.id ? h.reporter_id : null,
        media,
        updates,
        verifications: d.verifications.filter((v) => v.hazard_id === h.id).map((v) => (staff ? v : { ...v, reviewer_name: 'Authorised reviewer' })),
        assignments: d.assignments.filter((a) => a.hazard_id === h.id),
        repair: d.repairs[h.id] ?? null,
        team: d.teams.find((t) => t.id === h.assigned_team_id) ?? null,
      };
      return detail;
    },

    async findDuplicates(category, lat, lng) {
      const d = await load();
      const cutoff = Date.now() - LIMITS.duplicateWindowH * 3_600_000;
      return d.hazards.filter(
        (h) => h.category === category && h.status !== 'verified_resolved' && h.status !== 'dismissed' &&
          Date.parse(h.created_at) >= cutoff && distanceMeters([lat, lng], [h.latitude, h.longitude]) <= LIMITS.duplicateRadiusM,
      );
    },

    async submitHazard(input, files, onProgress) {
      const parsed = newHazardSchema.safeParse(input);
      if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? 'Invalid report.', 'invalid');
      const d = await load();
      const now = Date.now();
      d.rateLog = d.rateLog.filter((t) => now - t < LIMITS.rateWindowMs);
      if (d.rateLog.length >= LIMITS.reportsPerWindow) throw new ApiError('You’ve sent several reports in a few minutes. Please wait a little before sending another.', 'rate_limited');
      if (files.length > LIMITS.maxImages + 2) throw new ApiError('Too many files attached.', 'invalid');
      const u = await me();
      const v = parsed.data;
      const ts = new Date().toISOString();
      const h: Hazard = {
        id: uuid(), ref: makeRef(), reporter_id: v.anonymous ? null : u?.id ?? null, category: v.category, description: v.description,
        latitude: v.latitude, longitude: v.longitude, location_label: v.location_label, severity_score: 0, severity_level: 'low',
        severity_overridden: false, immediate_danger: v.immediate_danger, blocks_road: v.blocks_road, exposure: v.exposure,
        accessibility_note: v.accessibility_note, corroborations: 0, status: 'reported', assigned_team_id: null, thumbnail_url: null,
        is_demo: true, flagged: false, created_at: ts, updated_at: ts, resolved_at: null,
      };
      d.hazards.push(h);
      log(d, h, v.anonymous ? null : u, 'status', 'Report submitted', null, 'reported');
      const failedUploads = await storeFiles(d, h, files, 'report', v.anonymous ? null : u, onProgress);
      rescore(d, h);
      d.rateLog.push(now);
      save();
      emit({ type: 'hazard_upsert', hazard: h });
      return { hazard: { ...h }, failedUploads };
    },

    async corroborate(hazardId) {
      const d = await load();
      const h = getHazardOrThrow(d, hazardId);
      const key = `civiclens-corroborated-${h.id}`;
      if (storage.getItem(key)) throw new ApiError('You’ve already confirmed this hazard from this device.', 'conflict');
      h.corroborations += 1;
      log(d, h, await me(), 'corroboration', 'Another person confirmed this hazard');
      rescore(d, h);
      storage.setItem(key, '1');
      save();
      emit({ type: 'hazard_upsert', hazard: h });
      return { ...h };
    },

    async flagHazard(hazardId, reason) {
      const r = reasonSchema.safeParse(reason);
      if (!r.success) throw new ApiError(r.error.issues[0].message, 'invalid');
      const d = await load();
      const h = getHazardOrThrow(d, hazardId);
      const u = await me();
      d.flags.push({ hazard_id: h.id, reason: r.data, by: u?.id ?? null, at: new Date().toISOString() });
      h.flagged = true;
      log(d, h, u, 'flag', `Flagged for moderation: ${r.data}`, null, null, true);
      save();
      emit({ type: 'hazard_update', hazardId: h.id });
    },

    async getPublicStats() {
      const d = await load();
      const live = d.hazards.filter((h) => h.status !== 'dismissed');
      live.forEach((h) => rescore(d, h));
      const resolved = live.filter((h) => h.status === 'verified_resolved' && h.resolved_at);
      return {
        total: live.length,
        criticalOpen: live.filter((h) => h.severity_level === 'critical' && h.status !== 'verified_resolved').length,
        verifiedRepairs: resolved.length,
        avgResolutionHours: resolved.length
          ? resolved.reduce((s, h) => s + (Date.parse(h.resolved_at!) - Date.parse(h.created_at)), 0) / resolved.length / 3_600_000
          : null,
      };
    },

    async transition(hazardId, to, note) {
      const d = await load();
      const u = await requireStaff();
      const h = getHazardOrThrow(d, hazardId);
      if (!canTransition(h.status, to, u.role)) throw new ApiError(`Can’t move from “${h.status}” to “${to}” with your role.`, 'forbidden');
      if (to === 'verified_resolved') throw new ApiError('Use the verification review to resolve an incident.', 'invalid');
      if (to === 'repair_submitted') throw new ApiError('Submit repair evidence to mark a repair as submitted.', 'invalid');
      if (to === 'assigned' && !h.assigned_team_id) throw new ApiError('Assign a team first.', 'invalid');
      const prev = h.status;
      h.status = to;
      if (to === 'reopened') h.resolved_at = null;
      log(d, h, u, 'status', note?.trim() || null, prev, to);
      notifyReporter(d, h, `Your report ${h.ref} is now “${to.replace(/_/g, ' ')}”.`);
      save();
      emit({ type: 'hazard_upsert', hazard: h });
      return { ...h };
    },

    async assign(hazardId, teamId, note) {
      const d = await load();
      const u = await requireStaff();
      const h = getHazardOrThrow(d, hazardId);
      const team = d.teams.find((t) => t.id === teamId && t.active);
      if (!team) throw new ApiError('Choose an active team.', 'invalid');
      if (!['triaged', 'assigned', 'reopened', 'in_progress'].includes(h.status)) throw new ApiError('Triage the incident before assigning it.', 'invalid');
      const prev = h.status;
      h.assigned_team_id = team.id;
      d.assignments.push({ id: uuid(), hazard_id: h.id, team_id: team.id, assigned_by: u.id, assigned_at: new Date().toISOString() });
      if (prev === 'triaged' || prev === 'reopened') h.status = 'assigned';
      log(d, h, u, 'assignment', `Assigned to ${team.name}${note ? ` — ${note}` : ''}`, prev, h.status);
      notifyReporter(d, h, `A repair team was assigned to ${h.ref}.`, 'assignment');
      save();
      emit({ type: 'hazard_upsert', hazard: h });
      return { ...h };
    },

    async overrideSeverity(hazardId, level: SeverityLevel, reason) {
      const r = reasonSchema.safeParse(reason);
      if (!r.success) throw new ApiError(r.error.issues[0].message, 'invalid');
      const d = await load();
      const u = await requireStaff();
      const h = getHazardOrThrow(d, hazardId);
      const t = DEFAULT_WEIGHTS.thresholds;
      const score = { critical: Math.max(t.critical, 90), high: t.high + 5, medium: t.medium + 5, low: 15 }[level];
      const prevLevel = h.severity_level;
      h.severity_overridden = true;
      h.severity_score = score;
      h.severity_level = levelFor(score);
      log(d, h, u, 'severity_override', `Priority changed ${prevLevel} → ${level}. Reason: ${r.data}`, null, null, true);
      save();
      emit({ type: 'hazard_upsert', hazard: h });
      return { ...h };
    },

    async addNote(hazardId, note, internal) {
      const n = noteSchema.safeParse(note);
      if (!n.success) throw new ApiError(n.error.issues[0].message, 'invalid');
      const d = await load();
      const u = await requireStaff();
      const h = getHazardOrThrow(d, hazardId);
      log(d, h, u, 'note', n.data, null, null, internal);
      save();
      emit({ type: 'hazard_update', hazardId: h.id });
    },

    async recordInspection(hazardId, plannedFor, note) {
      const d = await load();
      const u = await requireStaff();
      const h = getHazardOrThrow(d, hazardId);
      if (Number.isNaN(Date.parse(plannedFor))) throw new ApiError('Choose a valid inspection date.', 'invalid');
      log(d, h, u, 'inspection', `Inspection planned for ${new Date(plannedFor).toLocaleString()}${note ? ` — ${note}` : ''}`, null, null, false);
      save();
      emit({ type: 'hazard_update', hazardId: h.id });
    },

    async uploadEvidence(hazardId, files, evidence, onProgress) {
      const d = await load();
      const u = await requireStaff();
      const h = getHazardOrThrow(d, hazardId);
      if (!files.length) throw new ApiError('Choose at least one photo.', 'invalid');
      const failed = await storeFiles(d, h, files, evidence, u, onProgress);
      if (failed.length === files.length) throw new ApiError(failed[0], 'invalid');
      log(d, h, u, 'evidence', `${files.length - failed.length} ${evidence.replace('_', ' ')} photo(s) added`, null, null, true);
      save();
      emit({ type: 'hazard_update', hazardId: h.id });
    },

    async submitRepair(hazardId, summary, completedAt, files, onProgress) {
      const r = repairSchema.safeParse({ summary, completed_at: completedAt });
      if (!r.success) throw new ApiError(r.error.issues[0].message, 'invalid');
      const d = await load();
      const u = await requireStaff();
      const h = getHazardOrThrow(d, hazardId);
      if (h.status !== 'in_progress') throw new ApiError('Only incidents that are in progress can receive a repair submission.', 'invalid');
      if (!files.some((f) => f.type.startsWith('image/'))) throw new ApiError('An after-repair photograph is required.', 'invalid');
      const failed = await storeFiles(d, h, files, 'after_repair', u, onProgress);
      if (failed.length === files.length) throw new ApiError(`Upload failed: ${failed[0]}`, 'invalid');
      d.repairs[h.id] = { summary: r.data.summary, completed_at: new Date(r.data.completed_at).toISOString(), submitted_by: u.id, submitted_at: new Date().toISOString() };
      log(d, h, u, 'status', r.data.summary, 'in_progress', 'repair_submitted');
      h.status = 'verification_pending';
      log(d, h, u, 'status', 'Awaiting review by an authorised reviewer', 'repair_submitted', 'verification_pending');
      notifyReporter(d, h, `Repair work on ${h.ref} was submitted and is awaiting verification.`);
      save();
      emit({ type: 'hazard_upsert', hazard: h });
      return { ...h };
    },

    async decideVerification(hazardId, decision, notes) {
      const d = await load();
      const u = await requireUser();
      if (!isReviewer(u.role)) throw new ApiError('Only authorised reviewers can verify repairs.', 'forbidden');
      const h = getHazardOrThrow(d, hazardId);
      if (h.status !== 'verification_pending') throw new ApiError('This incident is not awaiting verification.', 'invalid');
      if (decision !== 'approved') {
        const r = reasonSchema.safeParse(notes);
        if (!r.success) throw new ApiError('Explain why the evidence is not accepted (min. 5 characters).', 'invalid');
      }
      if (decision === 'approved' && !d.media.some((m) => m.hazard_id === h.id && m.evidence_type === 'after_repair')) throw new ApiError('No after-repair photo on file.', 'invalid');
      d.verifications.push({ id: uuid(), hazard_id: h.id, reviewer_id: u.id, reviewer_name: u.display_name, decision, notes: notes.trim(), created_at: new Date().toISOString() });
      const prev = h.status;
      if (decision === 'approved') {
        h.status = 'verified_resolved';
        h.resolved_at = new Date().toISOString();
        notifyReporter(d, h, `Good news — the repair for ${h.ref} was verified.`, 'verification');
      } else if (decision === 'rejected') {
        h.status = 'reopened';
        notifyReporter(d, h, `The repair for ${h.ref} was not accepted; the incident was reopened.`, 'verification');
      } else {
        h.status = 'in_progress';
      }
      log(d, h, u, 'verification', `${decision === 'approved' ? 'Repair approved' : decision === 'rejected' ? 'Evidence rejected' : 'Another photo requested'}${notes.trim() ? `: ${notes.trim()}` : ''}`, prev, h.status);
      rescore(d, h);
      save();
      emit({ type: 'hazard_upsert', hazard: h });
      return { ...h };
    },

    async setMediaPublic(mediaId, isPublic) {
      const d = await load();
      await requireStaff();
      const m = d.media.find((x) => x.id === mediaId);
      if (!m) throw new ApiError('Media not found.', 'not_found');
      m.is_public = isPublic;
      save();
      emit({ type: 'hazard_update', hazardId: m.hazard_id });
    },

    async getAnalytics() {
      const d = await load();
      await requireStaff();
      d.hazards.forEach((h) => rescore(d, h));
      return { hazards: d.hazards.map((h) => ({ ...h })), updates: [...d.updates], assignments: [...d.assignments], verifications: [...d.verifications], teams: [...d.teams] };
    },

    async listTeams() {
      return [...(await load()).teams];
    },
    async upsertTeam(team) {
      const t = teamSchema.safeParse(team);
      if (!t.success) throw new ApiError(t.error.issues[0].message, 'invalid');
      const d = await load();
      const u = await requireUser();
      if (!isAdmin(u.role)) throw new ApiError('Only administrators can manage teams.', 'forbidden');
      const existing = team.id ? d.teams.find((x) => x.id === team.id) : undefined;
      if (existing) Object.assign(existing, { ...t.data, active: team.active ?? existing.active });
      const out = existing ?? { id: uuid(), ...t.data, active: team.active ?? true };
      if (!existing) d.teams.push(out);
      save();
      return { ...out };
    },
    async listProfiles() {
      const d = await load();
      const u = await requireUser();
      if (!isAdmin(u.role)) throw new ApiError('Only administrators can view accounts.', 'forbidden');
      return d.profiles.map(strip);
    },
    async setRole(userId, role, teamId) {
      const d = await load();
      const u = await requireUser();
      if (!isAdmin(u.role)) throw new ApiError('Only administrators can change roles.', 'forbidden');
      if (userId === u.id && role !== 'admin') throw new ApiError('You can’t remove your own administrator role.', 'invalid');
      const p = d.profiles.find((x) => x.id === userId);
      if (!p) throw new ApiError('Account not found.', 'not_found');
      p.role = role;
      p.team_id = teamId;
      save();
    },

    async listNotifications() {
      const d = await load();
      const u = await me();
      if (!u) return [];
      return d.notifications.filter((n) => n.user_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async markNotificationRead(id) {
      const d = await load();
      const u = await requireUser();
      d.notifications.forEach((n) => {
        if (n.user_id === u.id && (id === 'all' || n.id === id) && !n.read_at) n.read_at = new Date().toISOString();
      });
      save();
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onConnectionChange(cb) {
      connListeners.add(cb);
      return () => connListeners.delete(cb);
    },
    getConnectionState: () => 'local',
    reconnect: () => setConn('local'),

    async resetDemo() {
      storage.removeItem(KEY);
      await blobs.clear().catch(() => undefined);
      db = null;
      await load();
      authListeners.forEach((l) => l(null));
      channel?.postMessage({ type: 'reload' });
    },
  };
  return api;
}

async function makeThumb(dataUrl: string): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || /jsdom/i.test(navigator.userAgent)) return dataUrl.length < 200_000 ? dataUrl : '';
  try {
    const img = new Image();
    img.src = dataUrl;
    const ok = await withTimeout(img.decode().then(() => true), 5000, false);
    if (!ok) throw new Error('decode timeout');
    const scale = Math.min(1, 360 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return dataUrl.length < 200_000 ? dataUrl : '';
  }
}

export type { HazardUpdate };
