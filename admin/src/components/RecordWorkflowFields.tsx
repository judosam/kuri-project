import { SourceBadge } from './SourceBadge';
import { useState, useRef, useEffect } from 'react';
import type { CaptureRecord } from '../types';
import { AuthThumbnail, formatDate, formatDateTime, parseUtcDate, Icon } from './ui';
import { getFieldCoordinates } from '../utils/geo';
import { ExpandableCellText } from './ExpandableCellText';
// Gmap satellite thumbnail removed per user request

export type RecordView = 'overview' | 'all' | 'imported' | 'audit' | 'field';
type Field = { key: string; label: string; sort?: string; value: (record: CaptureRecord) => any };
const text = (value: unknown) => value == null || value === '' ? '—' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
const field = (key: keyof CaptureRecord, label: string, sort?: string): Field => ({ key, label, sort, value: r => text(r[key]) });
const date = (key: keyof CaptureRecord, label: string, dateOnly = false): Field => ({ key, label, sort: key, value: r => r[key] ? (dateOnly ? formatDate(String(r[key])) : formatDateTime(String(r[key]))) : '—' });
export const lastModifiedTime = (r: CaptureRecord) =>
  r.last_modified_at || r.reassigned_at || r.assigned_at || r.created_at;

export const capturedTime = (r: CaptureRecord) => {
  let latestImgDate: string | null = null;
  if (r.images?.length) {
    for (const img of r.images) {
      if (img.captured_at) {
        if (!latestImgDate || new Date(img.captured_at).getTime() > new Date(latestImgDate).getTime()) {
          latestImgDate = img.captured_at;
        }
      }
    }
  }
  const fieldDate = r.field_captured_at;
  if (latestImgDate && fieldDate) {
    try {
      return new Date(latestImgDate).getTime() >= new Date(fieldDate).getTime() ? latestImgDate : fieldDate;
    } catch {
      return fieldDate || latestImgDate;
    }
  }
  return latestImgDate || fieldDate || r.date_of_visit;
};
export const fieldCoordinates = (r: CaptureRecord) => {
  if (r.updated_coordinates && r.updated_coordinates.trim()) {
    return r.updated_coordinates.trim();
  }
  const gps = getFieldCoordinates(r.images) ?? (r.field_latitude != null && r.field_longitude != null && (r.field_latitude !== 0 || r.field_longitude !== 0)
    ? { latitude: r.field_latitude, longitude: r.field_longitude } : null);
  return gps ? `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}` : '—';
};
export function getUnifiedQcStatus(record: CaptureRecord): string {
  const hasQc = record.qc_status === 'DONE' || !!record.qc_completed_at || [record.qc_vhr_comment, record.qc_street_details, record.qc_builder_contact, record.qc_sqfeet].some(v => !!v?.trim());
  return hasQc ? 'QC Done' : 'QC Pending';
}

export const RECORD_GROUPS: { key: 'imported' | 'audit' | 'field'; label: string; fields: Field[] }[] = [
  { key: 'imported', label: 'Imported Details', fields: [
    field('id', 'Record ID', 'id'), field('unique_id', 'Unique ID', 'unique_id'),
    { key: 'source', label: 'Source', sort: 'source', value: r => <SourceBadge source={r.source} isManual={r.is_manually_added} /> },
    { key: 'last_modified_at', label: 'Last Modified Date', sort: 'last_modified_at', value: r => { const t = lastModifiedTime(r); return t ? formatDateTime(String(t)) : '—'; } },
    field('name', 'Record Name', 'name'),
    field('is_manually_added', 'Manually Added'), field('uploaded_by_name', 'Imported By', 'uploaded_by'),
    date('created_at', 'Record Created'), field('staged_operator_name', 'Suggested Field Verifier'),
    field('coordinates', 'Imported Coordinates', 'coordinates'),
    field('site_address', 'Site Address'), field('admin_formatted_address', 'Admin Resolved Address'),
    field('land_use', 'Land Use', 'land_use'), field('owner_name_en', 'Owner Name', 'owner_name_en'),
    field('area', 'Area', 'area'), field('village', 'Village', 'village'), field('taluk', 'Taluk', 'taluk'), field('district', 'District', 'district'),
    field('priority_tier', 'Priority Tier', 'priority_tier'),
    field('govt_dtcp_permit', 'DTCP Permit'),
    field('dtcp_permit_date', 'DTCP Permit Date'),
    field('dtcp_application_no', 'DTCP Application No'),
  ] },
  { key: 'audit', label: 'Audit Details', fields: [
    { key: 'assigned_auditor_name', label: 'QA User', sort: 'assigned_auditor', value: r => text(r.assigned_auditor_name || r.qc_by_name || r.audited_by_name) },
    { key: 'qc_status', label: 'QC Status', sort: 'qc_status', value: r => getUnifiedQcStatus(r) },
    { key: 'audit_status', label: 'Audit Status', sort: 'audit_status', value: r => r.audit_status || 'Pending' },
    field('audited_by_name', 'Audited By', 'audited_by'), date('audited_at', 'Audited At'),
    field('qc_vhr_comment', 'QC Comments (VHR Imagery)'), field('qc_street_details', 'QC Additional Details (Street View)'),
    field('area', 'Area', 'area'), field('qc_sqfeet', 'Sq.ft'),
    date('qc_completed_at', 'QC Completed At'),
  ] },
  { key: 'field', label: 'Field Verification', fields: [
    date('assigned_at', 'Assigned Date', true), field('user_name', 'Field Verifier', 'user_name'),
    { ...field('status', 'Verification Status', 'status'), value: r => {
      const s = (r.status || '').toUpperCase();
      if (s === 'NOT_INTERESTED' || s === 'NOT INTERESTED') return 'Not Interested';
      if (s === 'DUPLICATE') return 'Duplicate';
      if (s === 'CONSTRUCTION_FINISHED' || s === 'CONSTRUCTION FINISHED') return 'Construction Finished';
      if (r.is_manually_added || r.source === 'manual') return 'Manually Added';
      if (r.status === 'Updated Revisited' || r.status === 'UPDATED_REVISITED' || r.status === 'COMPLETED' || r.revisit_status === 'COMPLETED') return 'Completed';
      if (r.reassigned_to_id != null || r.revisit_status === 'REASSIGNED' || r.revisit_status === 'PENDING_REVISIT') return 'Reassigned';
      return 'Pending';
    } },
    { key: 'captured_at', label: 'Captured or Inspection Completed', sort: 'captured_at', value: r => capturedTime(r) ? formatDateTime(capturedTime(r)!) : '—' },
    field('area', 'Area', 'area'), field('village', 'Village', 'village'), field('taluk', 'Taluk', 'taluk'), field('district', 'District', 'district'),
    field('priority_tier', 'Priority Tier', 'priority_tier'),
    field('govt_dtcp_permit', 'DTCP Permit'),
    field('dtcp_permit_date', 'DTCP Permit Date'),
    field('dtcp_application_no', 'DTCP Application No'),
    { key: 'photos', label: 'Photos', sort: 'photo_count', value: r => String(r.images?.length || 0) },
    field('formatted_address', 'Field Inspection Address'),
    { key: 'field_coordinates', label: 'Field Captured Coordinates', value: fieldCoordinates },
    field('deviation_formatted', 'Deviation'),
    field('type_of_construction', 'Type of Construction', 'type_of_construction'),
    field('stage_of_construction', 'Stage of Construction', 'stage_of_construction'),
    field('no_of_floors', 'No of Floors'),
    field('built_up_area', 'Built up area'),
    field('expected_completion', 'Expected Completion'),
    field('follow_up_date', 'Follow-up Date'),
    field('contact_number', 'Contact Number'),
    field('spoken_with', 'Spoken With'),
    field('site_contractor_architect_name', 'Contractor / Architect'), field('remarks', 'Inspection Remarks'),
  ] },
];

/**
 * Columns that only earn a spot when the operator narrows the table to that
 * single workflow view — the merged views stay compact.
 */
const EXTRA_FIELDS_BY_VIEW: Record<'imported' | 'audit' | 'field', string[]> = {
  imported: ['site_address', 'admin_formatted_address'],
  audit: ['qc_builder_contact'],
  field: ['location_name', 'field_location_accuracy', 'deviation_meters', 'deviation_status', 'construction_happening', 'relationship_with_building', 'building_user_name', 'spoken_with', 'site_contractor_architect_number'],
};

/** Fields for a group under the given record view (dropping view-specific extras). */
export function recordGroupFields(groupKey: 'imported' | 'audit' | 'field', view: RecordView) {
  const group = RECORD_GROUPS.find(g => g.key === groupKey);
  if (!group || view === 'all') return group?.fields ?? [];
  const extras = EXTRA_FIELDS_BY_VIEW[groupKey];
  return group.fields.filter(f => !extras.includes(f.key));
}

/**
 * Auditor-popup workflow summary. Audit Details and Field Verification are
 * hidden because the auditor supplies that data themselves (QC panel / field
 * app), and imported bookkeeping fields add noise without aiding the decision.
 */
const POPUP_HIDDEN_GROUPS = new Set(['audit', 'field']);
const POPUP_HIDDEN_FIELDS = new Set(['id', 'street_address', 'name', 'source', 'is_manually_added', 'uploaded_by_name', 'created_at', 'staged_operator_name', 'description']);

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
          title={isExpanded ? 'Show less' : 'Show more'}
          aria-label={isExpanded ? 'Show less' : 'Show more'}
        >
          {isExpanded ? ' ▴' : ' ▾'}
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

export function RecordWorkflowDetails({ record }: { record: CaptureRecord }) {
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const toggleField = (key: string) => {
    setExpandedKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="single-imported-card">
      {RECORD_GROUPS.filter((group) => !POPUP_HIDDEN_GROUPS.has(group.key)).map((group) => {
        const fields = group.fields
          .filter((item) => !POPUP_HIDDEN_FIELDS.has(item.key))
          .filter((item) => !isFieldEmpty(item.value(record)));
        if (fields.length === 0) return null;
        const fieldPairs: [Field, Field | undefined][] = [];
        for (let i = 0; i < fields.length; i += 2) {
          fieldPairs.push([fields[i], fields[i + 1]]);
        }
        return (
          <div key={group.key} className="single-card-inner">
            <div className="single-card-header">
              <div className="single-card-title-wrap">
                <Icon name="receipt_long" size={15} className="single-card-icon" style={{ color: '#ea580c' }} />
                <h3 className="single-card-title" style={{ color: '#0f172a' }}>{group.label}</h3>
              </div>
            </div>
            <div className="imported-table-wrapper">
              <table className="imported-details-table four-column-table">
                <tbody>
                  {fieldPairs.map(([fieldA, fieldB], rowIdx) => (
                    <tr key={fieldA.key || rowIdx} className="imported-table-row">
                      <td className="imported-table-label" style={{ color: 'oklch(50% 0.134 242.749)' }}>
                        <span style={{ color: 'oklch(50% 0.134 242.749)' }}>{fieldA.label}</span>
                      </td>
                      <td className="imported-table-value-cell">
                        <DetailValueCell
                          value={fieldA.value(record)}
                          isExpanded={!!expandedKeys[fieldA.key]}
                          onToggle={() => toggleField(fieldA.key)}
                        />
                      </td>
                      {fieldB ? (
                        <>
                          <td className="imported-table-label" style={{ color: 'oklch(50% 0.134 242.749)' }}>
                            <span style={{ color: 'oklch(50% 0.134 242.749)' }}>{fieldB.label}</span>
                          </td>
                          <td className="imported-table-value-cell">
                            <DetailValueCell
                              value={fieldB.value(record)}
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
          </div>
        );
      })}
    </div>
  );
}

export function RecordFieldValue({ record, item }: { record: CaptureRecord; item: Field }) {
  if (item.key === 'photos') return <div className="workflow-photos">{record.images?.[0]?.image_url && <AuthThumbnail imageUrl={record.images[0].image_url} alt="Field verification photo" size={34} />}<span>{item.value(record)}</span></div>;
  if (item.key === 'source') return <SourceBadge source={record.source} isManual={record.is_manually_added} />;
  return <span className="workflow-value" title={typeof item.value(record) === 'string' ? item.value(record) : undefined}>{item.value(record)}</span>;
}

/**
 * Shared records-table cells. The Audit and Admin tables show the same QC and
 * location facts, so the renderers live here instead of being duplicated in
 * each panel's <tbody>. Each one renders its own <td> so the column lines up
 * 1:1 with the matching <th>.
 */
export const NilCell = <span style={{ color: '#0f172a', fontWeight: 600 }}>-</span>;

/** When the QC (VHR imagery) assessment was last recorded. */
export function qcDoneAt(record: CaptureRecord): string | null {
  return record.qc_completed_at || null;
}

/** "QA Done at" column — the QC assessment timestamp, or a dash. */
export function QcDoneAtCell({ record }: { record: CaptureRecord }) {
  const doneAt = qcDoneAt(record);
  if (!doneAt) return <td>{NilCell}</td>;
  return (
    <td style={{ whiteSpace: 'nowrap' }} title={`QC recorded ${formatDateTime(doneAt)}`}>
      {formatDateTime(doneAt)}
    </td>
  );
}

/** "QA User" column — the auditor the row was routed to or audited by. */
export function QaUserCell({ record }: { record: CaptureRecord }) {
  const qaUser = record.assigned_auditor_name || record.qc_by_name || record.audited_by_name;
  if (!qaUser) return <td>{NilCell}</td>;
  return (
    <td><div className="rec-text-cell"><ExpandableCellText compact text={qaUser} /></div></td>
  );
}

/** "QC Status" column — QC Done, QC Pending. */
export function QcStatusCell({ record }: { record: CaptureRecord }) {
  const doneTime = record.qc_completed_at;
  const isDone = record.qc_status === 'DONE' || !!doneTime || [record.qc_vhr_comment, record.qc_street_details, record.qc_builder_contact, record.qc_sqfeet].some(value => !!value?.trim());
  const parsed = doneTime ? parseUtcDate(doneTime) : null;

  if (isDone) {
    return (
      <td className="col-qc-status" style={{ whiteSpace: 'nowrap' }}>
        <span
          className="audit-chip audit-chip-approval qc-done-chip"
          title={`QC Done${(record.qc_by_name || record.assigned_auditor_name) ? ` by ${(record.qc_by_name || record.assigned_auditor_name)}` : ''}${parsed ? ` on ${formatDateTime(doneTime!)}` : ''}`}
          style={{ padding: '1.5px 6.5px', fontSize: '0.70rem', height: 20, lineHeight: 1, display: 'inline-flex', alignItems: 'center', gap: 3.5, whiteSpace: 'nowrap' }}
        >
          <Icon name="task_alt" size={12} />
          <span style={{ fontWeight: 600 }}>QC Done</span>
        </span>
      </td>
    );
  }

  return (
    <td className="col-qc-status" style={{ whiteSpace: 'nowrap' }}>
      <span
        className="audit-chip"
        style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', padding: '1.5px 6.5px', fontSize: '0.70rem', height: 20, lineHeight: 1, display: 'inline-flex', alignItems: 'center', gap: 3.5, whiteSpace: 'nowrap' }}
        title="QC assessment (VHR imagery / street view) not recorded yet"
      >
        <Icon name="pending_actions" size={12} />
        <span>QC Pending</span>
      </span>
    </td>
  );
}

/** "Audit Status" column — Approval, Disapproval, Commercial, Reaudited, Pending. */
export function AuditStatusCell({ record }: { record: CaptureRecord }) {
  const s = record.audit_status || 'PENDING';
  let chip = null;
  if (s === 'APPROVAL') {
    chip = (
      <span className="audit-chip audit-chip-approval" title="Audit Status: Approval">
        <Icon name="check_circle" size={12} />
        <span>Approval</span>
      </span>
    );
  } else if (s === 'DISAPPROVAL') {
    chip = (
      <span className="audit-chip audit-chip-disapproval" title="Audit Status: Disapproval">
        <Icon name="block" size={12} />
        <span>Disapproval</span>
      </span>
    );
  } else if (s === 'COMMERCIAL_PROPERTY') {
    chip = (
      <span className="audit-chip audit-chip-commercial_property" title="Audit Status: Commercial Property">
        <Icon name="storefront" size={12} />
        <span>Commercial</span>
      </span>
    );
  } else if (s === 'RE_AUDITED') {
    chip = (
      <span className="audit-chip audit-chip-re_audited" title="Audit Status: Reaudited">
        <Icon name="history" size={12} />
        <span>Reaudited</span>
      </span>
    );
  } else {
    chip = (
      <span className="audit-chip audit-chip-pending" title="Audit Status: Pending Decision">
        <Icon name="pending_actions" size={12} />
        <span>Pending</span>
      </span>
    );
  }

  return (
    <td className="col-audit-status" style={{ whiteSpace: 'nowrap' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', maxWidth: '100%' }}>
        {chip}
        {record.qc_edited_at && (
          <span
            className="audit-chip audit-chip-approval qc-edit-chip"
            style={{ padding: '1px 6px', fontSize: '0.68rem', height: 18, lineHeight: 1, display: 'inline-flex', alignItems: 'center', gap: 2.5, flexShrink: 0, whiteSpace: 'nowrap' }}
            title={`QC Edited on ${formatDateTime(record.qc_edited_at)}`}
          >
            <Icon name="edit_note" size={11} />
            <span style={{ overflow: 'visible', textOverflow: 'clip', whiteSpace: 'nowrap' }}>Edited</span>
          </span>
        )}
      </div>
    </td>
  );
}

/** "QC Comments (VHR Imagery)" column. */
export function QcCommentsCell({ record }: { record: CaptureRecord }) {
  return (
    <td className="col-qc-vhr-comment" title={record.qc_builder_contact ? `Builder/contact: ${record.qc_builder_contact}` : undefined}>
      <div className="rec-text-cell"><ExpandableCellText text={record.qc_vhr_comment} /></div>
    </td>
  );
}

/** Site coordinates — the admin-given fix, else the field GPS capture. */
export function recordCoordinates(record: CaptureRecord): string | null {
  if (record.updated_coordinates && record.updated_coordinates.trim()) return record.updated_coordinates.trim();
  if (record.coordinates && record.coordinates.trim()) return record.coordinates;
  const fieldCoords = getFieldCoordinates(record.images) ?? (record.field_latitude != null && record.field_longitude != null
    ? { latitude: record.field_latitude, longitude: record.field_longitude }
    : null);
  return fieldCoords ? `${fieldCoords.latitude.toFixed(6)}, ${fieldCoords.longitude.toFixed(6)}` : null;
}

/** "Coordinates" column. */
export function CoordinatesCell({ record }: { record: CaptureRecord }) {
  const coords = recordCoordinates(record);
  if (!coords) return <td>{NilCell}</td>;
  return (
    <td>
      <span className="cell-coords mono-sm" style={{ color: '#0f172a', fontWeight: 600 }}>
        <Icon name="my_location" size={13} />
        {coords}
      </span>
    </td>
  );
}

/** "Map" column — Google Maps satellite deep link. */
export function MapLinkCell({ url, label = 'GMap' }: { url?: string | null; label?: string }) {
  return (
    <td onClick={(e) => e.stopPropagation()}>
      {url ? (
        <a
          className="btn btn-ghost btn-sm"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open these coordinates in Google Maps (satellite view)"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', textDecoration: 'none' }}
        >
          <Icon name="my_location" size={14} style={{ color: '#e86667' }} />
          {label}
        </a>
      ) : NilCell}
    </td>
  );
}

/** "Satellite" column — deprecated / removed per user request. */
export function SatelliteCell(_props?: { record?: CaptureRecord }) {
  return null;
}
