-- CivicLens — Row Level Security, grants, storage and realtime.

alter table public.app_settings enable row level security;
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.hazards enable row level security;
alter table public.hazard_media enable row level security;
alter table public.hazard_updates enable row level security;
alter table public.hazard_assignments enable row level security;
alter table public.repair_submissions enable row level security;
alter table public.repair_verifications enable row level security;
alter table public.notifications enable row level security;
alter table public.hazard_flags enable row level security;
alter table public.submission_tokens enable row level security; -- no policies: functions only
alter table public.rate_events enable row level security;       -- no policies: functions only
alter table public.corroborations enable row level security;    -- no policies: functions only

-- Clients never write workflow tables directly; everything goes through functions.
-- (Supabase grants ALL on new tables to anon/authenticated by default; TRUNCATE ignores RLS.)
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke all on public.submission_tokens, public.rate_events, public.corroborations from anon, authenticated;

-- Settings: readable by staff, editable by admins.
create policy "staff read settings" on public.app_settings for select to authenticated using (public.is_staff());
create policy "admins update settings" on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant update (value, updated_at) on public.app_settings to authenticated;

-- Teams: public names (shown on incidents); admins manage.
create policy "anyone reads teams" on public.teams for select to anon, authenticated using (true);
create policy "admins insert teams" on public.teams for insert to authenticated with check (public.is_admin());
create policy "admins update teams" on public.teams for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant insert (name, service_area, active), update (name, service_area, active) on public.teams to authenticated;

-- Profiles: own profile; staff can see names of colleagues; admins see all.
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant update (display_name, notify_email) on public.profiles to authenticated; -- role/team only via set_user_role()

-- Hazards: full rows for staff and for the reporter's own reports. Public uses public_hazards.
create policy "staff read hazards" on public.hazards for select to authenticated using (public.is_staff());
create policy "reporters read own hazards" on public.hazards for select to authenticated using (reporter_id = auth.uid());

create policy "staff read media" on public.hazard_media for select to authenticated using (public.is_staff());
create policy "reporters read own media" on public.hazard_media for select to authenticated
  using (exists (select 1 from public.hazards h where h.id = hazard_id and h.reporter_id = auth.uid()));

create policy "staff read updates" on public.hazard_updates for select to authenticated using (public.is_staff());
create policy "staff read assignments" on public.hazard_assignments for select to authenticated using (public.is_staff());
create policy "staff read repairs" on public.repair_submissions for select to authenticated using (public.is_staff());
create policy "staff read verifications" on public.repair_verifications for select to authenticated using (public.is_staff());
create policy "staff read flags" on public.hazard_flags for select to authenticated using (public.is_staff());

create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "mark own notifications read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant update (read_at) on public.notifications to authenticated;

-- Public read models
grant select on public.public_hazards, public.public_hazard_media, public.public_hazard_updates,
  public.public_repair_verifications, public.public_repairs to anon, authenticated;

-- Function execution. Supabase grants EXECUTE on new functions to anon/authenticated
-- directly, so revoking from PUBLIC alone is not enough: internal helpers such as
-- log_update() or recompute_severity() must not be callable by clients.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
grant execute on function
  public.submit_hazard(jsonb), public.attach_report_media(uuid, text, text, public.media_kind),
  public.find_duplicates(public.hazard_category, double precision, double precision),
  public.corroborate_hazard(uuid), public.flag_hazard(uuid, text), public.public_stats(),
  public.current_app_role(), public.is_staff(), public.is_reviewer(), public.is_admin()
  to anon, authenticated;
grant execute on function
  public.transition_hazard(uuid, public.hazard_status, text), public.assign_hazard(uuid, uuid, text),
  public.override_severity(uuid, public.severity_level, text), public.add_hazard_note(uuid, text, boolean),
  public.record_inspection(uuid, timestamptz, text), public.attach_staff_media(uuid, text, public.media_kind, public.evidence_kind),
  public.submit_repair(uuid, text, timestamptz), public.decide_verification(uuid, public.verification_decision, text),
  public.set_media_public(uuid, boolean), public.set_user_role(uuid, public.app_role, uuid)
  to authenticated;

-- ── Storage ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hazard-media', 'hazard-media', false, 26214400,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/webm','video/quicktime',
        'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav'])
on conflict (id) do nothing;

-- Reporters (incl. anonymous) may upload ONLY into reports/<hazard>/<token>/ while their token is valid.
-- The token table is not readable by clients, so the check runs as a SECURITY DEFINER function.
create or replace function public.report_upload_allowed(p_name text) returns boolean
language sql stable security definer set search_path = public, extensions, storage as $$
  select coalesce((storage.foldername(p_name))[1] = 'reports' and exists (
    select 1 from public.submission_tokens t
     where t.hazard_id::text = (storage.foldername(p_name))[2]
       and t.token_hash = encode(extensions.digest((storage.foldername(p_name))[3], 'sha256'), 'hex')
       and t.expires_at > now() and t.uploads < 6), false)
$$;
revoke execute on function public.report_upload_allowed(text) from public;
grant execute on function public.report_upload_allowed(text) to anon, authenticated;

create policy "report uploads with valid token" on storage.objects for insert to anon, authenticated
with check (bucket_id = 'hazard-media' and public.report_upload_allowed(name));

create policy "staff evidence uploads" on storage.objects for insert to authenticated
with check (bucket_id = 'hazard-media' and (storage.foldername(name))[1] = 'evidence' and public.is_staff());

-- Reads: public media, own report media, or staff.
create policy "read approved media" on storage.objects for select to anon, authenticated
using (
  bucket_id = 'hazard-media' and (
    public.is_staff()
    or exists (select 1 from public.public_hazard_media pm where pm.storage_path = name)
    or exists (select 1 from public.hazard_media m join public.hazards h on h.id = m.hazard_id
               where m.storage_path = name and h.reporter_id = auth.uid())
  )
);

-- ── Realtime ─────────────────────────────────────────────────────────────
-- Notifications stream per-user via postgres_changes (RLS-filtered).
alter publication supabase_realtime add table public.notifications;
-- Hazard changes are broadcast on the public "hazards" topic by broadcast_hazard_change().
