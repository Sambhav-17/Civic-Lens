import { CalendarClock, ClipboardCheck, Gauge, ImagePlus, MessageSquare, Users, Wrench } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useToast } from '@/hooks/providers';
import { useQuery } from '@/hooks/useQuery';
import { api } from '@/lib/api';
import { SEVERITY_META } from '@/lib/severity';
import { SEVERITY_LEVELS, type HazardDetail, type HazardStatus, type SeverityLevel } from '@/lib/types';
import { allowedNext, isReviewer, STATUS_META } from '@/lib/workflow';
import { Button, Card, Dialog, Field, Input, Progress, Select, Textarea } from './ui';

type Mode = null | { kind: 'status'; to: HazardStatus } | { kind: 'assign' } | { kind: 'override' } | { kind: 'note' } | { kind: 'inspection' } | { kind: 'evidence' } | { kind: 'repair' };

/** Municipal action panel. Every action is re-checked by the backend. */
export function StaffActions({ hazard, onDone }: { hazard: HazardDetail; onDone: () => void }) {
  const { session } = useAuth();
  const toast = useToast();
  const role = session?.user.role;
  const teams = useQuery(() => api.listTeams(), [], { live: false });
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState('');
  const [internal, setInternal] = useState(true);
  const [team, setTeam] = useState(hazard.assigned_team_id ?? '');
  const [level, setLevel] = useState<SeverityLevel>(hazard.severity_level);
  const [when, setWhen] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
  const [completed, setCompleted] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [files, setFiles] = useState<File[]>([]);
  const [evidenceType, setEvidenceType] = useState<'before_repair' | 'after_repair'>('before_repair');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const next = allowedNext(hazard.status, role).filter((s) => s !== 'repair_submitted' && s !== 'verified_resolved' && !(s === 'assigned' && !hazard.assigned_team_id && hazard.status !== 'in_progress'));
  const close = () => { setMode(null); setNote(''); setFiles([]); setError(null); setProgress(0); };

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast({ kind: 'success', title: success });
      close();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const action = (icon: ReactNode, label: string, m: Mode, variant: 'secondary' | 'primary' = 'secondary') => (
    <Button variant={variant} size="sm" icon={icon} onClick={() => { setMode(m); setError(null); }} className="justify-start">{label}</Button>
  );
  const onProgress = (_i: number, f: number) => setProgress((p) => Math.max(p, f));

  return (
    <Card className="p-5">
      <h2 className="text-sm font-bold">Municipal actions</h2>
      <p className="mt-1 text-xs text-ink-2">Signed in as <span className="capitalize">{role}</span>. Every change is recorded in the audit history.</p>

      {next.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Move to</p>
          <div className="flex flex-wrap gap-2">
            {next.map((s) => (
              <Button key={s} size="sm" variant={s === 'dismissed' || s === 'reopened' ? 'ghost' : 'primary'} onClick={() => setMode({ kind: 'status', to: s })}>{STATUS_META[s].label}</Button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {['triaged', 'assigned', 'reopened', 'in_progress'].includes(hazard.status) && action(<Users className="h-4 w-4" />, hazard.assigned_team_id ? 'Reassign team' : 'Assign team', { kind: 'assign' })}
        {action(<Gauge className="h-4 w-4" />, 'Change priority', { kind: 'override' })}
        {action(<MessageSquare className="h-4 w-4" />, 'Add note', { kind: 'note' })}
        {action(<CalendarClock className="h-4 w-4" />, 'Plan inspection', { kind: 'inspection' })}
        {action(<ImagePlus className="h-4 w-4" />, 'Upload photos', { kind: 'evidence' })}
        {hazard.status === 'in_progress' && action(<Wrench className="h-4 w-4" />, 'Submit repair', { kind: 'repair' }, 'primary')}
      </div>
      {hazard.status === 'verification_pending' && (
        isReviewer(role) ? (
          <Link to={`/verify/${hazard.id}`} className="mt-4 flex items-center gap-2 rounded-xl border border-safety/40 bg-safety/10 p-3 text-sm font-semibold text-safety hover:bg-safety/15"><ClipboardCheck className="h-4 w-4" />Review repair evidence</Link>
        ) : <p className="mt-4 rounded-xl border border-line p-3 text-xs text-ink-2">Awaiting an authorised reviewer.</p>
      )}

      <Dialog
        open={mode?.kind === 'status'} onClose={close}
        title={mode?.kind === 'status' ? `Move to “${STATUS_META[mode.to].label}”?` : ''}
        description={mode?.kind === 'status' && mode.to === 'dismissed' ? 'Dismiss only spam, duplicates or non-hazards. The reporter will be notified.' : 'The reporter will be notified of the status change.'}
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} variant={mode?.kind === 'status' && mode.to === 'dismissed' ? 'danger' : 'primary'} onClick={() => mode?.kind === 'status' && run(() => api.transition(hazard.id, mode.to, note), 'Status updated')}>Confirm</Button></>}
      >
        <Field label="Note (optional, visible publicly)">{(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}</Field>
        {error && <p role="alert" className="mt-3 text-sm text-critical">{error}</p>}
      </Dialog>

      <Dialog open={mode?.kind === 'assign'} onClose={close} title="Assign to a team"
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} disabled={!team} onClick={() => run(() => api.assign(hazard.id, team, note || undefined), 'Team assigned')}>Assign</Button></>}>
        <div className="space-y-4">
          <Field label="Team" required>{(p) => (
            <Select {...p} value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">Choose a team…</option>
              {teams.data?.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name} — {t.service_area}</option>)}
            </Select>
          )}</Field>
          <Field label="Note (optional)">{(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}</Field>
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
        </div>
      </Dialog>

      <Dialog open={mode?.kind === 'override'} onClose={close} title="Change priority" description="Manual overrides replace the automated score and are recorded with your name, the time and your reason."
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.overrideSeverity(hazard.id, level, note), 'Priority updated')}>Save override</Button></>}>
        <div className="space-y-4">
          <fieldset>
            <legend className="label">New priority</legend>
            <div className="grid grid-cols-2 gap-2">
              {SEVERITY_LEVELS.map((l) => (
                <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)} className="min-h-[44px] rounded-xl border text-sm font-bold" style={level === l ? { borderColor: SEVERITY_META[l].hex, color: SEVERITY_META[l].hex, background: `${SEVERITY_META[l].hex}18` } : { borderColor: 'rgba(154,168,189,.14)' }}>
                  {SEVERITY_META[l].glyph} {SEVERITY_META[l].label}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Reason" required hint="Required for the audit trail (min. 5 characters).">{(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}</Field>
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
        </div>
      </Dialog>

      <Dialog open={mode?.kind === 'note'} onClose={close} title="Add a note"
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.addNote(hazard.id, note, internal), 'Note added')}>Add note</Button></>}>
        <div className="space-y-4">
          <Field label="Note" required>{(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}</Field>
          <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-cyan" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Internal only (not shown to the public)</label>
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
        </div>
      </Dialog>

      <Dialog open={mode?.kind === 'inspection'} onClose={close} title="Plan an inspection"
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.recordInspection(hazard.id, when, note), 'Inspection recorded')}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Planned date and time" required>{(p) => <Input {...p} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
          <Field label="Note (optional)">{(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}</Field>
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
        </div>
      </Dialog>

      <Dialog open={mode?.kind === 'evidence'} onClose={close} title="Upload repair photos"
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} disabled={!files.length} onClick={() => run(() => api.uploadEvidence(hazard.id, files, evidenceType, onProgress), 'Photos uploaded')}>Upload</Button></>}>
        <div className="space-y-4">
          <Field label="Photo type">{(p) => (
            <Select {...p} value={evidenceType} onChange={(e) => setEvidenceType(e.target.value as typeof evidenceType)}>
              <option value="before_repair">Before repair (site inspection)</option>
              <option value="after_repair">After repair</option>
            </Select>
          )}</Field>
          <Field label="Photos" required hint="JPG, PNG, WebP or HEIC, up to 10 MB each.">{(p) => <input {...p} type="file" accept="image/*" multiple className="input py-2" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />}</Field>
          {busy && <Progress value={progress} label="Upload progress" />}
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
        </div>
      </Dialog>

      <Dialog open={mode?.kind === 'repair'} onClose={close} title="Submit repair for verification" description="An after-repair photograph, a summary and the completion time are required. A separate reviewer must approve before the incident is resolved."
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} disabled={!files.length} onClick={() => run(() => api.submitRepair(hazard.id, note, new Date(completed).toISOString(), files, onProgress), 'Repair submitted for verification')}>Submit repair</Button></>}>
        <div className="space-y-4">
          <Field label="After-repair photo(s)" required>{(p) => <input {...p} type="file" accept="image/*" capture="environment" multiple className="input py-2" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />}</Field>
          <Field label="Repair summary" required hint="What was done? (min. 10 characters)">{(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}</Field>
          <Field label="Completed at" required>{(p) => <Input {...p} type="datetime-local" value={completed} max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(e) => setCompleted(e.target.value)} />}</Field>
          {busy && <Progress value={progress} label="Upload progress" />}
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
        </div>
      </Dialog>
    </Card>
  );
}
