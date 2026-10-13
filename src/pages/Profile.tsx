import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScene } from '@/components/three/sceneStore';
import { Badge, Button, Card, Dialog, Field, Input } from '@/components/ui';
import { useAuth, useToast } from '@/hooks/providers';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

export default function Profile() {
  useScene({ variant: 'profile' });
  const { session } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const u = session!.user;
  const [name, setName] = useState(u.display_name);
  const [notify, setNotify] = useState(u.notify_email);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.updateProfile({ display_name: name, notify_email: notify });
      toast({ kind: 'success', title: 'Profile saved' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-x max-w-2xl py-10">
      <p className="eyebrow">Account</p>
      <h1 className="mt-2 text-3xl font-extrabold">Profile & preferences</h1>
      <Card className="mt-6 p-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <span>{u.email}</span>
          <Badge tone={u.email_verified ? 'green' : 'orange'}>{u.email_verified ? 'Email verified' : 'Email not verified'}</Badge>
          <Badge tone="cyan" className="capitalize">{u.role}</Badge>
        </div>
        <p className="mt-1 text-xs text-ink-3">Member since {fmtDateTime(u.created_at)}</p>
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label="Display name" hint="Shown only to municipal staff, never on public pages." error={err}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}</Field>
          <label className="flex min-h-[44px] items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-cyan" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span><span className="font-semibold">Email me when my reports change status</span><span className="block text-sm text-ink-2">In-app notifications are always on.{api.mode === 'demo' ? ' Emails aren’t sent in demo mode.' : ''}</span></span>
          </label>
          <Button type="submit" loading={busy}>Save changes</Button>
        </form>
      </Card>
      <Card className="mt-6 p-6">
        <h2 className="font-bold">Security</h2>
        <p className="mt-1 text-sm text-ink-2">Change your password by requesting a secure reset link.</p>
        <Button variant="secondary" className="mt-3" onClick={async () => {
          try { await api.requestPasswordReset(u.email ?? ''); toast({ kind: 'success', title: 'Reset link sent', body: `Check ${u.email}` }); } catch (e) { toast({ kind: 'error', title: 'Couldn’t send reset link', body: e instanceof Error ? e.message : undefined }); }
        }}>Send password reset link</Button>
      </Card>
      {api.mode === 'demo' && api.resetDemo && (
        <Card className="mt-6 border-safety/30 p-6">
          <h2 className="font-bold">Demo data</h2>
          <p className="mt-1 text-sm text-ink-2">Restore the original fictional incidents and accounts. This removes everything created in this browser’s demo.</p>
          <Button variant="danger" className="mt-3" onClick={() => setResetOpen(true)}>Reset demo data</Button>
        </Card>
      )}
      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} title="Reset demo data?" description="All demo reports, photos and accounts you created in this browser will be deleted and the seed data restored. You’ll be signed out."
        footer={<><Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button><Button variant="danger" onClick={async () => { await api.resetDemo?.(); setResetOpen(false); toast({ kind: 'success', title: 'Demo data restored' }); nav('/'); }}>Reset</Button></>} />
    </div>
  );
}
