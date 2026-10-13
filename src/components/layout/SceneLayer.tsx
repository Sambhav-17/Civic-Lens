import { Component, lazy, Suspense, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { hasWebGL, useMediaQuery, usePageVisible, useReducedMotion } from '@/hooks/useQuery';
import { useSceneState } from '../three/sceneStore';

const CityScene = lazy(() => import('../three/CityScene'));

/** Attractive CSS fallback when WebGL is unavailable or the scene fails. */
export function SceneFallback() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-midnight" aria-hidden>
      <div className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" style={{ transform: 'perspective(800px) rotateX(58deg) scale(2.2) translateY(-8%)', transformOrigin: 'center 70%' }} />
      <div className="absolute left-1/4 top-1/3 h-72 w-72 rounded-full bg-cyan/10 blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 h-60 w-60 rounded-full bg-safety/10 blur-3xl" />
      {[[30, 55, '#FF4D5A'], [62, 48, '#FF9D42'], [45, 70, '#48E0A4'], [72, 66, '#FF9D42']].map(([x, y, c], i) => (
        <span key={i} className="absolute h-3 w-3 rounded-full" style={{ left: `${x}%`, top: `${y}%`, background: c as string, boxShadow: `0 0 18px ${c}` }}>
          <span className="absolute inset-0 animate-ping2 rounded-full" style={{ background: c as string }} />
        </span>
      ))}
    </div>
  );
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <SceneFallback /> : this.props.children;
  }
}

export function SceneLayer() {
  const { variant, interactive } = useSceneState();
  const reduced = useReducedMotion();
  const small = useMediaQuery('(max-width: 768px)');
  const visible = usePageVisible();
  const webgl = typeof window !== 'undefined' && hasWebGL();
  if (variant === 'off') return null;
  return (
    <div className={clsx('fixed inset-0 z-0', interactive ? 'pointer-events-auto' : 'pointer-events-none')}>
      {webgl ? (
        <SceneBoundary>
          <Suspense fallback={<SceneFallback />}>
            <CityScene lowDetail={small} reduced={reduced} visible={visible} />
          </Suspense>
        </SceneBoundary>
      ) : (
        <SceneFallback />
      )}
      {!interactive && <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-midnight/30 via-transparent to-midnight/90" />}
      {/* Content-heavy pages dim the scene so text and forms stay readable. */}
      {!interactive && variant !== 'home' && variant !== 'dashboard' && <div className="pointer-events-none absolute inset-0 bg-midnight/45" />}
    </div>
  );
}
