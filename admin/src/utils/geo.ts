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

  // Prefer lower photo_order if present
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
 * Calculate geographical distance (variance) in meters between
 * an admin-given coordinate string ("lat, lon") and actual field-captured (lat, lon).
 *
 * Bands: <= 10 m exact match, <= 30 m nearby lock, > 30 m position discrepancy.
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

  const [lat1, lon1] = parsed;
  const lat2 = actualLat;
  const lon2 = actualLon;

  // High-precision Haversine formula (matches Google Maps spherical geometry)
  const R = 6371000; // Radius of Earth in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const meters = Math.round(R * c);

  let formatted = '';
  if (meters < 1000) {
    formatted = `${meters} m`;
  } else {
    formatted = `${(meters / 1000).toFixed(2)} km`;
  }

  const status = meters <= EXACT_MATCH_METERS ? 'exact' : meters <= NEARBY_LOCK_METERS ? 'close' : 'far';
  return { distanceMeters: meters, formatted, status, source: 'geodesic' };
}

/**
 * Fetch Google Maps API distance from backend for coordinates.
 * Falls back to local geodesic calculation if API call fails.
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
    // Graceful fallback to local geodesic calculation
  }

  return local;
}
