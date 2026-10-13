import { config } from './config';

export function distanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

export const geocoderAvailable = () => Boolean(config.geocoderUrl);

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  if (!config.geocoderUrl || query.trim().length < 3) return [];
  const url = `${config.geocoderUrl}/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Location search failed (${res.status})`);
  const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return data.map((d) => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) }));
}

export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<string | null> {
  if (!config.geocoderUrl) return null;
  const url = `${config.geocoderUrl}/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = (await res.json()) as { display_name?: string; address?: Record<string, string> };
  if (!data.address) return data.display_name ?? null;
  const a = data.address;
  const parts = [a.road ?? a.pedestrian ?? a.footway, a.suburb ?? a.neighbourhood ?? a.quarter, a.city ?? a.town ?? a.village].filter(Boolean);
  return parts.length ? parts.join(', ') : data.display_name ?? null;
}

export interface RouteResult {
  coordinates: [number, number][];
  distance: number;
  duration: number;
}

export const routingAvailable = () => Boolean(config.routingUrl);

/** OSRM-compatible routing. Returns null when no provider is configured. */
export async function getRoute(from: [number, number], to: [number, number], profile: 'foot' | 'driving' = 'foot'): Promise<RouteResult | null> {
  if (!config.routingUrl) return null;
  const url = `${config.routingUrl}/route/v1/${profile}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const data = await res.json();
  const r = data.routes?.[0];
  if (!r) return null;
  return { coordinates: r.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]), distance: r.distance, duration: r.duration };
}

/** External directions link (OpenStreetMap) used when in-app routing is not configured. */
export const externalDirectionsUrl = (lat: number, lng: number) =>
  `https://www.openstreetmap.org/directions?to=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;

export type GeoState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'granted'; lat: number; lng: number; accuracy: number }
  | { status: 'denied' | 'unavailable' | 'error'; message: string };

export function requestPosition(): Promise<GeoState> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ status: 'unavailable', message: 'Location is not available in this browser. Place the pin manually or search for an address.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ status: 'granted', lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) =>
        resolve(
          err.code === err.PERMISSION_DENIED
            ? { status: 'denied', message: 'Location permission was declined. You can still search or drop the pin by hand.' }
            : { status: 'error', message: 'We couldn’t get your location. Try again, search, or drop the pin by hand.' },
        ),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  });
}
