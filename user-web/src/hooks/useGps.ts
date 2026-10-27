import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { calculateCoordVariance } from '../utils/geo';

export type GpsState = 'unsupported' | 'locating' | 'ready' | 'denied' | 'unavailable';

export interface GpsFix {
  latitude: number;
  longitude: number;
  /** Metres of uncertainty reported by the device for this fix. */
  accuracy: number;
}

export interface GpsStatus {
  state: GpsState;
  fix: GpsFix | null;
  /** Place name resolved by the backend for the latest fix, when available. */
  place: string | null;
  updatedAt: number | null;
  retry: () => void;
}

/** Only re-resolve the place name after moving this far; the backend caches by distance too. */
const RESOLVE_MOVE_METERS = 50;

/** Give up on "acquiring" after this long — some desktop browsers never answer. */
const FIX_TIMEOUT_MS = 25000;

/**
 * Live device GPS for the dashboard telemetry bar.
 *
 * Note the platform rule: browsers only expose Geolocation on a secure origin.
 * On plain http over the LAN (e.g. http://192.168.1.x:5174) the API is
 * unavailable and the bar says so instead of pretending to have a fix — use the
 * `dev:https` script when testing on a phone.
 */
export function useGps(): GpsStatus {
  const [state, setState] = useState<GpsState>('locating');
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const lastResolved = useRef<GpsFix | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setState('unsupported');
      return;
    }

    setState('locating');
    const giveUp = window.setTimeout(
      () => setState((current) => (current === 'locating' ? 'unavailable' : current)),
      FIX_TIMEOUT_MS
    );

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const next: GpsFix = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setFix(next);
        setUpdatedAt(Date.now());
        setState('ready');
        window.clearTimeout(giveUp);

        const previous = lastResolved.current;
        const moved = previous
          ? calculateCoordVariance(`${previous.latitude},${previous.longitude}`, next.latitude, next.longitude)
              ?.distanceMeters ?? Infinity
          : Infinity;
        if (moved < RESOLVE_MOVE_METERS) return;

        lastResolved.current = next;
        api
          .reverseGeocode(next.latitude, next.longitude)
          .then((res) => setPlace(res.resolved ? res.place_name || res.address || null : null))
          .catch(() => setPlace(null));
      },
      (error) => {
        setState(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );

    return () => {
      window.clearTimeout(giveUp);
      navigator.geolocation.clearWatch(watchId);
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, fix, place, updatedAt, retry };
}
