import L from './leafletGlobal';
import 'leaflet.markercluster';
import 'leaflet.heat';
import { createElement, useEffect, useMemo, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapContainer, Polyline, TileLayer, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import { config } from '@/lib/config';
import { CATEGORY_META } from '@/lib/categories';
import { SEVERITY_META } from '@/lib/severity';
import type { Hazard } from '@/lib/types';
import { STATUS_META } from '@/lib/workflow';

declare module 'leaflet' {
  function heatLayer(latlngs: [number, number, number][], options?: Record<string, unknown>): L.Layer;
}

const iconCache = new Map<string, string>();
function iconSvg(h: Hazard) {
  const key = h.category;
  if (!iconCache.has(key)) iconCache.set(key, renderToStaticMarkup(createElement(CATEGORY_META[h.category].icon, { strokeWidth: 2.4 })));
  return iconCache.get(key)!;
}

export function hazardIcon(h: Hazard, selected = false) {
  const m = SEVERITY_META[h.severity_level];
  const resolved = h.status === 'verified_resolved';
  const color = resolved ? '#48E0A4' : m.hex;
  const pulse = !resolved && (h.severity_level === 'critical' || selected);
  return L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div class="cl-marker ${resolved ? 'resolved' : ''}" aria-hidden="true">
      ${pulse ? `<span class="ring" style="background:${color}55"></span>` : ''}
      <span class="dot" style="background:${color};${selected ? 'transform:scale(1.25);border-color:#fff;box-shadow:0 0 0 4px rgba(54,217,255,.45)' : ''}">${iconSvg(h)}</span>
    </div>`,
  });
}

function ClusterLayer({ hazards, selectedId, onSelect, cluster }: { hazards: Hazard[]; selectedId?: string | null; onSelect?: (h: Hazard) => void; cluster: boolean }) {
  const map = useMap();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  useEffect(() => {
    const group = cluster
      ? L.markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius: 48,
          iconCreateFunction: (c) => {
            const crit = c.getAllChildMarkers().some((m) => (m.options as { level?: string }).level === 'critical');
            return L.divIcon({ html: `<div><span>${c.getChildCount()}</span></div>`, className: `marker-cluster marker-cluster-small${crit ? ' has-critical' : ''}`, iconSize: L.point(40, 40) });
          },
        })
      : L.layerGroup();
    hazards.forEach((h) => {
      const label = `${CATEGORY_META[h.category].label}, ${SEVERITY_META[h.severity_level].label} severity, ${STATUS_META[h.status].label}${h.location_label ? `, ${h.location_label}` : ''}`;
      const mk = L.marker([h.latitude, h.longitude], {
        icon: hazardIcon(h, h.id === selectedId), title: label, alt: label, keyboard: true, riseOnHover: true,
        zIndexOffset: h.id === selectedId ? 1000 : SEVERITY_META[h.severity_level].rank * 10,
        level: h.severity_level,
      } as L.MarkerOptions & { level: string });
      mk.on('click keypress', (e) => {
        const ke = (e as L.LeafletKeyboardEvent).originalEvent;
        if (e.type === 'keypress' && ke && ke.key !== 'Enter' && ke.key !== ' ') return;
        onSelectRef.current?.(h);
      });
      group.addLayer(mk);
    });
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, hazards, selectedId, cluster]);
  return null;
}

function HeatLayer({ hazards }: { hazards: Hazard[] }) {
  const map = useMap();
  useEffect(() => {
    const pts = hazards.map((h) => [h.latitude, h.longitude, 0.25 + h.severity_score / 130] as [number, number, number]);
    const layer = L.heatLayer(pts, { radius: 32, blur: 24, maxZoom: 16, gradient: { 0.2: '#36D9FF', 0.5: '#F5D04C', 0.75: '#FF9D42', 1: '#FF4D5A' } });
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, hazards]);
  return null;
}

function FitTo({ hazards, center, zoom, fitKey }: { hazards: Hazard[]; center?: [number, number] | null; zoom?: number; fitKey?: string | number }) {
  const map = useMap();
  const done = useRef<string | number | undefined>(undefined);
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom ?? Math.max(map.getZoom(), 15), { duration: 0.6 });
      return;
    }
    if (done.current === fitKey || !hazards.length) return;
    done.current = fitKey;
    const b = L.latLngBounds(hazards.map((h) => [h.latitude, h.longitude] as [number, number]));
    map.fitBounds(b.pad(0.15), { maxZoom: 15, animate: false });
  }, [map, hazards, center, zoom, fitKey]);
  return null;
}

function BoundsWatcher({ onMove }: { onMove?: (b: [number, number, number, number], z: number, c: [number, number]) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      const c = map.getCenter();
      onMove?.([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()], map.getZoom(), [c.lat, c.lng]);
    },
  });
  return null;
}

export interface HazardMapProps {
  hazards: Hazard[];
  selectedId?: string | null;
  onSelect?: (h: Hazard) => void;
  heatmap?: boolean;
  cluster?: boolean;
  userLocation?: [number, number] | null;
  route?: [number, number][] | null;
  routeAlt?: [number, number][] | null;
  center?: [number, number] | null;
  zoom?: number;
  fitKey?: string | number;
  className?: string;
  onMove?: (b: [number, number, number, number], z: number, c: [number, number]) => void;
  label?: string;
  interactive?: boolean;
}

export default function HazardMap(p: HazardMapProps) {
  const initial = useMemo<[number, number]>(() => p.center ?? (p.hazards[0] ? [p.hazards[0].latitude, p.hazards[0].longitude] : config.defaultCenter), []); // eslint-disable-line react-hooks/exhaustive-deps
  const interactive = p.interactive ?? true;
  return (
    <div className={p.className} role="region" aria-label={p.label ?? 'Hazard map'}>
      <MapContainer
        center={initial} zoom={p.zoom ?? 13} className="h-full w-full" zoomControl={interactive} scrollWheelZoom={interactive}
        dragging={interactive} doubleClickZoom={interactive} keyboard={interactive} attributionControl preferCanvas={false}
      >
        <TileLayer url={config.tileUrl} attribution={config.tileAttribution} maxZoom={19} className={config.tileDark ? 'cl-dark-tiles' : undefined} />
        {p.heatmap ? <HeatLayer hazards={p.hazards} /> : <ClusterLayer hazards={p.hazards} selectedId={p.selectedId} onSelect={p.onSelect} cluster={p.cluster ?? true} />}
        {p.routeAlt && <Polyline positions={p.routeAlt} pathOptions={{ color: '#9AA8BD', weight: 4, opacity: 0.6, dashArray: '6 8' }} />}
        {p.route && <Polyline positions={p.route} pathOptions={{ color: '#36D9FF', weight: 5, opacity: 0.95, dashArray: '12 12', className: 'route-animated' }} />}
        {p.userLocation && (
          <>
            <CircleMarker center={p.userLocation} radius={14} pathOptions={{ color: '#36D9FF', weight: 0, fillOpacity: 0.18 }} />
            <CircleMarker center={p.userLocation} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: '#36D9FF', fillOpacity: 1 }} />
          </>
        )}
        <FitTo hazards={p.hazards} center={p.center} zoom={p.zoom} fitKey={p.fitKey} />
        <BoundsWatcher onMove={p.onMove} />
      </MapContainer>
    </div>
  );
}
