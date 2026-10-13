import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { config } from '@/lib/config';

const pinIcon = L.divIcon({
  className: '',
  iconSize: [36, 48],
  iconAnchor: [18, 46],
  html: `<svg width="36" height="48" viewBox="0 0 36 48" aria-hidden="true"><defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#000" flood-opacity=".6"/></filter></defs>
  <path filter="url(#s)" d="M18 46s14-15.3 14-27A14 14 0 0 0 4 19c0 11.7 14 27 14 27z" fill="#FF9D42" stroke="#fff" stroke-width="2"/><circle cx="18" cy="19" r="5.5" fill="#070B14"/></svg>`,
});

function ClickToMove({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onChange(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Recenter({ lat, lng, token }: { lat: number; lng: number; token: number }) {
  const map = useMap();
  useEffect(() => {
    if (token) map.flyTo([lat, lng], Math.max(map.getZoom(), 17), { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return null;
}

/**
 * Draggable location pin. Click anywhere to move it; drag for fine adjustment;
 * or focus the pin and use arrow keys (handled by the parent via nudge buttons).
 */
export default function LocationPicker({ lat, lng, accuracy, onChange, recenterToken }: {
  lat: number; lng: number; accuracy?: number | null; onChange: (lat: number, lng: number) => void; recenterToken: number;
}) {
  const ref = useRef<L.Marker>(null);
  const handlers = useMemo(() => ({ dragend: () => { const p = ref.current?.getLatLng(); if (p) onChange(p.lat, p.lng); } }), [onChange]);
  return (
    <MapContainer center={[lat, lng]} zoom={16} className="h-full w-full" scrollWheelZoom>
      <TileLayer url={config.tileUrl} attribution={config.tileAttribution} maxZoom={19} className={config.tileDark ? 'cl-dark-tiles' : undefined} />
      <ClickToMove onChange={onChange} />
      <Recenter lat={lat} lng={lng} token={recenterToken} />
      {accuracy && accuracy < 2000 && <Circle center={[lat, lng]} radius={accuracy} pathOptions={{ color: '#36D9FF', weight: 1, fillOpacity: 0.08 }} />}
      <Marker position={[lat, lng]} draggable icon={pinIcon} eventHandlers={handlers} ref={ref} title="Hazard location — drag to adjust" keyboard={false} />
    </MapContainer>
  );
}
