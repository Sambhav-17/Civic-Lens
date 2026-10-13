import L from 'leaflet';

// leaflet.markercluster and leaflet.heat are UMD plugins that extend the global `L`.
(window as unknown as { L: typeof L }).L = L;

export default L;
