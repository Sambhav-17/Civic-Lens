const env = import.meta.env;

export const config = {
  supabaseUrl: (env.VITE_SUPABASE_URL as string | undefined)?.trim() || '',
  supabaseAnonKey: (env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '',
  /** Default: OpenStreetMap standard tiles, darkened with a CSS filter. Use your own tile provider in production. */
  tileUrl: (env.VITE_TILE_URL as string | undefined)?.trim() || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: (env.VITE_TILE_ATTRIBUTION as string | undefined) || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  /** Apply the dark CSS filter to light raster tiles (set VITE_TILE_DARK=false for natively dark tiles). */
  tileDark: (env.VITE_TILE_DARK as string | undefined) !== 'false',
  geocoderUrl: (env.VITE_GEOCODER_URL as string | undefined) ?? 'https://nominatim.openstreetmap.org',
  routingUrl: (env.VITE_ROUTING_URL as string | undefined)?.trim() || '',
  defaultCenter: [Number(env.VITE_DEFAULT_LAT ?? 12.9716), Number(env.VITE_DEFAULT_LNG ?? 77.5946)] as [number, number],
};

export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);

export const LIMITS = {
  maxImages: 4,
  maxImageBytes: 10 * 1024 * 1024,
  maxVideoBytes: 25 * 1024 * 1024,
  maxAudioBytes: 5 * 1024 * 1024,
  maxVoiceSeconds: 60,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  videoTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  audioTypes: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'],
  reportsPerWindow: 5,
  rateWindowMs: 10 * 60 * 1000,
  duplicateRadiusM: 30,
  duplicateWindowH: 72,
};
