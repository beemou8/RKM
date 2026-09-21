// Geo helpers shared by tracking (stay-point / radius validation) and
// scheduling (nearest-neighbour clustering) — ports of the PHP
// hitungJarak/jarakMeter/hitungSudutArah functions.

/** Distance between two coordinates in kilometres (Haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Distance between two coordinates in metres. Returns null if any coord missing. */
export function distanceMeters(
  lat1: number | null | undefined,
  lon1: number | null | undefined,
  lat2: number | null | undefined,
  lon2: number | null | undefined
): number | null {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Compass bearing (radians) from a centre point to a target point. */
export function bearing(latCenter: number, lngCenter: number, latTarget: number, lngTarget: number): number {
  const dLon = deg2rad(lngTarget - lngCenter);
  const latP = deg2rad(latCenter);
  const latT = deg2rad(latTarget);
  const y = Math.sin(dLon) * Math.cos(latT);
  const x = Math.cos(latP) * Math.sin(latT) - Math.sin(latP) * Math.cos(latT) * Math.cos(dLon);
  return Math.atan2(y, x);
}

function deg2rad(deg: number): number {
  return (deg * Math.PI) / 180;
}
