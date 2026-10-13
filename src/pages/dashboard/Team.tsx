import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useScene } from '@/components/three/sceneStore';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { useAuth, useToast } from '@/hooks/providers';
import { useQuery } from '@/hooks/useQuery';
import { api } from '@/lib/api';
import type { Team as TeamT } from '@/lib/types';
import { isAdmin, isOpen } from '@/lib/workflow';

export default function Team() {
  useScene({ variant: 'dashboard' });
  const { session } = useAuth();
  const toast = useToast();
  const admin = isAdmin(session?.user.role);
  const teams = useQuery(() => api.listTeams(), []);
  const hz = useQuery(() => api.listHazards({ pageSize: 5000 }), []);
  const [edit, setEdit] = useState<Partial<TeamT> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    try {
      await api.upsertTeam({ ...edit, name: edit.name ?? '', service_area: edit.service_area ?? '' });
      toast({ kind: 'success', title: edit.id ? 'Team updated' : 'Team created' });
      setEdit(null);
      void teams.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Team management</p>
          <h1 className="mt-2 text-3xl font-extrabold">Field teams</h1>
          <p className="mt-1 text-sm text-ink-2">{admin ? 'Create teams and manage their service areas. Assign people to teams from Admin.' : 'Only administrators can edit teams.'}</p>
        </div>
        {admin && <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEdit({ name: '', service_area: '', active: true })}>New team</Button>}
      </header>
      {teams.error ? <ErrorState error={teams.error} onRetry={teams.reload} /> : teams.loading ? <Skeleton className="h-60 rounded-2xl" /> : !teams.data?.length ? <Card><EmptyState title="No teams yet" /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.data.map((t) => {
            const items = hz.data?.items.filter((h) => h.assigned_team_id === t.id) ?? [];
            const open = items.filter((h) => isOpen(h.status));
            return (
              <Card key={t.id} className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div><h2 className="font-bold">{t.name}</h2><p className="text-sm text-ink-2">{t.service_area}</p></div>
                  <Badge tone={t.active ? 'green' : 'muted'}>{t.active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-white/5 p-2"><dt className="text-[11px] text-ink-3">Open</dt><dd className="font-mono text-lg">{open.length}</dd></div>
                  <div className="rounded-xl bg-white/5 p-2"><dt className="text-[11px] text-ink-3">Critical</dt><dd className="font-mono text-lg text-critical">{open.filter((h) => h.severity_level === 'critical').length}</dd></div>
                  <div className="rounded-xl bg-white/5 p-2"><dt className="text-[11px] text-ink-3">Resolved</dt><dd className="font-mono text-lg text-success">{items.filter((h) => h.status === 'verified_resolved').length}</dd></div>
                </dl>
                {admin && <Button variant="ghost" size="sm" className="mt-3" onClick={() => setEdit(t)}>Edit</Button>}
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit team' : 'New team'}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Team name" required>{(p) => <Input {...p} value={edit?.name ?? ''} onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))} maxLength={80} />}</Field>
          <Field label="Service area" required>{(p) => <Input {...p} value={edit?.service_area ?? ''} onChange={(e) => setEdit((x) => ({ ...x, service_area: e.target.value }))} maxLength={120} />}</Field>
          <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-cyan" checked={edit?.active ?? true} onChange={(e) => setEdit((x) => ({ ...x, active: e.target.checked }))} />Active (can receive assignments)</label>
          {err && <p role="alert" className="text-sm text-critical">{err}</p>}
        </div>
      </Dialog>
    </div>
  );
}
