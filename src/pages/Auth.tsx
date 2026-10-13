import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Logo } from '@/components/layout/AppShell';
import { useScene } from '@/components/three/sceneStore';
import { Button, Card, Dialog, Field, Input } from '@/components/ui';
import { useToast } from '@/hooks/providers';
import { api } from '@/lib/api';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '@/lib/api/demo/seed';
import { signInSchema, signUpSchema } from '@/lib/validation';
import { isStaff } from '@/lib/workflow';

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: React.ReactNode; children: React.ReactNode }) {
  useScene({ variant: 'auth' });
  return (
    <div className="container-x grid min-h-[calc(100dvh-4rem)] place-items-center py-10">
      <Card strong className="w-full max-w-md p-6 sm:p-8">
        <Logo />
        <h1 className="mt-6 text-2xl font-extrabold">{title}</h1>
        <p className="mt-1 text-sm text-ink-2">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </Card>
    </div>
  );
}

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : null);

export function Login() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetState, setResetState] = useState<'idle' | 'busy' | 'sent' | string>('idle');
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<z.infer<typeof signInSchema>>({ resolver: zodResolver(signInSchema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const s = await api.signIn(v.email, v.password);
      toast({ kind: 'success', title: `Welcome back, ${s.user.display_name.split(' ')[0]}` });
      nav(safeNext(sp.get('next')) ?? (isStaff(s.user.role) ? '/dashboard' : '/my-reports'), { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.');
    }
  });

  const sendReset = async () => {
    setResetState('busy');
    try {
      await api.requestPasswordReset(resetEmail);
      setResetState('sent');
    } catch (e) {
      setResetState(e instanceof Error ? e.message : 'Could not send the reset email.');
    }
  };

  return (
    <AuthFrame title="Sign in" subtitle={<>New here? <Link to="/signup" className="link">Create an account</Link> — or <Link to="/report" className="link">report without one</Link>.</>}>
      {sp.get('verified') && <p className="mb-4 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">Email confirmed — you can sign in now.</p>}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Email" error={errors.email?.message}>{(p) => <Input {...p} {...register('email')} type="email" autoComplete="email" />}</Field>
        <Field label="Password" error={errors.password?.message}>{(p) => <Input {...p} {...register('password')} type="password" autoComplete="current-password" />}</Field>
        {error && <p role="alert" className="rounded-xl border border-critical/30 bg-critical/10 p-3 text-sm text-critical">{error}</p>}
        <Button type="submit" loading={isSubmitting} className="w-full">Sign in</Button>
        <button type="button" className="w-full text-center text-sm text-ink-2 hover:text-ink" onClick={() => setResetOpen(true)}>Forgot your password?</button>
      </form>

      {api.mode === 'demo' && (
        <div className="mt-6 rounded-2xl border border-safety/30 bg-safety/5 p-4">
          <p className="text-sm font-bold text-safety">Demo test accounts</p>
          <p className="mt-1 text-xs text-ink-2">Fictional accounts that exist only in this browser’s demo database.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <Button key={a.email} size="sm" variant="secondary" className="capitalize" onClick={() => { setValue('email', a.email); setValue('password', DEMO_PASSWORD); void onSubmit(); }}>
                {a.role}
              </Button>
            ))}
          </div>
        </div>
      )}

      <Dialog open={resetOpen} onClose={() => { setResetOpen(false); setResetState('idle'); }} title="Reset your password" description="We’ll email you a secure link to choose a new password."
        footer={resetState === 'sent' ? <Button onClick={() => setResetOpen(false)}>Done</Button> : <><Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button><Button loading={resetState === 'busy'} onClick={sendReset} disabled={!/\S+@\S+\.\S+/.test(resetEmail)}>Send link</Button></>}>
        {resetState === 'sent' ? <p className="text-sm text-success" role="status">If an account exists for that address, a reset link is on its way.</p> : (
          <Field label="Email" error={!['idle', 'busy', 'sent'].includes(resetState) ? resetState : null}>{(p) => <Input {...p} type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} autoComplete="email" />}</Field>
        )}
      </Dialog>
    </AuthFrame>
  );
}

export function Signup() {
  const nav = useNavigate();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof signUpSchema>>({ resolver: zodResolver(signUpSchema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await api.signUp(v.email, v.password, v.display_name);
      if (r.needsEmailVerification) return setVerify(v.email);
      toast({ kind: 'success', title: 'Account created', body: api.mode === 'demo' ? 'Demo accounts are stored only in this browser.' : undefined });
      nav('/my-reports', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign up failed.');
    }
  });

  if (verify)
    return (
      <AuthFrame title="Check your inbox" subtitle={<>We sent a confirmation link to <strong className="text-ink">{verify}</strong>.</>}>
        <p className="text-sm text-ink-2">Open the link to verify your email, then sign in. Didn’t get it? Check spam, or try signing up again in a few minutes.</p>
        <Link to="/login" className="link mt-4 inline-block text-sm">Go to sign in</Link>
      </AuthFrame>
    );

  return (
    <AuthFrame title="Create your account" subtitle={<>Track your reports and get notified when they’re fixed. Already have one? <Link to="/login" className="link">Sign in</Link>.</>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Display name" error={errors.display_name?.message} hint="Never shown publicly next to your reports.">{(p) => <Input {...p} {...register('display_name')} autoComplete="nickname" />}</Field>
        <Field label="Email" error={errors.email?.message}>{(p) => <Input {...p} {...register('email')} type="email" autoComplete="email" />}</Field>
        <Field label="Password" error={errors.password?.message} hint="At least 10 characters, with a letter and a number.">{(p) => <Input {...p} {...register('password')} type="password" autoComplete="new-password" />}</Field>
        {error && <p role="alert" className="rounded-xl border border-critical/30 bg-critical/10 p-3 text-sm text-critical">{error}</p>}
        <Button type="submit" loading={isSubmitting} className="w-full">Create account</Button>
        <p className="text-xs text-ink-3">By creating an account you agree to the <Link to="/legal/terms" className="link">terms</Link> and <Link to="/legal/privacy" className="link">privacy policy</Link>. New accounts are citizen accounts; municipal roles are granted only by an administrator.</p>
      </form>
    </AuthFrame>
  );
}
