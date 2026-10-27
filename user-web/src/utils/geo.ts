/** Tolerance for an "exact" GPS match, in meters. */
export const EXACT_MATCH_METERS = 10;
/** Max acceptable drift between admin-given and field-captured coordinates, in meters. */
export const NEARBY_LOCK_METERS = 30;

export interface CoordVarianceResult {
  distanceMeters: number;
  formatted: string;
  status: 'exact' | 'close' | 'far';
  source?: 'google_maps' | 'geodesic';
}

export interface RouteStopRecord<T = any> {
  record: T;
  stopOrder: number;
  distanceFromCurrentKm: number;
  currentDistanceFormatted: string;
  legDistanceKm: number;
  legDistanceFormatted: string;
  prevStopName?: string;
}

/**
 * Robustly parse coordinate string (e.g. "11.040756, 77.030313", "11.040756 77.030313", "11.040756° N, 77.030313° E").
 * Rejects Null Island (0, 0) and out-of-range coordinates.
 */
export function parseCoordinates(givenCoordsStr?: string | null): [number, number] | null {
  if (!givenCoordsStr || !givenCoordsStr.trim()) return null;

  const cleaned = givenCoordsStr.trim().replace(/;/g, ',').replace(/\//g, ',');
  let parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    parts = cleaned.split(/\s+/).map((p) => p.trim()).filter(Boolean);
  }
  if (parts.length < 2) return null;

  const parseNum = (str: string): number => {
    const match = str.match(/[-+]?\d*\.?\d+/);
    if (!match) return NaN;
    let val = parseFloat(match[0]);
    const upper = str.toUpperCase();
    if ((upper.includes('S') || upper.includes('W')) && !str.includes('-')) {
      val = -Math.abs(val);
    }
    return val;
  };

  const lat = parseNum(parts[0]);
  const lon = parseNum(parts[1]);

  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return [lat, lon];
}

/**
 * Safely find the primary valid GPS coordinate from an array of images.
 * Rejects images with null, missing, or (0, 0) Null Island coordinates.
 */
export function getFieldCoordinates(
  images?: Array<{ latitude?: number | null; longitude?: number | null; photo_order?: number }> | null
): { latitude: number; longitude: number } | null {
  if (!images || !images.length) return null;

  const sorted = [...images].sort((a, b) => (a.photo_order ?? 0) - (b.photo_order ?? 0));
  const valid = sorted.find(
    (img) =>
      img.latitude != null &&
      img.longitude != null &&
      !(img.latitude === 0 && img.longitude === 0) &&
      !isNaN(img.latitude) &&
      !isNaN(img.longitude)
  );

  if (!valid) return null;
  return { latitude: valid.latitude!, longitude: valid.longitude! };
}

/**
 * High precision spherical geodesic distance between two [lat, lon] points in meters.
 */
export function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Calculate geographical distance (variance) in meters between
 * an admin-given coordinate string ("lat, lon") and actual field-captured (lat, lon).
 */
export function calculateCoordVariance(
  givenCoordsStr?: string | null,
  actualLat?: number | null,
  actualLon?: number | null
): CoordVarianceResult | null {
  if (!givenCoordsStr || actualLat == null || actualLon == null) return null;
  if (isNaN(actualLat) || isNaN(actualLon)) return null;
  if (actualLat === 0 && actualLon === 0) return null;

  const parsed = parseCoordinates(givenCoordsStr);
  if (!parsed) return null;

  const meters = haversineDistanceMeters(parsed[0], parsed[1], actualLat, actualLon);

  let formatted = '';
  if (meters < 1000) {
    formatted = `${meters} m`;
  } else {
    formatted = `${(meters / 1000).toFixed(2)} km (${meters.toLocaleString()} m)`;
  }

  const status = meters <= EXACT_MATCH_METERS ? 'exact' : meters <= NEARBY_LOCK_METERS ? 'close' : 'far';
  return { distanceMeters: meters, formatted, status, source: 'geodesic' };
}

/**
 * Sort pending records starting from the user's current GPS location using Nearest Neighbor routing.
 * Route order:
 * User location -> nearest pending location (Stop 1)
 * Stop 1 -> next nearest pending location (Stop 2)
 * ... chained through to the last location.
 *
 * For each stop, computes:
 * 1. Distance from user's current location (in km).
 * 2. Place-to-place / leg distance from the previous stop (in km).
 */
export type PendingSortMode = 'route' | 'order_no';

export interface PendingRouteItem<T = any> {
  record: T;
  stopOrder?: number;
  prevStopOrder?: number;
  distanceFromCurrentKm?: number;
  currentDistanceFormatted?: string;
  currentDurationFormatted?: string;
  legDistanceKm?: number;
  legDistanceFormatted?: string;
  legDurationFormatted?: string;
  routeUnavailableReason?: string;
}

function formatDistanceKm(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
}

export function sortPendingRecordsByRoute<
  T extends {
    id: number;
    coordinates?: string | null;
    name?: string;
    unique_id?: string | null;
    visit_order?: number | null;
  }
>(
  userLocation: { latitude: number; longitude: number } | null,
  records: T[],
  sortMode: PendingSortMode = 'route'
): PendingRouteItem<T>[] {
  if (!records || !records.length) return [];

  // When sorting by Order No (Visit Order), sort sequence first then compute distances for every stop
  if (sortMode === 'order_no') {
    const sorted = [...records].sort((a, b) => {
      const orderA = a.visit_order != null ? a.visit_order : Infinity;
      const orderB = b.visit_order != null ? b.visit_order : Infinity;
      if (orderA !== orderB) return orderA - orderB;
      const numA = parseInt(String(a.unique_id || '').replace(/\D/g, ''), 10);
      const numB = parseInt(String(b.unique_id || '').replace(/\D/g, ''), 10);
      if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
      return a.id - b.id;
    });

    const items: PendingRouteItem<T>[] = [];
    let prevCoord: { lat: number; lon: number; stopNumber: number } | null = null;
    let fallbackStopNumber = 1;

    for (const r of sorted) {
      const parsed = parseCoordinates(r.coordinates);
      const stopNumber = r.visit_order ?? fallbackStopNumber++;

      if (parsed) {
        const [lat, lon] = parsed;
        let distFromUserKm: number | undefined;
        let currentDistanceFormatted: string | undefined;

        if (userLocation) {
          const distFromUserMeters = haversineDistanceMeters(
            userLocation.latitude,
            userLocation.longitude,
            lat,
            lon
          );
          distFromUserKm = distFromUserMeters / 1000;
          currentDistanceFormatted = formatDistanceKm(distFromUserKm);
        }

        let legKm: number | undefined;
        let legDistanceFormatted: string | undefined;
        let prevStopOrder: number | undefined;

        if (prevCoord) {
          const legMeters = haversineDistanceMeters(prevCoord.lat, prevCoord.lon, lat, lon);
          legKm = legMeters / 1000;
          legDistanceFormatted = formatDistanceKm(legKm);
          prevStopOrder = prevCoord.stopNumber;
        } else if (userLocation && distFromUserKm != null) {
          legKm = distFromUserKm;
          legDistanceFormatted = formatDistanceKm(legKm);
        }

        items.push({
          record: r,
          stopOrder: stopNumber,
          prevStopOrder,
          distanceFromCurrentKm: distFromUserKm,
          currentDistanceFormatted,
          legDistanceKm: legKm,
          legDistanceFormatted,
        });

        prevCoord = { lat, lon, stopNumber };
      } else {
        items.push({
          record: r,
          stopOrder: stopNumber,
        });
      }
    }

    return items;
  }

  // Otherwise, sortMode === 'route' (Greedy nearest-neighbor chain starting from userLocation)
  const withCoords: Array<{ record: T; lat: number; lon: number }> = [];
  const withoutCoords: T[] = [];

  for (const r of records) {
    const parsed = parseCoordinates(r.coordinates);
    if (parsed) {
      withCoords.push({ record: r, lat: parsed[0], lon: parsed[1] });
    } else {
      withoutCoords.push(r);
    }
  }

  // If no user location is available, fallback to Order No sequence but still compute leg distances
  if (!userLocation || !withCoords.length) {
    return sortPendingRecordsByRoute(null, records, 'order_no');
  }

  const unvisited = [...withCoords];
  const route: PendingRouteItem<T>[] = [];

  let currentLat = userLocation.latitude;
  let currentLon = userLocation.longitude;
  let stopNumber = 1;
  let prevStopOrder: number | undefined = undefined;

  while (unvisited.length > 0) {
    let nearestIndex = 0;
    let minLegMeters = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const d = haversineDistanceMeters(currentLat, currentLon, unvisited[i].lat, unvisited[i].lon);
      if (d < minLegMeters) {
        minLegMeters = d;
        nearestIndex = i;
      }
    }

    const selected = unvisited.splice(nearestIndex, 1)[0];
    const distFromUserMeters = haversineDistanceMeters(
      userLocation.latitude,
      userLocation.longitude,
      selected.lat,
      selected.lon
    );

    const distFromUserKm = distFromUserMeters / 1000;
    const legKm = minLegMeters / 1000;

    route.push({
      record: selected.record,
      stopOrder: stopNumber,
      prevStopOrder,
      distanceFromCurrentKm: distFromUserKm,
      currentDistanceFormatted: formatDistanceKm(distFromUserKm),
      legDistanceKm: legKm,
      legDistanceFormatted: formatDistanceKm(legKm),
    });

    currentLat = selected.lat;
    currentLon = selected.lon;
    prevStopOrder = stopNumber;
    stopNumber++;
  }

  // Append records that had no coordinates
  const remainder = withoutCoords.map((r, idx) => ({
    record: r,
    stopOrder: stopNumber + idx,
  }));

  return [...route, ...remainder];
}

/**
 * Fetch Google Maps API distance from backend for coordinates.
 */
export async function fetchGoogleDistance(
  adminCoordsStr: string,
  fieldLat: number,
  fieldLon: number,
  apiBase: string = '/api'
): Promise<CoordVarianceResult | null> {
  const local = calculateCoordVariance(adminCoordsStr, fieldLat, fieldLon);
  if (!local) return null;

  const parsed = parseCoordinates(adminCoordsStr);
  if (!parsed) return local;

  try {
    const res = await fetch(
      `${apiBase}/location/distance?lat1=${parsed[0]}&lon1=${parsed[1]}&lat2=${fieldLat}&lon2=${fieldLon}`
    );
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.distance_meters === 'number') {
        return {
          distanceMeters: data.distance_meters,
          formatted: data.formatted || local.formatted,
          status: data.status || local.status,
          source: data.source || 'google_maps',
        };
      }
    }
  } catch {
    // Fall back to local calculation
  }

  return local;
}
