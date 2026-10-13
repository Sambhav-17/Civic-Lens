import { Plus } from 'lucide-react';
import { HazardListItem } from '@/components/hazard';
import { useScene } from '@/components/three/sceneStore';
import { ButtonLink, Card, EmptyState, ErrorState, Skeleton, Stat } from '@/components/ui';
import { useAuth } from '@/hooks/providers';
import { useQuery } from '@/hooks/useQuery';
import { api } from '@/lib/api';
import { isOpen } from '@/lib/workflow';

export default function MyReports() {
  useScene({ variant: 'profile' });
  const { session, loading } = useAuth();
  const q = useQuery(() => api.listHazards({ reporterId: session!.user.id, sort: 'newest', pageSize: 500 }), [session?.user.id], { enabled: !!session });
  const items = q.data?.items ?? [];

  if (!loading && !session)
    return (
      <div className="container-x max-w-2xl py-16">
        <Card className="p-2">
          <EmptyState title="Sign in to see your reports" body="Reports you make while signed in appear here with live status updates. Anonymous reports can’t be linked to an account — keep their incident link to track them." action={<div className="flex gap-2"><ButtonLink to="/login?next=/my-reports">Sign in</ButtonLink><ButtonLink to="/signup" variant="secondary">Create account</ButtonLink></div>} />
        </Card>
      </div>
    );

  return (
    <div className="container-x max-w-4xl py-10">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Report history</p>
          <h1 className="mt-2 text-3xl font-extrabold">My reports</h1>
        </div>
        <ButtonLink to="/report"><Plus className="h-4 w-4" aria-hidden />New report</ButtonLink>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat loading={q.loading} label="Reports made" value={items.length} />
        <Stat loading={q.loading} tone="orange" label="Still open" value={items.filter((h) => isOpen(h.status)).length} />
        <Stat loading={q.loading} tone="green" label="Verified fixed" value={items.filter((h) => h.status === 'verified_resolved').length} />
      </div>
      <div className="mt-6 space-y-2">
        {q.loading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)}
        {!!q.error && <ErrorState error={q.error} onRetry={q.reload} />}
        {!q.loading && !q.error && items.length === 0 && <Card><EmptyState title="No reports yet" body="When you report a hazard while signed in, you can follow its progress here." action={<ButtonLink to="/report">Report a hazard</ButtonLink>} /></Card>}
        {items.map((h) => <HazardListItem key={h.id} hazard={h} to={`/hazards/${h.id}`} />)}
      </div>
    </div>
  );
}
