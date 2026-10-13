# CivicLens

**Spot a hazard. Pin the problem. Make your city safer.**

CivicLens is a hyper-local civic hazard platform. It combines photo-first reporting, a public safety map, transparent severity scoring, a municipal operations dashboard and photo-verified repairs. A shared procedural 3D smart-city (React Three Fiber) runs behind every page.

## Quick start (demo mode, no accounts or keys needed)

```bash
npm install
npm run dev        # http://localhost:5173
```

With no Supabase keys, the app runs in **demo mode**:
- A clearly labelled banner appears on every page.
- About 24 **fictional** incidents are seeded into your browser (localStorage + IndexedDB). They are flagged `is_demo` and never mixed with live data.
- A simulated backend applies the same rules as the SQL functions: role checks, workflow transitions, server-side severity scoring, rate limiting and duplicate detection. It is **not** a security boundary. Real enforcement lives in Postgres.
- Changes sync across browser tabs. The status pill reads "Demo · local sync" rather than claiming to be live.

Demo test accounts (password `Demo-pass-2026`). The sign-in page also has one-click buttons for each:

| Role | Email |
|---|---|
| Citizen | citizen@demo.civiclens.app |
| Municipal staff (Roads team) | staff@demo.civiclens.app |
| Reviewer | reviewer@demo.civiclens.app |
| Administrator | admin@demo.civiclens.app |

To restore the seed data, go to **Profile → Reset demo data**.

## Connect Supabase (production backend)

1. Create a Supabase project. PostGIS is available on all projects.
2. Run the migrations in order, either with the CLI (`supabase link && supabase db push`) or by pasting them into the SQL editor:
   - `supabase/migrations/0001_schema.sql`: tables, enums, indexes, PostGIS geography and constraints
   - `supabase/migrations/0002_functions.sql`: severity model, workflow functions, triggers and public read models
   - `supabase/migrations/0003_security.sql`: RLS policies, grants, storage bucket and policies, realtime
3. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. **Never** put the service-role key in a `VITE_` variable.
4. Enable email confirmations under **Authentication → Providers → Email**. You can optionally enable OAuth providers there too; the client needs no changes.
5. Optional: schedule `select public.refresh_open_severity();` hourly with `pg_cron`, so the "time unresolved" factor keeps growing.
6. Optional, for a separate staging project only: run `supabase/seed.demo.sql` to load fictional incidents, then grant roles to your test users as described at the bottom of that file.

### Security model
- Clients have **no direct INSERT/UPDATE** rights on workflow tables. Every write goes through `SECURITY DEFINER` functions (`submit_hazard`, `transition_hazard`, `assign_hazard`, `override_severity`, `submit_repair`, `decide_verification`, `set_user_role` …), which check the caller's role server-side.
- **Severity is computed in SQL** (`compute_severity`) from the weights in `app_settings`. The client never sends a score, role, user id or workflow transition that is trusted.
- **Public reads** go through views (`public_hazards`, `public_hazard_media`, `public_hazard_updates` …). These never expose reporter identity, internal notes or hidden media.
- **Anonymous uploads** use a single-use token returned by `submit_hazard`. Storage policies only accept files under `reports/<hazard>/<token>/`, while the token is valid and the upload quota isn't exceeded. Bucket MIME types and the 25 MB size limit are enforced by Storage. The client also checks magic bytes, compresses photos and strips EXIF data.
- **Rate limits**: 5 reports per 10 minutes, keyed by a hash of the user id or forwarded IP (never raw IPs). Corroboration and flagging are limited the same way. Duplicate reports within 30 m and 72 h are offered as "confirm existing" instead.
- **Roles**: new users are always `citizen`. A trigger blocks any role or team change that doesn't come from `set_user_role()` (admins only).
- **Moderation**: the public can flag reports. Staff can hide sensitive media (faces, number plates) and dismiss spam.

### Realtime
- Hazard changes are broadcast on the `hazards` topic by a trigger (`realtime.send`), carrying ids only. Clients refetch through RLS-protected queries.
- Notifications stream per user via `postgres_changes` on `notifications`, filtered by RLS.
- The header pill shows **Live** only while the channel is actually subscribed. Otherwise it shows Connecting, Reconnecting or Offline. Reconnects back off and trigger a catch-up refetch.

## Severity model

Scores run from 0 to 100, from documented weights (`src/lib/severity.ts` mirrors the SQL function):

| Factor | Points |
|---|---|
| Category baseline | electrical wire 50 · open manhole 45 · drain cover 35 · traffic signal 30 · fallen tree 25 · pothole 22 · waterlogging 20 · footpath 15 · other 10 |
| Actively endangering people | +18 |
| Electrical exposure | +12 |
| Open ground opening | +10 |
| Exposure (both / pedestrians or vehicles / unknown) | +10 / +6 / +2 |
| Blocks road | +8 |
| Evidence (photo +4, description +1) | max +5 |
| Independent corroboration | +2 each, **capped at +8** |
| Time unresolved | +0.5 per day, capped at +7 |

- **Floors**: an electrical wire or open manhole is at least **70 (High)**, and at least **85 (Critical)** if it's reported as actively endangering people.
- **Levels**: Critical ≥ 80, High ≥ 60, Medium ≥ 35, otherwise Low.
- Report volume is capped, so it can never outrank a life-threatening hazard.
- Staff overrides require a reason and are logged with the actor and time.
- Automated scores are always labelled *preliminary*.

## Routes

`/` landing · `/map` public map (map, list and 3D city views; heatmap; filters in the URL) · `/report` reporting wizard · `/hazards/:id` details and timeline · `/dashboard` overview · `/dashboard/queue` · `/dashboard/reports` · `/dashboard/assigned` · `/dashboard/verification` · `/dashboard/map` · `/dashboard/analytics` · `/dashboard/team` · `/dashboard/settings` · `/verify/:id` repair review · `/my-reports` · `/profile` · `/login` · `/signup` · `/admin` · `/legal/:doc`

## External services

| Service | Used for | Config | If missing |
|---|---|---|---|
| Supabase (Auth, Postgres + PostGIS, Storage, Realtime) | Backend | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Demo mode |
| Map tiles | Base map | `VITE_TILE_URL`, `VITE_TILE_ATTRIBUTION`, `VITE_TILE_DARK` | Defaults to OSM tiles (fine for dev; use your own provider in production) |
| Nominatim-compatible geocoder | Address search, reverse geocoding | `VITE_GEOCODER_URL` | Manual pin and coordinate entry |
| OSRM-compatible router | In-app walking routes with hazard check | `VITE_ROUTING_URL` | "Directions" opens OpenStreetMap |
| Email (Supabase Auth SMTP / Database Webhook → your mailer) | Verification, password reset, optional status emails | Supabase dashboard | In-app notifications only |

## Tests

```bash
npm test                          # unit + integration (Vitest)
npx playwright install chromium   # once
npm run test:e2e                  # end-to-end (desktop + mobile)
```

- **Unit tests** cover the severity model (determinism, floors, caps), workflow permissions and CSV escaping.
- **Integration tests** run against the demo backend and cover:
  - persistence and unique IDs
  - unauthorized modification
  - severity computation
  - triage, assignment and the audit trail
  - repair evidence and reviewer approval or rejection
  - role administration and notifications
- **E2E tests** cover:
  - public navigation
  - photo + location reporting
  - the keyboard-only reporting flow
  - upload errors
  - the staff → reviewer lifecycle
  - the WebGL-unavailable fallback (`?nowebgl`)
  - denied geolocation
  - no horizontal scroll on small screens

## Architecture

```
src/
  lib/            domain: types, severity, workflow, validation (Zod), geo, media, analytics
  lib/api/        CivicApi interface → supabaseApi.ts | demo/ (seeded local backend)
  components/
    three/        CityScene (one shared WebGL canvas, per-route variants) + sceneStore
    map/          HazardMap (clusters, heatmap, routes), LocationPicker
    ui/           design system (buttons, badges, dialogs, fields, skeletons…)
  pages/          one lazily loaded module per route
supabase/         migrations (schema, functions, RLS/storage/realtime), demo seed
e2e/              Playwright specs
```

**Performance**
- Routes and the 3D scene are lazy-loaded, and there is only one WebGL context.
- Buildings, windows, streetlights, vehicles and data bars are instanced.
- The pixel ratio is capped, and mobile gets a lower-detail scene.
- Rendering pauses when the tab is hidden or while the 2D map covers the scene.
- With reduced motion, the scene renders on demand only.
- A CSS fallback is used when WebGL is unavailable.
- Searches are debounced and lists paginated.

**Accessibility**
- Pages have a skip link, visible focus and labelled controls.
- Dialogs trap focus and close on Escape.
- Severity is shown by colour **plus** a glyph and label.
- Every map has a list view, and every chart has a table toggle.
- Location can be entered as coordinates.
- Reduced-motion preferences are respected.

> CivicLens is not an emergency service. For immediate danger, call your local emergency number.
