import { useScene } from '@/components/three/sceneStore';
import { ButtonLink, Card, EmptyState } from '@/components/ui';

export default function NotFound() {
  useScene({ variant: 'profile' });
  return (
    <div className="container-x max-w-xl py-24">
      <Card>
        <EmptyState title="Page not found" body="This street doesn’t exist on our map." action={<div className="flex gap-2"><ButtonLink to="/">Home</ButtonLink><ButtonLink to="/map" variant="secondary">Explore map</ButtonLink></div>} />
      </Card>
    </div>
  );
}
