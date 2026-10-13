import { useEffect, useSyncExternalStore } from 'react';
import type { SeverityLevel } from '@/lib/types';

export type SceneVariant = 'home' | 'map3d' | 'report' | 'detail' | 'dashboard' | 'analytics' | 'verify' | 'profile' | 'auth' | 'off';

export interface ScenePin {
  id: string;
  lat: number;
  lng: number;
  level: SeverityLevel;
  resolved?: boolean;
}

export interface SceneState {
  variant: SceneVariant;
  /** Real hazard pins (map3d / dashboard / detail). */
  pins: ScenePin[];
  focusId: string | null;
  /** Values for analytics bars (0..1 normalised). */
  bars: number[];
  /** Pause rendering (e.g. while the 2D map covers the scene). */
  paused: boolean;
  /** Canvas receives pointer events (map3d). */
  interactive: boolean;
  onSelect: ((id: string) => void) | null;
}

const initial: SceneState = { variant: 'home', pins: [], focusId: null, bars: [], paused: false, interactive: false, onSelect: null };
let state: SceneState = initial;
const listeners = new Set<() => void>();

export const sceneStore = {
  get: () => state,
  set(patch: Partial<SceneState>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const useSceneState = () => useSyncExternalStore(sceneStore.subscribe, sceneStore.get, sceneStore.get);

/** Pages call this to configure the shared background scene. */
export function useScene(patch: Partial<SceneState> & { variant: SceneVariant }, deps: unknown[] = []) {
  useEffect(() => {
    sceneStore.set({ pins: [], focusId: null, bars: [], paused: false, interactive: false, onSelect: null, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch.variant, ...deps]);
}
