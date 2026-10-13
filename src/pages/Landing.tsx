import { motion } from 'framer-motion';
import {
  ArrowRight, Camera, ChevronDown, ClipboardCheck, Gauge, MapPin, ShieldCheck, Sparkles, Users, Wrench,
} from 'lucide-react';
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { HazardListItem } from '@/components/hazard';
import { useScene } from '@/components/three/sceneStore';
import { ButtonLink, Card, CategoryIcon, EmptyState, ErrorState, SeverityBadge, Skeleton, Stat } from '@/components/ui';
import { useQuery, useReducedMotion } from '@/hooks/useQuery';
import { api } from '@/lib/api';
import { CATEGORY_META } from '@/lib/categories';
import { durationLabel } from '@/lib/format';
import { computeSeverity } from '@/lib/severity';
import { CATEGORIES, type Category, type Exposure } from '@/lib/types';
import { LIFECYCLE, STATUS_META } from '@/lib/workflow';

const HazardMap = lazy(() => import('@/components/map/HazardMap'));

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function SectionHead({ eyebrow, title, body, id }: { eyebrow: string; title: ReactNode; body?: ReactNode; id?: string }) {
  return (
    <Reveal className="max-w-2xl">
      <p className="eyebrow" id={id}>{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl lg:text-5xl">{title}</h2>
      {body && <p className="mt-4 text-lg text-ink-2">{body}</p>}
    </Reveal>
  );
}

function FloatingCard({ className, tone, title, meta, delay }: { className: string; tone: 'red' | 'green'; title: string; meta: string; delay: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      className={clsx('glass-strong pointer-events-none absolute hidden w-64 p-3.5 xl:block', className)}
      initial={reduced ? false : { opacity: 0, y: 20 }}
      animate={reduced ? undefined : { opacity: 1, y: [0, -8, 0] }}
      transition={{ opacity: { delay, duration: 0.8 }, y: { delay, duration: 6, repeat: Infinity, ease: 'easeInOut' } }}
    >
      <div className="flex items-start gap-3">
        <span className={clsx('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl', tone === 'red' ? 'bg-critical/15 text-critical' : 'bg-success/15 text-success')}>
          {tone === 'red' ? <CategoryIcon category="open_manhole" /> : <ShieldCheck className="h-5 w-5" />}
        </span>
        <div>
          <p className="text-sm font-bold">{title}</p>
          <p className="text-xs text-ink-2">{meta}</p>
        </div>
      </div>
      <p className="mt-2.5 border-t border-line pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">Illustrative example</p>
    </motion.div>
  );
}

function Hero() {
  return (
    <section className="relative flex min-h-[calc(100dvh-4rem)] items-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-midnight/90 via-midnight/50 to-transparent" aria-hidden />
      <div className="container-x relative py-20">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1.5 text-xs font-semibold text-cyan backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Civic hazard intelligence for safer streets
          </span>
          <h1 className="mt-6 text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl lg:text-7xl">
            Your city has hazards. <span className="bg-gradient-to-r from-cyan via-[#8BE9FF] to-safety bg-clip-text text-transparent">Now it has a way to fix them.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-2 sm:text-xl">
            Report dangerous streets in seconds. Help neighbours navigate safely. Give civic teams the intelligence to prioritise what matters.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/report" size="lg">Report a Hazard <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink>
            <ButtonLink to="/map" size="lg" variant="secondary"><MapPin className="h-4 w-4" aria-hidden /> Explore Safety Map</ButtonLink>
          </div>
          <p className="mt-6 text-sm text-ink-3">No account needed to report. Anonymous reports welcome.</p>
        </motion.div>
        <FloatingCard className="right-8 top-24" tone="red" title="Open manhole detected" meta="High severity · 120 m away" delay={0.6} />
        <FloatingCard className="bottom-24 right-48" tone="green" title="Footpath repair verified" meta="Resolved · Photo confirmed" delay={1} />
      </div>
      <a href="#impact" className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1 text-xs text-ink-3 hover:text-ink sm:flex" aria-label="Scroll to live impact">
        Scroll <ChevronDown className="h-4 w-4 animate-bounce" aria-hidden />
      </a>
    </section>
  );
}

function Impact() {
  const stats = useQuery(() => api.getPublicStats(), []);
  const s = stats.data;
  return (
    <section className="container-x py-24" aria-labelledby="impact">
      <SectionHead id="impact" eyebrow="Live impact" title="Every report moves the city forward." body={api.mode === 'demo' ? 'These figures come from the demo database in your browser (fictional incidents).' : 'Live figures from the CivicLens database.'} />
      {stats.error ? (
        <Card className="mt-10"><ErrorState title="Statistics are unavailable right now" error={stats.error} onRetry={stats.reload} /></Card>
      ) : s && s.total === 0 ? (
        <Card className="mt-10"><EmptyState title="No reports yet" body="Be the first to report a hazard in your area." action={<ButtonLink to="/report">Report a hazard</ButtonLink>} /></Card>
      ) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Reveal><Stat loading={stats.loading} label="Hazards reported" value={s?.total.toLocaleString()} /></Reveal>
          <Reveal delay={0.05}><Stat loading={stats.loading} tone="red" label="Critical, awaiting action" value={s?.criticalOpen.toLocaleString()} /></Reveal>
          <Reveal delay={0.1}><Stat loading={stats.loading} tone="green" label="Verified repairs" value={s?.verifiedRepairs.toLocaleString()} /></Reveal>
          <Reveal delay={0.15}>
            <Stat loading={stats.loading} tone="orange" label="Average resolution time" value={s?.avgResolutionHours != null ? durationLabel(s.avgResolutionHours * 3_600_000) : '—'} hint={s?.avgResolutionHours == null ? 'No verified repairs yet' : 'Report to verified repair'} />
          </Reveal>
        </div>
      )}
    </section>
  );
}

const STEPS = [
  { icon: MapPin, title: 'Spot a hazard', body: 'An open manhole, a dangling wire, a flooded underpass. Keep a safe distance.' },
  { icon: Camera, title: 'Capture & pin it', body: 'Snap a photo from where you are and drop a pin. About 15 seconds.' },
  { icon: Gauge, title: 'Risk is prioritised', body: 'A transparent severity model ranks the danger so crews act on what matters first.' },
  { icon: ClipboardCheck, title: 'Fix is verified', body: 'Crews upload after-repair photos. A reviewer confirms before it’s marked resolved.' },
];

function HowItWorks() {
  return (
    <section className="container-x py-24">
      <SectionHead id="how" eyebrow="How it works" title="From sidewalk to solved, in four steps." />
      <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <Reveal key={s.title} delay={i * 0.08}>
            <li className="group glass relative h-full overflow-hidden p-6 transition hover:-translate-y-1 hover:border-cyan/40">
              <span className="font-mono text-xs text-ink-3">0{i + 1}</span>
              <span className="mt-4 grid h-12 w-12 place-items-center rounded-2xl border border-cyan/30 bg-cyan/10 text-cyan transition group-hover:shadow-glow"><s.icon className="h-6 w-6" aria-hidden /></span>
              <h3 className="mt-5 text-lg font-bold">{s.title}</h3>
              <p className="mt-2 text-sm text-ink-2">{s.body}</p>
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-cyan/5 blur-2xl transition group-hover:bg-cyan/15" aria-hidden />
            </li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

function MapPreview() {
  const nav = useNavigate();
  const q = useQuery(() => api.listHazards({ sort: 'newest', pageSize: 200 }), []);
  const items = q.data?.items ?? [];
  return (
    <section className="container-x py-24">
      <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.3fr]">
        <SectionHead eyebrow="Public safety map" title="See risk before you reach it." body="Every report appears on a shared, public map with severity, status and photos — so neighbours can plan safer routes and crews can see the whole picture." />
        <Reveal delay={0.1}>
          <Card className="overflow-hidden p-1.5">
            <div className="relative h-[380px] overflow-hidden rounded-xl">
              {q.loading ? <Skeleton className="h-full w-full" /> : q.error ? <ErrorState error={q.error} onRetry={q.reload} /> : (
                <Suspense fallback={<Skeleton className="h-full w-full" />}>
                  <HazardMap hazards={items} className="h-full w-full" fitKey="preview" onSelect={(h) => nav(`/hazards/${h.id}`)} label="Preview map of reported hazards" />
                </Suspense>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] flex justify-end p-3">
                <ButtonLink to="/map" size="sm" className="pointer-events-auto">Open full map <ArrowRight className="h-4 w-4" aria-hidden /></ButtonLink>
              </div>
            </div>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

function Recent() {
  const q = useQuery(() => api.listHazards({ sort: 'newest', pageSize: 6 }), []);
  return (
    <section className="container-x py-24">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <SectionHead eyebrow="Recently reported" title="What neighbours are flagging." />
        <ButtonLink to="/map?view=list" variant="secondary">View all reports</ButtonLink>
      </div>
      <div className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {q.loading && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)}
        {!!q.error && <Card className="md:col-span-3"><ErrorState error={q.error} onRetry={q.reload} /></Card>}
        {q.data?.items.length === 0 && <Card className="md:col-span-3"><EmptyState title="No reports yet" body="When people report hazards, they’ll appear here." /></Card>}
        {q.data?.items.map((h, i) => <Reveal key={h.id} delay={i * 0.04}><HazardListItem hazard={h} to={`/hazards/${h.id}`} /></Reveal>)}
      </div>
    </section>
  );
}

function SeverityExplainer() {
  const [category, setCategory] = useState<Category>('open_manhole');
  const [danger, setDanger] = useState(false);
  const [blocks, setBlocks] = useState(false);
  const [exposure, setExposure] = useState<Exposure>('pedestrians');
  const [reports, setReports] = useState(1);
  const r = useMemo(() => computeSeverity({ category, immediateDanger: danger, blocksRoad: blocks, exposure, hasPhoto: true, hasDescription: true, reportCount: reports, daysOpen: 0 }), [category, danger, blocks, exposure, reports]);
  return (
    <section className="container-x py-24">
      <div className="grid gap-10 lg:grid-cols-2">
        <SectionHead id="severity" eyebrow="Severity prioritisation" title="Explainable scoring, not a black box." body="Each report gets a 0–100 score from documented, weighted factors. Life-threatening categories have minimum floors, and report volume is capped so a pile-on can never outrank real danger. Staff can override — with a recorded reason." />
        <Reveal delay={0.1}>
          <Card className="p-6">
            <p className="text-sm font-bold">Try the model</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                <span className="label">Hazard type</span>
                <select className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="label">Who is exposed</span>
                <select className="input" value={exposure} onChange={(e) => setExposure(e.target.value as Exposure)}>
                  <option value="pedestrians">Pedestrians</option><option value="vehicles">Vehicles</option><option value="both">Both</option><option value="unknown">Not sure</option>
                </select>
              </label>
              <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-cyan" checked={danger} onChange={(e) => setDanger(e.target.checked)} />Actively endangering people</label>
              <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-cyan" checked={blocks} onChange={(e) => setBlocks(e.target.checked)} />Blocks the road</label>
              <label className="text-sm sm:col-span-2">
                <span className="label">Independent reports: {reports}</span>
                <input type="range" min={1} max={30} value={reports} onChange={(e) => setReports(Number(e.target.value))} className="w-full accent-cyan" />
              </label>
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl border border-line bg-midnight/60 p-4" aria-live="polite">
              <div>
                <p className="font-mono text-3xl font-semibold">{r.score}<span className="text-base text-ink-3"> / 100</span></p>
                {r.floorApplied && <p className="mt-1 text-xs text-critical">{r.floorApplied}</p>}
              </div>
              <SeverityBadge level={r.level} />
            </div>
            <ul className="mt-3 grid gap-1 text-xs text-ink-2 sm:grid-cols-2">
              {r.factors.map((f) => <li key={f.key} className="flex justify-between gap-2"><span>{f.label}</span><span className="font-mono text-ink">+{f.points}</span></li>)}
            </ul>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

function Workflow() {
  return (
    <section className="container-x py-24">
      <SectionHead eyebrow="Municipal response" title="A clear, auditable path to closure." body="Every change is logged with who, when and why. Nothing is marked resolved until a reviewer checks photographic proof." />
      <Reveal delay={0.1}>
        <div className="mt-10 overflow-x-auto pb-2">
          <ol className="flex min-w-[760px] items-stretch gap-2">
            {LIFECYCLE.map((s, i) => (
              <li key={s} className="glass flex flex-1 flex-col gap-2 p-4">
                <span className="font-mono text-xs text-ink-3">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-sm font-bold">{STATUS_META[s].label}</span>
                <span className={clsx('mt-auto h-1 rounded-full', i === LIFECYCLE.length - 1 ? 'bg-success' : 'bg-cyan/50')} />
              </li>
            ))}
          </ol>
        </div>
      </Reveal>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          { icon: Users, title: 'Triage & assign', body: 'Staff confirm the report, merge duplicates and route it to the right crew.' },
          { icon: Wrench, title: 'Repair with evidence', body: 'Crews record inspections and upload before/after photos from the field.' },
          { icon: ShieldCheck, title: 'Independent verification', body: 'A reviewer approves, rejects with a reason, or requests another photo.' },
        ].map((c, i) => (
          <Reveal key={c.title} delay={i * 0.06}>
            <Card className="h-full p-5">
              <c.icon className="h-5 w-5 text-cyan" aria-hidden />
              <h3 className="mt-3 font-bold">{c.title}</h3>
              <p className="mt-1 text-sm text-ink-2">{c.body}</p>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Community() {
  const q = useQuery(() => api.listHazards({ pageSize: 2000 }), []);
  const items = q.data?.items ?? [];
  const confirmations = items.reduce((s, h) => s + h.corroborations, 0);
  const categories = new Set(items.map((h) => h.category)).size;
  return (
    <section className="container-x py-24">
      <div className="glass relative overflow-hidden p-8 sm:p-12">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-success/10 blur-3xl" aria-hidden />
        <SectionHead eyebrow="Community impact" title="Neighbours looking out for neighbours." />
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            ['Public reports on the map', items.length],
            ['Confirmations from other residents', confirmations],
            ['Hazard types being tracked', categories],
          ].map(([l, v]) => (
            <div key={l as string}>
              {q.loading ? <Skeleton className="h-10 w-20" /> : <p className="font-mono text-4xl font-semibold text-success">{v as number}</p>}
              <p className="mt-1 text-sm text-ink-2">{l as string}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  ['Do I need an account to report?', 'No. You can report anonymously. Creating an account lets you track your reports and get notified when they change status.'],
  ['Is CivicLens an emergency service?', 'No. For immediate danger to life — a live wire on a person, a fire, a collapse — call your local emergency number first (112 in India). CivicLens is for getting hazards fixed.'],
  ['Should I get close to take a photo?', 'Never approach electrical wires, open manholes, flood water or unstable structures. Photograph from a safe distance, or skip the photo — a pinned location still helps.'],
  ['How is severity decided?', 'A transparent weighted model (category, immediate danger, exposure, obstruction, evidence, corroboration and time open). It is a preliminary assessment; authorised staff confirm official urgency.'],
  ['Who can see my details?', 'Your name, email and phone are never shown publicly. Public pages show only the hazard, its location, approved photos and status. Staff may remove photos that show faces or number plates.'],
  ['How do I know a repair is real?', 'Repairs need an after-repair photo, a summary and a completion time, and a separate reviewer must approve them. You’ll see both photos side-by-side.'],
];

function Faq() {
  return (
    <section className="container-x py-24">
      <SectionHead eyebrow="FAQ" title="Questions, answered." />
      <div className="mt-10 grid gap-3 lg:grid-cols-2">
        {FAQ.map(([q, a], i) => (
          <Reveal key={q} delay={i * 0.03}>
            <details className="group glass p-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {q}<ChevronDown className="h-5 w-5 shrink-0 text-ink-2 transition group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-3 text-sm text-ink-2">{a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="container-x py-24">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-cyan/30 bg-gradient-to-br from-cyan/15 via-surface/80 to-safety/10 p-10 text-center backdrop-blur-xl sm:p-16">
          <h2 className="text-3xl font-extrabold sm:text-5xl">Spot a hazard. Pin the problem.<br className="hidden sm:block" /> Make your city safer.</h2>
          <p className="mx-auto mt-4 max-w-xl text-ink-2">It takes about 15 seconds. Your report goes straight onto the public map and into the city’s priority queue.</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink to="/report" size="lg">Report a Hazard</ButtonLink>
            <ButtonLink to="/map" size="lg" variant="secondary">Explore the map</ButtonLink>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

export default function Landing() {
  useScene({ variant: 'home' });
  return (
    <>
      <Hero />
      <div className="relative bg-gradient-to-b from-transparent via-midnight/80 to-midnight">
        <Impact />
        <HowItWorks />
        <MapPreview />
        <Recent />
        <SeverityExplainer />
        <Workflow />
        <Community />
        <Faq />
        <FinalCta />
      </div>
    </>
  );
}
