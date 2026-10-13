-- CivicLens — server-side logic. All workflow writes go through these
-- SECURITY DEFINER functions; clients have no direct INSERT/UPDATE rights on
-- hazards, so a client can never supply its own score, role or transition.

-- ── Role helpers ─────────────────────────────────────────────────────────
create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('staff', 'reviewer', 'admin'), false)
$$;

create or replace function public.is_reviewer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('reviewer', 'admin'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

-- Hashed client key for rate limiting (user id when signed in, otherwise forwarded IP).
create or replace function public.client_hash() returns text
language sql stable security definer set search_path = public, extensions as $$
  select encode(extensions.digest(
    coalesce(auth.uid()::text,
      split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', 'unknown'), ',', 1))
    || ':civiclens', 'sha256'), 'hex')
$$;

create or replace function public.enforce_rate_limit(p_bucket text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = public as $$
declare v_hash text := public.client_hash(); v_count int;
begin
  select count(*) into v_count from public.rate_events
   where bucket = p_bucket and client_hash = v_hash and created_at > now() - p_window;
  if v_count >= p_max then
    raise exception 'RATE_LIMITED: Too many requests. Please wait a few minutes and try again.' using errcode = 'P0001';
  end if;
  insert into public.rate_events (bucket, client_hash) values (p_bucket, v_hash);
  delete from public.rate_events where created_at < now() - interval '1 day';
end $$;

-- ── Severity model (mirrors src/lib/severity.ts) ─────────────────────────
create or replace function public.compute_severity(
  p_category public.hazard_category, p_danger boolean, p_blocks boolean, p_exposure public.exposure_kind,
  p_has_photo boolean, p_has_description boolean, p_report_count int, p_days_open numeric
) returns table (score int, level public.severity_level)
language plpgsql stable security definer set search_path = public as $$
declare
  w jsonb := (select value from public.app_settings where key = 'severity');
  s numeric := 0;
  floor_score numeric;
begin
  s := s + coalesce((w -> 'category' ->> p_category::text)::numeric, 0);
  if p_danger then s := s + (w ->> 'immediateDanger')::numeric; end if;
  if p_category = 'electrical_wire' then s := s + (w ->> 'electricalExposure')::numeric; end if;
  if p_category in ('open_manhole', 'drain_cover') then s := s + (w ->> 'openGround')::numeric; end if;
  s := s + coalesce((w -> 'exposure' ->> p_exposure::text)::numeric, 0);
  if p_blocks then s := s + (w ->> 'roadObstruction')::numeric; end if;
  s := s + least((w -> 'confidence' ->> 'max')::numeric,
         (case when p_has_photo then (w -> 'confidence' ->> 'photo')::numeric else 0 end) +
         (case when p_has_description then (w -> 'confidence' ->> 'description')::numeric else 0 end));
  s := s + least((w -> 'corroboration' ->> 'max')::numeric, greatest(0, p_report_count - 1) * (w -> 'corroboration' ->> 'perReport')::numeric);
  s := s + least((w -> 'duration' ->> 'max')::numeric, greatest(0, p_days_open) * (w -> 'duration' ->> 'perDay')::numeric);

  if p_category in ('electrical_wire', 'open_manhole') then
    floor_score := case when p_danger then (w -> 'floors' ->> 'lifeThreateningAndActive')::numeric
                        else (w -> 'floors' ->> 'lifeThreateningCategory')::numeric end;
    s := greatest(s, floor_score);
  end if;

  score := greatest(0, least(100, round(s)))::int;
  level := case
    when score >= (w -> 'thresholds' ->> 'critical')::int then 'critical'
    when score >= (w -> 'thresholds' ->> 'high')::int then 'high'
    when score >= (w -> 'thresholds' ->> 'medium')::int then 'medium'
    else 'low' end;
  return next;
end $$;

create or replace function public.recompute_severity(p_hazard uuid) returns void
language plpgsql security definer set search_path = public as $$
declare h public.hazards; r record;
begin
  select * into h from public.hazards where id = p_hazard;
  if h.id is null or h.severity_overridden then return; end if;
  select * into r from public.compute_severity(
    h.category, h.immediate_danger, h.blocks_road, h.exposure,
    exists (select 1 from public.hazard_media m where m.hazard_id = h.id and m.evidence_type = 'report' and m.media_type = 'image'),
    char_length(trim(h.description)) > 0,
    1 + h.corroborations,
    case when h.status in ('verified_resolved', 'dismissed') then 0
         else extract(epoch from now() - h.created_at) / 86400 end);
  update public.hazards set severity_score = r.score, severity_level = r.level where id = h.id;
end $$;

-- Optional: schedule with pg_cron so "time unresolved" keeps contributing.
create or replace function public.refresh_open_severity() returns void
language sql security definer set search_path = public as $$
  select public.recompute_severity(id) from public.hazards
   where status not in ('verified_resolved', 'dismissed') and not severity_overridden;
$$;

-- ── Workflow rules (mirrors src/lib/workflow.ts) ─────────────────────────
create or replace function public.can_transition(p_from public.hazard_status, p_to public.hazard_status, p_role public.app_role)
returns boolean language sql immutable as $$
  select case
    when p_role is null or p_role = 'citizen' then false
    when p_to in ('verified_resolved', 'reopened') and p_role not in ('reviewer', 'admin') then false
    else (p_from, p_to) in (
      ('reported','triaged'), ('reported','dismissed'),
      ('triaged','assigned'), ('triaged','dismissed'),
      ('assigned','in_progress'), ('assigned','triaged'),
      ('in_progress','repair_submitted'), ('in_progress','assigned'),
      ('repair_submitted','verification_pending'), ('repair_submitted','in_progress'),
      ('verification_pending','verified_resolved'), ('verification_pending','reopened'),
      ('verified_resolved','reopened'),
      ('reopened','triaged'), ('reopened','assigned'),
      ('dismissed','reopened'))
  end
$$;

create or replace function public.log_update(p_hazard uuid, p_kind public.update_kind, p_note text,
  p_prev public.hazard_status default null, p_next public.hazard_status default null, p_internal boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into public.hazard_updates (hazard_id, actor_id, kind, previous_status, new_status, note, internal)
  values (p_hazard, auth.uid(), p_kind, p_prev, p_next, nullif(trim(p_note), ''), p_internal);
  update public.hazards set updated_at = now() where id = p_hazard;
$$;

create or replace function public.make_ref() returns text language plpgsql as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; r text := 'CL-'; i int;
begin
  for i in 1..6 loop r := r || substr(alphabet, 1 + floor(random() * 32)::int, 1); end loop;
  return r;
end $$;

-- ── Public reporting ─────────────────────────────────────────────────────
create or replace function public.submit_hazard(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_lat double precision := (p ->> 'latitude')::double precision;
  v_lng double precision := (p ->> 'longitude')::double precision;
  v_cat public.hazard_category := (p ->> 'category')::public.hazard_category;
  v_desc text := left(coalesce(trim(p ->> 'description'), ''), 600);
  v_anon boolean := coalesce((p ->> 'anonymous')::boolean, false);
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  h public.hazards;
begin
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    raise exception 'INVALID: Invalid coordinates.' using errcode = 'P0001';
  end if;
  perform public.enforce_rate_limit('submit_hazard', 5, interval '10 minutes');

  insert into public.hazards (ref, reporter_id, category, description, latitude, longitude, location_label,
    immediate_danger, blocks_road, exposure, accessibility_note)
  values (public.make_ref(), case when v_anon then null else auth.uid() end, v_cat, v_desc, v_lat, v_lng,
    left(nullif(trim(p ->> 'location_label'), ''), 200),
    coalesce((p ->> 'immediate_danger')::boolean, false), coalesce((p ->> 'blocks_road')::boolean, false),
    coalesce((p ->> 'exposure')::public.exposure_kind, 'unknown'), left(nullif(trim(p ->> 'accessibility_note'), ''), 300))
  returning * into h;

  insert into public.submission_tokens (hazard_id, token_hash) values (h.id, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  insert into public.hazard_updates (hazard_id, actor_id, kind, new_status, note)
  values (h.id, case when v_anon then null else auth.uid() end, 'status', 'reported', 'Report submitted');
  perform public.recompute_severity(h.id);
  select * into h from public.hazards where id = h.id;
  return jsonb_build_object('hazard', to_jsonb(h) - 'reporter_id' - 'location', 'upload_token', v_token);
end $$;

create or replace function public.attach_report_media(p_hazard uuid, p_token text, p_path text, p_media public.media_kind)
returns void language plpgsql security definer set search_path = public, extensions, storage as $$
declare t public.submission_tokens;
begin
  select * into t from public.submission_tokens where hazard_id = p_hazard for update;
  if t.hazard_id is null or t.expires_at < now() or t.uploads >= 6
     or t.token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex') then
    raise exception 'FORBIDDEN: Upload window closed for this report.' using errcode = 'P0001';
  end if;
  if p_path not like 'reports/' || p_hazard::text || '/' || p_token || '/%' then
    raise exception 'INVALID: Unexpected media path.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'hazard-media' and name = p_path) then
    raise exception 'INVALID: File was not uploaded.' using errcode = 'P0001';
  end if;
  insert into public.hazard_media (hazard_id, storage_path, media_type, evidence_type, uploaded_by, is_public)
  values (p_hazard, p_path, p_media, 'report',
          (select reporter_id from public.hazards where id = p_hazard), -- null for anonymous reports
          p_media <> 'audio');
  update public.submission_tokens set uploads = uploads + 1 where hazard_id = p_hazard;
  update public.hazards set thumbnail_path = coalesce(thumbnail_path, case when p_media = 'image' then p_path end) where id = p_hazard;
  perform public.recompute_severity(p_hazard);
end $$;

create or replace function public.find_duplicates(p_category public.hazard_category, p_lat double precision, p_lng double precision)
returns setof uuid language sql stable security definer set search_path = public, extensions as $$
  select id from public.hazards
   where category = p_category and not hidden
     and status not in ('verified_resolved', 'dismissed')
     and created_at > now() - interval '72 hours'
     and extensions.st_dwithin(location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography, 30)
$$;

create or replace function public.corroborate_hazard(p_hazard uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.enforce_rate_limit('corroborate', 20, interval '1 hour');
  begin
    insert into public.corroborations (hazard_id, client_hash) values (p_hazard, public.client_hash());
  exception when unique_violation then
    raise exception 'CONFLICT: You have already confirmed this hazard.' using errcode = 'P0001';
  end;
  update public.hazards set corroborations = corroborations + 1 where id = p_hazard and status not in ('verified_resolved', 'dismissed');
  if not found then raise exception 'NOT_FOUND: Incident not found or already closed.' using errcode = 'P0001'; end if;
  perform public.log_update(p_hazard, 'corroboration', 'Another person confirmed this hazard');
  perform public.recompute_severity(p_hazard);
end $$;

create or replace function public.flag_hazard(p_hazard uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if char_length(trim(p_reason)) < 5 then raise exception 'INVALID: Give a reason of at least 5 characters.' using errcode = 'P0001'; end if;
  perform public.enforce_rate_limit('flag', 10, interval '1 hour');
  insert into public.hazard_flags (hazard_id, reason, flagged_by) values (p_hazard, left(trim(p_reason), 500), auth.uid());
  update public.hazards set flagged = true where id = p_hazard;
  perform public.log_update(p_hazard, 'flag', 'Flagged for moderation: ' || left(trim(p_reason), 500), null, null, true);
end $$;

create or replace function public.public_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', count(*),
    'criticalOpen', count(*) filter (where severity_level = 'critical' and status <> 'verified_resolved'),
    'verifiedRepairs', count(*) filter (where status = 'verified_resolved'),
    'avgResolutionHours', avg(extract(epoch from resolved_at - created_at) / 3600) filter (where status = 'verified_resolved' and resolved_at is not null))
  from public.hazards where status <> 'dismissed' and not hidden
$$;

-- ── Municipal workflow ───────────────────────────────────────────────────
create or replace function public.require_staff() returns public.app_role
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := public.current_app_role();
begin
  if r is null or r = 'citizen' then raise exception 'FORBIDDEN: Only municipal staff can do this.' using errcode = 'P0001'; end if;
  return r;
end $$;

create or replace function public.transition_hazard(p_hazard uuid, p_to public.hazard_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_role public.app_role := public.require_staff(); h public.hazards;
begin
  select * into h from public.hazards where id = p_hazard for update;
  if h.id is null then raise exception 'NOT_FOUND: Incident not found.' using errcode = 'P0001'; end if;
  if not public.can_transition(h.status, p_to, v_role) then
    raise exception 'FORBIDDEN: Transition % → % is not allowed for your role.', h.status, p_to using errcode = 'P0001';
  end if;
  if p_to = 'verified_resolved' then raise exception 'INVALID: Use the verification review to resolve an incident.' using errcode = 'P0001'; end if;
  if p_to = 'repair_submitted' then raise exception 'INVALID: Submit repair evidence instead.' using errcode = 'P0001'; end if;
  if p_to = 'assigned' and h.assigned_team_id is null then raise exception 'INVALID: Assign a team first.' using errcode = 'P0001'; end if;
  update public.hazards set status = p_to, resolved_at = case when p_to = 'reopened' then null else resolved_at end where id = h.id;
  perform public.log_update(h.id, 'status', p_note, h.status, p_to);
  perform public.recompute_severity(h.id);
end $$;

create or replace function public.assign_hazard(p_hazard uuid, p_team uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare h public.hazards; t public.teams; v_next public.hazard_status;
begin
  perform public.require_staff();
  select * into h from public.hazards where id = p_hazard for update;
  select * into t from public.teams where id = p_team and active;
  if h.id is null then raise exception 'NOT_FOUND: Incident not found.' using errcode = 'P0001'; end if;
  if t.id is null then raise exception 'INVALID: Choose an active team.' using errcode = 'P0001'; end if;
  if h.status not in ('triaged', 'assigned', 'reopened', 'in_progress') then
    raise exception 'INVALID: Triage the incident before assigning it.' using errcode = 'P0001';
  end if;
  v_next := case when h.status in ('triaged', 'reopened') then 'assigned' else h.status end;
  update public.hazards set assigned_team_id = t.id, status = v_next where id = h.id;
  insert into public.hazard_assignments (hazard_id, team_id, assigned_by) values (h.id, t.id, auth.uid());
  perform public.log_update(h.id, 'assignment', 'Assigned to ' || t.name || coalesce(' — ' || nullif(trim(p_note), ''), ''), h.status, v_next);
end $$;

create or replace function public.override_severity(p_hazard uuid, p_level public.severity_level, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare h public.hazards; w jsonb := (select value -> 'thresholds' from public.app_settings where key = 'severity'); v_score int;
begin
  perform public.require_staff();
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'INVALID: A reason of at least 5 characters is required.' using errcode = 'P0001'; end if;
  select * into h from public.hazards where id = p_hazard for update;
  if h.id is null then raise exception 'NOT_FOUND: Incident not found.' using errcode = 'P0001'; end if;
  v_score := case p_level when 'critical' then greatest((w ->> 'critical')::int, 90) when 'high' then (w ->> 'high')::int + 5
                          when 'medium' then (w ->> 'medium')::int + 5 else 15 end;
  update public.hazards set severity_overridden = true, severity_score = v_score, severity_level = p_level where id = h.id;
  perform public.log_update(h.id, 'severity_override', format('Priority changed %s → %s. Reason: %s', h.severity_level, p_level, trim(p_reason)), null, null, true);
end $$;

create or replace function public.add_hazard_note(p_hazard uuid, p_note text, p_internal boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff();
  if char_length(trim(coalesce(p_note, ''))) < 3 then raise exception 'INVALID: Write at least 3 characters.' using errcode = 'P0001'; end if;
  perform public.log_update(p_hazard, 'note', left(p_note, 1000), null, null, p_internal);
end $$;

create or replace function public.record_inspection(p_hazard uuid, p_when timestamptz, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff();
  perform public.log_update(p_hazard, 'inspection',
    'Inspection planned for ' || to_char(p_when, 'YYYY-MM-DD HH24:MI') || coalesce(' — ' || nullif(trim(p_note), ''), ''));
end $$;

create or replace function public.attach_staff_media(p_hazard uuid, p_path text, p_media public.media_kind, p_evidence public.evidence_kind)
returns void language plpgsql security definer set search_path = public, storage as $$
begin
  perform public.require_staff();
  if p_path not like 'evidence/' || p_hazard::text || '/%' then raise exception 'INVALID: Unexpected media path.' using errcode = 'P0001'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'hazard-media' and name = p_path) then
    raise exception 'INVALID: File was not uploaded.' using errcode = 'P0001';
  end if;
  insert into public.hazard_media (hazard_id, storage_path, media_type, evidence_type, uploaded_by, is_public)
  values (p_hazard, p_path, p_media, p_evidence, auth.uid(), p_evidence in ('after_repair', 'before_repair'));
  perform public.log_update(p_hazard, 'evidence', replace(p_evidence::text, '_', ' ') || ' photo added', null, null, true);
end $$;

create or replace function public.submit_repair(p_hazard uuid, p_summary text, p_completed_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare h public.hazards;
begin
  perform public.require_staff();
  select * into h from public.hazards where id = p_hazard for update;
  if h.status <> 'in_progress' then raise exception 'INVALID: Only in-progress incidents can receive a repair submission.' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_summary, ''))) < 10 then raise exception 'INVALID: Describe the repair (min. 10 characters).' using errcode = 'P0001'; end if;
  if p_completed_at > now() + interval '1 minute' then raise exception 'INVALID: Completion time cannot be in the future.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.hazard_media where hazard_id = h.id and evidence_type = 'after_repair' and media_type = 'image') then
    raise exception 'INVALID: An after-repair photograph is required.' using errcode = 'P0001';
  end if;
  insert into public.repair_submissions (hazard_id, summary, completed_at, submitted_by)
  values (h.id, trim(p_summary), p_completed_at, auth.uid())
  on conflict (hazard_id) do update set summary = excluded.summary, completed_at = excluded.completed_at,
    submitted_by = excluded.submitted_by, submitted_at = now();
  update public.hazards set status = 'verification_pending' where id = h.id;
  perform public.log_update(h.id, 'status', trim(p_summary), 'in_progress', 'repair_submitted');
  perform public.log_update(h.id, 'status', 'Awaiting review by an authorised reviewer', 'repair_submitted', 'verification_pending');
end $$;

create or replace function public.decide_verification(p_hazard uuid, p_decision public.verification_decision, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare h public.hazards; v_next public.hazard_status;
begin
  if not public.is_reviewer() then raise exception 'FORBIDDEN: Only authorised reviewers can verify repairs.' using errcode = 'P0001'; end if;
  select * into h from public.hazards where id = p_hazard for update;
  if h.status <> 'verification_pending' then raise exception 'INVALID: This incident is not awaiting verification.' using errcode = 'P0001'; end if;
  if p_decision <> 'approved' and char_length(trim(coalesce(p_notes, ''))) < 5 then
    raise exception 'INVALID: Explain why the evidence is not accepted.' using errcode = 'P0001';
  end if;
  if p_decision = 'approved' and not exists (select 1 from public.hazard_media where hazard_id = h.id and evidence_type = 'after_repair') then
    raise exception 'INVALID: No after-repair photo on file.' using errcode = 'P0001';
  end if;
  v_next := case p_decision when 'approved' then 'verified_resolved' when 'rejected' then 'reopened' else 'in_progress' end;
  insert into public.repair_verifications (hazard_id, reviewer_id, decision, notes) values (h.id, auth.uid(), p_decision, coalesce(trim(p_notes), ''));
  update public.hazards set status = v_next, resolved_at = case when v_next = 'verified_resolved' then now() else null end where id = h.id;
  perform public.log_update(h.id, 'verification',
    case p_decision when 'approved' then 'Repair approved' when 'rejected' then 'Evidence rejected' else 'Another photo requested' end
      || coalesce(': ' || nullif(trim(p_notes), ''), ''), h.status, v_next);
  perform public.recompute_severity(h.id);
end $$;

create or replace function public.set_media_public(p_media uuid, p_public boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff();
  update public.hazard_media set is_public = p_public where id = p_media;
end $$;

-- ── Administration ───────────────────────────────────────────────────────
create or replace function public.set_user_role(p_user uuid, p_role public.app_role, p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN: Only administrators can change roles.' using errcode = 'P0001'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'INVALID: You cannot remove your own administrator role.' using errcode = 'P0001'; end if;
  perform set_config('civiclens.role_change', 'on', true);
  update public.profiles set role = p_role, team_id = p_team where id = p_user;
end $$;

-- ── Triggers ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Citizen'), 60));
  return new; -- role always defaults to 'citizen'; never read from metadata
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.protect_profile_privileges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.team_id is distinct from old.team_id)
     and coalesce(current_setting('civiclens.role_change', true), 'off') <> 'on' then
    raise exception 'FORBIDDEN: Roles can only be changed by an administrator.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger protect_profile before update on public.profiles for each row execute function public.protect_profile_privileges();

create or replace function public.notify_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reporter_id is not null and new.status is distinct from old.status then
    insert into public.notifications (user_id, hazard_id, notification_type, message)
    values (new.reporter_id, new.id,
      case when new.status in ('verified_resolved', 'reopened') then 'verification'::public.notification_kind
           when new.status = 'assigned' then 'assignment' else 'status_change' end,
      format('Your report %s is now “%s”.', new.ref, replace(new.status::text, '_', ' ')));
  end if;
  return new;
end $$;
create trigger hazards_notify after update of status on public.hazards for each row execute function public.notify_status_change();

-- Broadcast minimal change events (no private fields) for realtime map/queue updates.
create or replace function public.broadcast_hazard_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(jsonb_build_object('id', new.id, 'status', new.status, 'severity_level', new.severity_level),
                          'hazard_changed', 'hazards', false);
  exception when others then null; -- realtime.send unavailable: clients fall back to polling
  end;
  return new;
end $$;
create trigger hazards_broadcast after insert or update on public.hazards for each row execute function public.broadcast_hazard_change();

-- ── Public read models (no reporter identity, no internal notes) ─────────
create view public.public_hazards as
  select id, ref, category, description, latitude, longitude, location_label, severity_score, severity_level,
         severity_overridden, immediate_danger, blocks_road, exposure, accessibility_note, corroborations, status,
         assigned_team_id, thumbnail_path, is_demo, flagged, created_at, updated_at, resolved_at
    from public.hazards where not hidden and status <> 'dismissed';

create view public.public_hazard_media as
  select m.id, m.hazard_id, m.storage_path, m.media_type, m.evidence_type, m.created_at
    from public.hazard_media m join public.hazards h on h.id = m.hazard_id
   where m.is_public and not h.hidden and h.status <> 'dismissed';

create view public.public_hazard_updates as
  select u.id, u.hazard_id, u.kind, u.previous_status, u.new_status, u.note, u.created_at,
         case when u.actor_id is null then 'Anonymous reporter'
              when u.actor_id = h.reporter_id then 'Reporter'
              else 'Municipal team' end as actor_label
    from public.hazard_updates u join public.hazards h on h.id = u.hazard_id
   where not u.internal and not h.hidden and h.status <> 'dismissed';

create view public.public_repair_verifications as
  select v.id, v.hazard_id, v.decision, v.notes, v.created_at
    from public.repair_verifications v join public.hazards h on h.id = v.hazard_id where not h.hidden;

create view public.public_repairs as
  select r.hazard_id, r.summary, r.completed_at from public.repair_submissions r
    join public.hazards h on h.id = r.hazard_id where not h.hidden;
