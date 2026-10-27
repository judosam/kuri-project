import type { CaptureRecord } from '../types';

export function formatDate(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

export function formatDateTime(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export function formatTime(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export function formatRecordNo(id: number): string {
  return `#${String(id).padStart(4, '0')}`;
}

export function formatCoordinates(lat?: number | null, lng?: number | null): string {
  if (lat == null || lng == null) return 'No coordinates';
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${latDir}, ${Math.abs(lng).toFixed(5)}° ${lngDir}`;
}

export function parseCoordinates(coordStr?: string | null): { lat: number; lng: number } | null {
  if (!coordStr) return null;
  const parts = coordStr.split(',').map((p) => parseFloat(p.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}

export function toISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function enName(str?: string | null): string {
  if (!str) return '';
  return str.trim();
}

export function isRecordClosed(record: CaptureRecord): boolean {
  const s = (record.status || '').toUpperCase();
  return (
    s === 'NOT_INTERESTED' ||
    s === 'NOT INTERESTED' ||
    s === 'DUPLICATE' ||
    s === 'CONSTRUCTION_FINISHED' ||
    s === 'CONSTRUCTION FINISHED'
  );
}

export function getRecordStatusBadgeInfo(record: CaptureRecord): { label: string; className: string; bg?: string; color?: string } {
  const s = (record.status || '').toUpperCase();
  if (s === 'NOT_INTERESTED' || s === 'NOT INTERESTED') {
    return { label: 'Not Interested', className: 'badge-not-interested', bg: '#fef3c7', color: '#b45309' };
  }
  if (s === 'DUPLICATE') {
    return { label: 'Duplicate', className: 'badge-duplicate', bg: '#ede9fe', color: '#6d28d9' };
  }
  if (s === 'CONSTRUCTION_FINISHED' || s === 'CONSTRUCTION FINISHED') {
    return { label: 'Construction Finished', className: 'badge-finished', bg: '#ccfbf1', color: '#0f766e' };
  }
  if (isRecordCompleted(record)) {
    return { label: 'Completed', className: 'badge-complete', bg: '#e6f4ea', color: '#137333' };
  }
  if (record.reassigned_to_id != null || record.revisit_status === 'REASSIGNED' || record.revisit_status === 'PENDING_REVISIT') {
    return { label: 'Reassigned', className: 'badge-reassigned', bg: '#e0f2fe', color: '#0369a1' };
  }
  return { label: 'Pending', className: 'badge-pending', bg: '#fff4e5', color: '#b06000' };
}

export function isRecordCompleted(record: CaptureRecord): boolean {
  if (isRecordClosed(record)) return false;
  if (
    record.status === 'NOT_COMPLETED' ||
    record.status === 'PENDING' ||
    record.revisit_status === 'REASSIGNED' ||
    record.revisit_status === 'PENDING_REVISIT'
  ) {
    return false;
  }
  return (
    record.status === 'COMPLETED' ||
    record.status === 'Updated Revisited' ||
    record.status === 'UPDATED_REVISITED' ||
    record.revisit_status === 'COMPLETED' ||
    record.revisit_status === 'Updated Revisited' ||
    record.revisit_status === 'UPDATED_REVISITED'
  );
}

export interface RecentCaptureOrInspection {
  type: 'captured' | 'inspected' | 'none';
  date: Date | null;
  isoString: string | null;
  label: string;
}

/**
 * Returns the most recent datetime between photo capture and inspection completion.
 */
export function getRecentCaptureOrInspection(record: CaptureRecord): RecentCaptureOrInspection {
  // 1. Latest photo captured date
  let latestPhotoDate: Date | null = null;
  let latestPhotoIso: string | null = null;
  if (record.images && record.images.length > 0) {
    for (const img of record.images) {
      if (img.captured_at) {
        const d = new Date(img.captured_at);
        if (!isNaN(d.getTime())) {
          if (!latestPhotoDate || d.getTime() > latestPhotoDate.getTime()) {
            latestPhotoDate = d;
            latestPhotoIso = img.captured_at;
          }
        }
      }
    }
  }

  // 2. Latest inspection date (field GPS completion, updated_at on completed records, or date_of_visit)
  let latestInspectionDate: Date | null = null;
  let latestInspectionIso: string | null = null;
  let hasInspectionTime = false;

  if (record.field_captured_at) {
    const d = new Date(record.field_captured_at);
    if (!isNaN(d.getTime())) {
      latestInspectionDate = d;
      latestInspectionIso = record.field_captured_at;
      hasInspectionTime = true;
    }
  }

  if (!latestInspectionDate && record.date_of_visit) {
    const visitD = new Date(record.date_of_visit);
    if (!isNaN(visitD.getTime())) {
      latestInspectionDate = visitD;
      latestInspectionIso = record.date_of_visit;
      if (isRecordCompleted(record) && record.updated_at) {
        const updD = new Date(record.updated_at);
        if (!isNaN(updD.getTime())) {
          latestInspectionDate = updD;
          latestInspectionIso = record.updated_at;
          hasInspectionTime = true;
        }
      }
    }
  }

  // 3. Compare which one is more recent
  if (latestPhotoDate && latestInspectionDate) {
    if (latestPhotoDate.getTime() >= latestInspectionDate.getTime()) {
      return {
        type: 'captured',
        date: latestPhotoDate,
        isoString: latestPhotoIso,
        label: `Captured: ${formatDateTime(latestPhotoIso)}`,
      };
    } else {
      return {
        type: 'inspected',
        date: latestInspectionDate,
        isoString: latestInspectionIso,
        label: hasInspectionTime
          ? `Inspected: ${formatDateTime(latestInspectionIso)}`
          : `Inspected: ${formatDate(latestInspectionIso)}`,
      };
    }
  }

  if (latestPhotoDate) {
    return {
      type: 'captured',
      date: latestPhotoDate,
      isoString: latestPhotoIso,
      label: `Captured: ${formatDateTime(latestPhotoIso)}`,
    };
  }

  if (latestInspectionDate) {
    return {
      type: 'inspected',
      date: latestInspectionDate,
      isoString: latestInspectionIso,
      label: hasInspectionTime
        ? `Inspected: ${formatDateTime(latestInspectionIso)}`
        : `Inspected: ${formatDate(latestInspectionIso)}`,
    };
  }

  if (isRecordCompleted(record)) {
    if (record.updated_at) {
      return {
        type: 'inspected',
        date: new Date(record.updated_at),
        isoString: record.updated_at,
        label: `Inspected: ${formatDateTime(record.updated_at)}`,
      };
    }
    return {
      type: 'inspected',
      date: null,
      isoString: null,
      label: 'Inspection completed',
    };
  }

  return {
    type: 'none',
    date: null,
    isoString: null,
    label: 'Not inspected yet',
  };
}

/** Record cards describe the inspection, displaying the latest captured or inspected date and time. */
export function inspectionDateLabel(record: CaptureRecord): string {
  return getRecentCaptureOrInspection(record).label;
}

/**
 * Generates a Google Maps URL that opens the map centered on the location
 * with a pin dropped, rather than initiating turn-by-turn navigation / directions.
 */
export function getGoogleMapsUrl(coords?: string | null, address?: string | null): string {
  const c = coords?.trim();
  if (c && /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(c)) {
    const cleanCoords = c.replace(/\s*,\s*/, ',');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanCoords)}`;
  }
  const target = (c || address || '').trim();
  if (!target) return 'https://www.google.com/maps';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;
}

