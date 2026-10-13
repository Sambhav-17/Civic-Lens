import { ArrowLeft, Camera, CircleCheck, CircleX, Info } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BeforeAfter } from '@/components/BeforeAfter';
import { Timeline } from '@/components/hazard';
import { useScene } from '@/components/three/sceneStore';
import { Badge, Button, ButtonLink, Card, Dialog, EmptyState, ErrorState, Field, Skeleton, StatusBadge, Textarea } from '@/components/ui';
import { useAuth, useToast } from '@/hooks/providers';
import { useQuery } from '@/hooks/useQuery';
import { api } from '@/lib/api';
import { CATEGORY_META } from '@/lib/categories';
import { fmtDateTime } from '@/lib/format';
import type { VerificationDecision } from '@/lib/types';
import { isReviewer } from '@/lib/workflow';

const DECISIONS: Record<VerificationDecision, { title: string; body: string; cta: string; variant: 'success' | 'danger' | 'secondary' }> = {
  approved: { title: 'Approve this repair?', body: 'The incident will be marked Verified Resolved and the reporter notified. Original evidence and history are preserved.', cta: 'Approve repair', variant: 'success' },
  rejected: { title: 'Reject the evidence and reopen?', body: 'The incident returns to the queue as Reopened. A reason is required and will be recorded.', cta: 'Reject & reopen', variant: 'danger' },
  photo_requested: { title: 'Request another photo?', body: 'The incident goes back to In Progress so the crew can upload clearer evidence. A reason is required.', cta: 'Request photo', variant: 'secondary' },
};

export default function VerifyPage() {
  useScene({ variant: 'verify' });
  const { id = '' } = useParams();
  const { session } = useAuth();
  const toast = useToast();
  const q = useQuery(() => api.getHazard(id), [id]);
  const [decision, setDecision] = useState<VerificationDecision | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reviewer = isReviewer(session?.user.role);
  const h = q.data;

  if (q.loading) return <div className="container-x py-10"><Skeleton className="h-[520px] rounded-2xl" /></div>;
  if (q.error) return <div className="container-x py-20"><ErrorState error={q.error} onRetry={q.reload} /></div>;
  if (!h) return <div className="container-x py-20"><Card><EmptyState title="Incident not found" action={<ButtonLink to="/dashboard/verification">Back to verification queue</ButtonLink>} /></Card></div>;

  const original = h.media.find((m) => m.evidence_type === 'report' && m.media_type === 'image');
  const afters = h.media.filter((m) => m.evidence_type === 'after_repair');
  const pending = h.status === 'verification_pending';

  const decide = async () => {
    if (!decision) return;
    setBusy(true);
    setErr(null);
    try {
      await api.decideVerification(h.id, decision, notes);
      toast({ kind: 'success', title: decision === 'approved' ? 'Repair verified' : decision === 'rejected' ? 'Incident reopened' : 'New photo requested' });
      setDecision(null);
      setNotes('');
      void q.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-x py-8 sm:py-10">
      <Link to="/dashboard/verification" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Verification queue</Link>
      <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Repair verification · {h.ref}</p>
          <h1 className="mt-2 text-3xl font-extrabold">{CATEGORY_META[h.category].label}</h1>
          <p className="mt-1 text-ink-2">{h.location_label}</p>
        </div>
        <div className="flex gap-2"><StatusBadge status={h.status} />{h.is_demo && <Badge tone="orange">Demo data</Badge>}</div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-lg font-bold">Evidence comparison</h2>
            <p className="mt-1 text-sm text-ink-2">Check the after-repair photo shows the same location and that the hazard is fully removed.</p>
            <div className="mt-4">
              {original && afters[0] ? <BeforeAfter before={original.url} after={afters[0].url} /> : !afters.length ? (
                <EmptyState icon={<Camera className="h-6 w-6" />} title="No after-repair photo yet" body="The repair team hasn’t uploaded evidence." />
              ) : (
                <img src={afters[0].url} alt="After repair" className="rounded-xl" />
              )}
            </div>
            {afters.length > 1 && <div className="mt-3 grid grid-cols-3 gap-2">{afters.slice(1).map((m) => <img key={m.id} src={m.url} alt="Additional after-repair evidence" className="aspect-square rounded-xl object-cover" />)}</div>}
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-3">Repair summary</dt><dd>{h.repair?.summary ?? '—'}</dd></div>
              <div><dt className="text-ink-3">Completed at</dt><dd>{h.repair ? fmtDateTime(h.repair.completed_at) : '—'}</dd></div>
              <div><dt className="text-ink-3">Uploaded</dt><dd>{afters[0] ? `${fmtDateTime(afters[0].created_at)}${afters[0].uploader_name ? ` by ${afters[0].uploader_name}` : ''}` : '—'}</dd></div>
              <div><dt className="text-ink-3">Original report</dt><dd>{fmtDateTime(h.created_at)}</dd></div>
            </dl>
            <p className="mt-4 flex gap-2 rounded-xl border border-line bg-midnight/50 p-3 text-xs text-ink-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan" aria-hidden />Upload times and uploader identity are recorded by the server. Photo metadata alone does not prove a repair is safe — use your judgement and request another photo if unsure.</p>
          </Card>
          <Card className="p-5"><h2 className="text-lg font-bold">Full history</h2><div className="mt-4"><Timeline updates={h.updates} /></div></Card>
        </div>

        <aside className="space-y-6">
          <Card className="p-5">
            <h2 className="text-lg font-bold">Decision</h2>
            {!reviewer ? (
              <p className="mt-2 text-sm text-ink-2">Only authorised reviewers can approve or reject repairs. You can view the evidence.</p>
            ) : !pending ? (
              <p className="mt-2 text-sm text-ink-2">This incident is not awaiting verification (current status shown above).</p>
            ) : (
              <div className="mt-4 grid gap-2">
                <Button variant="success" size="lg" icon={<CircleCheck className="h-5 w-5" aria-hidden />} onClick={() => setDecision('approved')} disabled={!afters.length}>Approve repair</Button>
                <Button variant="secondary" icon={<Camera className="h-4 w-4" aria-hidden />} onClick={() => setDecision('photo_requested')}>Request another photo</Button>
                <Button variant="danger" icon={<CircleX className="h-4 w-4" aria-hidden />} onClick={() => setDecision('rejected')}>Reject &amp; reopen</Button>
              </div>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="text-sm font-bold">Previous decisions</h2>
            {h.verifications.length === 0 ? <p className="mt-2 text-sm text-ink-2">None yet.</p> : (
              <ul className="mt-3 space-y-2">
                {h.verifications.map((v) => (
                  <li key={v.id} className="rounded-xl border border-line p-3 text-sm">
                    <span className="font-semibold capitalize">{v.decision.replace('_', ' ')}</span> <span className="text-ink-3">· {v.reviewer_name} · {fmtDateTime(v.created_at)}</span>
                    {v.notes && <p className="mt-1 text-ink-2">{v.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      <Dialog open={!!decision} onClose={() => setDecision(null)} title={decision ? DECISIONS[decision].title : ''} description={decision ? DECISIONS[decision].body : ''}
        footer={<><Button variant="ghost" onClick={() => setDecision(null)}>Cancel</Button>{decision && <Button variant={DECISIONS[decision].variant} loading={busy} onClick={decide}>{DECISIONS[decision].cta}</Button>}</>}>
        <Field label={decision === 'approved' ? 'Verification notes (optional)' : 'Reason (required)'} error={err}>{(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />}</Field>
      </Dialog>
    </div>
  );
}
