import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SEVERITY_META } from '@/lib/severity';
import { sceneStore, useSceneState, type ScenePin, type SceneVariant } from './sceneStore';

/**
 * CityScene — one shared, procedurally generated smart-city.
 * Every route configures it through `useScene()`; only one WebGL context exists.
 * Repeated geometry (buildings, windows, vehicles, lights) is instanced.
 */

const BLOCK = 4; // block pitch (road centre to road centre)
const ROAD = 1.1; // road width
const GRID = 9; // blocks from centre to edge

const rand = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// ── Camera presets ────────────────────────────────────────────────────────
const PRESETS: Record<SceneVariant, { pos: [number, number, number]; look: [number, number, number]; orbit: number; light: string; fog: number }> = {
  home: { pos: [24, 19, 24], look: [-2, 0, -2], orbit: 0.035, light: '#36D9FF', fog: 0.0110 },
  map3d: { pos: [0, 30, 24], look: [0, 0, 0], orbit: 0, light: '#36D9FF', fog: 0.0060 },
  report: { pos: [8, 6.5, 10], look: [0, 1.6, 0], orbit: 0.06, light: '#FF9D42', fog: 0.0175 },
  detail: { pos: [7, 6, 7], look: [0, 0.5, 0], orbit: 0.04, light: '#FF4D5A', fog: 0.0200 },
  dashboard: { pos: [16, 24, 16], look: [0, 0, 0], orbit: 0.02, light: '#36D9FF', fog: 0.0080 },
  analytics: { pos: [13, 11, 17], look: [0, 2, 0], orbit: 0.03, light: '#48E0A4', fog: 0.0125 },
  verify: { pos: [0, 8.5, 9.5], look: [0, 0, 0], orbit: 0, light: '#48E0A4', fog: 0.0175 },
  profile: { pos: [22, 7, 22], look: [0, 2, 0], orbit: 0.015, light: '#36D9FF', fog: 0.0150 },
  auth: { pos: [20, 9, -18], look: [0, 0, 0], orbit: 0.02, light: '#36D9FF', fog: 0.0150 },
  off: { pos: [19, 13, 19], look: [0, 0, 0], orbit: 0, light: '#36D9FF', fog: 0.0150 },
};

function CameraRig({ variant, reduced }: { variant: SceneVariant; reduced: boolean }) {
  const { camera, pointer } = useThree();
  const look = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());
  const angle = useRef(0);
  useFrame((_, dt) => {
    const p = PRESETS[variant];
    if (!reduced) angle.current += dt * p.orbit;
    const base = new THREE.Vector3(...p.pos);
    base.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle.current);
    if (!reduced) {
      base.x += pointer.x * 1.2;
      base.y += pointer.y * 0.8;
    }
    const k = reduced ? 1 : 1 - Math.pow(0.001, dt); // frame-rate independent ease
    camera.position.lerp(base, k * 0.9);
    target.current.set(...p.look);
    look.current.lerp(target.current, k);
    camera.lookAt(look.current);
  });
  return null;
}

// ── Ground + roads + data pulses (single shader plane) ───────────────────
const groundVert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const groundFrag = /* glsl */ `
  uniform float uTime; uniform float uBlock; uniform float uRoad; uniform vec3 uAccent; uniform float uFog; uniform vec3 uCam;
  varying vec3 vWorld;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec2 p = vWorld.xz;
    vec2 cell = p / uBlock + 0.5;
    vec2 f = abs(fract(cell) - 0.5) * uBlock;      // distance to nearest road centre line
    vec2 idx = floor(cell);
    float roadX = step(f.y, uRoad * 0.5);           // road running along x
    float roadZ = step(f.x, uRoad * 0.5);           // road running along z
    float road = max(roadX, roadZ);
    vec3 col = mix(vec3(0.03, 0.045, 0.075), vec3(0.075, 0.1, 0.15), road);
    // sidewalk edge glow
    float edgeX = smoothstep(0.06, 0.0, abs(f.y - uRoad * 0.5));
    float edgeZ = smoothstep(0.06, 0.0, abs(f.x - uRoad * 0.5));
    col += uAccent * 0.4 * max(edgeX, edgeZ);
    // dashed centre lines
    float dashX = roadX * smoothstep(0.035, 0.0, f.y) * step(0.5, fract(p.x * 0.8));
    float dashZ = roadZ * smoothstep(0.035, 0.0, f.x) * step(0.5, fract(p.y * 0.8));
    col += vec3(0.35, 0.42, 0.5) * 0.35 * max(dashX, dashZ);
    // travelling data pulses
    float sx = fract((p.x * 0.06) - uTime * (0.05 + hash(idx.y) * 0.08) + hash(idx.y * 7.1));
    float sz = fract((p.y * 0.06) - uTime * (0.05 + hash(idx.x + 3.0) * 0.08) + hash(idx.x * 3.7));
    float pulseX = roadX * smoothstep(0.25, 0.0, f.y) * pow(smoothstep(0.86, 1.0, sx), 3.0) * step(0.55, hash(idx.y + 11.0));
    float pulseZ = roadZ * smoothstep(0.25, 0.0, f.x) * pow(smoothstep(0.86, 1.0, sz), 3.0) * step(0.55, hash(idx.x + 17.0));
    col += uAccent * 2.4 * max(pulseX, pulseZ);
    // fine block grid
    vec2 g = abs(fract(p * 0.5) - 0.5);
    col += vec3(0.04, 0.09, 0.12) * (1.0 - road) * smoothstep(0.02, 0.0, min(g.x, g.y)) * 0.6;
    // distance fog + radial fade
    float d = length(vWorld - uCam);
    float fog = 1.0 - exp(-pow(d * uFog, 2.0));
    float radial = smoothstep(58.0, 24.0, length(p));
    col = mix(col, vec3(0.027, 0.043, 0.078), fog);
    gl_FragColor = vec4(col * (0.35 + 0.65 * radial), 1.0);
  }`;

function Ground({ accent, fog, reduced }: { accent: string; fog: number; reduced: boolean }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uBlock: { value: BLOCK }, uRoad: { value: ROAD }, uAccent: { value: new THREE.Color(accent) }, uFog: { value: fog }, uCam: { value: new THREE.Vector3() } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useFrame(({ camera }, dt) => {
    if (!mat.current) return;
    if (!reduced) uniforms.uTime.value += dt;
    (uniforms.uAccent.value as THREE.Color).lerp(new THREE.Color(accent), 0.04);
    uniforms.uFog.value += (fog - uniforms.uFog.value) * 0.05;
    uniforms.uCam.value.copy(camera.position);
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
      <planeGeometry args={[120, 120, 1, 1]} />
      <shaderMaterial ref={mat} vertexShader={groundVert} fragmentShader={groundFrag} uniforms={uniforms} />
    </mesh>
  );
}

// ── Instanced buildings with procedural windows ──────────────────────────
const bVert = /* glsl */ `
  varying vec3 vLocal; varying vec3 vScale; varying float vSeed; varying vec3 vN; varying vec3 vWorld;
  void main() {
    vLocal = position;
    vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vSeed = instanceMatrix[3].x * 1.31 + instanceMatrix[3].z * 2.17;
    vN = normal;
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const bFrag = /* glsl */ `
  uniform vec3 uAccent; uniform float uTime; uniform vec3 uCam; uniform float uFog;
  varying vec3 vLocal; varying vec3 vScale; varying float vSeed; varying vec3 vN; varying vec3 vWorld;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    float y = (vLocal.y + 0.5);
    vec3 base = mix(vec3(0.04, 0.055, 0.09), vec3(0.09, 0.12, 0.19), y);
    float side = 1.0 - abs(vN.y);
    // window grid on vertical faces
    vec2 uv = vec2((vN.x != 0.0 ? vLocal.z * vScale.z : vLocal.x * vScale.x), y * vScale.y);
    vec2 cell = floor(uv / vec2(0.32, 0.42));
    vec2 inCell = fract(uv / vec2(0.32, 0.42));
    float win = step(0.25, inCell.x) * step(inCell.x, 0.75) * step(0.3, inCell.y) * step(inCell.y, 0.75);
    float lit = step(0.84, h(cell + vSeed)) * step(0.6, y * vScale.y);
    float flicker = 0.85 + 0.15 * sin(uTime * 2.0 + h(cell) * 30.0);
    vec3 warm = mix(vec3(1.0, 0.72, 0.45), uAccent, step(0.5, h(cell + 3.1)));
    vec3 col = base + side * win * lit * warm * 0.38 * flicker;
    // rim + roof edge glow
    col += uAccent * 0.45 * smoothstep(0.97, 1.0, y) * side;
    col += uAccent * 0.05 * (1.0 - abs(dot(normalize(uCam - vWorld), vN)));
    float d = length(vWorld - uCam);
    float fog = 1.0 - exp(-pow(d * uFog, 2.0));
    gl_FragColor = vec4(mix(col, vec3(0.027, 0.043, 0.078), fog), 1.0);
  }`;

function Buildings({ accent, fog, lowDetail, reduced, clearCenter }: { accent: string; fog: number; lowDetail: boolean; reduced: boolean; clearCenter: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: { x: number; z: number; w: number; d: number; h: number }[] = [];
    const span = lowDetail ? 6 : GRID;
    for (let i = -span; i < span; i++) {
      for (let j = -span; j < span; j++) {
        const cx = (i + 0.5) * BLOCK, cz = (j + 0.5) * BLOCK;
        const dist = Math.hypot(cx, cz);
        if (dist < clearCenter) continue;
        const inner = BLOCK - ROAD - 0.5;
        const parts = rand(i * 31 + j) > 0.55 ? 2 : 1;
        for (let k = 0; k < parts; k++) {
          const s = rand(i * 17 + j * 29 + k * 5);
          const w = parts === 2 ? inner / 2 - 0.15 : inner * (0.7 + s * 0.3);
          const d = inner * (0.6 + rand(s * 99) * 0.4);
          const tall = Math.max(0.5, (1 - dist / 44) * 6.5 * (0.3 + Math.pow(rand(s * 7 + 1), 2) * 1.5));
          out.push({ x: cx + (parts === 2 ? (k - 0.5) * (inner / 2 + 0.1) : 0), z: cz, w, d, h: tall });
        }
      }
    }
    return out;
  }, [lowDetail, clearCenter]);

  const uniforms = useMemo(
    () => ({ uAccent: { value: new THREE.Color(accent) }, uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uFog: { value: fog } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach((b, i) => {
      o.position.set(b.x, b.h / 2, b.z);
      o.scale.set(b.w, b.h, b.d);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  useFrame(({ camera }, dt) => {
    if (!reduced) uniforms.uTime.value += dt;
    (uniforms.uAccent.value as THREE.Color).lerp(new THREE.Color(accent), 0.04);
    uniforms.uFog.value += (fog - uniforms.uFog.value) * 0.05;
    uniforms.uCam.value.copy(camera.position);
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} key={items.length} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <shaderMaterial vertexShader={bVert} fragmentShader={bFrag} uniforms={uniforms} />
    </instancedMesh>
  );
}

// ── Streetlights (instanced) & vehicles (instanced, animated) ────────────
function StreetLights({ lowDetail }: { lowDetail: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const pos = useMemo(() => {
    const out: [number, number, number][] = [];
    const span = lowDetail ? 5 : 8;
    for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) out.push([i * BLOCK + ROAD * 0.6, 0.9, j * BLOCK + ROAD * 0.6]);
    return out;
  }, [lowDetail]);
  useEffect(() => {
    const o = new THREE.Object3D();
    pos.forEach((p, i) => {
      o.position.set(...p);
      o.updateMatrix();
      ref.current?.setMatrixAt(i, o.matrix);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [pos]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, pos.length]} key={pos.length} frustumCulled={false}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial color="#FFD9A0" toneMapped={false} />
    </instancedMesh>
  );
}

function Vehicles({ count, reduced }: { count: number; reduced: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const cars = useMemo(
    () => Array.from({ length: count }, (_, i) => ({
      axis: i % 2, lane: Math.round((rand(i) - 0.5) * 14) * BLOCK + (rand(i + 9) > 0.5 ? 0.25 : -0.25),
      offset: rand(i * 3) * 80, speed: (rand(i * 5) > 0.5 ? 1 : -1) * (2 + rand(i * 7) * 3),
    })),
    [count],
  );
  const color = useMemo(() => {
    const c = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const col = new THREE.Color(rand(i * 13) > 0.3 ? '#EAF6FF' : '#FF9D42');
      col.toArray(c, i * 3);
    }
    return c;
  }, [count]);
  const o = useMemo(() => new THREE.Object3D(), []);
  const t = useRef(0);
  useFrame((_, dt) => {
    if (!ref.current) return;
    if (!reduced) t.current += dt;
    cars.forEach((c, i) => {
      const s = ((c.offset + t.current * c.speed) % 80 + 80) % 80 - 40;
      if (c.axis === 0) o.position.set(s, 0.12, c.lane);
      else o.position.set(c.lane, 0.12, s);
      o.rotation.y = c.axis === 0 ? 0 : Math.PI / 2;
      o.updateMatrix();
      ref.current!.setMatrixAt(i, o.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} key={count} frustumCulled={false}>
      <boxGeometry args={[0.42, 0.14, 0.2]}>
        <instancedBufferAttribute attach="attributes-color" args={[color, 3]} />
      </boxGeometry>
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

function Particles({ count, reduced }: { count: number; reduced: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      a[i * 3] = (rand(i) - 0.5) * 70;
      a[i * 3 + 1] = rand(i + 1) * 14 + 0.5;
      a[i * 3 + 2] = (rand(i + 2) - 0.5) * 70;
    }
    return a;
  }, [count]);
  useFrame((_, dt) => {
    if (ref.current && !reduced) ref.current.rotation.y += dt * 0.01;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.08} color="#7FE8FF" transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
    </points>
  );
}

// ── Hazard markers (decorative on home, real data elsewhere) ─────────────
const ringGeo = new THREE.RingGeometry(0.5, 0.62, 48);
const beamGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 8, 1, true);
const headGeo = new THREE.SphereGeometry(0.22, 20, 20);

function Marker({ position, color, focus, reduced, onClick, label }: { position: [number, number, number]; color: string; focus?: boolean; reduced: boolean; onClick?: () => void; label?: string }) {
  const ring = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const h = focus ? 3.2 : 1.8;
  useFrame(({ clock }) => {
    const t = reduced ? 0.4 : (clock.elapsedTime * 0.7 + phase) % 1;
    if (ring.current) {
      const s = 1 + t * (focus ? 4 : 2.4);
      ring.current.scale.set(s, s, s);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
    }
    if (head.current && !reduced) head.current.position.y = h + Math.sin(clock.elapsedTime * 2 + phase) * 0.12;
  });
  return (
    <group position={position}>
      <mesh ref={ring} geometry={ringGeo} rotation-x={-Math.PI / 2} position-y={0.03}>
        <meshBasicMaterial color={color} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh geometry={beamGeo} position-y={h / 2} scale-y={h}>
        <meshBasicMaterial color={color} transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh
        ref={head} geometry={headGeo} position-y={h} scale={focus ? 1.6 : onClick ? 1.25 : 1}
        onClick={onClick ? (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick(); } : undefined}
        onPointerOver={onClick ? () => (document.body.style.cursor = 'pointer') : undefined}
        onPointerOut={onClick ? () => (document.body.style.cursor = '') : undefined}
        userData={{ label }}
      >
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

const DECOR: { p: [number, number, number]; c: string }[] = [
  { p: [2, 0, -6], c: '#FF4D5A' }, { p: [-8, 0, 2], c: '#FF9D42' }, { p: [10, 0, 6], c: '#FF9D42' },
  { p: [-2, 0, 10], c: '#48E0A4' }, { p: [6, 0, -14], c: '#FF4D5A' }, { p: [-14, 0, -6], c: '#36D9FF' },
];

/** Project real lat/lng pins into scene space (fit to a radius). */
function projectPins(pins: ScenePin[], radius: number) {
  if (!pins.length) return [];
  const lats = pins.map((p) => p.lat), lngs = pins.map((p) => p.lng);
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2, cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs), 0.002);
  return pins.map((p) => ({ ...p, x: ((p.lng - cLng) / span) * radius * 2, z: (-(p.lat - cLat) / span) * radius * 2 }));
}

function DataPins({ reduced, radius = 16 }: { reduced: boolean; radius?: number }) {
  const { pins, focusId, onSelect, variant } = useSceneState();
  const projected = useMemo(() => projectPins(pins.slice(0, 120), radius), [pins, radius]);
  return (
    <>
      {projected.map((p) => (
        <Marker
          key={p.id} position={[p.x, 0, p.z]} focus={p.id === focusId} reduced={reduced}
          color={p.resolved ? '#48E0A4' : SEVERITY_META[p.level].hex}
          onClick={variant === 'map3d' && onSelect ? () => onSelect(p.id) : undefined}
        />
      ))}
    </>
  );
}

/** Dashboard digital twin: severity-coloured cluster columns. */
function Clusters({ reduced }: { reduced: boolean }) {
  const { pins } = useSceneState();
  const cells = useMemo(() => {
    const pr = projectPins(pins, 14);
    const map = new Map<string, { x: number; z: number; n: number; rank: number; color: string }>();
    pr.forEach((p) => {
      const k = `${Math.round(p.x / 4)}:${Math.round(p.z / 4)}`;
      const m = SEVERITY_META[p.level];
      const cur = map.get(k) ?? { x: Math.round(p.x / 4) * 4, z: Math.round(p.z / 4) * 4, n: 0, rank: 0, color: m.hex };
      cur.n += 1;
      if (!p.resolved && m.rank > cur.rank) { cur.rank = m.rank; cur.color = m.hex; }
      map.set(k, cur);
    });
    return [...map.values()];
  }, [pins]);
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    group.current?.children.forEach((c) => {
      const target = (c.userData.h as number) ?? 1;
      c.scale.y += (target - c.scale.y) * Math.min(1, dt * (reduced ? 60 : 3));
      c.position.y = c.scale.y / 2;
    });
  });
  return (
    <group ref={group}>
      {cells.map((c, i) => (
        <mesh key={i} position={[c.x, 0.5, c.z]} scale={[1.1, 0.01, 1.1]} userData={{ h: 0.8 + c.n * 1.4 }}>
          <cylinderGeometry args={[0.7, 0.7, 1, 24, 1, true]} />
          <meshBasicMaterial color={c.color} transparent opacity={0.4} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Analytics: animated 3D data bars + particle flow. */
function DataBars({ reduced }: { reduced: boolean }) {
  const { bars } = useSceneState();
  const values = bars.length ? bars : Array.from({ length: 16 }, (_, i) => 0.2 + rand(i) * 0.8);
  const ref = useRef<THREE.InstancedMesh>(null);
  const cur = useRef<number[]>([]);
  const o = useMemo(() => new THREE.Object3D(), []);
  const cols = Math.ceil(Math.sqrt(values.length));
  useFrame(({ clock }, dt) => {
    if (!ref.current) return;
    values.forEach((v, i) => {
      const target = 0.3 + v * 6 + (reduced ? 0 : Math.sin(clock.elapsedTime * 1.2 + i) * 0.08);
      cur.current[i] = (cur.current[i] ?? 0.01) + (target - (cur.current[i] ?? 0.01)) * Math.min(1, dt * (reduced ? 60 : 2.5));
      const x = (i % cols - (cols - 1) / 2) * 1.6, z = (Math.floor(i / cols) - (cols - 1) / 2) * 1.6;
      o.position.set(x, cur.current[i] / 2, z);
      o.scale.set(0.9, cur.current[i], 0.9);
      o.updateMatrix();
      ref.current!.setMatrixAt(i, o.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, values.length]} key={values.length} frustumCulled={false}>
      <boxGeometry />
      <meshStandardMaterial color="#36D9FF" emissive="#36D9FF" emissiveIntensity={0.55} transparent opacity={0.85} roughness={0.3} metalness={0.2} />
    </instancedMesh>
  );
}

/** Report: rotating location pin + floating photo frames on a mini block. */
function ReportPin({ reduced }: { reduced: boolean }) {
  const pin = useRef<THREE.Group>(null);
  const frames = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    if (reduced) return;
    if (pin.current) {
      pin.current.rotation.y += dt * 0.8;
      pin.current.position.y = 2.2 + Math.sin(clock.elapsedTime * 1.6) * 0.18;
    }
    if (frames.current) frames.current.rotation.y -= dt * 0.18;
  });
  return (
    <group>
      <group ref={pin} position={[0, 2.2, 0]}>
        <mesh position-y={0.55}>
          <sphereGeometry args={[0.6, 32, 32]} />
          <meshStandardMaterial color="#FF9D42" emissive="#FF9D42" emissiveIntensity={0.6} roughness={0.25} metalness={0.3} />
        </mesh>
        <mesh position-y={-0.35} rotation-x={Math.PI}>
          <coneGeometry args={[0.52, 1.3, 32]} />
          <meshStandardMaterial color="#FF9D42" emissive="#FF9D42" emissiveIntensity={0.5} roughness={0.25} metalness={0.3} />
        </mesh>
        <mesh position-y={0.55}>
          <sphereGeometry args={[0.24, 24, 24]} />
          <meshBasicMaterial color="#070B14" />
        </mesh>
      </group>
      <Marker position={[0, 0, 0]} color="#FF9D42" focus reduced={reduced} />
      <group ref={frames}>
        {[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2;
          return (
            <group key={i} position={[Math.cos(a) * 3.2, 2.4 + i * 0.4, Math.sin(a) * 3.2]} rotation-y={-a + Math.PI / 2}>
              <mesh>
                <planeGeometry args={[1.5, 1.05]} />
                <meshBasicMaterial color="#101827" transparent opacity={0.85} side={THREE.DoubleSide} />
              </mesh>
              <lineSegments>
                <edgesGeometry args={[new THREE.PlaneGeometry(1.5, 1.05)]} />
                <lineBasicMaterial color="#36D9FF" />
              </lineSegments>
              <mesh position-z={0.01}>
                <circleGeometry args={[0.18, 24]} />
                <meshBasicMaterial color="#36D9FF" transparent opacity={0.5} side={THREE.DoubleSide} />
              </mesh>
            </group>
          );
        })}
      </group>
    </group>
  );
}

/** Verify: damaged street surface transforming into a repaired one. */
const verifyFrag = /* glsl */ `
  uniform float uProgress; varying vec2 vUv;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+1.0), f.x), f.y); }
  void main() {
    vec2 p = vUv * 8.0;
    float cracks = smoothstep(0.035, 0.0, abs(n(p * 1.3) - 0.5)) + smoothstep(0.03, 0.0, abs(n(p * 2.7 + 4.0) - 0.5));
    float hole = smoothstep(0.32, 0.26, length(vUv - vec2(0.5)) + n(p) * 0.08);
    vec3 damaged = vec3(0.08, 0.09, 0.11) - cracks * 0.05 + vec3(1.0, 0.45, 0.15) * cracks * 0.35;
    damaged = mix(damaged, vec3(0.01), hole);
    damaged += vec3(1.0, 0.3, 0.3) * smoothstep(0.34, 0.3, length(vUv - 0.5)) * (1.0 - hole) * 0.25;
    vec3 repaired = vec3(0.12, 0.14, 0.17) + n(p * 6.0) * 0.02;
    float edge = vUv.x - uProgress;
    float m = smoothstep(0.0, 0.01, -edge);
    vec3 col = mix(damaged, repaired, m);
    col += vec3(0.28, 0.88, 0.64) * smoothstep(0.02, 0.0, abs(edge)) * 1.4;
    float border = smoothstep(0.0, 0.015, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
    col = mix(vec3(0.21, 0.85, 1.0) * 0.5, col, border);
    gl_FragColor = vec4(col, 1.0);
  }`;

function VerifyTile({ reduced }: { reduced: boolean }) {
  const uniforms = useMemo(() => ({ uProgress: { value: 0.5 } }), []);
  useFrame(({ clock }) => {
    uniforms.uProgress.value = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 0.45);
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
      <planeGeometry args={[8, 8]} />
      <shaderMaterial uniforms={uniforms} vertexShader={`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`} fragmentShader={verifyFrag} />
    </mesh>
  );
}

function Lights({ accent }: { accent: string }) {
  const key = useRef<THREE.PointLight>(null);
  useFrame(() => key.current?.color.lerp(new THREE.Color(accent), 0.04));
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[10, 18, 6]} intensity={0.6} color="#B8D4FF" />
      <pointLight ref={key} position={[0, 8, 0]} intensity={40} distance={30} color={accent} />
    </>
  );
}

function SceneContent({ variant, lowDetail, reduced }: { variant: SceneVariant; lowDetail: boolean; reduced: boolean }) {
  const p = PRESETS[variant];
  const clear = variant === 'verify' || variant === 'report' ? 7 : variant === 'detail' ? 3 : variant === 'analytics' ? 8.5 : 0;
  return (
    <>
      <color attach="background" args={['#070B14']} />
      <CameraRig variant={variant} reduced={reduced} />
      <Lights accent={p.light} />
      <Ground accent={p.light} fog={p.fog} reduced={reduced} />
      <Buildings accent={p.light} fog={p.fog} lowDetail={lowDetail} reduced={reduced} clearCenter={clear} />
      <StreetLights lowDetail={lowDetail} />
      <Vehicles count={lowDetail ? 24 : 70} reduced={reduced} />
      <Particles count={lowDetail ? 180 : 600} reduced={reduced} />
      {variant === 'home' && DECOR.map((d, i) => <Marker key={i} position={d.p} color={d.c} reduced={reduced} />)}
      {(variant === 'map3d' || variant === 'detail') && <DataPins reduced={reduced} radius={variant === 'detail' ? 3 : 16} />}
      {variant === 'dashboard' && <Clusters reduced={reduced} />}
      {variant === 'analytics' && <DataBars reduced={reduced} />}
      {variant === 'report' && <ReportPin reduced={reduced} />}
      {variant === 'verify' && <VerifyTile reduced={reduced} />}
    </>
  );
}

export default function CityScene({ lowDetail, reduced, visible }: { lowDetail: boolean; reduced: boolean; visible: boolean }) {
  const { variant, paused } = useSceneState();
  const active = visible && !paused && variant !== 'off';
  return (
    <Canvas
      dpr={lowDetail ? [1, 1.25] : [1, 1.75]}
      camera={{ position: [19, 13, 19], fov: 42, near: 0.1, far: 200 }}
      gl={{ antialias: !lowDetail, powerPreference: 'high-performance', alpha: false }}
      frameloop={active ? (reduced ? 'demand' : 'always') : 'never'}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
      onPointerMissed={() => sceneStore.get().interactive && document.body.style.removeProperty('cursor')}
      aria-hidden
    >
      <SceneContent variant={variant === 'off' ? 'home' : variant} lowDetail={lowDetail} reduced={reduced} />
      {reduced && <DemandRender variant={variant} />}
    </Canvas>
  );
}

/** In reduced-motion mode, render a few frames when the variant changes, then stop. */
function DemandRender({ variant }: { variant: SceneVariant }) {
  const { invalidate } = useThree();
  const { pins, bars } = useSceneState();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      invalidate();
      if (++n > 4) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, [variant, pins, bars, invalidate]);
  return null;
}
