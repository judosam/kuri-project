import { useEffect, useRef, useState } from 'react';
import type { CaptureRecord } from '../types';
import { api, type RoadRoutePlan } from '../services/api';
import {
  sortPendingRecordsByRoute,
  haversineDistanceMeters,
  type PendingRouteItem,
  type PendingSortMode,
} from '../utils/geo';

const distance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
const duration = (seconds: number) => {
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`;
};

/**
 * Threshold in meters: if the operator's current location changes within 100 meters,
 * clicking Route reuses the already retrieved route data without calling the API (0 API calls).
 * If the operator has moved beyond 100 meters, clicking Route refreshes the route from the new position.
 */
export const LOCATION_CHANGE_THRESHOLD_METERS = 100;

interface CachedRoute {
  provider: 'ors' | 'gmap';
  plan: RoadRoutePlan;
  records: CaptureRecord[];
  origin: { latitude: number; longitude: number };
  fetchedAt: number;
}

/** Routes are requested only by an explicit click. GPS updates never reorder the list automatically. */
export function useRoadRoute(
  records: CaptureRecord[],
  gps: { fix: { latitude: number; longitude: number } | null; retry: () => void },
  context: string,
  enabled = true,
  loadPending?: () => Promise<CaptureRecord[]>,
) {
  const [routeProvider, setRouteProviderState] = useState<'ors' | 'gmap'>(() => {
    try {
      const saved = localStorage.getItem('photocapture_route_provider');
      if (saved === 'ors' || saved === 'gmap') return saved;
      if (saved === 'osrm') return 'ors';
    } catch {}
    return 'ors';
  });

  const setRouteProvider = (provider: 'ors' | 'gmap') => {
    setRouteProviderState(provider);
    try {
      localStorage.setItem('photocapture_route_provider', provider);
    } catch {}
  };

  const key = JSON.stringify([context, enabled, records.map(r => [r.id, r.coordinates, r.status])]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; }, []);

  // In-memory cache for computed routes per provider for the current dataset
  const cachedRoutesRef = useRef<Map<string, CachedRoute>>(new Map());

  // User-selected sort mode ('order_no' | 'route')
  const [activeSortMode, setActiveSortMode] = useState<PendingSortMode>('order_no');

  // Currently displayed route result
  const [currentRoute, setCurrentRoute] = useState<{
    key: string;
    provider: 'ors' | 'gmap';
    plan: RoadRoutePlan;
    records: CaptureRecord[];
    origin: { latitude: number; longitude: number };
    isCached: boolean;
    driftMeters: number;
  } | null>(null);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);

  // When dataset / filters change, reset active route & cache
  useEffect(() => {
    requestId.current++;
    setCurrentRoute(null);
    setActiveSortMode('order_no');
    setBusyKey(null);
    setError(null);
    cachedRoutesRef.current.clear();
  }, [key]);

  const calculateRoute = async (providerToUse: 'ors' | 'gmap') => {
    const id = ++requestId.current;
    setError(null);
    setBusyKey(null);
    if (!enabled) return;

    if (!gps.fix) {
      gps.retry();
      setError({ key, text: 'Location is not ready. Enable location and click Route again.' });
      return;
    }

    const currentOrigin = { latitude: gps.fix.latitude, longitude: gps.fix.longitude };
    const cacheKey = `${key}:${providerToUse}`;
    const cached = cachedRoutesRef.current.get(cacheKey);

    // Check if operator's location has changed:
    if (cached) {
      const movedMeters = haversineDistanceMeters(
        cached.origin.latitude,
        cached.origin.longitude,
        currentOrigin.latitude,
        currentOrigin.longitude,
      );

      // If location changed within 100m, reuse the already gotten data without calling API!
      if (movedMeters < LOCATION_CHANGE_THRESHOLD_METERS) {
        if (id === requestId.current && key === currentKey.current) {
          setCurrentRoute({
            key,
            provider: providerToUse,
            plan: cached.plan,
            records: cached.records,
            origin: cached.origin,
            isCached: true,
            driftMeters: movedMeters,
          });
          setActiveSortMode('route');
          setBusyKey(null);
        }
        return;
      }
    }

    // Otherwise (first time OR operator moved >= 100m), refresh route via API:
    setBusyKey(key);
    try {
      const pending = (loadPending ? await loadPending() : records).filter(r => r.status === 'NOT_COMPLETED');
      if (id !== requestId.current || key !== currentKey.current) return;
      if (!pending.length) throw new Error('No pending records match the current filters.');
      if (pending.length > 1000) throw new Error('Route supports up to 1,000 pending records. Narrow the filters and try again.');

      const response = await api.planRoadRoute(
        currentOrigin,
        pending.map(r => r.id),
        providerToUse,
      );

      if (response.ordering !== 'nearest_from_origin') {
        throw new Error('Nearest-first routing needs a server update. Please contact your administrator.');
      }

      // Store in memory cache
      cachedRoutesRef.current.set(cacheKey, {
        provider: providerToUse,
        plan: response,
        records: pending,
        origin: currentOrigin,
        fetchedAt: Date.now(),
      });

      if (id === requestId.current && key === currentKey.current) {
        setCurrentRoute({
          key,
          provider: providerToUse,
          plan: response,
          records: pending,
          origin: currentOrigin,
          isCached: false,
          driftMeters: 0,
        });
        setActiveSortMode('route');
      }
    } catch (err) {
      if (id === requestId.current && key === currentKey.current) {
        const engineLabel = providerToUse === 'ors' ? 'OpenRouteService' : 'Google Maps';
        setError({ key, text: err instanceof Error ? err.message : `Could not calculate routes using ${engineLabel}.` });
      }
    } finally {
      if (id === requestId.current) setBusyKey(null);
    }
  };

  const handleSetSortMode = async (mode: PendingSortMode) => {
    if (mode === 'order_no') {
      // Switch view to Order No without discarding the cached route
      setActiveSortMode('order_no');
      setError(null);
      setBusyKey(null);
      return;
    }

    // When clicking Route: reuses cached data if within 100m, refreshes if moved >= 100m
    await calculateRoute(routeProvider);
  };

  const handleSetRouteProvider = async (provider: 'ors' | 'gmap') => {
    setRouteProvider(provider);
    if (activeSortMode === 'route') {
      await calculateRoute(provider);
    }
  };

  const isRouteActive = enabled && activeSortMode === 'route' && currentRoute !== null && currentRoute.key === key;
  const pendingSortMode: PendingSortMode = isRouteActive ? 'route' : 'order_no';

  let displayRecords: PendingRouteItem<CaptureRecord>[];
  if (!enabled) {
    displayRecords = records.map(record => ({ record }));
  } else if (isRouteActive && currentRoute) {
    const routeRecords = currentRoute.records;
    const byId = new Map(routeRecords.map(record => [record.id, record]));
    displayRecords = currentRoute.plan.stops.flatMap(stop => {
      const record = byId.get(stop.record_id);
      if (!record) return [];
      return [{
        record,
        stopOrder: stop.stop_order,
        currentDistanceFormatted: stop.distance_from_origin_meters == null ? undefined : distance(stop.distance_from_origin_meters),
        currentDurationFormatted: stop.duration_from_origin_seconds == null ? undefined : duration(stop.duration_from_origin_seconds),
      }];
    });
    const routedIds = new Set(currentRoute.plan.stops.map(stop => stop.record_id));
    const reasons = new Map(currentRoute.plan.unrouted.map(stop => [stop.record_id, stop.reason]));
    displayRecords.push(...routeRecords.filter(record => !routedIds.has(record.id)).map(record => ({
      record,
      routeUnavailableReason: reasons.get(record.id),
    })));
  } else {
    // Order No is a sequence only; never present straight-line distances as road distances.
    displayRecords = sortPendingRecordsByRoute(null, records, 'order_no').map(({ record, stopOrder }) => ({ record, stopOrder }));
  }

  const providerLabel = currentRoute?.plan.provider_label || (currentRoute?.provider === 'gmap' ? 'Google Maps' : 'OpenRouteService');
  const cacheStatus = currentRoute?.isCached
    ? ` · Reusing cached route (${Math.round(currentRoute.driftMeters)}m drift, 0 API calls)`
    : '';

  const routeNotice = isRouteActive && currentRoute
    ? `Nearest first by road distance · ${providerLabel} · ${currentRoute.plan.stops.length} records${currentRoute.plan.unrouted.length ? ` · ${currentRoute.plan.unrouted.length} unavailable and shown last` : ''}${cacheStatus}. Distances calculated from your GPS fix. Move >100m and click Route to refresh.${currentRoute.plan.travel_mode === 'TWO_WHEELER' ? ' Two-wheeler routes are in beta and may miss suitable paths. Use caution.' : ''}`
    : null;

  return {
    displayRecords,
    pendingSortMode,
    handleSetSortMode,
    routeProvider,
    setRouteProvider: handleSetRouteProvider,
    routeBusy: busyKey === key,
    routeError: error?.key === key ? error.text : null,
    routeNotice,
  };
}
