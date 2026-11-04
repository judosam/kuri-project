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


/**
 * Haversine formula to calculate geodesic distance between two points in meters.
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
 * Safely extract [lat, lon] from any record.
 */
export function getRecordCoordinates(record?: any): [number, number] | null {
  if (!record) return null;
  if (record.latitude != null && record.longitude != null && (record.latitude !== 0 || record.longitude !== 0)) {
    return [Number(record.latitude), Number(record.longitude)];
  }
  if (record.coordinates) {
    const parsed = parseCoordinates(record.coordinates);
    if (parsed) return parsed;
  }
  if (record.field_latitude != null && record.field_longitude != null && (record.field_latitude !== 0 || record.field_longitude !== 0)) {
    return [Number(record.field_latitude), Number(record.field_longitude)];
  }
  return null;
}

export interface SpatialCluster<T = any> {
  id: string;
  clusterIndex: number;
  label: string;
  village?: string;
  records: T[];
  count: number;
  maxSpanMeters: number;
  centerCoords: [number, number];
}

export interface SpatialGroupingResult<T = any> {
  clusters: SpatialCluster<T>[];
  standalone: T[];
  totalClustered: number;
}

/**
 * Cluster records that are within `thresholdMeters` (e.g. 50m, 100m) of each other
 * using connected component spatial clustering.
 */
export function clusterRecordsByProximity<T = any>(
  items: T[],
  getRecord: (item: T) => any,
  thresholdMeters: number = 50
): SpatialGroupingResult<T> {
  if (!items || items.length === 0) {
    return { clusters: [], standalone: [], totalClustered: 0 };
  }

  const resolved = items.map((item, idx) => ({
    item,
    idx,
    record: getRecord(item),
    coords: getRecordCoordinates(getRecord(item)),
  }));

  const withCoords = resolved.filter((r) => r.coords !== null);
  const withoutCoords = resolved.filter((r) => r.coords === null).map((r) => r.item);

  if (withCoords.length === 0) {
    return { clusters: [], standalone: items, totalClustered: 0 };
  }

  const n = withCoords.length;
  const adj: number[][] = Array.from({ length: n }, () => []);

  // Spatial Grid Hash Optimization: O(N) average complexity instead of O(N^2)
  // 1 degree lat ~ 111,000 meters. Grid cell size is proportional to threshold in degrees.
  const latCellSize = Math.max(0.0001, thresholdMeters / 111000);
  const grid = new Map<string, number[]>();

  for (let i = 0; i < n; i++) {
    const [lat, lon] = withCoords[i].coords!;
    const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    const lonCellSize = latCellSize / cosLat;

    const cellX = Math.floor(lat / latCellSize);
    const cellY = Math.floor(lon / lonCellSize);
    const key = `${cellX}:${cellY}`;

    const cellList = grid.get(key);
    if (!cellList) {
      grid.set(key, [i]);
    } else {
      cellList.push(i);
    }
  }

  // Check distances only among items in the same or 8 neighbor grid cells
  const checkedPairs = new Set<number>();
  for (let i = 0; i < n; i++) {
    const [lat, lon] = withCoords[i].coords!;
    const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    const lonCellSize = latCellSize / cosLat;

    const cellX = Math.floor(lat / latCellSize);
    const cellY = Math.floor(lon / lonCellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighborKey = `${cellX + dx}:${cellY + dy}`;
        const neighbors = grid.get(neighborKey);
        if (!neighbors) continue;

        for (const j of neighbors) {
          if (j <= i) continue;
          const pairKey = i * 1000000 + j;
          if (checkedPairs.has(pairKey)) continue;
          checkedPairs.add(pairKey);

          const c2 = withCoords[j].coords!;
          if (Math.abs(lat - c2[0]) > latCellSize) continue;

          const dist = haversineDistanceMeters(lat, lon, c2[0], c2[1]);
          if (dist <= thresholdMeters) {
            adj[i].push(j);
            adj[j].push(i);
          }
        }
      }
    }
  }

  const visited = new Array(n).fill(false);
  const clusters: SpatialCluster<T>[] = [];
  const standalone: T[] = [];

  let clusterCounter = 1;

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;

    const component: number[] = [];
    const queue: number[] = [i];
    visited[i] = true;

    while (queue.length > 0) {
      const u = queue.shift()!;
      component.push(u);
      for (const v of adj[u]) {
        if (!visited[v]) {
          visited[v] = true;
          queue.push(v);
        }
      }
    }

    if (component.length >= 2) {
      let maxSpan = 0;
      let sumLat = 0;
      let sumLon = 0;
      const villageCounts: Record<string, number> = {};

      for (let a = 0; a < component.length; a++) {
        const u = component[a];
        const cu = withCoords[u].coords!;
        sumLat += cu[0];
        sumLon += cu[1];

        const rec = withCoords[u].record;
        const v = rec?.village || rec?.taluk || rec?.location_name;
        if (v) villageCounts[v] = (villageCounts[v] || 0) + 1;

        for (let b = a + 1; b < component.length; b++) {
          const w = component[b];
          const cw = withCoords[w].coords!;
          const d = haversineDistanceMeters(cu[0], cu[1], cw[0], cw[1]);
          if (d > maxSpan) maxSpan = d;
        }
      }

      let topVillage: string | undefined;
      let maxVCount = 0;
      for (const [vName, count] of Object.entries(villageCounts)) {
        if (count > maxVCount) {
          maxVCount = count;
          topVillage = vName;
        }
      }

      clusters.push({
        id: `cluster-${thresholdMeters}m-${clusterCounter}`,
        clusterIndex: clusterCounter,
        label: `Cluster #${clusterCounter} • ${component.length} Sites within ${thresholdMeters}m`,
        village: topVillage,
        records: component.map((idx) => withCoords[idx].item),
        count: component.length,
        maxSpanMeters: maxSpan,
        centerCoords: [sumLat / component.length, sumLon / component.length],
      });
      clusterCounter++;
    } else {
      standalone.push(withCoords[component[0]].item);
    }
  }

  standalone.push(...withoutCoords);

  return {
    clusters,
    standalone,
    totalClustered: clusters.reduce((acc, c) => acc + c.count, 0),
  };
}

export interface NearbySiteMatch {
  record: any;
  distanceMeters: number;
}

export function findNearbySitesForRecord(
  targetRecord: any,
  allRecords: any[],
  maxDistanceM: number = 100
): NearbySiteMatch[] {
  if (!targetRecord) return [];
  const targetCoords = getRecordCoordinates(targetRecord);
  if (!targetCoords) return [];

  const matches: NearbySiteMatch[] = [];

  for (const other of allRecords) {
    if (!other || other.id === targetRecord.id) continue;
    const otherCoords = getRecordCoordinates(other);
    if (!otherCoords) continue;
    const dist = haversineDistanceMeters(targetCoords[0], targetCoords[1], otherCoords[0], otherCoords[1]);
    if (dist <= maxDistanceM) {
      matches.push({ record: other, distanceMeters: dist });
    }
  }

  return matches.sort((a, b) => a.distanceMeters - b.distanceMeters);
}
