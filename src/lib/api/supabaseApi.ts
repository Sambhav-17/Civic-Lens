import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { compressImage, sniffImage, validateMedia } from '../media';
import type {
  AppNotification, Hazard, HazardDetail, HazardMedia, HazardUpdate, MediaType, Profile, Role, Team,
} from '../types';
import { isAdmin, isStaff } from '../workflow';
import { newHazardSchema } from '../validation';
import { matchesFilter, sortHazards } from './query';
import { ApiError, type CivicApi, type ConnectionState, type HazardFilter, type RealtimeEvent, type Session } from './types';

/** Maps Postgres function errors ("FORBIDDEN: …") to typed ApiErrors. */
function fail(error: { message: string } | null | undefined): never {
  const msg = error?.message ?? 'Something went wrong.';
  const m = /^(RATE_LIMITED|FORBIDDEN|INVALID|NOT_FOUND|CONFLICT):\s*(.*)$/s.exec(msg);
  if (m) {
    const code = { RATE_LIMITED: 'rate_limited', FORBIDDEN: 'forbidden', INVALID: 'invalid', NOT_FOUND: 'not_found', CONFLICT: 'conflict' }[m[1]] as ApiError['code'];
    throw new ApiError(m[2], code);
  }
  if (/fetch|network/i.test(msg)) throw new ApiError('Network problem — check your connection and try again.', 'network');
  if (/JWT|permission denied|not authorized/i.test(msg)) throw new ApiError('You don’t have permission to do that.', 'forbidden');
  throw new ApiError(msg);
}

const PUBLIC_COLS = 'id,ref,category,description,latitude,longitude,location_label,severity_score,severity_level,severity_overridden,immediate_danger,blocks_road,exposure,accessibility_note,corroborations,status,assigned_team_id,thumbnail_path,is_demo,flagged,created_at,updated_at,resolved_at';

type Row = Record<string, unknown> & { thumbnail_path?: string | null };

export function createSupabaseApi(): CivicApi {
  const sb: SupabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  let profile: Profile | null = null;
  const listeners = new Set<(e: RealtimeEvent) => void>();
  const connListeners = new Set<(s: ConnectionState) => void>();
  let conn: ConnectionState = 'connecting';
  let hazardChannel: RealtimeChannel | null = null;
  let notifChannel: RealtimeChannel | null = null;
  const signedCache = new Map<string, { url: string; exp: number }>();

  const setConn = (s: ConnectionState) => {
    conn = s;
    connListeners.forEach((l) => l(s));
  };
  const emit = (e: RealtimeEvent) => listeners.forEach((l) => l(e));

  async function loadProfile(): Promise<Profile | null> {
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) return (profile = null);
    const { data, error } = await sb.from('profiles').select('*').eq('id', auth.user.id).maybeSingle();
    if (error) fail(error);
    profile = data
      ? { ...(data as Profile), email: auth.user.email, email_verified: Boolean(auth.user.email_confirmed_at) }
      : null;
    return profile;
  }

  async function signUrls(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const need = paths.filter((p) => {
      const c = signedCache.get(p);
      if (c && c.exp > Date.now()) {
        out.set(p, c.url);
        return false;
      }
      return true;
    });
    if (need.length) {
      const { data } = await sb.storage.from('hazard-media').createSignedUrls(need, 3600);
      data?.forEach((d) => {
        if (d.signedUrl && d.path) {
          out.set(d.path, d.signedUrl);
          signedCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 3_300_000 });
        }
      });
    }
    return out;
  }

  async function toHazards(rows: Row[]): Promise<Hazard[]> {
    const urls = await signUrls(rows.map((r) => r.thumbnail_path).filter(Boolean) as string[]);
    return rows.map((r) => {
      const { thumbnail_path, location: _l, ...rest } = r as Row & { location?: unknown };
      void _l;
      return { reporter_id: null, ...rest, thumbnail_url: thumbnail_path ? urls.get(thumbnail_path) ?? null : null } as unknown as Hazard;
    });
  }

  async function uploadFiles(files: File[], prefix: string, onProgress?: (i: number, f: number) => void) {
    const done: { path: string; type: MediaType }[] = [];
    const failed: string[] = [];
    for (const [i, raw] of files.entries()) {
      try {
        const type = validateMedia(raw);
        if (type === 'image' && !(await sniffImage(raw))) throw new Error(`“${raw.name}” doesn’t look like a real image file.`);
        onProgress?.(i, 0.1);
        const file = type === 'image' ? await compressImage(raw, (p) => onProgress?.(i, 0.1 + (p / 100) * 0.5)) : raw;
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
        const { error } = await sb.storage.from('hazard-media').upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw new Error(error.message);
        onProgress?.(i, 1);
        done.push({ path, type });
      } catch (e) {
        failed.push(e instanceof Error ? e.message : raw.name);
        onProgress?.(i, -1);
      }
    }
    return { done, failed };
  }

  function wireRealtime() {
    if (hazardChannel) void sb.removeChannel(hazardChannel);
    setConn('connecting');
    hazardChannel = sb
      .channel('hazards')
      .on('broadcast', { event: 'hazard_changed' }, ({ payload }) => emit({ type: 'hazard_update', hazardId: String(payload?.id ?? '') }))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConn('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConn('reconnecting');
        else if (status === 'CLOSED') setConn('offline');
      });
  }

  function wireNotifications(userId: string | null) {
    if (notifChannel) void sb.removeChannel(notifChannel);
    notifChannel = null;
    if (!userId) return;
    notifChannel = sb
      .channel(`notifications:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, ({ new: n }) =>
        emit({ type: 'notification', notification: n as AppNotification }))
      .subscribe();
  }

  if (typeof window !== 'undefined') {
    wireRealtime();
    window.addEventListener('offline', () => setConn('offline'));
    window.addEventListener('online', () => wireRealtime());
  }

  const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) fail(error);
    return data as T;
  };

  const getHazardRow = async (id: string): Promise<Hazard> => {
    const d = await api.getHazard(id);
    if (!d) throw new ApiError('Incident not found.', 'not_found');
    return d;
  };

  const api: CivicApi = {
    mode: 'supabase',

    async getSession() {
      const p = await loadProfile();
      wireNotifications(p?.id ?? null);
      return p ? { user: p } : null;
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange(() => {
        void loadProfile().then((p) => {
          wireNotifications(p?.id ?? null);
          cb(p ? ({ user: p } as Session) : null);
        });
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new ApiError(/confirm/i.test(error.message) ? 'Please confirm your email address first — check your inbox.' : 'Email or password is incorrect.', 'unauthorized');
      const p = await loadProfile();
      if (!p) throw new ApiError('Profile not found.', 'not_found');
      return { user: p };
    },
    async signUp(email, password, displayName) {
      const { data, error } = await sb.auth.signUp({
        email: email.trim(), password,
        options: { data: { display_name: displayName.trim() }, emailRedirectTo: `${location.origin}/login?verified=1` },
      });
      if (error) throw new ApiError(error.message, /registered/i.test(error.message) ? 'conflict' : 'invalid');
      if (!data.session) return { session: null, needsEmailVerification: true };
      const p = await loadProfile();
      return { session: p ? { user: p } : null, needsEmailVerification: false };
    },
    async signOut() {
      await sb.auth.signOut();
      profile = null;
    },
    async requestPasswordReset(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/profile?reset=1` });
      if (error) fail(error);
    },
    async updateProfile(patch) {
      if (!profile) throw new ApiError('Please sign in.', 'unauthorized');
      const { error } = await sb.from('profiles').update(patch).eq('id', profile.id);
      if (error) fail(error);
      return (await loadProfile())!;
    },

    async listHazards(filter: HazardFilter = {}) {
      const staff = isStaff(profile?.role);
      const ownOnly = Boolean(filter.reporterId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = ownOnly || staff ? sb.from('hazards').select(staff ? '*' : PUBLIC_COLS + ',reporter_id', { count: 'exact' }) : sb.from('public_hazards').select(PUBLIC_COLS, { count: 'exact' });
      if (filter.reporterId) q = q.eq('reporter_id', filter.reporterId);
      if (filter.categories?.length) q = q.in('category', filter.categories);
      if (filter.severities?.length) q = q.in('severity_level', filter.severities);
      if (filter.statuses?.length) q = q.in('status', filter.statuses);
      if (filter.since) q = q.gte('created_at', filter.since);
      if (filter.assignedTeamId) q = q.eq('assigned_team_id', filter.assignedTeamId);
      if (filter.bbox) {
        const [s, w, n, e] = filter.bbox;
        q = q.gte('latitude', s).lte('latitude', n).gte('longitude', w).lte('longitude', e);
      }
      if (filter.search) {
        const term = filter.search.replace(/[%,()]/g, ' ').trim();
        if (term) q = q.or(`ref.ilike.%${term}%,location_label.ilike.%${term}%,description.ilike.%${term}%`);
      }
      const sort = filter.sort ?? 'severity';
      if (sort === 'severity') q = q.order('severity_score', { ascending: false }).order('created_at', { ascending: true });
      else if (sort === 'updated') q = q.order('updated_at', { ascending: false });
      else q = q.order('created_at', { ascending: sort === 'oldest' });
      const page = Math.max(1, filter.page ?? 1);
      const pageSize = filter.pageSize ?? 500;
      q = q.range((page - 1) * pageSize, page * pageSize - 1);
      const { data, count, error } = await q;
      if (error) fail(error);
      const items = sortHazards((await toHazards((data ?? []) as unknown as Row[])).filter((h) => matchesFilter(h, { ...filter, search: undefined })), sort);
      return { items, total: count ?? items.length, page, pageSize };
    },

    async getHazard(id) {
      const staff = isStaff(profile?.role);
      const byRef = /^CL-/i.test(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const base: any = staff ? sb.from('hazards').select('*') : sb.from('public_hazards').select(PUBLIC_COLS);
      let { data: row, error } = await (byRef ? base.eq('ref', id.toUpperCase()) : base.eq('id', id)).maybeSingle();
      if (error) fail(error);
      if (!row && profile) {
        // The reporter can always see their own report, even if hidden from the public.
        ({ data: row } = await (byRef ? sb.from('hazards').select('*').eq('ref', id.toUpperCase()) : sb.from('hazards').select('*').eq('id', id)).maybeSingle());
      }
      if (!row) return null;
      const [h] = await toHazards([row as unknown as Row]);
      const hid = h.id;

      const mediaQ = staff ? sb.from('hazard_media').select('*').eq('hazard_id', hid) : sb.from('public_hazard_media').select('*').eq('hazard_id', hid);
      const updatesQ = staff
        ? sb.from('hazard_updates').select('*, actor:profiles(display_name)').eq('hazard_id', hid).order('created_at')
        : sb.from('public_hazard_updates').select('*').eq('hazard_id', hid).order('created_at');
      const verQ = staff
        ? sb.from('repair_verifications').select('*, reviewer:profiles(display_name)').eq('hazard_id', hid).order('created_at')
        : sb.from('public_repair_verifications').select('*').eq('hazard_id', hid).order('created_at');
      const repairQ = staff ? sb.from('repair_submissions').select('*').eq('hazard_id', hid).maybeSingle() : sb.from('public_repairs').select('*').eq('hazard_id', hid).maybeSingle();
      const assignQ = staff ? sb.from('hazard_assignments').select('*').eq('hazard_id', hid).order('assigned_at') : Promise.resolve({ data: [], error: null });
      const teamQ = h.assigned_team_id ? sb.from('teams').select('*').eq('id', h.assigned_team_id).maybeSingle() : Promise.resolve({ data: null, error: null });

      const [media, updates, ver, repair, assign, team] = await Promise.all([mediaQ, updatesQ, verQ, repairQ, assignQ, teamQ]);
      for (const r of [media, updates, ver]) if (r.error) fail(r.error);
      const urls = await signUrls(((media.data ?? []) as { storage_path: string }[]).map((m) => m.storage_path));

      const detail: HazardDetail = {
        ...h,
        media: ((media.data ?? []) as Record<string, unknown>[]).map((m) => ({
          id: m.id, hazard_id: m.hazard_id, url: urls.get(m.storage_path as string) ?? '', media_type: m.media_type, evidence_type: m.evidence_type,
          uploaded_by: (m.uploaded_by as string) ?? null, is_public: (m.is_public as boolean) ?? true, created_at: m.created_at,
        })) as HazardMedia[],
        updates: ((updates.data ?? []) as Record<string, unknown>[]).map((u) => ({
          id: u.id, hazard_id: u.hazard_id, actor_id: (u.actor_id as string) ?? null,
          actor_name: staff ? ((u.actor as { display_name?: string } | null)?.display_name ?? 'Anonymous reporter') : (u.actor_label as string),
          kind: u.kind, previous_status: u.previous_status ?? null, new_status: u.new_status ?? null, note: u.note ?? null,
          internal: Boolean(u.internal), created_at: u.created_at,
        })) as HazardUpdate[],
        verifications: ((ver.data ?? []) as Record<string, unknown>[]).map((v) => ({
          id: v.id, hazard_id: v.hazard_id, reviewer_id: (v.reviewer_id as string) ?? '', decision: v.decision, notes: v.notes, created_at: v.created_at,
          reviewer_name: staff ? (v.reviewer as { display_name?: string } | null)?.display_name : 'Authorised reviewer',
        })) as HazardDetail['verifications'],
        assignments: (assign.data ?? []) as HazardDetail['assignments'],
        repair: repair.data ? { submitted_by: '', submitted_at: '', ...(repair.data as object) } as HazardDetail['repair'] : null,
        team: (team.data as Team) ?? null,
      };
      return detail;
    },

    async findDuplicates(category, lat, lng) {
      const ids = await rpc<string[]>('find_duplicates', { p_category: category, p_lat: lat, p_lng: lng });
      if (!ids?.length) return [];
      const { data, error } = await sb.from('public_hazards').select(PUBLIC_COLS).in('id', ids);
      if (error) fail(error);
      return toHazards((data ?? []) as unknown as Row[]);
    },

    async submitHazard(input, files, onProgress) {
      const parsed = newHazardSchema.safeParse(input);
      if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? 'Invalid report.', 'invalid');
      const res = await rpc<{ hazard: Row; upload_token: string }>('submit_hazard', { p: parsed.data });
      const hazardId = res.hazard.id as string;
      const { done, failed } = await uploadFiles(files, `reports/${hazardId}/${res.upload_token}`, onProgress);
      for (const f of done) {
        try {
          await rpc('attach_report_media', { p_hazard: hazardId, p_token: res.upload_token, p_path: f.path, p_media: f.type });
        } catch (e) {
          failed.push(e instanceof Error ? e.message : 'Attachment failed');
        }
      }
      const { data } = await sb.from('public_hazards').select(PUBLIC_COLS).eq('id', hazardId).maybeSingle();
      const [hazard] = await toHazards([(data ?? res.hazard) as Row]);
      return { hazard, failedUploads: failed };
    },

    async corroborate(hazardId) {
      await rpc('corroborate_hazard', { p_hazard: hazardId });
      return getHazardRow(hazardId);
    },
    async flagHazard(hazardId, reason) {
      await rpc('flag_hazard', { p_hazard: hazardId, p_reason: reason });
    },
    async getPublicStats() {
      const s = await rpc<{ total: number; criticalOpen: number; verifiedRepairs: number; avgResolutionHours: number | null }>('public_stats', {});
      return { total: s.total ?? 0, criticalOpen: s.criticalOpen ?? 0, verifiedRepairs: s.verifiedRepairs ?? 0, avgResolutionHours: s.avgResolutionHours ?? null };
    },

    async transition(hazardId, to, note) {
      await rpc('transition_hazard', { p_hazard: hazardId, p_to: to, p_note: note ?? null });
      return getHazardRow(hazardId);
    },
    async assign(hazardId, teamId, note) {
      await rpc('assign_hazard', { p_hazard: hazardId, p_team: teamId, p_note: note ?? null });
      return getHazardRow(hazardId);
    },
    async overrideSeverity(hazardId, level, reason) {
      await rpc('override_severity', { p_hazard: hazardId, p_level: level, p_reason: reason });
      return getHazardRow(hazardId);
    },
    async addNote(hazardId, note, internal) {
      await rpc('add_hazard_note', { p_hazard: hazardId, p_note: note, p_internal: internal });
    },
    async recordInspection(hazardId, plannedFor, note) {
      await rpc('record_inspection', { p_hazard: hazardId, p_when: new Date(plannedFor).toISOString(), p_note: note });
    },
    async uploadEvidence(hazardId, files, evidence, onProgress) {
      const { done, failed } = await uploadFiles(files, `evidence/${hazardId}`, onProgress);
      if (!done.length) throw new ApiError(failed[0] ?? 'Upload failed.', 'invalid');
      for (const f of done) await rpc('attach_staff_media', { p_hazard: hazardId, p_path: f.path, p_media: f.type, p_evidence: evidence });
    },
    async submitRepair(hazardId, summary, completedAt, files, onProgress) {
      await api.uploadEvidence(hazardId, files, 'after_repair', onProgress);
      await rpc('submit_repair', { p_hazard: hazardId, p_summary: summary, p_completed_at: new Date(completedAt).toISOString() });
      return getHazardRow(hazardId);
    },
    async decideVerification(hazardId, decision, notes) {
      await rpc('decide_verification', { p_hazard: hazardId, p_decision: decision, p_notes: notes });
      return getHazardRow(hazardId);
    },
    async setMediaPublic(mediaId, isPublic) {
      await rpc('set_media_public', { p_media: mediaId, p_public: isPublic });
    },
    async getAnalytics() {
      if (!isStaff(profile?.role)) throw new ApiError('Only municipal staff can view analytics.', 'forbidden');
      const [h, u, a, v, t] = await Promise.all([
        sb.from('hazards').select('*').limit(10000),
        sb.from('hazard_updates').select('*').limit(50000),
        sb.from('hazard_assignments').select('*').limit(20000),
        sb.from('repair_verifications').select('*').limit(20000),
        sb.from('teams').select('*'),
      ]);
      for (const r of [h, u, a, v, t]) if (r.error) fail(r.error);
      return {
        hazards: await toHazards((h.data ?? []) as Row[]),
        updates: (u.data ?? []) as HazardUpdate[],
        assignments: (a.data ?? []) as HazardDetail['assignments'],
        verifications: (v.data ?? []) as HazardDetail['verifications'],
        teams: (t.data ?? []) as Team[],
      };
    },

    async listTeams() {
      const { data, error } = await sb.from('teams').select('*').order('name');
      if (error) fail(error);
      return (data ?? []) as Team[];
    },
    async upsertTeam(team) {
      if (!isAdmin(profile?.role)) throw new ApiError('Only administrators can manage teams.', 'forbidden');
      const payload = { name: team.name.trim(), service_area: team.service_area.trim(), active: team.active ?? true };
      const { data, error } = team.id
        ? await sb.from('teams').update(payload).eq('id', team.id).select().single()
        : await sb.from('teams').insert(payload).select().single();
      if (error) fail(error);
      return data as Team;
    },
    async listProfiles() {
      if (!isAdmin(profile?.role)) throw new ApiError('Only administrators can view accounts.', 'forbidden');
      const { data, error } = await sb.from('profiles').select('*').order('created_at');
      if (error) fail(error);
      return ((data ?? []) as Profile[]).map((p) => ({ ...p, email_verified: true }));
    },
    async setRole(userId, role: Role, teamId) {
      await rpc('set_user_role', { p_user: userId, p_role: role, p_team: teamId });
    },

    async listNotifications() {
      if (!profile) return [];
      const { data, error } = await sb.from('notifications').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(50);
      if (error) fail(error);
      return (data ?? []) as AppNotification[];
    },
    async markNotificationRead(id) {
      if (!profile) return;
      let q = sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', profile.id).is('read_at', null);
      if (id !== 'all') q = q.eq('id', id);
      const { error } = await q;
      if (error) fail(error);
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onConnectionChange(cb) {
      connListeners.add(cb);
      return () => connListeners.delete(cb);
    },
    getConnectionState: () => conn,
    reconnect: () => wireRealtime(),
  };
  return api;
}
