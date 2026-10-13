import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useScene } from '@/components/three/sceneStore';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Select, Skeleton } from '@/components/ui';
import { useAuth, useToast } from '@/hooks/providers';
import { useQuery } from '@/hooks/useQuery';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { ROLES, type Profile, type Role } from '@/lib/types';

export default function Admin() {
  useScene({ variant: 'profile' });
  const { session } = useAuth();
  const toast = useToast();
  const people = useQuery(() => api.listProfiles(), []);
  const teams = useQuery(() => api.listTeams(), [], { live: false });
  const flagged = useQuery(() => api.listHazards({ pageSize: 2000 }), []);
  const [edit, setEdit] = useState<Profile | null>(null);
  const [role, setRole] = useState<Role>('citizen');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    try {
      await api.setRole(edit.id, role, role === 'citizen' ? null : team || null);
      toast({ kind: 'success', title: `Updated ${edit.display_name}` });
      setEdit(null);
      void people.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  const flaggedItems = flagged.data?.items.filter((h) => h.flagged) ?? [];

  return (
    <div className="container-x py-10">
      <p className="eyebrow">Administration</p>
      <h1 className="mt-2 text-3xl font-extrabold">Accounts, roles & moderation</h1>
      <p className="mt-1 text-sm text-ink-2">Role changes are enforced by the backend and can only be made by administrators. Manage teams in <Link to="/dashboard/team" className="link">Team Management</Link>.</p>

      <Card className="mt-6 overflow-hidden">
        <h2 className="border-b border-line p-4 font-bold">Accounts</h2>
        {people.error ? <ErrorState error={people.error} onRetry={people.reload} /> : people.loading ? <div className="p-4"><Skeleton className="h-40" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-ink-3"><tr><th scope="col" className="p-3">Name</th><th scope="col" className="p-3">Email</th><th scope="col" className="p-3">Role</th><th scope="col" className="p-3">Team</th><th scope="col" className="p-3">Joined</th><th className="p-3" /></tr></thead>
              <tbody className="divide-y divide-line">
                {people.data?.map((p) => (
                  <tr key={p.id}>
                    <td className="p-3 font-semibold">{p.display_name}{p.id === session?.user.id && <span className="ml-1 text-xs text-ink-3">(you)</span>}</td>
                    <td className="p-3 text-ink-2">{p.email ?? '—'}</td>
                    <td className="p-3"><Badge tone={p.role === 'admin' ? 'red' : p.role === 'citizen' ? 'muted' : 'cyan'} className="capitalize">{p.role}</Badge></td>
                    <td className="p-3 text-ink-2">{teams.data?.find((t) => t.id === p.team_id)?.name ?? '—'}</td>
                    <td className="whitespace-nowrap p-3 text-xs text-ink-3">{fmtDateTime(p.created_at)}</td>
                    <td className="p-3 text-right"><Button size="sm" variant="secondary" onClick={() => { setEdit(p); setRole(p.role); setTeam(p.team_id ?? ''); setErr(null); }}>Edit role</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-6 p-4">
        <h2 className="font-bold">Moderation queue</h2>
        <p className="mt-1 text-sm text-ink-2">Reports flagged by the public (duplicates, sensitive photos, abuse). Open an incident to hide media or dismiss it.</p>
        {flagged.loading ? <Skeleton className="mt-3 h-20" /> : flaggedItems.length === 0 ? <EmptyState title="Nothing flagged" /> : (
          <ul className="mt-3 divide-y divide-line">
            {flaggedItems.map((h) => <li key={h.id} className="flex items-center justify-between py-2.5 text-sm"><span><span className="font-mono text-cyan">{h.ref}</span> · {h.location_label}</span><Link to={`/hazards/${h.id}`} className="link">Review</Link></li>)}
          </ul>
        )}
      </Card>

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={`Change role for ${edit?.display_name ?? ''}`} description="Staff can triage and assign; reviewers can verify repairs; admins manage accounts and teams."
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Role">{(p) => <Select {...p} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</Select>}</Field>
          {role !== 'citizen' && <Field label="Team (optional)">{(p) => <Select {...p} value={team} onChange={(e) => setTeam(e.target.value)}><option value="">No team</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>}
          {err && <p role="alert" className="text-sm text-critical">{err}</p>}
        </div>
      </Dialog>
    </div>
  );
}
