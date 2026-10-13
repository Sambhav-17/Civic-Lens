-- CivicLens — DEMO seed for a SEPARATE demo/staging Supabase project.
-- Every row is fictional and flagged is_demo = true. Never run this on a live project:
-- demo records must not be mixed with real public reports.

insert into public.teams (id, name, service_area) values
  ('00000000-0000-0000-0000-0000000000a1', 'Roads & Footpaths — East', 'East zone'),
  ('00000000-0000-0000-0000-0000000000a2', 'Electrical Safety Cell', 'City-wide'),
  ('00000000-0000-0000-0000-0000000000a3', 'Stormwater & Drains', 'Central & South'),
  ('00000000-0000-0000-0000-0000000000a4', 'Urban Forestry', 'City-wide'),
  ('00000000-0000-0000-0000-0000000000a5', 'Traffic Engineering', 'City-wide')
on conflict (id) do nothing;

insert into public.hazards (ref, category, description, latitude, longitude, location_label, immediate_danger, blocks_road, exposure, status, assigned_team_id, is_demo, created_at)
values
  ('CL-DEMO01', 'open_manhole', 'Manhole cover missing next to the bus stop. (demo)', 12.9836, 77.6256, 'Near bus stop, 80 Feet Road (demo)', true, false, 'pedestrians', 'reported', null, true, now() - interval '5 hours'),
  ('CL-DEMO02', 'electrical_wire', 'Cable hanging low across the lane after the storm. (demo)', 12.9656, 77.6056, 'Service lane behind market (demo)', true, false, 'both', 'triaged', null, true, now() - interval '1 day'),
  ('CL-DEMO03', 'pothole', 'Deep pothole in the left lane. (demo)', 12.9926, 77.5906, 'Junction near metro pillar 112 (demo)', false, true, 'vehicles', 'reported', null, true, now() - interval '4 days'),
  ('CL-DEMO04', 'waterlogging', 'Knee-deep water in the underpass. (demo)', 12.9536, 77.5726, 'Underpass, Ring Road (demo)', false, true, 'both', 'reported', null, true, now() - interval '14 hours'),
  ('CL-DEMO05', 'broken_footpath', 'Three slabs broken outside the school gate. (demo)', 12.9756, 77.5776, 'School street footpath (demo)', false, false, 'pedestrians', 'reported', null, true, now() - interval '3 days'),
  ('CL-DEMO06', 'drain_cover', 'Drain grate snapped, opening about 40 cm wide. (demo)', 12.9606, 77.6186, 'Corner of 4th Cross (demo)', false, false, 'pedestrians', 'reported', null, true, now() - interval '6 days')
on conflict (ref) do nothing;

insert into public.hazard_updates (hazard_id, kind, new_status, note, created_at)
select id, 'status', 'reported', 'Report submitted (demo seed)', created_at from public.hazards where is_demo
on conflict do nothing;

select public.recompute_severity(id) from public.hazards where is_demo;

-- Test accounts: create users in Authentication → Users (e.g. staff@demo.example,
-- reviewer@demo.example, admin@demo.example), then grant roles in the SQL editor.
-- The protect_profile trigger blocks role changes unless this flag is set for the transaction:
--
-- begin;
--   set local civiclens.role_change = 'on';
--   update public.profiles set role = 'admin'    where id = (select id from auth.users where email = 'admin@demo.example');
--   update public.profiles set role = 'reviewer' where id = (select id from auth.users where email = 'reviewer@demo.example');
--   update public.profiles set role = 'staff', team_id = '00000000-0000-0000-0000-0000000000a1'
--    where id = (select id from auth.users where email = 'staff@demo.example');
-- commit;
