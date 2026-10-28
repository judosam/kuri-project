import { useEffect, useState, useRef, type ReactNode } from 'react';
import type { CaptureRecord } from '../types';
import { api } from '../services/api';
import Icon from '../components/common/Icon';
import Lightbox from '../components/common/Lightbox';
import GoogleMapEmbed from '../components/common/GoogleMapEmbed';
import { formatDateTime, formatDate, formatRecordNo, inspectionDateLabel, getGoogleMapsUrl, isRecordCompleted, isRecordClosed, getRecordStatusBadgeInfo, getRecentCaptureOrInspection } from '../utils/format';
import { useForegroundRefresh } from '../hooks/useForegroundRefresh';
import MarkStatusModal from '../components/MarkStatusModal';
import {
  calculateCoordVariance,
  getFieldCoordinates,
  fetchGoogleDistance,
  NEARBY_LOCK_METERS,
  type CoordVarianceResult,
} from '../utils/geo';

interface TableField {
  key: string;
  label: string;
  value?: React.ReactNode;
}

export function DetailValueCell({
  value,
  isExpanded,
  onToggle,
}: {
  value: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);

  const clean = value?.trim() ?? '';
  const isHyphen = clean === '—' || clean === '' || clean === '-';
  const likelyLong = clean.length > 35 || clean.includes('\n');

  useEffect(() => {
    const el = textRef.current;
    if (!el || isHyphen) return;
    const measure = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [clean, isExpanded]);

  const showButton = !isHyphen && (overflows || likelyLong || isExpanded);

  return (
    <div className={`imported-table-value ${isExpanded ? 'is-expanded' : 'clamped-2'} ${isHyphen ? 'is-empty' : ''}`}>
      <span
        ref={textRef}
        className={isExpanded ? 'expanded' : 'clamped-2'}
        title={isExpanded ? undefined : clean}
      >
        {clean || '—'}
      </span>
      {showButton && (
        <span
          role="button"
          tabIndex={0}
          className="inline-show-more-text"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              onToggle();
            }
          }}
          title={isExpanded ? 'Show less' : 'View more'}
          aria-label={isExpanded ? 'Show less' : 'View more'}
        >
          {isExpanded ? ' ▲' : ' ▼'}
        </span>
      )}
    </div>
  );
}

export function isFieldEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') {
    const s = value.trim();
    return (
      s === '' ||
      s === '—' ||
      s === '-' ||
      s === '--' ||
      s === 'N/A' ||
      s === 'n/a' ||
      s === 'None' ||
      s === 'null' ||
      s === 'undefined' ||
      s === 'Not assigned' ||
      s === 'Not assigned yet' ||
      s === 'Not audited yet' ||
      s === 'No QC assessment recorded' ||
      s === 'No call recorded' ||
      s === 'Not resolved yet' ||
      s === 'No coordinates assigned to this task' ||
      s === 'No address captured on site' ||
      s === 'Not captured on site yet' ||
      s === 'No photo captured' ||
      s === 'Not captured on site (old record)' ||
      s === 'No admin-given coordinates on this record'
    );
  }
  return false;
}

export function FourColumnTable({ fields }: { fields: TableField[] }) {
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const toggleField = (key: string) => {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const visibleFields = fields.filter((f) => !isFieldEmpty(f.value));
  if (visibleFields.length === 0) return null;

  const pairs: [TableField, TableField | undefined][] = [];
  for (let i = 0; i < visibleFields.length; i += 2) {
    pairs.push([visibleFields[i], visibleFields[i + 1]]);
  }

  return (
    <div className="imported-table-wrapper">
      <table className="imported-details-table four-column-table">
        <tbody>
          {pairs.map(([fieldA, fieldB], rowIdx) => (
            <tr key={fieldA.key || rowIdx} className="imported-table-row">
              <td className="imported-table-label">
                <span>{fieldA.label}</span>
              </td>
              <td className="imported-table-value-cell">
                <DetailValueCell
                  value={String(fieldA.value)}
                  isExpanded={!!expandedKeys[fieldA.key]}
                  onToggle={() => toggleField(fieldA.key)}
                />
              </td>
              {fieldB ? (
                <>
                  <td className="imported-table-label">
                    <span>{fieldB.label}</span>
                  </td>
                  <td className="imported-table-value-cell">
                    <DetailValueCell
                      value={String(fieldB.value)}
                      isExpanded={!!expandedKeys[fieldB.key]}
                      onToggle={() => toggleField(fieldB.key)}
                    />
                  </td>
                </>
              ) : (
                <>
                  <td className="imported-table-label empty-cell" />
                  <td className="imported-table-value-cell empty-cell" />
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const AUDIT_CHIP_META: Record<string, { label: string; icon: string; cls: string }> = {
  PENDING: { label: 'Pending', icon: 'pending_actions', cls: 'audit-chip-pending' },
  APPROVAL: { label: 'Approval', icon: 'check_circle', cls: 'audit-chip-approval' },
  DISAPPROVAL: { label: 'Disapproval', icon: 'block', cls: 'audit-chip-disapproval' },
  COMMERCIAL_PROPERTY: { label: 'Commercial Property', icon: 'storefront', cls: 'audit-chip-commercial_property' },
  RE_AUDITED: { label: 'Re Audited', icon: 'history', cls: 'audit-chip-re_audited' },
};

function AuditStatusChip({ status }: { status?: string | null }) {
  if (!status) return null;
  const meta = AUDIT_CHIP_META[status] || AUDIT_CHIP_META.PENDING;
  return (
    <span className={`audit-chip ${meta.cls}`} title={`Audit status: ${meta.label}`}>
      <Icon name={meta.icon} size={13} />
      <span>{meta.label}</span>
    </span>
  );
}

interface RecordDetailScreenProps {
  recordId: number;
  onBack: () => void;
  onStartInspection: (record: CaptureRecord) => void;
  /** Reopen the submitted inspection form for this record. */
  onEditRecord: (record: CaptureRecord) => void;
}

/** Titled block header used by every detail section. */
/** "11.047,77.036" → "11.047, 77.036" so the value wraps at the comma, never mid-number. */
function prettyCoords(raw?: string | null): string {
  return (raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

function SectionHead({
  icon,
  title,
  action,
}: {
  icon: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="rd-section-head">
      <span className="rd-section-title">
        <Icon name={icon} size={17} color="#ea580c" />
        {title}
      </span>
      {action}
    </div>
  );
}

/** Label + value pair. Renders an em dash when the value is missing. */
function Row({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value?: ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  if (isFieldEmpty(value)) return null;
  return (
    <div className={`rd-row${wide ? ' rd-row-wide' : ''}`}>
      <span className="rd-label">{label}</span>
      <span className={`rd-value${mono ? ' rd-value-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

/** A geocoded address row: label then the resolved value. Hides completely if empty. */
function AddressValue({
  label,
  value,
  pending = false,
  empty,
}: {
  label: string;
  value?: string;
  pending?: boolean;
  empty?: string;
}) {
  if (pending && !value) {
    return (
      <div className="rd-row rd-row-wide">
        <span className="rd-label">{label}</span>
        <span className="rd-value rd-value-pending">
          <span className="rd-mini-spinner" />
          Resolving from coordinates…
        </span>
      </div>
    );
  }
  if (!value || isFieldEmpty(value)) return null;
  return (
    <div className="rd-row rd-row-wide">
      <span className="rd-label">{label}</span>
      <span className="rd-value">{value}</span>
    </div>
  );
}

export default function RecordDetailScreen({
  recordId,
  onBack,
  onStartInspection,
  onEditRecord,
}: RecordDetailScreenProps) {
  const [record, setRecord] = useState<CaptureRecord | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  useForegroundRefresh(() => setRefreshVersion(version => version + 1));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showRefImageModal, setShowRefImageModal] = useState(false);
  const [showMarkStatusModal, setShowMarkStatusModal] = useState(false);
  const [addressResolving, setAddressResolving] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [googleVariance, setGoogleVariance] = useState<CoordVarianceResult | null>(null);

  const images = record?.images || [];
  const fieldCoords = getFieldCoordinates(images)
    ?? (record?.field_latitude != null && record?.field_longitude != null
      ? { latitude: record.field_latitude, longitude: record.field_longitude }
      : null);
  const fieldLat = fieldCoords?.latitude ?? null;
  const fieldLon = fieldCoords?.longitude ?? null;

  useEffect(() => {
    if (record?.coordinates && fieldLat != null && fieldLon != null) {
      let active = true;
      fetchGoogleDistance(record.coordinates, fieldLat, fieldLon).then((res) => {
        if (active && res) setGoogleVariance(res);
      });
      return () => {
        active = false;
      };
    }
  }, [record?.coordinates, fieldLat, fieldLon]);

  useEffect(() => {
    let active = true;
    if (record?.id !== recordId) setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = await api.getRecord(recordId);
        if (!active) return;
        setRecord(data);
        setLoading(false);

        // Pre-populate with authenticated direct URLs for instant rendering
        const initialUrls: Record<number, string> = {};
        for (const img of data.images || []) {
          const authUrl = api.getAuthenticatedImageUrl(img.image_url);
          if (authUrl) initialUrls[img.id] = imageUrls[img.id] || authUrl;
        }
        if (active) setImageUrls(initialUrls);

        // Fetch blob object URLs in background for lightbox offline caching
        for (const img of data.images || []) {
          if (img.image_url && !imageUrls[img.id]) {
            try {
              const dataUri = await api.fetchImageAsDataUri(img.image_url);
              if (active) {
                setImageUrls((prev) => ({ ...prev, [img.id]: dataUri }));
              }
            } catch {
              // ignore
            }
          }
        }
      } catch (err: any) {
        if (active) {
          setError(err?.message || 'Failed to load record details');
          setLoading(false);
        }
      }
    })();

    return () => { active = false; };
  }, [recordId, refreshVersion]);

  // Records captured while the geocoding key was missing have no address stored.
  // Resolve it from the captured GPS so the location block is never blank.
  useEffect(() => {
    if (!record) return;
    const hasGps = (record.images || []).some(
      (img) => img.latitude != null && img.longitude != null
    );
    // Only ask for an address we have a source for, so a record without admin
    // coordinates never triggers a pointless lookup on every open.
    const needsField = !record.formatted_address && hasGps;
    const needsAdmin = !record.admin_formatted_address && !!record.coordinates?.trim();
    if (!needsField && !needsAdmin) return;

    let active = true;
    setAddressResolving(true);
    setAddressError(null);
    api
      .resolveRecordAddress(record.id)
      .then((res) => {
        if (!active) return;
        if (res.address || res.admin_address) {
          setRecord((prev) =>
            prev
              ? {
                  ...prev,
                  formatted_address: res.address || prev.formatted_address,
                  admin_formatted_address: res.admin_address || prev.admin_formatted_address,
                  location_name: prev.location_name || res.place_name,
                }
              : prev
          );
        }
        if (!res.address) setAddressError(res.error || 'Address unavailable');
      })
      .catch(() => {
        if (active) setAddressError('Could not reach the geocoding service');
      })
      .finally(() => {
        if (active) setAddressResolving(false);
      });

    return () => { active = false; };
  }, [record?.id, record?.formatted_address]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <span
          className="spinner"
          style={{ width: 30, height: 30, borderWidth: 3, borderTopColor: 'var(--primary)' }}
        />
        <div style={{ marginTop: 12, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
          Loading record #{recordId}…
        </div>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div style={{ maxWidth: 500, margin: '40px auto', textAlign: 'center' }}>
        <div className="card" style={{ padding: 28 }}>
          <Icon name="error" size={40} color="var(--danger)" />
          <h3 style={{ marginTop: 12, fontSize: '1.1rem', color: 'var(--text-main)' }}>Record Not Found</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {error || 'Unable to load record details'}
          </p>
          <button type="button" className="btn btn-secondary" onClick={onBack} style={{ marginTop: 16 }}>
            ← Back to Records
          </button>
        </div>
      </div>
    );
  }

  const isCompleted = isRecordCompleted(record);

  const coordVariance =
    googleVariance ||
    (record.deviation_formatted
      ? {
          distanceMeters: record.deviation_meters ?? 0,
          formatted: record.deviation_formatted,
          status: (record.deviation_status || 'far') as any,
          source: 'google_maps' as const,
        }
      : calculateCoordVariance(record.coordinates, fieldLat, fieldLon));

  const varianceTone =
    coordVariance?.status === 'exact'
      ? { chip: 'rd-chip-ok', dev: 'rd-deviation-ok', label: 'Exact Match' }
      : coordVariance?.status === 'close'
        ? { chip: 'rd-chip-warn', dev: 'rd-deviation-warn', label: 'Nearby Lock' }
        : { chip: 'rd-chip-danger', dev: 'rd-deviation-bad', label: 'Position Discrepancy' };

  const hasPlanning =
    !!(record.unique_id ||
      record.land_use || record.survey_no || record.subdivision_no || record.survey_number ||
      record.sub_division || record.owner_name_en || record.taluk || record.village || record.district ||
      record.site_address);

  const hasInspection =
    !!(record.date_of_visit || record.construction_happening || record.stage_of_construction ||
      record.no_of_floors || record.built_up_area || record.expected_completion ||
      record.type_of_construction || record.relationship_with_building || record.building_user_name || record.spoken_with || record.contact_number ||
      record.site_contractor_architect_name || record.site_contractor_architect_number);

  const hasQc =
    !!(record.qc_vhr_comment || record.qc_street_details || record.qc_builder_contact);

  const hasAudit =
    !!(
      (record.audit_status && record.audit_status !== 'PENDING') ||
      record.audit_comment ||
      record.audited_by_name ||
      record.qc_by_name ||
      record.assigned_auditor_name ||
      record.qc_completed_at ||
      record.qc_vhr_comment ||
      record.qc_street_details ||
      record.qc_builder_contact ||
      record.qc_sqfeet ||
      record.qc_reference_image_url
    );

  // Header/map subtitle: the physically verified address wins over admin desktop data.
  const address = record.formatted_address || record.site_address ||
    [record.village, record.taluk, record.district].filter(Boolean).join(', ');

  return (
    <div className="record-detail-split">
      <div className="record-detail-information">

      {/* ─── 1. Record identity ─── */}
      <div className="rd-identity">
        <div className="rd-identity-top">
          <span className="rd-record-no">{formatRecordNo(record.id)}</span>
          {(() => {
            if (record.is_manually_added || record.source === 'manual') {
              return (
                <span className="rd-chip rd-chip-neutral">
                  <span className="rd-dot" />
                  Manually Added
                </span>
              );
            }
            const badge = getRecordStatusBadgeInfo(record);
            return (
              <span
                className="rd-chip"
                style={{
                  backgroundColor: badge.bg,
                  color: badge.color,
                  border: `1px solid ${badge.color}33`,
                }}
              >
                <span className="rd-dot" style={{ backgroundColor: badge.color }} />
                {badge.label}
              </span>
            );
          })()}
        </div>

        <h1 className="rd-identity-title">{record.name}</h1>
        {record.unique_id && <div className="rd-identity-sub">UID {record.unique_id}</div>}

        <div className="rd-identity-meta">
          <span className="rd-meta-line">
            <Icon name="schedule" size={15} />
            <span>{inspectionDateLabel(record)}</span>
          </span>
          {address && (
            <span className="rd-meta-line" title={address}>
              <Icon name="location_on" size={15} />
              <span>{address}</span>
            </span>
          )}
          <span className="rd-meta-line">
            <Icon name="photo_library" size={15} />
            <span>{images.length} photo{images.length === 1 ? '' : 's'}</span>
          </span>
        </div>

        <div className="rd-identity-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isCompleted ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onEditRecord(record)}
              title="Edit the inspection details saved for this record"
            >
              <Icon name="edit_note" size={16} />
              Edit Details
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onStartInspection(record)}
            >
              <Icon name="photo_camera" size={16} color="#ffffff" />
              {record.revisit_status === 'PENDING_REVISIT' || record.revisit_status === 'REASSIGNED' ? 'Start Revisit Inspection' : 'Start Inspection'}
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowMarkStatusModal(true)}
            title="Mark status as Not Interested, Duplicate, Construction Finished"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <Icon name="label" size={16} />
            Mark Status
          </button>
        </div>
      </div>

      {/* ─── 2. Site location ─── */}
      <div className="rd-card">
        <SectionHead
          icon="map"
          title="Site Location"
          action={
            (record.coordinates || address) ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600 }}
                onClick={() => {
                  try {
                    localStorage.setItem('pc_selected_record_id', String(record.id));
                    localStorage.setItem('pc_active_screen', 'detail');
                  } catch {
                    // ignore
                  }
                  const url = getGoogleMapsUrl(record.coordinates, address);
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                title="Open in Google Maps"
              >
                <Icon name="map" size={14} color="#FF6467" />
                <span>Open in Google Maps</span>
              </button>
            ) : undefined
          }
        />
        <GoogleMapEmbed
          latitude={fieldLat ?? undefined}
          longitude={fieldLon ?? undefined}
          coordinates={record.coordinates}
          address={address}
          title={`${record.name || 'Site'} Location`}
          height={230}
          zoom={16}
        />
        <div className="rd-rows rd-rows-single rd-location-rows">
          <AddressValue
            label="Field Inspection Address"
            value={record.formatted_address}
            pending={addressResolving}
            empty={
              addressError ||
              (isCompleted ? 'No address captured on site' : 'Not captured on site yet')
            }
          />
          <AddressValue
            label="Admin Given Address"
            value={record.admin_formatted_address}
            pending={addressResolving}
            empty={
              record.coordinates?.trim()
                ? 'Not resolved yet'
                : 'No coordinates assigned to this task'
            }
          />
          {record.location_name ? (
            <Row label="Place Name" value={record.location_name} />
          ) : null}
        </div>
      </div>

      {/* ─── 3. Imported Details (matches admin four-column layout) ─── */}
      {hasPlanning && (
        <div className="rd-card">
          <SectionHead icon="receipt_long" title="Imported Details" />
          <FourColumnTable
            fields={[
              { key: 'unique_id', label: 'Unique ID', value: record.unique_id },
              { key: 'survey_no', label: 'Survey No', value: record.survey_no || record.survey_number },
              { key: 'subdivision_no', label: 'Subdivision No', value: record.subdivision_no || record.sub_division },
              { key: 'land_use', label: 'Land Use', value: record.land_use },
              { key: 'owner_name', label: 'Owner Name', value: record.owner_name_en },
              { key: 'taluk', label: 'Taluk', value: record.taluk },
              { key: 'village', label: 'Village', value: record.village },
              { key: 'district', label: 'District', value: record.district },
              { key: 'site_address', label: 'Site Address', value: record.site_address },
            ]}
          />
        </div>
      )}

      {/* ─── 4. Audit Details (with QC Comments & Street View + View More) ─── */}
      {hasAudit && (
        <div className="rd-card">
          <SectionHead
            icon="fact_check"
            title="Audit Details"
            action={<AuditStatusChip status={record.audit_status} />}
          />
          <FourColumnTable
            fields={[
              { key: 'assigned_auditor', label: 'Assigned Auditor', value: record.qc_by_name || record.assigned_auditor_name },
              { key: 'audit_comment', label: 'Audit Comment', value: record.audit_comment },
              { key: 'qc_completed_at', label: 'QC Completed At', value: record.qc_completed_at ? formatDateTime(record.qc_completed_at) : undefined },
              { key: 'audited_by', label: 'Audited By', value: record.audited_by_name },
              { key: 'qc_vhr_comment', label: 'QC (VHR)', value: record.qc_vhr_comment },
              { key: 'qc_street_details', label: 'QC (Street View)', value: record.qc_street_details },
              ...(record.qc_builder_contact ? [{ key: 'qc_builder_contact', label: 'Builder / Contact', value: record.qc_builder_contact }] : []),
              ...(record.qc_sqfeet ? [{ key: 'qc_sqfeet', label: 'Sq.ft', value: record.qc_sqfeet }] : []),
            ]}
          />
          {record.qc_reference_image_url && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="photo_camera" size={14} color="#0284c7" />
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase' }}>
                    QC Reference Image
                  </span>
                </div>
                <span style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Icon name="cloud_done" size={13} /> GDrive Synced
                </span>
              </div>
              <div
                onClick={() => setShowRefImageModal(true)}
                style={{
                  position: 'relative',
                  borderRadius: 8,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  maxHeight: 220,
                  background: '#0f172a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid #cbd5e1',
                }}
              >
                <img
                  src={api.getAuthenticatedImageUrl(record.qc_reference_image_url)}
                  alt="QC Reference"
                  style={{ width: '100%', height: '100%', maxHeight: 220, objectFit: 'contain' }}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: 8,
                    right: 8,
                    background: 'rgba(15, 23, 42, 0.8)',
                    color: '#fff',
                    padding: '4px 8px',
                    borderRadius: 6,
                    fontSize: '0.72rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Icon name="zoom_in" size={14} /> Tap to expand
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── 5. Field Inspection Details (Compact Four-Column Table) ─── */}
      {hasInspection && (
        <div className="rd-card">
          <SectionHead
            icon="assignment_turned_in"
            title="Field Inspection Details"
            action={
              record.construction_happening ? (
                <span
                  className={`rd-chip ${
                    record.construction_happening === 'Yes' ? 'rd-chip-ok' : 'rd-chip-neutral'
                  }`}
                >
                  <span className="rd-dot" />
                  {record.construction_happening === 'Yes' ? 'Construction On' : 'No Construction'}
                </span>
              ) : undefined
            }
          />
          <FourColumnTable
            fields={[
              {
                key: 'captured_at',
                label: 'Captured / Inspected',
                value: (() => {
                  const recent = getRecentCaptureOrInspection(record);
                  if (recent.isoString) return formatDateTime(recent.isoString);
                  if (recent.date) return formatDate(recent.isoString);
                  return undefined;
                })(),
              },
              { key: 'construction_happening', label: 'Construction Status', value: record.construction_happening === 'Yes' ? 'Construction Happening' : 'No Construction' },
              { key: 'type_of_construction', label: 'Type of Construction', value: record.type_of_construction },
              { key: 'stage_of_construction', label: 'Stage of Construction', value: record.stage_of_construction },
              { key: 'no_of_floors', label: 'No of Floors', value: record.no_of_floors },
              { key: 'built_up_area', label: 'Built up area', value: record.built_up_area },
              { key: 'expected_completion', label: 'Expected Completion', value: record.expected_completion },
              { key: 'relationship_with_building', label: 'Relationship with Building', value: record.relationship_with_building },
              { key: 'building_user_name', label: 'Building User', value: record.building_user_name },
              { key: 'spoken_with', label: 'Spoken With', value: record.spoken_with },
              { key: 'contact_number', label: 'Contact Number', value: record.contact_number },
              { key: 'site_contractor_architect_name', label: 'Contractor / Architect', value: record.site_contractor_architect_name },
              { key: 'site_contractor_architect_number', label: 'Contractor Contact', value: record.site_contractor_architect_number },
              { key: 'remarks', label: 'Inspection Remarks', value: record.remarks },
              { key: 'follow_up_date', label: 'Follow-up Date', value: record.follow_up_date ? formatDate(record.follow_up_date) : undefined },
            ]}
          />
        </div>
      )}

      {/* ─── Revisit Details ─── */}
      {(record.reassigned_to_name || record.revisit_status || record.updated_coordinates || record.updated_information || record.follow_up_date) && (
        <div className="rd-card">
          <SectionHead
            icon="history"
            title="Revisit Details"
            action={
              record.revisit_status ? (
                <span className="rd-chip rd-chip-ok">
                  <span className="rd-dot" />
                  {record.revisit_status}
                </span>
              ) : undefined
            }
          />
          <FourColumnTable
            fields={[
              { key: 'reassigned_op', label: 'Reassigned Field Verifier', value: record.reassigned_to_name },
              { key: 'reassigned_date', label: 'Reassign Date', value: record.reassigned_at ? formatDateTime(record.reassigned_at) : undefined },
              { key: 'revisit_stat', label: 'Revisit Status', value: record.revisit_status },
              { key: 'follow_up_date_rev', label: 'Follow-up Date', value: record.follow_up_date ? formatDate(record.follow_up_date) : undefined },
              { key: 'upd_coords', label: 'Updated Coordinates', value: record.updated_coordinates },
              { key: 'upd_info', label: 'Updated Information', value: record.updated_information },
            ]}
          />
        </div>
      )}

      {/* ─── 5. Location verification ─── */}
      <div className="rd-card">
        <SectionHead
          icon="my_location"
          title="Location Verification"
          action={
            coordVariance ? (
              <span
                className={`rd-chip ${varianceTone.chip}`}
                title={`Tolerance: within ${NEARBY_LOCK_METERS} m of the admin-given position`}
              >
                <span className="rd-dot" />
                {varianceTone.label}
              </span>
            ) : undefined
          }
        />
        <div className="rd-coord-grid">
          {prettyCoords(record.coordinates) ? (
            <div className="rd-coord-item">
              <span className="rd-label">Admin Given Coordinates</span>
              <span className="rd-coord-val">
                <Icon name="pin_drop" size={15} />
                {prettyCoords(record.coordinates)}
              </span>
            </div>
          ) : null}
          {fieldLat != null && fieldLon != null ? (
            <div className="rd-coord-item">
              <span className="rd-label">Field Captured Coordinates</span>
              <span className="rd-coord-val">
                <Icon name="near_me" size={15} />
                {`${fieldLat.toFixed(6)}, ${fieldLon.toFixed(6)}`}
              </span>
            </div>
          ) : null}
          {coordVariance ? (
            <div className="rd-coord-item rd-coord-item-wide">
              <span className="rd-label">Deviation</span>
              <span className={`rd-value ${varianceTone.dev}`}>
                {coordVariance.formatted}
              </span>
            </div>
          ) : null}
        </div>


      </div>

      </div>
      {/* ─── 7. Captured evidence ─── */}
      <div className="rd-card record-detail-evidence">
        <SectionHead icon="photo_library" title={`Captured Evidence (${images.length})`} />
        {images.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
            {images.map((img, idx) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setLightboxIndex(idx)}
                title={`Open photo #${idx + 1}`}
                style={{
                  position: 'relative',
                  padding: 0,
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  backgroundColor: 'var(--bg-subtle)',
                  border: '1px solid var(--border-line)',
                  aspectRatio: '4 / 3',
                  cursor: 'pointer',
                  display: 'block',
                }}
              >
                <img
                  src={imageUrls[img.id] || img.image_url}
                  alt={img.file_name}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
                <span
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    backgroundColor: 'rgba(255,255,255,0.92)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border-line)',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 6,
                  }}
                >
                  #{idx + 1}
                </span>
                {img.location_accuracy > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 6,
                      right: 6,
                      backgroundColor: 'rgba(255,255,255,0.92)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border-line)',
                      fontSize: '0.64rem',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 6,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    ±{Math.round(img.location_accuracy)}m
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-faint)' }}>
            <Icon name="photo_camera" size={26} color="var(--text-faint)" />
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: 6 }}>
              No photos captured for this record
            </div>
          </div>
        )}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          images={images}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onSelectIndex={(idx) => setLightboxIndex(idx)}
          imageUrls={imageUrls}
        />
      )}

      {showRefImageModal && record.qc_reference_image_url && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(10, 15, 29, 0.95)',
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={() => setShowRefImageModal(false)}
        >
          <div
            style={{
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: '#fff',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <div>
              <strong style={{ fontSize: '0.9rem', display: 'block' }}>QC Reference Image</strong>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{record.unique_id || `Record #${record.id}`}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowRefImageModal(false)}
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: 'none',
                color: '#fff',
                borderRadius: '50%',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              overflow: 'auto',
            }}
          >
            <img
              src={api.getAuthenticatedImageUrl(record.qc_reference_image_url)}
              alt="QC Reference full view"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {showMarkStatusModal && record && (
        <MarkStatusModal
          record={record}
          isOpen={showMarkStatusModal}
          onClose={() => setShowMarkStatusModal(false)}
          onSuccess={(updated) => {
            setRecord(updated);
            setRefreshVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
