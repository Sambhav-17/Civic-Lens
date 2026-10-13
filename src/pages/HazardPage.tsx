import { ArrowLeft, Copy, ExternalLink, Eye, EyeOff, Flag, Hand, MapPin, Share2, ShieldCheck } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BeforeAfter } from '@/components/BeforeAfter';
import { LifecycleTracker, SeverityBreakdown, Timeline } from '@/components/hazard';
import { StaffActions } from '@/components/StaffActions';
import { sceneStore, useScene } from '@/components/three/sceneStore';
import { Badge, Button, ButtonLink, Card, CategoryIcon, Dialog, EmptyState, ErrorState, Field, Skeleton, StatusBadge, SeverityBadge, Textarea } from '@/components/ui';
import { useAuth, useToast } from '@/hooks/providers';
import { useQuery } from '@/hooks/useQuery';
import { api } from '@/lib/api';
import { CATEGORY_META } from '@/lib/categories';
import { externalDirectionsUrl } from '@/lib/geo';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { isStaff } from '@/lib/workflow';

const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

const HazardMap = lazy(() => import('@/components/map/HazardMap'));

export default function HazardPage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const toast = useToast();
  const staff = isStaff(session?.user.role);
  const q = useQuery(() => api.getHazard(id), [id, session?.user.id]);
  const h = q.data;
  const [flagOpen, setFlagOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [flagErr, setFlagErr] = useState<string | null>(null);

  useScene({ variant: 'detail' }, [id]);
  useEffect(() => {
    if (h) sceneStore.set({ pins: [{ id: h.id, lat: h.latitude, lng: h.longitude, level: h.severity_level, resolved: h.status === 'verified_resolved' }], focusId: h.id });
  }, [h]);

  if (q.loading)
    return (
      <div className="container-x py-10">
        <Skeleton className="h-8 w-64" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
      </div>
    );
  if (q.error) return <div className="container-x py-20"><ErrorState title="Couldn’t load this incident" error={q.error} onRetry={q.reload} /></div>;
  if (!h)
    return (
      <div className="container-x py-20">
        <Card><EmptyState title="Incident not found" body="It may have been removed by moderators, or the link is incorrect." action={<ButtonLink to="/map">Back to the map</ButtonLink>} /></Card>
      </div>
    );

  const reportPhotos = h.media.filter((m) => m.evidence_type === 'report' && m.media_type === 'image');
  const videos = h.media.filter((m) => m.media_type === 'video');
  const audio = h.media.filter((m) => m.media_type === 'audio');
  const before = h.media.filter((m) => m.evidence_type === 'before_repair');
  const after = h.media.filter((m) => m.evidence_type === 'after_repair');
  const link = `${location.origin}/hazards/${h.id}`;
  const canConfirm = h.status !== 'verified_resolved' && h.status !== 'dismissed';

  const confirm = async () => {
    setBusy(true);
    try {
      await api.corroborate(h.id);
      toast({ kind: 'success', title: 'Thanks for confirming', body: 'Independent confirmations help prioritise repairs.' });
      void q.reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t add your confirmation', body: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  const flag = async () => {
    setBusy(true);
    setFlagErr(null);
    try {
      await api.flagHazard(h.id, reason);
      toast({ kind: 'success', title: 'Sent to moderators', body: 'Thank you — a moderator will review this report.' });
      setFlagOpen(false);
      setReason('');
    } catch (e) {
      setFlagErr(e instanceof Error ? e.message : 'Couldn’t send.');
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    if (canShare()) {
      try { await navigator.share({ title: `CivicLens ${h.ref}`, url: link }); } catch { /* cancelled */ }
      return;
    }
    try { await navigator.clipboard.writeText(link); toast({ kind: 'success', title: 'Link copied' }); } catch { toast({ kind: 'error', title: 'Couldn’t copy the link' }); }
  };

  return (
    <div className="container-x py-8 sm:py-10">
      <Link to="/map" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Back to map</Link>

      <header className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-cyan">{h.ref}</span>
            {h.is_demo && <Badge tone="orange">Demo data</Badge>}
            {h.flagged && staff && <Badge tone="red">Flagged for moderation</Badge>}
          </div>
          <h1 className="mt-2 flex items-center gap-3 text-3xl font-extrabold sm:text-4xl">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-cyan/30 bg-cyan/10 text-cyan"><CategoryIcon category={h.category} className="h-6 w-6" /></span>
            {CATEGORY_META[h.category].label}
          </h1>
          <p className="mt-2 flex items-center gap-1.5 text-ink-2"><MapPin className="h-4 w-4" aria-hidden />{h.location_label ?? 'Unlabelled location'} · <span className="font-mono text-xs">{h.latitude.toFixed(5)}, {h.longitude.toFixed(5)}</span></p>
          <div className="mt-3 flex flex-wrap gap-2"><SeverityBadge level={h.severity_level} score={h.severity_score} preliminary={!h.severity_overridden} /><StatusBadge status={h.status} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canConfirm && <Button variant="secondary" onClick={confirm} loading={busy} icon={<Hand className="h-4 w-4" aria-hidden />}>I see this too{h.corroborations ? ` (${h.corroborations})` : ''}</Button>}
          <Button variant="secondary" onClick={share} icon={canShare() ? <Share2 className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}>Share</Button>
          <a href={externalDirectionsUrl(h.latitude, h.longitude)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface-2/80 px-4 text-[15px] font-semibold hover:border-cyan/50"><ExternalLink className="h-4 w-4" aria-hidden />Directions</a>
          <Button variant="ghost" onClick={() => setFlagOpen(true)} icon={<Flag className="h-4 w-4" aria-hidden />}>Report a problem</Button>
        </div>
      </header>

      {h.category === 'electrical_wire' && h.status !== 'verified_resolved' && (
        <p role="alert" className="mt-5 rounded-2xl border border-critical/30 bg-critical/10 p-3.5 text-sm"><strong className="text-critical">Electrical hazard:</strong> keep well away and treat wires as live. Do not approach to take photos. If anyone is in danger, call 112.</p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            {reportPhotos.length ? (
              <div className={reportPhotos.length > 1 ? 'grid grid-cols-2 gap-1' : ''}>
                {reportPhotos.map((m, i) => (
                  <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer" className={i === 0 && reportPhotos.length > 2 ? 'col-span-2' : ''}>
                    <img src={m.url} alt={`Reported ${CATEGORY_META[h.category].label.toLowerCase()}, photo ${i + 1}`} className="max-h-[440px] w-full object-cover" loading={i ? 'lazy' : 'eager'} />
                  </a>
                ))}
              </div>
            ) : (
              <EmptyState title="No photo" body="The reporter didn’t attach a photo — that’s fine when it isn’t safe to take one." />
            )}
            <div className="p-5">
              <p className="text-sm text-ink-3">Reported {timeAgo(h.created_at)} · {fmtDateTime(h.created_at)}</p>
              {h.description ? <p className="mt-2 whitespace-pre-line">{h.description}</p> : <p className="mt-2 text-ink-2">No description provided.</p>}
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {h.immediate_danger && <Badge tone="red">Endangering people</Badge>}
                {h.blocks_road && <Badge tone="orange">Blocks road</Badge>}
                {h.exposure !== 'unknown' && <Badge>Exposed: {h.exposure}</Badge>}
                {h.corroborations > 0 && <Badge tone="cyan">{h.corroborations} confirmation{h.corroborations > 1 ? 's' : ''}</Badge>}
              </div>
              {h.accessibility_note && <p className="mt-3 rounded-xl border border-line p-3 text-sm"><strong>Accessibility:</strong> {h.accessibility_note}</p>}
              {videos.map((v) => <video key={v.id} src={v.url} controls className="mt-4 w-full rounded-xl" aria-label="Reporter video" />)}
              {audio.map((a) => <div key={a.id} className="mt-4"><p className="mb-1 text-xs text-ink-3">Voice note (visible to staff and the reporter only)</p><audio src={a.url} controls className="w-full" /></div>)}
            </div>
          </Card>

          {(after.length > 0 || h.repair) && (
            <Card className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="h-5 w-5 text-success" aria-hidden />Repair evidence</h2>
                {h.status === 'verified_resolved' ? <Badge tone="green">Verified by reviewer</Badge> : <Badge tone="orange">Not yet verified</Badge>}
              </div>
              {h.repair && <p className="mt-2 text-sm text-ink-2">{h.repair.summary} <span className="text-ink-3">· completed {fmtDateTime(h.repair.completed_at)}</span></p>}
              {reportPhotos[0] && after[0] ? <div className="mt-4"><BeforeAfter before={reportPhotos[0].url} after={after[0].url} /></div> : after[0] && <img src={after[0].url} alt="After repair" className="mt-4 rounded-xl" />}
              {h.verifications.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {h.verifications.map((v) => (
                    <li key={v.id} className="rounded-xl border border-line p-3 text-sm">
                      <span className={v.decision === 'approved' ? 'font-semibold text-success' : v.decision === 'rejected' ? 'font-semibold text-critical' : 'font-semibold text-safety'}>{v.decision === 'approved' ? 'Approved' : v.decision === 'rejected' ? 'Rejected' : 'More evidence requested'}</span>
                      <span className="text-ink-3"> · {v.reviewer_name} · {fmtDateTime(v.created_at)}</span>
                      {v.notes && <p className="mt-1 text-ink-2">{v.notes}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {staff && before.length > 0 && (
            <Card className="p-5">
              <h2 className="text-lg font-bold">Site inspection photos</h2>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{before.map((m) => <img key={m.id} src={m.url} alt="Before repair" className="aspect-square rounded-xl object-cover" />)}</div>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="text-lg font-bold">Progress</h2>
            <div className="mt-4"><LifecycleTracker status={h.status} /></div>
            <h3 className="mt-8 text-sm font-bold">Activity history</h3>
            <div className="mt-4"><Timeline updates={h.updates} /></div>
          </Card>
        </div>

        <aside className="space-y-6">
          {staff && <StaffActions hazard={h} onDone={q.reload} />}
          <Card className="p-5"><SeverityBreakdown hazard={h} /></Card>
          <Card className="overflow-hidden">
            <div className="h-64">
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <HazardMap hazards={[h]} selectedId={h.id} center={[h.latitude, h.longitude]} zoom={16} cluster={false} className="h-full w-full" label="Hazard location map" />
              </Suspense>
            </div>
            <div className="p-4 text-sm">
              <p className="text-ink-2">{h.team ? <>Assigned to <strong className="text-ink">{h.team.name}</strong></> : 'Not yet assigned to a team'}</p>
            </div>
          </Card>
          {staff && h.media.length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-bold">Media moderation</h2>
              <p className="mt-1 text-xs text-ink-2">Hide photos that show faces, number plates or other personal details.</p>
              <ul className="mt-3 space-y-2">
                {h.media.filter((m) => m.media_type === 'image').map((m) => (
                  <li key={m.id} className="flex items-center gap-3">
                    <img src={m.url} alt="" className="h-12 w-12 rounded-lg object-cover" />
                    <span className="flex-1 text-xs text-ink-2">{m.evidence_type.replace('_', ' ')} · {m.is_public ? 'Public' : 'Hidden'}</span>
                    <Button size="sm" variant="ghost" icon={m.is_public ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} onClick={async () => {
                      try { await api.setMediaPublic(m.id, !m.is_public); void q.reload(); } catch (e) { toast({ kind: 'error', title: 'Couldn’t update', body: e instanceof Error ? e.message : undefined }); }
                    }}>{m.is_public ? 'Hide' : 'Show'}</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <Dialog open={flagOpen} onClose={() => setFlagOpen(false)} title="Report a problem with this incident" description="For example: it’s a duplicate, it’s already fixed, or a photo shows someone’s face or number plate."
        footer={<><Button variant="ghost" onClick={() => setFlagOpen(false)}>Cancel</Button><Button loading={busy} onClick={flag}>Send to moderators</Button></>}>
        <Field label="What’s wrong?" required error={flagErr}>{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
      </Dialog>
    </div>
  );
}
