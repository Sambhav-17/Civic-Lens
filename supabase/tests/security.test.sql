\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
-- Test helpers (security invoker → run with the caller's privileges)
create schema t; grant usage on schema t to anon, authenticated;
create function t.expect_error(q text, pat text) returns text language plpgsql as $$
begin execute q; return 'FAIL (no error): ' || q;
exception when others then
  if sqlerrm ~* pat then return 'ok'; else return 'FAIL (wrong error ' || sqlerrm || '): ' || q; end if;
end $$;
create function t.ok(cond boolean, label text) returns text language sql as $$ select case when cond then 'ok' else 'FAIL: ' || label end $$;
grant execute on all functions in schema t to anon, authenticated;
create function t.as_user(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on function t.as_user(text) to anon, authenticated;

-- Setup (as postgres)
insert into public.teams (id, name, service_area) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Drains', 'City');
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'cit@x.test', '{"display_name":"Citizen","role":"admin"}'),
  ('22222222-2222-2222-2222-222222222222', 'staff@x.test', '{"display_name":"Staff"}'),
  ('33333333-3333-3333-3333-333333333333', 'rev@x.test', '{"display_name":"Reviewer"}'),
  ('44444444-4444-4444-4444-444444444444', 'admin@x.test', '{"display_name":"Admin"}');
select t.ok((select role from profiles where id = '11111111-1111-1111-1111-111111111111') = 'citizen', 'signup metadata cannot grant roles');
begin; set local civiclens.role_change = 'on';
update profiles set role = 'staff', team_id = 'aaaaaaaa-0000-0000-0000-000000000001' where id = '22222222-2222-2222-2222-222222222222';
update profiles set role = 'reviewer' where id = '33333333-3333-3333-3333-333333333333';
update profiles set role = 'admin' where id = '44444444-4444-4444-4444-444444444444';
commit;

-- ── Anonymous visitor ─────────────────────────────────────────
set role anon; select t.as_user('');
select (submit_hazard('{"category":"open_manhole","description":"Cover missing","latitude":12.95,"longitude":77.6,"immediate_danger":true,"blocks_road":false,"exposure":"pedestrians","anonymous":true}') ) as r \gset
select :'r'::jsonb -> 'hazard' ->> 'id' as hid, :'r'::jsonb ->> 'upload_token' as tok \gset
select t.ok((:'r'::jsonb -> 'hazard' ->> 'severity_level') = 'critical', 'server-side severity: active open manhole = critical');
select t.ok((:'r'::jsonb -> 'hazard' ->> 'ref') ~ '^CL-[A-Z2-9]{6}$', 'unique ref generated');
select t.ok(not (:'r'::jsonb -> 'hazard' ? 'reporter_id'), 'reporter_id not returned');
select t.expect_error($$select submit_hazard('{"category":"pothole","latitude":123,"longitude":77}')$$, 'Invalid coordinates');
select t.ok((select count(*) from hazards) = 0, 'anon cannot read hazards table rows (RLS)');
select t.ok((select count(*) from public_hazards) = 1, 'anon reads public view');
select t.ok(not exists (select 1 from information_schema.columns where table_name = 'public_hazards' and column_name = 'reporter_id'), 'public view hides reporter_id');
select t.expect_error($$select log_update('$$ || :'hid' || $$'::uuid, 'note', 'forged')$$, 'permission denied');
select t.expect_error($$select recompute_severity('$$ || :'hid' || $$'::uuid)$$, 'permission denied');
select t.expect_error($$truncate hazards$$, 'permission denied');
select t.expect_error($$update hazards set status = 'verified_resolved'$$, 'permission denied');
select t.expect_error($$insert into hazard_updates (hazard_id, note) values ('$$ || :'hid' || $$', 'x')$$, 'permission denied');
select t.expect_error($$select transition_hazard('$$ || :'hid' || $$'::uuid, 'triaged')$$, 'permission denied|FORBIDDEN');
select t.expect_error($$select * from submission_tokens$$, 'permission denied');
-- Upload with the right token is allowed; wrong token / wrong folder is refused by storage RLS
insert into storage.objects (bucket_id, name) values ('hazard-media', 'reports/' || :'hid' || '/' || :'tok' || '/a.jpg');
select t.expect_error($$insert into storage.objects (bucket_id, name) values ('hazard-media', 'reports/$$ || :'hid' || $$/badtoken/b.jpg')$$, 'row-level security');
select t.expect_error($$insert into storage.objects (bucket_id, name) values ('hazard-media', 'evidence/$$ || :'hid' || $$/c.jpg')$$, 'row-level security');
select attach_report_media(:'hid'::uuid, :'tok', 'reports/' || :'hid' || '/' || :'tok' || '/a.jpg', 'image');
select t.expect_error($$select attach_report_media('$$ || :'hid' || $$'::uuid, 'wrong', 'reports/x/wrong/a.jpg', 'image')$$, 'Upload window closed');
select t.ok((select count(*) from public_hazard_media) = 1, 'public media visible after attach');
select t.ok((select count(*) from find_duplicates('open_manhole', 12.95005, 77.60005)) = 1, 'duplicate detection within 30 m');
select t.ok((select count(*) from find_duplicates('open_manhole', 12.96, 77.6)) = 0, 'no duplicate 1 km away');
select corroborate_hazard(:'hid'::uuid);
select t.expect_error($$select corroborate_hazard('$$ || :'hid' || $$'::uuid)$$, 'already confirmed');
-- Rate limit: 5 submissions per 10 minutes per client (1 already used)
select submit_hazard('{"category":"pothole","latitude":12.1,"longitude":77.1}') is not null from generate_series(1,4);
select t.expect_error($$select submit_hazard('{"category":"pothole","latitude":12.2,"longitude":77.2}')$$, 'RATE_LIMITED');
reset role;
delete from rate_events;

-- ── Citizen ───────────────────────────────────────────────────
set role authenticated; select t.as_user('11111111-1111-1111-1111-111111111111');
select (submit_hazard('{"category":"pothole","description":"Deep pothole","latitude":12.97,"longitude":77.59,"exposure":"vehicles","anonymous":false}') -> 'hazard' ->> 'id') as cid \gset
select t.ok((select count(*) from hazards) = 1, 'citizen sees only own row in hazards table');
select t.expect_error($$select transition_hazard('$$ || :'cid' || $$'::uuid, 'triaged')$$, 'FORBIDDEN');
select t.expect_error($$select override_severity('$$ || :'cid' || $$'::uuid, 'low', 'not a real problem')$$, 'FORBIDDEN');
select t.expect_error($$update profiles set role = 'admin' where id = auth.uid()$$, 'permission denied|FORBIDDEN');
select t.expect_error($$select set_user_role(auth.uid(), 'admin', null)$$, 'FORBIDDEN');
update profiles set display_name = 'Citizen Renamed' where id = auth.uid();
select t.ok((select display_name from profiles where id = auth.uid()) = 'Citizen Renamed', 'citizen can edit own display name');
select t.ok((select count(*) from profiles) = 1, 'citizen sees only own profile');
reset role;

-- ── Staff: triage → assign → in progress → repair submitted ───
set role authenticated; select t.as_user('22222222-2222-2222-2222-222222222222');
select t.ok((select count(*) from hazards) = 6, 'staff reads all hazards');
select t.expect_error($$select transition_hazard('$$ || :'cid' || $$'::uuid, 'in_progress')$$, 'not allowed');
select transition_hazard(:'cid'::uuid, 'triaged', 'Confirmed from photo');
select t.expect_error($$select transition_hazard('$$ || :'cid' || $$'::uuid, 'assigned')$$, 'Assign a team first');
select assign_hazard(:'cid'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', 'urgent');
select transition_hazard(:'cid'::uuid, 'in_progress');
select add_hazard_note(:'cid'::uuid, 'Contractor contacted', true);
select override_severity(:'cid'::uuid, 'high', 'Busy junction near school');
select t.ok((select severity_level::text from hazards where id = :'cid') = 'high' and (select severity_overridden from hazards where id = :'cid'), 'override applied');
select t.expect_error($$select submit_repair('$$ || :'cid' || $$'::uuid, 'Filled and compacted', now())$$, 'after-repair photograph is required');
insert into storage.objects (bucket_id, name) values ('hazard-media', 'evidence/' || :'cid' || '/after.jpg');
select attach_staff_media(:'cid'::uuid, 'evidence/' || :'cid' || '/after.jpg', 'image', 'after_repair');
select t.expect_error($$select submit_repair('$$ || :'cid' || $$'::uuid, 'Filled and compacted', now() + interval '2 days')$$, 'future');
select submit_repair(:'cid'::uuid, 'Filled and compacted, surface sealed', now());
select t.ok((select status::text from hazards where id = :'cid') = 'verification_pending', 'repair → verification pending');
select t.expect_error($$select decide_verification('$$ || :'cid' || $$'::uuid, 'approved', '')$$, 'Only authorised reviewers');
select t.expect_error($$select transition_hazard('$$ || :'cid' || $$'::uuid, 'verified_resolved')$$, 'not allowed|verification review');
select t.expect_error($$select set_user_role('11111111-1111-1111-1111-111111111111', 'admin', null)$$, 'FORBIDDEN');
reset role;

-- ── Reviewer ──────────────────────────────────────────────────
set role authenticated; select t.as_user('33333333-3333-3333-3333-333333333333');
select t.expect_error($$select decide_verification('$$ || :'cid' || $$'::uuid, 'rejected', '')$$, 'Explain why');
select decide_verification(:'cid'::uuid, 'approved', 'Photo matches location');
select t.ok((select status::text from hazards where id = :'cid') = 'verified_resolved' and (select resolved_at is not null from hazards where id = :'cid'), 'reviewer approval resolves');
select t.ok((select array_agg(new_status::text order by created_at) from hazard_updates where hazard_id = :'cid' and new_status is not null)
  = array['reported','triaged','assigned','in_progress','repair_submitted','verification_pending','verified_resolved'], 'full audit trail recorded');
select t.ok((select count(*) from hazard_updates where hazard_id = :'cid' and kind = 'severity_override' and actor_id = '22222222-2222-2222-2222-222222222222') = 1, 'override audited with actor');
reset role;

-- ── Notifications & public read models ────────────────────────
set role authenticated; select t.as_user('11111111-1111-1111-1111-111111111111');
select t.ok((select count(*) from notifications) >= 4, 'reporter notified of status changes');
update notifications set read_at = now();
select t.ok((select count(*) from notifications where read_at is null) = 0, 'reporter marks notifications read');
reset role;
set role anon; select t.as_user('');
select t.ok((select count(*) from public_hazard_updates where note = 'Contractor contacted') = 0, 'internal notes hidden from public');
select t.ok((select bool_and(actor_label in ('Reporter','Municipal team','Anonymous reporter')) from public_hazard_updates), 'public timeline shows role labels only');
select t.ok((public_stats() ->> 'verifiedRepairs')::int = 1, 'public stats count verified repairs');
select t.ok((select count(*) from notifications) = 0, 'anon sees no notifications');
reset role;

-- ── Admin ─────────────────────────────────────────────────────
set role authenticated; select t.as_user('44444444-4444-4444-4444-444444444444');
select set_user_role('11111111-1111-1111-1111-111111111111', 'staff', 'aaaaaaaa-0000-0000-0000-000000000001');
select t.ok((select role::text from profiles where id = '11111111-1111-1111-1111-111111111111') = 'staff', 'admin can grant roles');
select t.expect_error($$select set_user_role(auth.uid(), 'citizen', null)$$, 'own administrator role');
insert into teams (name, service_area) values ('Forestry', 'North');
reset role;
set role authenticated; select t.as_user('22222222-2222-2222-2222-222222222222');
select t.expect_error($$insert into teams (name, service_area) values ('Rogue', 'X')$$, 'row-level security');
reset role;
select t.ok((select count(*) from realtime.messages where topic = 'hazards') > 0, 'hazard changes broadcast on realtime topic');
