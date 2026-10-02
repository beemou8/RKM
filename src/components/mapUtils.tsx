import { useEffect, useState } from 'react';
import { TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useTheme } from '../lib/theme';

/** Map TileLayer — 100% Gratis & Tanpa API Key:
 *  Menggunakan Google Maps (mt0-mt3) yang bebas API key, sangat cepat,
 *  dan memiliki data jalan/toko paling akurat di Indonesia. */
export function CartoTileLayer() {
  const [theme] = useTheme();

  return (
    <TileLayer
      key={theme}
      url="https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
      subdomains={['0', '1', '2', '3']}
      attribution="&copy; Google Maps"
      maxZoom={20}
    />
  );
}

// Alias untuk nama yang lebih netral
export const AppTileLayer = CartoTileLayer;

/** Fits the map viewport to the given [lat, lng] points whenever they change
 *  (or when `resetSignal` is bumped, e.g. by a "Zoom Out" button). */
export function FitBounds({ points, resetSignal }: { points: [number, number][]; resetSignal?: number }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [50, 50] });
    }
  }, [JSON.stringify(points), resetSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Imperatively fly the map to a single point — used for "focus on this row" clicks. */
export function FlyTo({ point, zoom = 17 }: { point: [number, number] | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    map.flyTo(point, zoom, { duration: 0.6 });
  }, [point ? point[0] : null, point ? point[1] : null, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** A simple colored teardrop pin, used instead of Leaflet's default marker asset. */
export function pinIcon(color: string, size = 28) {
  return L.divIcon({
    className: '',
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">
      <path fill="${color}" stroke="white" stroke-width="1" d="M12 0C7 0 3 4 3 9c0 6.5 9 15 9 15s9-8.5 9-15c0-5-4-9-9-9z"/>
      <circle cx="12" cy="9" r="3.4" fill="white"/>
    </svg>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 4],
  });
}

// Public OSRM demo servers — free, no API key.
// Includes primary and fallback servers so the road geometry never drops
// to straight lines during temporary rate-limiting or downtime.
const OSRM_ROUTE_SERVERS = [
  'https://router.project-osrm.org/route/v1/driving/',
  'https://routing.openstreetmap.de/routed-car/route/v1/driving/',
];
const OSRM_MATCH_URL = 'https://router.project-osrm.org/match/v1/driving/';
const ROAD_ROUTE_CACHE = new Map<string, { route: [number, number][]; distanceM: number }>();

function distanceBetweenM(p1: [number, number], p2: [number, number]): number {
  const R = 6371000;
  const dLat = ((p2[0] - p1[0]) * Math.PI) / 180;
  const dLng = ((p2[1] - p1[1]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((p1[0] * Math.PI) / 180) * Math.cos((p2[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Filters out invalid coordinates and stationary noise (<25m from previous point),
 *  keeping actual movement waypoints plus first and last. */
function filterMeaningfulPoints(points: [number, number][], minDistanceM = 25): [number, number][] {
  const valid = points.filter(
    (p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) > 0.1 && Math.abs(p[1]) > 0.1
  );
  if (valid.length <= 2) return valid;
  const out: [number, number][] = [valid[0]];
  for (let i = 1; i < valid.length - 1; i++) {
    if (distanceBetweenM(out[out.length - 1], valid[i]) >= minDistanceM) {
      out.push(valid[i]);
    }
  }
  out.push(valid[valid.length - 1]);
  return out;
}

/** Straight-line (haversine) distance in meters, summed across consecutive
 *  points — used as the fallback when OSRM can't be reached. */
function haversineDistance(points: [number, number][]): number {
  const R = 6371000;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [lat1, lng1] = points[i - 1];
    const [lat2, lng2] = points[i];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return total;
}

/** Evenly thins a point list down to at most `max` points, always keeping
 *  the first and last, so a long GPS trail stays a manageable OSRM request
 *  without losing its overall shape. */
function downsample(points: [number, number][], max: number): [number, number][] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

function useRoadGeometry(
  points: [number, number][],
  mode: 'route' | 'match',
  maxPoints: number
): { route: [number, number][]; loading: boolean; snapped: boolean; distanceKm: number } {
  const cleaned = filterMeaningfulPoints(points, mode === 'match' ? 30 : 5);
  const trimmed = downsample(cleaned, Math.min(maxPoints, 70));
  const key = trimmed.length > 1 ? `${mode}:${trimmed.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';')}` : '';
  const fallbackDistanceM = points.length > 1 ? haversineDistance(points) : 0;
  const [state, setState] = useState<{ key: string; route: [number, number][]; loading: boolean; snapped: boolean; distanceM: number }>(
    { key: '', route: points, loading: false, snapped: false, distanceM: fallbackDistanceM }
  );

  useEffect(() => {
    if (trimmed.length < 2) {
      setState({ key, route: points, loading: false, snapped: false, distanceM: 0 });
      return;
    }

    const cached = ROAD_ROUTE_CACHE.get(key);
    if (cached) {
      setState({ key, route: cached.route, loading: false, snapped: true, distanceM: cached.distanceM });
      return;
    }

    let cancelled = false;
    setState({ key, route: points, loading: true, snapped: false, distanceM: fallbackDistanceM });

    const coords = trimmed.map(([lat, lng]) => `${lng},${lat}`).join(';');

    async function fetchRoadGeometry() {
      // 1. In match mode, try OSRM map-matching first
      if (mode === 'match') {
        try {
          const matchUrl = `${OSRM_MATCH_URL}${coords}?overview=full&geometries=geojson&gaps=split&radiuses=${trimmed.map(() => 50).join(';')}`;
          const res = await fetch(matchUrl);
          if (res.ok) {
            const data = await res.json();
            const coordsGeo: [number, number][] | undefined = data?.matchings?.[0]?.geometry?.coordinates;
            if (coordsGeo && coordsGeo.length > 1) {
              const road = coordsGeo.map(([lng, lat]) => [lat, lng] as [number, number]);
              const distanceM = typeof data?.matchings?.[0]?.distance === 'number' ? data.matchings[0].distance : fallbackDistanceM;
              return { road, distanceM };
            }
          }
        } catch {
          // match failed or returned NoMatch/TooBig -> proceed to route fallback
        }
      }

      // 2. Route mode OR fallback from match: calculate driving path along road network
      for (const server of OSRM_ROUTE_SERVERS) {
        try {
          const routeUrl = `${server}${coords}?overview=full&geometries=geojson`;
          const res = await fetch(routeUrl);
          if (res.ok) {
            const data = await res.json();
            const coordsGeo: [number, number][] | undefined = data?.routes?.[0]?.geometry?.coordinates;
            if (coordsGeo && coordsGeo.length > 1) {
              const road = coordsGeo.map(([lng, lat]) => [lat, lng] as [number, number]);
              const distanceM = typeof data?.routes?.[0]?.distance === 'number' ? data.routes[0].distance : fallbackDistanceM;
              return { road, distanceM };
            }
          }
        } catch {
          // Try next server
        }
      }

      return null;
    }

    fetchRoadGeometry()
      .then((res) => {
        if (cancelled) return;
        if (res && res.road.length > 1) {
          ROAD_ROUTE_CACHE.set(key, { route: res.road, distanceM: res.distanceM });
          setState({ key, route: res.road, loading: false, snapped: true, distanceM: res.distanceM });
        } else {
          setState({ key, route: points, loading: false, snapped: false, distanceM: fallbackDistanceM });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ key, route: points, loading: false, snapped: false, distanceM: fallbackDistanceM });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Guard against showing a stale route while a new key is still loading.
  if (state.key !== key) {
    return { route: points, loading: trimmed.length >= 2, snapped: false, distanceKm: fallbackDistanceM / 1000 };
  }
  return { route: state.route, loading: state.loading, snapped: state.snapped, distanceKm: state.distanceM / 1000 };
}

/** Follows the actual road network between an ordered list of planned stops
 *  (via OSRM's routing service), instead of drawing a straight line that
 *  cuts through buildings/blocks. Best for a small number of intentional
 *  waypoints, e.g. a visit-schedule preview. */
export function useRoadRoute(points: [number, number][]) {
  return useRoadGeometry(points, 'route', 100);
}

/** Snaps a raw, noisy GPS trail (many closely-spaced samples) onto the road
 *  network via OSRM's map-matching service — the right tool for an actual
 *  recorded trip, as opposed to a small set of intended waypoints. Long
 *  trails are thinned before the request; falls back to the original trail
 *  on any error. */
export function useRoadMatch(points: [number, number][]) {
  return useRoadGeometry(points, 'match', 95);
}

export function numberedIcon(n: number, color = '#10b981', size = 24) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)">${n}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
