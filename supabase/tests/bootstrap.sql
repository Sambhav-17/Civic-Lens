-- Minimal stand-ins for the Supabase platform pieces the migrations depend on.
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
create schema auth; create schema storage; create schema realtime; create schema extensions;
grant usage on schema public, extensions, storage, auth to anon, authenticated;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert on storage.objects to anon, authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
grant execute on function storage.foldername(text) to anon, authenticated;
create table realtime.messages (payload jsonb, event text, topic text);
create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language sql as $$ insert into realtime.messages values (payload, event, topic) $$;
create publication supabase_realtime;
-- PostGIS stand-ins (geography column replaced below; distance via haversine)
create function extensions.st_dwithin(a double precision[], b double precision[], m double precision) returns boolean language sql immutable as $$
  select 2*6371000*asin(sqrt(power(sin(radians(b[1]-a[1])/2),2)+cos(radians(a[1]))*cos(radians(b[1]))*power(sin(radians(b[2]-a[2])/2),2))) <= m $$;

-- Emulate Supabase default privileges on the public schema.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
