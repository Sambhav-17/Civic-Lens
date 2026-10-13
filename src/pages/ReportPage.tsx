import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Camera, Check, CircleAlert, Copy, ImagePlus, LocateFixed, MapPin, Mic, Search, Share2,
  ShieldAlert, Square, Trash2, Video,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { HazardListItem } from '@/components/hazard';
import { useScene } from '@/components/three/sceneStore';
import { Button, ButtonLink, Card, Field, Input, Progress, SeverityBadge, Skeleton, StatusBadge, Textarea } from '@/components/ui';
import { useAuth, useToast } from '@/hooks/providers';
import { useDebounced } from '@/hooks/useQuery';
import { api, ApiError, type SubmitResult } from '@/lib/api';
import { CATEGORY_META } from '@/lib/categories';
import { config, LIMITS } from '@/lib/config';
import { requestPosition, reverseGeocode, searchPlaces, type GeoState, type GeocodeResult } from '@/lib/geo';
import { MediaError, validateMedia } from '@/lib/media';
import { CATEGORIES, type Category, type Exposure, type Hazard } from '@/lib/types';

const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

const LocationPicker = lazy(() => import('@/components/map/LocationPicker'));

const STEPS = ['Hazard', 'Evidence', 'Location', 'Danger', 'Review'] as const;

interface Attachment { id: string; file: File; url: string; kind: 'image' | 'video' | 'audio' }

type SpeechRec = { start(): void; stop(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null };
const SpeechRecognitionCtor: (new () => SpeechRec) | undefined =
  typeof window !== 'undefined' ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => SpeechRec) | undefined : undefined;

function StepHeader({ step, title, subtitle }: { step: number; title: string; subtitle?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="mb-6">
      <p className="eyebrow">Step {step + 1} of {STEPS.length}</p>
      <h1 ref={ref} tabIndex={-1} className="mt-2 text-2xl font-extrabold outline-none sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-2 text-ink-2">{subtitle}</p>}
    </div>
  );
}

function Stepper({ step, onJump, maxReached }: { step: number; onJump: (i: number) => void; maxReached: number }) {
  return (
    <nav aria-label="Report progress" className="mb-6">
      <ol className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <button
              type="button" onClick={() => onJump(i)} disabled={i > maxReached}
              aria-current={i === step ? 'step' : undefined}
              className={clsx('flex min-h-[36px] w-full items-center gap-2 rounded-full border px-2 text-xs font-semibold transition disabled:cursor-not-allowed',
                i === step ? 'border-cyan bg-cyan/15 text-cyan' : i < step ? 'border-success/40 text-success' : 'border-line text-ink-3')}
            >
              <span className={clsx('grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px]', i < step ? 'bg-success text-midnight' : i === step ? 'bg-cyan text-midnight' : 'bg-white/10')}>{i < step ? <Check className="h-3 w-3" aria-hidden /> : i + 1}</span>
              <span className="hidden truncate sm:inline">{s}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function YesNo({ label, value, onChange, hint }: { label: string; value: boolean | null; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      {hint && <p className="-mt-1 mb-2 text-xs text-ink-2">{hint}</p>}
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
        {[true, false].map((v) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={clsx('min-h-[48px] rounded-xl border font-semibold transition', value === v ? (v ? 'border-critical bg-critical/15 text-critical' : 'border-cyan bg-cyan/10 text-cyan') : 'border-line text-ink-2 hover:text-ink')}>
            {v ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function VoiceRecorder({ onRecorded, onTranscript, existing, onRemove }: { onRecorded: (f: File) => void; onTranscript: (t: string) => void; existing: Attachment | undefined; onRemove: () => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'error'>('idle');
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const speech = useRef<SpeechRec | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const supported = typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia;

  const stop = useCallback(() => {
    rec.current?.state === 'recording' && rec.current.stop();
    speech.current?.stop();
    clearInterval(timer.current);
  }, []);
  useEffect(() => stop, [stop]);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = (r.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        if (blob.size) onRecorded(new File([blob], `voice-note.${type.includes('mp4') ? 'm4a' : type.split('/')[1]}`, { type }));
        setState('idle');
      };
      rec.current = r;
      r.start();
      setSecs(0);
      setState('recording');
      timer.current = setInterval(() => setSecs((s) => {
        if (s + 1 >= LIMITS.maxVoiceSeconds) stop();
        return s + 1;
      }), 1000);
      if (SpeechRecognitionCtor) {
        try {
          const sr = new SpeechRecognitionCtor();
          sr.continuous = true; sr.interimResults = false; sr.lang = navigator.language || 'en-IN';
          sr.onresult = (e) => onTranscript(Array.from(e.results).map((x) => x[0].transcript).join(' '));
          sr.onerror = () => undefined;
          sr.start();
          speech.current = sr;
        } catch { /* transcription optional */ }
      }
    } catch {
      setErr('Microphone permission was declined or no microphone is available. You can type a description instead.');
      setState('error');
    }
  };

  if (!supported) return <p className="text-sm text-ink-2">Voice notes aren’t supported in this browser — please type a description instead.</p>;
  return (
    <div className="space-y-2">
      {existing ? (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-midnight/50 p-2">
          <audio controls src={existing.url} className="h-10 flex-1" aria-label="Recorded voice note" />
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Delete voice note" icon={<Trash2 className="h-4 w-4" />} />
        </div>
      ) : state === 'recording' ? (
        <Button variant="danger" onClick={stop} icon={<Square className="h-4 w-4" aria-hidden />} className="w-full">
          Stop recording · 0:{String(secs).padStart(2, '0')} / 1:00
        </Button>
      ) : (
        <Button variant="secondary" onClick={start} icon={<Mic className="h-4 w-4" aria-hidden />} className="w-full">Record a voice note (optional)</Button>
      )}
      {state === 'recording' && <p className="flex items-center gap-2 text-xs text-critical" role="status"><span className="h-2 w-2 animate-pulse rounded-full bg-critical" />Recording…{SpeechRecognitionCtor ? ' Speech will also be transcribed into the description where supported.' : ''}</p>}
      {err && <p className="text-xs text-critical" role="alert">{err}</p>}
    </div>
  );
}

export default function ReportPage() {
  useScene({ variant: 'report' });
  const nav = useNavigate();
  const toast = useToast();
  const { session } = useAuth();

  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [category, setCategory] = useState<Category | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [lat, setLat] = useState(config.defaultCenter[0]);
  const [lng, setLng] = useState(config.defaultCenter[1]);
  const [locationSet, setLocationSet] = useState(false);
  const [label, setLabel] = useState('');
  const [labelTouched, setLabelTouched] = useState(false);
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  const [recenter, setRecenter] = useState(0);
  const [placeQuery, setPlaceQuery] = useState('');
  const debouncedPlace = useDebounced(placeQuery, 400);
  const [places, setPlaces] = useState<GeocodeResult[]>([]);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [coordLat, setCoordLat] = useState('');
  const [coordLng, setCoordLng] = useState('');
  const [danger, setDanger] = useState<boolean | null>(null);
  const [blocks, setBlocks] = useState<boolean | null>(null);
  const [exposure, setExposure] = useState<Exposure>('unknown');
  const [a11y, setA11y] = useState('');
  const [anonymous, setAnonymous] = useState(!session);
  const [duplicates, setDuplicates] = useState<Hazard[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<number[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const imgInput = useRef<HTMLInputElement>(null);
  const camInput = useRef<HTMLInputElement>(null);
  const vidInput = useRef<HTMLInputElement>(null);

  useEffect(() => setAnonymous(!session), [session]);
  useEffect(() => () => attachments.forEach((a) => URL.revokeObjectURL(a.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const images = attachments.filter((a) => a.kind === 'image');
  const video = attachments.find((a) => a.kind === 'video');
  const voice = attachments.find((a) => a.kind === 'audio');

  const addFiles = (files: FileList | File[] | null, replaceId?: string) => {
    if (!files) return;
    setFileError(null);
    const next = [...attachments];
    for (const file of Array.from(files)) {
      try {
        const kind = validateMedia(file);
        if (kind === 'image' && !replaceId && next.filter((a) => a.kind === 'image').length >= LIMITS.maxImages) throw new MediaError(`You can attach up to ${LIMITS.maxImages} photos.`);
        if (kind === 'video') next.filter((a) => a.kind === 'video').forEach((v) => { URL.revokeObjectURL(v.url); next.splice(next.indexOf(v), 1); });
        const att = { id: crypto.randomUUID(), file, url: URL.createObjectURL(file), kind };
        if (replaceId) {
          const i = next.findIndex((a) => a.id === replaceId);
          if (i >= 0) { URL.revokeObjectURL(next[i].url); next[i] = att; }
        } else next.push(att);
      } catch (e) {
        setFileError(e instanceof Error ? e.message : 'That file can’t be used.');
      }
    }
    setAttachments(next);
  };
  const remove = (id: string) => setAttachments((xs) => { const a = xs.find((x) => x.id === id); if (a) URL.revokeObjectURL(a.url); return xs.filter((x) => x.id !== id); });

  const setPin = useCallback((la: number, ln: number) => {
    setLat(la); setLng(ln); setLocationSet(true);
  }, []);

  // Reverse geocode pin → label (unless the user typed their own).
  useEffect(() => {
    if (!locationSet || labelTouched) return;
    const ctl = new AbortController();
    const t = setTimeout(() => reverseGeocode(lat, lng, ctl.signal).then((l) => l && setLabel(l)).catch(() => undefined), 500);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [lat, lng, locationSet, labelTouched]);

  useEffect(() => {
    setPlaceError(null);
    if (debouncedPlace.trim().length < 3) return setPlaces([]);
    const ctl = new AbortController();
    searchPlaces(debouncedPlace, ctl.signal).then((r) => { setPlaces(r); if (!r.length) setPlaceError('No places found. Try a nearby landmark, or move the pin by hand.'); }).catch((e) => e.name !== 'AbortError' && setPlaceError('Address search is unavailable right now — move the pin by hand.'));
    return () => ctl.abort();
  }, [debouncedPlace]);

  const useMyLocation = async () => {
    setGeo({ status: 'requesting' });
    const r = await requestPosition();
    setGeo(r);
    if (r.status === 'granted') { setPin(r.lat, r.lng); setRecenter((x) => x + 1); }
  };

  const validate = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 0 && !category) e.category = 'Choose the type of hazard to continue.';
    if (s === 1 && description.length > 600) e.description = 'Keep the description under 600 characters.';
    if (s === 2 && !locationSet) e.location = 'Set the location: use your location, search, or tap the map to drop the pin.';
    if (s === 3 && danger === null) e.danger = 'Tell us whether people are in immediate danger.';
    if (s === 3 && blocks === null) e.blocks = 'Tell us whether it blocks the road.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const go = async (to: number) => {
    if (to > step) for (let s = step; s < to; s++) if (!validate(s)) return;
    setErrors({});
    if (to === 4 && category) {
      setDuplicates(null);
      api.findDuplicates(category, lat, lng).then(setDuplicates).catch(() => setDuplicates([]));
    }
    setStep(to);
    setMaxReached((m) => Math.max(m, to));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async () => {
    if (!category || danger === null || blocks === null) return;
    setSubmitting(true);
    setSubmitError(null);
    const files = attachments.map((a) => a.file);
    setProgress(files.map(() => 0));
    try {
      const r = await api.submitHazard(
        { category, description: description.trim(), location_label: label.trim() || null, immediate_danger: danger, blocks_road: blocks, exposure, accessibility_note: a11y.trim() || null, anonymous, latitude: lat, longitude: lng },
        files,
        (i, f) => setProgress((p) => p.map((v, j) => (j === i ? f : v))),
      );
      setResult(r);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setSubmitError(e instanceof ApiError || e instanceof Error ? e.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const corroborate = async (h: Hazard) => {
    try {
      await api.corroborate(h.id);
      toast({ kind: 'success', title: 'Thanks — your confirmation was added', body: 'Confirmations help the city prioritise.' });
      nav(`/hazards/${h.id}`);
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t add confirmation', body: e instanceof Error ? e.message : undefined });
    }
  };

  if (result) return <Confirmation result={result} />;

  const safety = category ? CATEGORY_META[category].safety : null;
  const overall = progress.length ? progress.reduce((s, p) => s + Math.max(0, p), 0) / progress.length : 0;

  return (
    <div className="container-x max-w-3xl py-8 sm:py-12">
      <div role="note" className="mb-6 flex items-start gap-3 rounded-2xl border border-critical/30 bg-critical/10 p-3.5 text-sm backdrop-blur">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-critical" aria-hidden />
        <p><strong>Is someone in immediate danger?</strong> Call your local emergency number (112) first. CivicLens is not an emergency dispatch service. Keep a safe distance — never approach a hazard to photograph it.</p>
      </div>

      <Card strong className="p-5 sm:p-8">
        <Stepper step={step} onJump={go} maxReached={maxReached} />
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
            {step === 0 && (
              <section>
                <StepHeader step={0} title="What did you spot?" subtitle="Choose the closest match — you can add details later." />
                <div role="radiogroup" aria-label="Hazard type" aria-describedby={errors.category ? 'cat-err' : undefined} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {CATEGORIES.map((c) => {
                    const m = CATEGORY_META[c];
                    const on = category === c;
                    return (
                      <button key={c} type="button" role="radio" aria-checked={on} onClick={() => { setCategory(c); setErrors({}); }}
                        onDoubleClick={() => { setCategory(c); void go(1); }}
                        className={clsx('group relative flex min-h-[120px] flex-col items-start gap-2 rounded-2xl border p-3.5 text-left transition', on ? 'border-cyan bg-cyan/10 shadow-glow' : 'border-line bg-midnight/40 hover:border-cyan/40 hover:bg-surface-2/60')}>
                        <span className={clsx('grid h-10 w-10 place-items-center rounded-xl transition', on ? 'bg-cyan text-midnight' : 'bg-white/5 text-cyan group-hover:bg-cyan/15')}><m.icon className="h-5 w-5" aria-hidden /></span>
                        <span className="text-sm font-bold leading-tight">{m.label}</span>
                        <span className="text-xs text-ink-2">{m.hint}</span>
                        {on && <Check className="absolute right-3 top-3 h-4 w-4 text-cyan" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
                {errors.category && <p id="cat-err" role="alert" className="mt-3 text-sm text-critical">{errors.category}</p>}
                {safety && <p className="mt-4 flex gap-2 rounded-xl border border-safety/30 bg-safety/10 p-3 text-sm text-safety"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{safety}</p>}
              </section>
            )}

            {step === 1 && (
              <section>
                <StepHeader step={1} title="Add evidence" subtitle="A photo helps crews find and assess the hazard. Only take one if it’s safe." />
                {safety && <p className="mb-4 flex gap-2 rounded-xl border border-safety/30 bg-safety/10 p-3 text-sm text-safety"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{safety}</p>}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button variant="primary" size="lg" onClick={() => camInput.current?.click()} icon={<Camera className="h-5 w-5" aria-hidden />} disabled={images.length >= LIMITS.maxImages}>Take a photo</Button>
                  <Button variant="secondary" size="lg" onClick={() => imgInput.current?.click()} icon={<ImagePlus className="h-5 w-5" aria-hidden />} disabled={images.length >= LIMITS.maxImages}>Upload photos</Button>
                </div>
                <input ref={camInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                <input ref={imgInput} type="file" accept={LIMITS.imageTypes.join(',')} multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                <input ref={vidInput} type="file" accept={LIMITS.videoTypes.join(',')} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                <p className="mt-2 text-xs text-ink-3">Up to {LIMITS.maxImages} photos (JPG, PNG, WebP, HEIC · max 10 MB each). Photos are compressed and location metadata is stripped before upload.</p>
                {fileError && <p role="alert" className="mt-3 flex items-center gap-1.5 text-sm text-critical"><CircleAlert className="h-4 w-4" aria-hidden />{fileError}</p>}

                {images.length > 0 && (
                  <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Attached photos">
                    {images.map((a, i) => (
                      <li key={a.id} className="group relative aspect-square overflow-hidden rounded-xl border border-line">
                        <img src={a.url} alt={`Attached photo ${i + 1}`} className="h-full w-full object-cover" />
                        <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-midnight/90 p-1.5">
                          <label className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg bg-midnight/80 hover:bg-surface-3" title="Replace photo">
                            <ImagePlus className="h-4 w-4" aria-hidden /><span className="sr-only">Replace photo {i + 1}</span>
                            <input type="file" accept="image/*" className="sr-only" onChange={(e) => { addFiles(e.target.files, a.id); e.target.value = ''; }} />
                          </label>
                          <button type="button" onClick={() => remove(a.id)} className="grid h-9 w-9 place-items-center rounded-lg bg-midnight/80 text-critical hover:bg-critical/20" aria-label={`Remove photo ${i + 1}`}><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-6 grid gap-4">
                  <div>
                    <p className="label">Short video (optional)</p>
                    {video ? (
                      <div className="flex items-center gap-2 rounded-xl border border-line bg-midnight/50 p-2">
                        <video src={video.url} controls className="h-24 rounded-lg" aria-label="Attached video" />
                        <span className="flex-1 truncate text-sm text-ink-2">{video.file.name}</span>
                        <Button variant="ghost" size="sm" onClick={() => remove(video.id)} aria-label="Remove video" icon={<Trash2 className="h-4 w-4" />} />
                      </div>
                    ) : (
                      <Button variant="secondary" onClick={() => vidInput.current?.click()} icon={<Video className="h-4 w-4" aria-hidden />} className="w-full">Add a short video (max 25 MB)</Button>
                    )}
                  </div>
                  <div>
                    <p className="label">Voice note (optional)</p>
                    <VoiceRecorder existing={voice} onRemove={() => voice && remove(voice.id)} onRecorded={(f) => addFiles([f])} onTranscript={(t) => setDescription((d) => (d ? d : t).slice(0, 600))} />
                  </div>
                  <Field label="Description (optional)" error={errors.description} hint={`${description.length}/600 · What’s the hazard and where exactly? e.g. “Left lane, outside the bakery.”`}>
                    {(p) => <Textarea {...p} value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} placeholder="Describe what you see" />}
                  </Field>
                </div>
              </section>
            )}

            {step === 2 && (
              <section>
                <StepHeader step={2} title="Pin the exact spot" subtitle="Use your location, search for an address, or tap the map. Drag the pin to fine-tune." />
                <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                  <Button variant="secondary" onClick={useMyLocation} loading={geo.status === 'requesting'} icon={<LocateFixed className="h-4 w-4" aria-hidden />}>Use my location</Button>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
                    <Input value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} placeholder="Search address or locality" className="pl-9" aria-label="Search address or locality" />
                    {places.length > 0 && (
                      <ul className="glass-strong absolute inset-x-0 top-12 z-[700] max-h-60 overflow-y-auto p-1">
                        {places.map((p) => (
                          <li key={`${p.lat}${p.lng}`}><button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5" onClick={() => { setPin(p.lat, p.lng); setLabel(p.label.split(',').slice(0, 3).join(',')); setLabelTouched(true); setRecenter((x) => x + 1); setPlaces([]); setPlaceQuery(''); }}>{p.label}</button></li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                {placeError && <p className="mt-2 text-xs text-ink-2" role="status">{placeError}</p>}
                {geo.status === 'granted' && <p className="mt-2 text-xs text-success" role="status">Location found · accuracy about ±{Math.round(geo.accuracy)} m{geo.accuracy > 50 ? ' — drag the pin if it’s off.' : ''}</p>}
                {(geo.status === 'denied' || geo.status === 'unavailable' || geo.status === 'error') && <p className="mt-2 text-xs text-safety" role="alert">{geo.message}</p>}
                <div className="relative mt-4 h-[340px] overflow-hidden rounded-2xl border border-line sm:h-[400px]">
                  <Suspense fallback={<Skeleton className="h-full w-full" />}>
                    <LocationPicker lat={lat} lng={lng} accuracy={geo.status === 'granted' ? geo.accuracy : null} onChange={setPin} recenterToken={recenter} />
                  </Suspense>
                  {!locationSet && <div className="pointer-events-none absolute inset-x-0 top-3 z-[500] mx-auto w-fit rounded-full bg-midnight/90 px-3 py-1.5 text-xs font-semibold">Tap the map to place the pin</div>}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
                  <span className="font-mono">{lat.toFixed(6)}, {lng.toFixed(6)}</span>
                  <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{locationSet ? 'Pin placed' : 'Not set yet'}</span>
                </div>
                {errors.location && <p role="alert" className="mt-2 text-sm text-critical">{errors.location}</p>}
                <details className="mt-3 rounded-xl border border-line p-3">
                  <summary className="cursor-pointer text-sm font-semibold">Enter coordinates instead</summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <Field label="Latitude">{(p) => <Input {...p} inputMode="decimal" value={coordLat} onChange={(e) => setCoordLat(e.target.value)} placeholder={lat.toFixed(6)} />}</Field>
                    <Field label="Longitude">{(p) => <Input {...p} inputMode="decimal" value={coordLng} onChange={(e) => setCoordLng(e.target.value)} placeholder={lng.toFixed(6)} />}</Field>
                    <Button variant="secondary" onClick={() => {
                      const la = coordLat.trim() ? Number(coordLat) : lat, ln = coordLng.trim() ? Number(coordLng) : lng;
                      if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return setErrors({ location: 'Enter a latitude between -90 and 90 and a longitude between -180 and 180.' });
                      setErrors({}); setPin(la, ln); setRecenter((x) => x + 1);
                    }}>Use these coordinates</Button>
                  </div>
                </details>
                <div className="mt-4">
                  <Field label="Location description" hint="Filled in from the map where possible. Add a landmark to help crews.">
                    {(p) => <Input {...p} value={label} maxLength={200} onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); }} placeholder="e.g. Outside No. 14, 5th Cross Road" />}
                  </Field>
                </div>
              </section>
            )}

            {step === 3 && (
              <section>
                <StepHeader step={3} title="How dangerous is it right now?" subtitle="This helps prioritise the response. Answer from what you can safely see." />
                <div className="space-y-5">
                  <YesNo label="Is it actively endangering people?" hint="e.g. people walking near an open manhole, a wire hanging at head height." value={danger} onChange={setDanger} />
                  {errors.danger && <p role="alert" className="-mt-3 text-sm text-critical">{errors.danger}</p>}
                  <YesNo label="Is it blocking the road?" value={blocks} onChange={setBlocks} />
                  {errors.blocks && <p role="alert" className="-mt-3 text-sm text-critical">{errors.blocks}</p>}
                  <fieldset>
                    <legend className="label">Who is exposed?</legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Who is exposed">
                      {(['pedestrians', 'vehicles', 'both', 'unknown'] as const).map((x) => (
                        <button key={x} type="button" role="radio" aria-checked={exposure === x} onClick={() => setExposure(x)} className={clsx('min-h-[44px] rounded-xl border text-sm font-semibold capitalize', exposure === x ? 'border-cyan bg-cyan/10 text-cyan' : 'border-line text-ink-2 hover:text-ink')}>{x === 'unknown' ? 'Not sure' : x}</button>
                      ))}
                    </div>
                  </fieldset>
                  <Field label="Accessibility impact (optional)" hint="e.g. wheelchair users must use the road, no tactile paving.">
                    {(p) => <Input {...p} value={a11y} maxLength={300} onChange={(e) => setA11y(e.target.value)} />}
                  </Field>
                  {danger && <p className="flex gap-2 rounded-xl border border-critical/30 bg-critical/10 p-3 text-sm"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden />If anyone is hurt or at immediate risk, call 112 now. Your report will be flagged for priority review, but it is not monitored as an emergency line.</p>}
                </div>
              </section>
            )}

            {step === 4 && category && (
              <section>
                <StepHeader step={4} title="Review and send" subtitle="Check everything looks right." />
                {duplicates === null ? (
                  <Skeleton className="mb-4 h-16 rounded-2xl" />
                ) : duplicates.length > 0 ? (
                  <div className="mb-5 rounded-2xl border border-safety/40 bg-safety/10 p-4" role="status">
                    <p className="font-semibold text-safety">This may already be reported nearby</p>
                    <p className="mt-1 text-sm text-ink-2">Confirming an existing report raises its priority and avoids duplicates.</p>
                    <div className="mt-3 space-y-2">
                      {duplicates.slice(0, 3).map((d) => (
                        <div key={d.id} className="space-y-2">
                          <HazardListItem hazard={d} to={`/hazards/${d.id}`} />
                          <Button size="sm" variant="secondary" onClick={() => corroborate(d)}>Yes, I see this one too</Button>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-ink-3">Different hazard? You can still send a new report below.</p>
                  </div>
                ) : null}
                <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                  {[
                    ['Hazard', CATEGORY_META[category].label, 0],
                    ['Evidence', `${images.length} photo${images.length === 1 ? '' : 's'}${video ? ', 1 video' : ''}${voice ? ', voice note' : ''}`, 1],
                    ['Description', description || '—', 1],
                    ['Location', `${label || 'Unlabelled'} (${lat.toFixed(5)}, ${lng.toFixed(5)})`, 2],
                    ['Danger', `${danger ? 'Actively endangering people' : 'No immediate danger'} · ${blocks ? 'Blocks road' : 'Road passable'} · Exposed: ${exposure === 'unknown' ? 'not sure' : exposure}`, 3],
                  ].map(([k, v, s]) => (
                    <div key={k as string} className="flex items-start justify-between gap-4 p-3.5">
                      <div className="min-w-0"><dt className="text-xs text-ink-3">{k}</dt><dd className="mt-0.5 break-words text-sm">{v}</dd></div>
                      <button type="button" className="shrink-0 text-sm font-semibold text-cyan hover:underline" onClick={() => setStep(s as number)}>Edit<span className="sr-only"> {k as string}</span></button>
                    </div>
                  ))}
                </dl>
                {images[0] && <img src={images[0].url} alt="Main photo for this report" className="mt-4 max-h-56 w-full rounded-2xl object-cover" />}
                <div className="mt-5 rounded-2xl border border-line p-4">
                  {session ? (
                    <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 h-5 w-5 accent-cyan" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                      <span><span className="font-semibold">Report anonymously</span><span className="block text-sm text-ink-2">Anonymous reports won’t appear in your history or send you updates.</span></span>
                    </label>
                  ) : (
                    <p className="text-sm text-ink-2">You’re reporting <strong className="text-ink">anonymously</strong>. <Link to="/login?next=/report" className="link">Sign in</Link> first if you’d like to track this report and get updates.</p>
                  )}
                  <p className="mt-3 text-xs text-ink-3">Your contact details are never shown publicly. Please avoid photographing faces or number plates.</p>
                </div>
                {submitting && progress.length > 0 && <div className="mt-4"><Progress value={overall} label="Upload progress" /><p className="mt-1 text-xs text-ink-2" role="status">Uploading evidence… {Math.round(overall * 100)}%</p></div>}
                {submitError && <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-critical/30 bg-critical/10 p-3 text-sm text-critical"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{submitError}</p>}
              </section>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5">
          {step > 0 ? <Button variant="ghost" onClick={() => go(step - 1)} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>Back</Button> : <span />}
          {step < 4 ? (
            <Button onClick={() => go(step + 1)}>{step === 1 && !attachments.length && !description ? 'Skip for now' : 'Continue'} <ArrowRight className="h-4 w-4" aria-hidden /></Button>
          ) : (
            <Button onClick={submit} loading={submitting} size="lg">{submitting ? 'Sending…' : 'Send report'}</Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function Confirmation({ result }: { result: SubmitResult }) {
  const toast = useToast();
  const h = result.hazard;
  const link = `${location.origin}/hazards/${h.id}`;
  const share = async () => {
    if (canShare()) {
      try { await navigator.share({ title: `CivicLens report ${h.ref}`, text: `${CATEGORY_META[h.category].label} reported on CivicLens`, url: link }); } catch { /* cancelled */ }
    } else {
      try { await navigator.clipboard.writeText(link); toast({ kind: 'success', title: 'Link copied' }); } catch { toast({ kind: 'error', title: 'Couldn’t copy the link' }); }
    }
  };
  return (
    <div className="container-x max-w-2xl py-12">
      <Card strong className="p-6 text-center sm:p-10">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }} className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success text-midnight shadow-[0_0_40px_rgba(72,224,164,.5)]">
          <Check className="h-8 w-8" aria-hidden />
        </motion.div>
        <h1 className="mt-6 text-3xl font-extrabold" tabIndex={-1} ref={(el) => el?.focus()}>Report received</h1>
        <p className="mt-2 text-ink-2">Thank you for helping make your city safer.</p>
        <div className="mx-auto mt-6 w-fit rounded-2xl border border-line bg-midnight/60 px-6 py-4">
          <p className="text-xs text-ink-3">Incident ID</p>
          <p className="font-mono text-2xl font-semibold tracking-wider text-cyan">{h.ref}</p>
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <StatusBadge status={h.status} />
          <SeverityBadge level={h.severity_level} score={h.severity_score} preliminary />
        </div>
        <p className="mt-2 text-xs text-ink-3">Severity is a preliminary automated assessment; municipal staff confirm official urgency.</p>
        {result.failedUploads.length > 0 && (
          <p role="alert" className="mt-4 rounded-xl border border-safety/30 bg-safety/10 p-3 text-left text-sm text-safety">
            Your report was saved, but {result.failedUploads.length} file{result.failedUploads.length > 1 ? 's' : ''} couldn’t be uploaded: {result.failedUploads.join(' ')}
          </p>
        )}
        <div className="mt-8 grid gap-2 sm:grid-cols-2">
          <ButtonLink to={`/hazards/${h.id}`}>Track this report</ButtonLink>
          <Button variant="secondary" onClick={share} icon={canShare() ? <Share2 className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}>{canShare() ? 'Share link' : 'Copy link'}</Button>
          <ButtonLink to={`/map?id=${h.id}`} variant="ghost">See it on the map</ButtonLink>
          <Button variant="ghost" onClick={() => location.assign('/report')}>Report another</Button>
        </div>
      </Card>
    </div>
  );
}
