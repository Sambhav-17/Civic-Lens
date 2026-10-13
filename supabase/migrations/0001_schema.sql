-- CivicLens — schema
-- Run with the Supabase CLI (`supabase db push`) or paste into the SQL editor in order.

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ── Enums ────────────────────────────────────────────────────────────────
create type public.app_role as enum ('citizen', 'staff', 'reviewer', 'admin');
create type public.hazard_category as enum (
  'open_manhole', 'electrical_wire', 'pothole', 'broken_footpath', 'waterlogging',
  'drain_cover', 'fallen_tree', 'traffic_signal', 'other');
create type public.severity_level as enum ('critical', 'high', 'medium', 'low');
create type public.hazard_status as enum (
  'reported', 'triaged', 'assigned', 'in_progress', 'repair_submitted',
  'verification_pending', 'verified_resolved', 'reopened', 'dismissed');
create type public.exposure_kind as enum ('pedestrians', 'vehicles', 'both', 'unknown');
create type public.media_kind as enum ('image', 'video', 'audio');
create type public.evidence_kind as enum ('report', 'before_repair', 'after_repair', 'supporting');
create type public.update_kind as enum ('status', 'note', 'assignment', 'severity_override', 'corroboration', 'verification', 'inspection', 'evidence', 'flag');
create type public.verification_decision as enum ('approved', 'rejected', 'photo_requested');
create type public.notification_kind as enum ('status_change', 'assignment', 'verification', 'system');

-- ── Settings (severity weights are configurable here) ────────────────────
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values ('severity', '{
  "category": {"electrical_wire":50,"open_manhole":45,"drain_cover":35,"traffic_signal":30,"fallen_tree":25,"pothole":22,"waterlogging":20,"broken_footpath":15,"other":10},
  "immediateDanger": 18, "electricalExposure": 12, "openGround": 10,
  "exposure": {"both":10,"pedestrians":6,"vehicles":6,"unknown":2},
  "roadObstruction": 8,
  "confidence": {"photo":4,"description":1,"max":5},
  "corroboration": {"perReport":2,"max":8},
  "duration": {"perDay":0.5,"max":7},
  "floors": {"lifeThreateningCategory":70,"lifeThreateningAndActive":85},
  "thresholds": {"critical":80,"high":60,"medium":35}
}'::jsonb);

-- ── Teams & profiles ─────────────────────────────────────────────────────
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  service_area text not null check (char_length(service_area) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 60),
  role public.app_role not null default 'citizen',
  team_id uuid references public.teams (id) on delete set null,
  notify_email boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── Hazards ──────────────────────────────────────────────────────────────
create table public.hazards (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  reporter_id uuid references public.profiles (id) on delete set null,
  category public.hazard_category not null,
  description text not null default '' check (char_length(description) <= 600),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  location extensions.geography(Point, 4326)
    generated always as (extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography) stored,
  location_label text check (char_length(location_label) <= 200),
  severity_score smallint not null default 0 check (severity_score between 0 and 100),
  severity_level public.severity_level not null default 'low',
  severity_overridden boolean not null default false,
  immediate_danger boolean not null default false,
  blocks_road boolean not null default false,
  exposure public.exposure_kind not null default 'unknown',
  accessibility_note text check (char_length(accessibility_note) <= 300),
  corroborations integer not null default 0 check (corroborations >= 0),
  status public.hazard_status not null default 'reported',
  assigned_team_id uuid references public.teams (id) on delete set null,
  thumbnail_path text,
  is_demo boolean not null default false,
  flagged boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index hazards_location_gix on public.hazards using gist (location);
create index hazards_status_idx on public.hazards (status);
create index hazards_severity_idx on public.hazards (severity_level, severity_score desc);
create index hazards_created_idx on public.hazards (created_at desc);
create index hazards_team_idx on public.hazards (assigned_team_id);
create index hazards_reporter_idx on public.hazards (reporter_id);
create index hazards_category_idx on public.hazards (category);

create table public.hazard_media (
  id uuid primary key default gen_random_uuid(),
  hazard_id uuid not null references public.hazards (id) on delete cascade,
  storage_path text not null unique,
  media_type public.media_kind not null,
  evidence_type public.evidence_kind not null default 'report',
  uploaded_by uuid references public.profiles (id) on delete set null,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index hazard_media_hazard_idx on public.hazard_media (hazard_id);

create table public.hazard_updates (
  id uuid primary key default gen_random_uuid(),
  hazard_id uuid not null references public.hazards (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  kind public.update_kind not null default 'status',
  previous_status public.hazard_status,
  new_status public.hazard_status,
  note text check (char_length(note) <= 1000),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index hazard_updates_hazard_idx on public.hazard_updates (hazard_id, created_at);

create table public.hazard_assignments (
  id uuid primary key default gen_random_uuid(),
  hazard_id uuid not null references public.hazards (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  assigned_by uuid not null references public.profiles (id),
  assigned_at timestamptz not null default now()
);
create index hazard_assignments_hazard_idx on public.hazard_assignments (hazard_id);
create index hazard_assignments_team_idx on public.hazard_assignments (team_id);

create table public.repair_submissions (
  hazard_id uuid primary key references public.hazards (id) on delete cascade,
  summary text not null check (char_length(summary) between 10 and 1000),
  completed_at timestamptz not null,
  submitted_by uuid not null references public.profiles (id),
  submitted_at timestamptz not null default now()
);

create table public.repair_verifications (
  id uuid primary key default gen_random_uuid(),
  hazard_id uuid not null references public.hazards (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id),
  decision public.verification_decision not null,
  notes text not null default '' check (char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index repair_verifications_hazard_idx on public.repair_verifications (hazard_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  hazard_id uuid references public.hazards (id) on delete cascade,
  notification_type public.notification_kind not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.hazard_flags (
  id uuid primary key default gen_random_uuid(),
  hazard_id uuid not null references public.hazards (id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 500),
  flagged_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Single-use upload tokens so anonymous reporters can attach media to *their* report only.
create table public.submission_tokens (
  hazard_id uuid primary key references public.hazards (id) on delete cascade,
  token_hash text not null,
  uploads integer not null default 0,
  expires_at timestamptz not null default now() + interval '20 minutes'
);

-- Rate limiting buckets (hashed client key, never raw IPs).
create table public.rate_events (
  id bigserial primary key,
  bucket text not null,
  client_hash text not null,
  created_at timestamptz not null default now()
);
create index rate_events_lookup_idx on public.rate_events (bucket, client_hash, created_at desc);

create table public.corroborations (
  hazard_id uuid not null references public.hazards (id) on delete cascade,
  client_hash text not null,
  created_at timestamptz not null default now(),
  primary key (hazard_id, client_hash)
);
