import { SourceBadge } from '../components/SourceBadge';
/**
 * Imported Record — the dedicated detail page for old field records that an
 * admin backfilled from Excel (source === "imported").
 *
 * It shows exactly the same fields and sections as the field-captured record
 * page (`RecordDetail`), plus the two things an imported record needs:
 *   1. editable details (Save / update), and
 *   2. photo upload with an instant preview — the server stamps each stored
 *      photo “Uploaded” (these are not device captures, so no GPS/time HUD).
 *
 * Field-captured records keep using /records/:id — this page never renders for
 * them.
 */
import React, { useCallback, useEffect, useState, useRef, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { recordsApi, logsApi, SERVER_BASE } from '../services/api';
import type { AuditStatus, CaptureRecord, ActivityEntry, User } from '../types';
import { AuditStatusChip, AUDIT_OPTIONS } from './Records';
import {
  Icon,
  Avatar,
  LoadingPanel,
  PageShell,
  CustomSelect,
  formatCoords,
  formatDate,
  formatDateTime,
  formatRecordNo,
  type IconName,
} from '../components/ui';
import { DetailValueCell, isFieldEmpty } from '../components/RecordWorkflowFields';
import { CoordinateMap } from '../components/CoordinateMap';
import { enName } from '../utils/english';
import { useTopHeader } from '../context/HeaderContext';
import {
  calculateCoordVariance,
  getFieldCoordinates,
  fetchGoogleDistance,
  NEARBY_LOCK_METERS,
  type CoordVarianceResult,
} from '../utils/geo';
import { useLightboxKeys } from '../hooks/useLightboxKeys';

import { QC_VHR_OPTIONS, QC_STREET_OPTIONS } from '../utils/qcOptions';

import { TELECALLER_STATUS_OPTIONS } from '../components/TelecallerRecordModal';
import { TelecallerHistoryTable } from '../components/TelecallerHistoryTable';

const CONSTRUCTION_TYPES = [
  'Residential',
  'Commercial',
  'Industrial',
  'Institutional',
  'Infrastructure',
  'Other',
];

const STAGES_OF_CONSTRUCTION = [
  'Excavation',
  'Foundation Work (Piling)',
  'Ground Floor Construction',
  'Additional Floor Construction',
  'Electrical & Plumbing Work (MEP)',
  'Plastering & Waterproofing',
  'Flooring, Painting & Finishing',
  'External Development (Parking, Roads, Landscaping)',
  'Completed Building',
  'Renovation',
  'Other',
];

const RELATIONSHIP_OPTIONS = [
  'Owner',
  'Tenant',
  'Contractor',
  'Architect',
  'Engineer',
  'Site Supervisor',
  'Watchman / Security',
  'Neighbour',
  'Other',
];

const SPOKEN_WITH_OPTIONS = [
  'Owner',
  'Engineer',
  'Architect',
  'Contractor',
  'Supervisor',
  'Security / Watchman',
  'Neighbour',
  'Other',
];

/** Human-readable photo label — mirrors the backend's canonical naming. */
function photoLabel(recordId: number, order: number): string {
  return `Record_${recordId}_Photo_${order}.jpg`;
}

/** "11.047,77.036" → "11.047, 77.036" so the value wraps at the comma. */
function prettyCoords(raw?: string | null): string {
  return (raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

/** One titled block of the detail panel (same markup as the captured-record page). */
function Section({
  icon,
  title,
  action,
  badges,
  boxed = false,
  children,
}: {
  icon: IconName;
  title: string;
  action?: ReactNode;
  badges?: ReactNode;
  boxed?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`rd-section${boxed ? ' rd-section-boxed' : ''}`}>
      <header className="rd-section-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0, flex: '1 1 auto' }}>
          <span className="rd-section-title" style={{ flex: 'none' }}>
            <Icon name={icon} size={15} />
            {title}
          </span>
          {badges}
        </div>
        {action && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
            {action}
          </div>
        )}
      </header>
      {children}
    </section>
  );
}

interface TableField {
  key: string;
  label: string;
  value?: React.ReactNode;
}

function FourColumnTable({ fields }: { fields: TableField[] }) {
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
              <td className="imported-table-label" style={{ color: 'oklch(50% 0.134 242.749)' }}>
                <span style={{ color: 'oklch(50% 0.134 242.749)' }}>{fieldA.label}</span>
              </td>
              <td className="imported-table-value-cell">
                {React.isValidElement(fieldA.value) ? (
                  <div className="imported-table-value">{fieldA.value}</div>
                ) : (
                  <DetailValueCell
                    value={fieldA.value != null ? String(fieldA.value) : ''}
                    isExpanded={!!expandedKeys[fieldA.key]}
                    onToggle={() => toggleField(fieldA.key)}
                  />
                )}
              </td>
              {fieldB ? (
                <>
                  <td className="imported-table-label" style={{ color: 'oklch(50% 0.134 242.749)' }}>
                    <span style={{ color: 'oklch(50% 0.134 242.749)' }}>{fieldB.label}</span>
                  </td>
                  <td className="imported-table-value-cell">
                    {React.isValidElement(fieldB.value) ? (
                      <div className="imported-table-value">{fieldB.value}</div>
                    ) : (
                      <DetailValueCell
                        value={fieldB.value != null ? String(fieldB.value) : ''}
                        isExpanded={!!expandedKeys[fieldB.key]}
                        onToggle={() => toggleField(fieldB.key)}
                      />
                    )}
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


/** Editable fields of the imported record — same field set as the captured record. */
const PLANNING_FIELDS: { key: keyof CaptureRecord; label: string; wide?: boolean; mono?: boolean }[] = [
  { key: 'unique_id', label: 'Unique ID', mono: true },
  { key: 'survey_no', label: 'Survey No' },
  { key: 'subdivision_no', label: 'Subdivision No' },

  { key: 'land_use', label: 'Land Use' },
  { key: 'owner_name_en', label: 'Owner Name', wide: true },
  { key: 'taluk', label: 'Taluk' },
  { key: 'village', label: 'Village' },
  { key: 'district', label: 'District' },
  { key: 'priority_tier', label: 'Priority Tier' },
  { key: 'dtcp_permit_date', label: 'DTCP Permit Date' },
  { key: 'dtcp_application_no', label: 'DTCP Application No' },

  { key: 'coordinates', label: 'Admin Coordinates', wide: true },
  { key: 'site_address', label: 'Site Address', wide: true },
];

const INSPECTION_FIELDS: { key: keyof CaptureRecord; label: string; wide?: boolean; mono?: boolean }[] = [
  { key: 'date_of_visit', label: 'Date of Visit' },
  { key: 'type_of_construction', label: 'Type of Construction' },
  { key: 'stage_of_construction', label: 'Stage of Construction', wide: true },
  { key: 'relationship_with_building', label: 'Relationship with Building' },
  { key: 'building_user_name', label: 'Building User' },
  { key: 'spoken_with', label: 'Spoken With' },
  { key: 'contact_number', label: 'Contact Number', mono: true },
  { key: 'site_contractor_architect_name', label: 'Contractor / Architect' },
  { key: 'site_contractor_architect_number', label: 'Contractor Contact', mono: true },
];

type FormState = Record<string, string>;

function recordToForm(record: CaptureRecord): FormState {
  const form: FormState = {};
  for (const field of [...PLANNING_FIELDS, ...INSPECTION_FIELDS]) {
    const value = record[field.key];
    form[field.key as string] = value == null ? '' : String(value);
  }
  form.survey_no = record.survey_no || record.survey_number || '';
  form.subdivision_no = record.subdivision_no || record.sub_division || '';
  form.name = record.name || '';
  form.description = record.description || '';
  form.remarks = record.remarks || '';
  form.construction_happening = record.construction_happening || '';
  return form;
}

export default function ImportedRecordDetail({
  canAdmin = true,
  canAudit = false,
}: {
  canAdmin?: boolean;
  canAudit?: boolean;
}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [record, setRecord] = useState<CaptureRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [imageBlobUrls, setImageBlobUrls] = useState<Record<number, string>>({});
  const [imageFailures, setImageFailures] = useState<Record<number, boolean>>({});
  const [addressBusy, setAddressBusy] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Photo upload
  const [pending, setPending] = useState<{ file: File; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadNote, setUploadNote] = useState('');

  // Edit / save
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState<FormState>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // QC Assessment & Decision state
  const [qcVhr, setQcVhr] = useState<string>('');
  const [qcStreet, setQcStreet] = useState<string>('');
  const [qcBuilder, setQcBuilder] = useState<string>('');
  const [qcSqfeet, setQcSqfeet] = useState<string>('');
  const [auditComment, setAuditComment] = useState<string>('');
  const [auditStatus, setAuditStatus] = useState<AuditStatus | ''>('');
  const [editQcCoordinates, setEditQcCoordinates] = useState<string>('');
  const [showPinPicker, setShowPinPicker] = useState<boolean>(false);
  const [auditSaving, setAuditSaving] = useState<boolean>(false);
  const [assignedAuditorId, setAssignedAuditorId] = useState<string>('');
  const [auditors, setAuditors] = useState<User[]>([]);
  const [auditNotice, setAuditNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [isEditingQc, setIsEditingQc] = useState(false);
  const [qcImageUploading, setQcImageUploading] = useState(false);
  const [qcImageDeleting, setQcImageDeleting] = useState(false);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [refViewerUrl, setRefViewerUrl] = useState<string | null>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);
  const [showEditHistoryModal, setShowEditHistoryModal] = useState(false);
  const [showQcHistoryModal, setShowQcHistoryModal] = useState(false);
  const [recordActivityLogs, setRecordActivityLogs] = useState<ActivityEntry[]>([]);
  const [loadingActivityLogs, setLoadingActivityLogs] = useState(false);

  // Field Verification editing
  const [isEditingField, setIsEditingField] = useState(false);
  const [fieldSaving, setFieldSaving] = useState(false);
  const [fieldNotice, setFieldNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldDraft, setFieldDraft] = useState({
    construction_happening: 'Yes',
    date_of_visit: '',
    type_of_construction: '',
    stage_of_construction: '',
    no_of_floors: '',
    built_up_area: '',
    expected_completion: '',
    relationship_with_building: '',
    building_user_name: '',
    spoken_with: '',
    contact_number: '',
    site_contractor_architect_name: '',
    site_contractor_architect_number: '',
    remarks: '',
  });

  // Telecaller Verification editing
  const [telecallers, setTelecallers] = useState<{ id: number; full_name: string; email: string; role: string }[]>([]);
  const [isEditingTelecaller, setIsEditingTelecaller] = useState(false);
  const [telecallerSaving, setTelecallerSaving] = useState(false);
  const [telecallerNotice, setTelecallerNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [telecallerDraft, setTelecallerDraft] = useState({
    assigned_telecaller_id: '',
    telecaller_status: 'PENDING',
    telecaller_comment: '',
    telecaller_no_of_floors: '',
    telecaller_built_up_area: '',
    telecaller_expected_completion: '',
    telecaller_stage_of_construction: '',
  });

  useEffect(() => {
    recordsApi.auditors()
      .then((list) => setAuditors(list as User[]))
      .catch(() => {});
    recordsApi.telecallers()
      .then((list) => setTelecallers(list))
      .catch(() => {});
  }, []);

  const fetchActivityLogs = async () => {
    if (!record?.id) return;
    setLoadingActivityLogs(true);
    try {
      const res = await logsApi.list({ limit: 500 });
      if (res && Array.isArray(res.items)) {
        const filtered = res.items.filter(
          (item) => item.record_id === record.id || (item.record_name && item.record_name === record.name)
        );
        setRecordActivityLogs(filtered);
      }
    } catch {
      // ignore if forbidden or error
    } finally {
      setLoadingActivityLogs(false);
    }
  };

  useEffect(() => {
    if (record?.id) {
      fetchActivityLogs();
    }
  }, [record?.id, record?.name]);

  const sortedImages = [...(record?.images || [])].sort((a, b) => a.photo_order - b.photo_order);
  const currentImage = sortedImages[selectedImage] ?? null;
  const lightboxImage = lightbox !== null ? sortedImages[lightbox] ?? null : null;

  const stepLightbox = (delta: number) => {
    if (lightbox === null || sortedImages.length === 0) return;
    setLightbox((lightbox + delta + sortedImages.length) % sortedImages.length);
  };

  useLightboxKeys(
    lightbox !== null,
    () => setLightbox(null),
    () => stepLightbox(-1),
    () => stepLightbox(1)
  );

  const selectedHasGps =
    currentImage &&
    currentImage.latitude != null &&
    currentImage.longitude != null &&
    !(currentImage.latitude === 0 && currentImage.longitude === 0);
  const primaryGps = getFieldCoordinates(sortedImages);
  const fieldLat = selectedHasGps ? currentImage!.latitude : primaryGps?.latitude ?? null;
  const fieldLon = selectedHasGps ? currentImage!.longitude : primaryGps?.longitude ?? null;

  const [googleVariance, setGoogleVariance] = useState<CoordVarianceResult | null>(null);

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

  const coordVariance =
    googleVariance ||
    (record?.deviation_formatted
      ? {
          distanceMeters: record.deviation_meters ?? 0,
          formatted: record.deviation_formatted,
          status: (record.deviation_status || 'far') as any,
          source: 'google_maps' as const,
        }
      : calculateCoordVariance(record?.coordinates, fieldLat, fieldLon));


  const varianceTone =
    coordVariance?.status === 'exact'
      ? { chip: 'rd-chip-ok', dev: 'rd-deviation-ok', label: 'Exact Match' }
      : coordVariance?.status === 'close'
        ? { chip: 'rd-chip-warn', dev: 'rd-deviation-warn', label: 'Nearby Lock' }
        : { chip: 'rd-chip-danger', dev: 'rd-deviation-bad', label: 'Position Discrepancy' };

  const fetchImageBlob = useCallback(
    async (imageUrl: string, imageId: number) => {
      if (imageBlobUrls[imageId] || imageFailures[imageId]) return;
      try {
        const token = localStorage.getItem('token');
        const normalized = imageUrl.startsWith('/api')
          ? imageUrl
          : `/api${imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`}`;
        const resp = await fetch(`${SERVER_BASE}${normalized}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        setImageBlobUrls((prev) => ({ ...prev, [imageId]: URL.createObjectURL(blob) }));
      } catch {
        setImageFailures((prev) => ({ ...prev, [imageId]: true }));
      }
    },
    [imageBlobUrls, imageFailures]
  );

  const loadRecord = useCallback(
    async (recordId: number) => {
      const data = await recordsApi.get(recordId);
      setRecord(data);
      setForm(recordToForm(data));
      setQcVhr(data.qc_vhr_comment || '');
      setQcStreet(data.qc_street_details || '');
      setQcBuilder(data.qc_builder_contact || '');
      setQcSqfeet(data.qc_sqfeet || '');
      setAuditComment(data.audit_comment || '');
      setAuditStatus((data.audit_status as AuditStatus) || '');
      setEditQcCoordinates(data.coordinates || '');
      setAssignedAuditorId(data.assigned_auditor_id ? String(data.assigned_auditor_id) : '');
      setFieldDraft({
        construction_happening: data.construction_happening || 'Yes',
        date_of_visit: data.date_of_visit || '',
        type_of_construction: data.type_of_construction || '',
        stage_of_construction: data.stage_of_construction || '',
        no_of_floors: data.no_of_floors || '',
        built_up_area: data.built_up_area || '',
        expected_completion: data.expected_completion || '',
        relationship_with_building: data.relationship_with_building || '',
        building_user_name: data.building_user_name || '',
        spoken_with: data.spoken_with || '',
        contact_number: data.contact_number || '',
        site_contractor_architect_name: data.site_contractor_architect_name || '',
        site_contractor_architect_number: data.site_contractor_architect_number || '',
        remarks: data.remarks || '',
      });
      setTelecallerDraft({
        assigned_telecaller_id: data.assigned_telecaller_id ? String(data.assigned_telecaller_id) : '',
        telecaller_status: data.telecaller_status || 'PENDING',
        telecaller_comment: data.telecaller_comment || '',
        telecaller_no_of_floors: data.telecaller_no_of_floors || '',
        telecaller_built_up_area: data.telecaller_built_up_area || '',
        telecaller_expected_completion: data.telecaller_expected_completion || '',
        telecaller_stage_of_construction: data.telecaller_stage_of_construction || '',
      });
      data.images.forEach((img) => {
        if (img.image_url) fetchImageBlob(img.image_url, img.id);
      });
      return data;
    },
    [fetchImageBlob]
  );

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    loadRecord(parseInt(id))
      .then(() => setSelectedImage(0))
      .catch(() => setError('Failed to load record.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleBack = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/records');
    }
  };

  useTopHeader(
    {
      left: (
        <div className="topbar-cmd-left">
          <button
            type="button"
            className="topbar-back-btn"
            onClick={handleBack}
            title="Return to records list"
          >
            <Icon name="arrow_back" size={15} />
            <span>Records</span>
          </button>
          {record && (
            <>
              <span className="topbar-cmd-divider" />
              <div className="topbar-cmd-titles">
                <div className="topbar-cmd-title-row">
                  <h1 className="topbar-record-title">{record.name || `Imported Record #${record.id}`}</h1>
                  <span className="topbar-record-pill">{formatRecordNo(record.id)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      ),
      right: record ? (
        <div className="topbar-cmd-right">
        <button type="button" className="topbar-btn topbar-btn-secondary" onClick={() => recordsApi.downloadRecord(record.id).catch(() => window.alert('Could not download this record. Please retry.'))}>Download Full Record (.xlsx)</button>
          <button
            type="button"
            className="topbar-btn topbar-btn-secondary"
            onClick={() => {
              setForm(recordToForm(record));
              setSaveError('');
              setShowEdit(true);
            }}
            title="Edit the imported record details"
          >
            <Icon name="tune" size={14} />
            <span>Edit Details</span>
          </button>
          <div className="topbar-cmd-divider" />
          <span
            className="topbar-verified-pill"
            style={{ background: '#eef2ff', color: '#4f46e5' }}
            title="Old field work uploaded by an admin"
          >
            <Icon name="upload_file" size={13} />
            <span>Uploaded / Imported</span>
          </span>
        </div>
      ) : null,
    },
    [record, navigate]
  );

  const pickPhotos = (files: FileList | null) => {
    if (!files?.length) return;
    const added = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    if (added.length === 0) {
      setUploadError('Please choose image files (JPEG or PNG).');
      return;
    }
    setUploadError('');
    setUploadNote('');
    setPending((prev) => [...prev, ...added]);
  };

  const removePending = (index: number) => {
    setPending((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.url);
      return next;
    });
  };

  const uploadPhotos = async () => {
    if (!record || pending.length === 0) return;
    setUploading(true);
    setUploadError('');
    setUploadNote('');
    try {
      const updated = await recordsApi.uploadImportedPhotos(
        record.id,
        pending.map((p) => p.file)
      );
      pending.forEach((p) => URL.revokeObjectURL(p.url));
      setPending([]);

      // Refresh the gallery from the server so the watermarked files are what
      // the admin actually sees, never the local un-watermarked previews.
      // Uploads only ever append frames, so object URLs already loaded for the
      // earlier frames stay valid — fetchImageBlob skips them and pulls just
      // the new ones.
      setRecord({ ...updated, images: updated.images });
      updated.images.forEach((img) => {
        if (img.image_url) fetchImageBlob(img.image_url, img.id);
      });
      setSelectedImage(Math.max(0, updated.images.length - 1));

      if (updated.errors?.length) {
        setUploadError(updated.errors.join(' · '));
      } else {
        setUploadNote(
          `${pending.length} photo${pending.length === 1 ? '' : 's'} uploaded and watermarked.`
        );
      }
    } catch (e: any) {
      setUploadError(e.response?.data?.detail || e.message || 'Photo upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const saveDetails = async () => {
    if (!record) return;
    setSaving(true);
    setSaveError('');
    try {
      const payload: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(form)) {
        payload[key] = value.trim();
      }
      // visit_order is an integer on the API — only send it when it is a number.
      const rawOrder = (form.visit_order || '').trim();
      if (rawOrder) {
        if (/^\d+$/.test(rawOrder)) payload.visit_order = Number(rawOrder);
        else delete payload.visit_order;
      } else {
        delete payload.visit_order;
      }
      // A cleared construction flag is sent as an empty string, which the API
      // stores as "not recorded" rather than silently keeping the old value.
      const updated = await recordsApi.update(record.id, payload as any);
      setRecord((prev) => (prev ? { ...prev, ...updated } : updated));
      setForm(recordToForm(updated));
      setShowEdit(false);
    } catch (e: any) {
      setSaveError(e.response?.data?.detail || e.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  /** Save the loaded blob as a file — blob: URLs ignore the download attribute
      when navigated cross-origin, so an anchor click alone is not enough. */
  const downloadImage = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const resolveAddresses = async () => {
    if (!record) return;
    setAddressBusy(true);
    try {
      const res = await recordsApi.resolveAddress(record.id, true);
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
    } finally {
      setAddressBusy(false);
    }
  };

  /** Save the auditor's QC assessment + audit decision (in-place on this page). */
  const saveAuditAssessment = async () => {
    if (!record || auditSaving) return;
    const coordsChanged = editQcCoordinates.trim() !== (record.coordinates || '').trim();
    const auditorChanged = (assignedAuditorId ? Number(assignedAuditorId) : null) !== (record.assigned_auditor_id || null);
    const commentChanged = auditComment.trim() !== (record.audit_comment || '').trim();
    const qcChanged =
      qcVhr.trim() !== (record.qc_vhr_comment || '').trim() ||
      qcStreet.trim() !== (record.qc_street_details || '').trim() ||
      qcBuilder.trim() !== (record.qc_builder_contact || '').trim() ||
      qcSqfeet.trim() !== (record.qc_sqfeet || '').trim() ||
      commentChanged ||
      auditorChanged;

    const effectiveAuditStatus =
      auditStatus === 'RE_AUDITED' || coordsChanged || qcChanged
        ? 'RE_AUDITED'
        : (auditStatus || 'APPROVAL');

    setAuditSaving(true);
    try {
      await recordsApi.audit(
        record.id,
        effectiveAuditStatus as AuditStatus,
        auditComment.trim() || undefined,
        {
          qc_vhr_comment: qcVhr,
          qc_street_details: qcStreet,
          qc_builder_contact: qcBuilder,
          qc_sqfeet: qcSqfeet,
          coordinates: coordsChanged ? editQcCoordinates.trim() : undefined,
          assigned_auditor_id: assignedAuditorId ? Number(assignedAuditorId) : null,
        }
      );
      const fresh = await recordsApi.get(record.id);
      setRecord(fresh);
      setForm(recordToForm(fresh));
      setAuditStatus((fresh.audit_status as AuditStatus) || '');
      setAuditComment(fresh.audit_comment || '');
      setEditQcCoordinates(fresh.coordinates || '');
      setQcSqfeet(fresh.qc_sqfeet || '');
      setAssignedAuditorId(fresh.assigned_auditor_id ? String(fresh.assigned_auditor_id) : '');
      setIsEditingQc(false);
      setAuditNotice({ ok: true, text: 'Admin / QC decision saved.' });
    } catch (err: any) {
      setAuditNotice({ ok: false, text: err.response?.data?.detail || 'Could not save the QC assessment.' });
    } finally {
      setAuditSaving(false);
    }
  };

  const saveFieldVerification = async () => {
    if (!record || fieldSaving) return;
    setFieldSaving(true);
    setFieldNotice(null);
    try {
      const updated = await recordsApi.update(record.id, {
        construction_happening: fieldDraft.construction_happening || undefined,
        date_of_visit: fieldDraft.date_of_visit || undefined,
        type_of_construction: fieldDraft.type_of_construction.trim() || undefined,
        stage_of_construction: fieldDraft.stage_of_construction.trim() || undefined,
        no_of_floors: fieldDraft.no_of_floors.trim() || undefined,
        built_up_area: fieldDraft.built_up_area.trim() || undefined,
        expected_completion: fieldDraft.expected_completion.trim() || undefined,
        relationship_with_building: fieldDraft.relationship_with_building.trim() || undefined,
        building_user_name: fieldDraft.building_user_name.trim() || undefined,
        spoken_with: fieldDraft.spoken_with.trim() || undefined,
        contact_number: fieldDraft.contact_number.trim() || undefined,
        site_contractor_architect_name: fieldDraft.site_contractor_architect_name.trim() || undefined,
        site_contractor_architect_number: fieldDraft.site_contractor_architect_number.trim() || undefined,
        remarks: fieldDraft.remarks.trim() || undefined,
      });
      setRecord(updated);
      setForm(recordToForm(updated));
      setIsEditingField(false);
      setFieldNotice({ ok: true, text: 'Field verification updated successfully.' });
      fetchActivityLogs();
    } catch (err: any) {
      setFieldNotice({ ok: false, text: err.response?.data?.detail || 'Failed to update field verification.' });
    } finally {
      setFieldSaving(false);
    }
  };

  const saveTelecallerVerification = async () => {
    if (!record || telecallerSaving) return;
    setTelecallerSaving(true);
    setTelecallerNotice(null);
    try {
      const updated = await recordsApi.update(record.id, {
        assigned_telecaller_id: telecallerDraft.assigned_telecaller_id ? Number(telecallerDraft.assigned_telecaller_id) : 0,
        telecaller_status: telecallerDraft.telecaller_status || undefined,
        telecaller_comment: telecallerDraft.telecaller_comment.trim() || undefined,
        telecaller_no_of_floors: telecallerDraft.telecaller_no_of_floors.trim() || undefined,
        telecaller_built_up_area: telecallerDraft.telecaller_built_up_area.trim() || undefined,
        telecaller_expected_completion: telecallerDraft.telecaller_expected_completion.trim() || undefined,
        telecaller_stage_of_construction: telecallerDraft.telecaller_stage_of_construction.trim() || undefined,
      });
      setRecord(updated);
      setIsEditingTelecaller(false);
      setTelecallerNotice({ ok: true, text: 'Telecaller details updated successfully.' });
    } catch (err: any) {
      setTelecallerNotice({ ok: false, text: err.response?.data?.detail || 'Failed to update telecaller details.' });
    } finally {
      setTelecallerSaving(false);
    }
  };

  const uploadReferenceImage = async (file: File | Blob) => {
    if (!record || qcImageUploading) return;
    setQcImageUploading(true);
    setAuditNotice(null);
    try {
      const updated = await recordsApi.uploadQcReferenceImage(record.id, file);
      setRecord(updated);
      setAuditNotice({ ok: true, text: 'QC reference image saved and synced to Google Drive.' });
    } catch (err: any) {
      setAuditNotice({
        ok: false,
        text: err.response?.data?.detail || 'Failed to upload QC reference image.',
      });
    } finally {
      setQcImageUploading(false);
    }
  };

  const deleteReferenceImage = async () => {
    if (!record || qcImageDeleting) return;
    if (!window.confirm('Are you sure you want to remove the QC reference image?')) return;
    setQcImageDeleting(true);
    setAuditNotice(null);
    try {
      const updated = await recordsApi.deleteQcReferenceImage(record.id);
      setRecord(updated);
      setAuditNotice({ ok: true, text: 'QC reference image removed.' });
    } catch (err: any) {
      setAuditNotice({
        ok: false,
        text: err.response?.data?.detail || 'Failed to delete QC reference image.',
      });
    } finally {
      setQcImageDeleting(false);
    }
  };

  useEffect(() => {
    if (!isEditingQc || !record) return;
    const onWindowPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            uploadReferenceImage(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [isEditingQc, record?.id, qcImageUploading]);

  if (loading) {
    return (
      <PageShell>
        <div style={{ marginBottom: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleBack}>
            <Icon name="arrow_back" size={15} /> Return to Records
          </button>
        </div>
        <LoadingPanel text="Loading imported record…" />
      </PageShell>
    );
  }
  if (error || !record) {
    return (
      <PageShell>
        <div style={{ marginBottom: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleBack}>
            <Icon name="arrow_back" size={15} /> Return to Records
          </button>
        </div>
        <div className="state-panel">
          <Icon name="error" size={30} />
          <span>{error || 'Record not found'}</span>
        </div>
      </PageShell>
    );
  }

  const isCompleted = record.status === 'COMPLETED';
  const gpsCount = (record.images || []).filter((i) => i.latitude && i.longitude).length;
  const allFramesLocated = sortedImages.length > 0 && gpsCount === sortedImages.length;

  const hasPlanning = !!(
    record.unique_id ||
    record.land_use ||
    record.survey_no ||
    record.subdivision_no ||
    record.survey_number ||
    record.sub_division ||
    record.owner_name_en ||
    record.taluk ||
    record.village ||
    record.district ||
    record.site_address
  );

  return (
    <>
      <div className="record-screen-container">
        <div className="record-screen-grid">
          {/* LEFT COLUMN — the same ordered fields as the captured-record page */}
          <div className="record-audit-card">
            <Section
              icon="person"
              title="Field Operator"
              action={
                <span className={`rd-chip ${(record.is_manually_added || record.source === 'manual') ? 'rd-chip-neutral' : (isCompleted ? 'rd-chip-ok' : 'rd-chip-warn')}`}>
                  <span className="rd-dot" />
                  {(record.is_manually_added || record.source === 'manual') ? 'Manually Added' : (isCompleted ? 'Completed' : 'Pending')}
                </span>
              }
            >
              <div className="rd-operator">
                <Avatar name={record.user_name || `User ${record.user_id}`} size="md" />
                <div className="rd-operator-meta">
                  <span className="rd-operator-name">
                    {record.user_name || `Field Operator #${record.user_id}`}
                  </span>
                  <span className="rd-operator-sub">Operator ID #{record.user_id}</span>
                </div>
              </div>
            </Section>

            {(record.formatted_address || record.admin_formatted_address || record.location_name) && (
              <Section
                icon="location_on"
                title="Site & Location"
                action={
                  <button
                    type="button"
                    className="rd-inline-toggle"
                    onClick={resolveAddresses}
                    disabled={addressBusy}
                    title="Resolve the stored addresses from the given coordinates"
                  >
                    <span>{addressBusy ? 'Resolving…' : 'Resolve address'}</span>
                    <Icon name={addressBusy ? 'refresh' : 'my_location'} size={14} />
                  </button>
                }
              >
                <div className="site-location-two-col-grid">
                  {record.formatted_address ? (
                    <div className="site-location-card">
                      <div className="site-location-val">
                        {enName(record.formatted_address)}
                      </div>
                      <div className="site-location-title">Field Inspection Address</div>
                    </div>
                  ) : null}
                  {record.admin_formatted_address ? (
                    <div className="site-location-card">
                      <div className="site-location-val">
                        {enName(record.admin_formatted_address)}
                      </div>
                      <div className="site-location-title">Admin Given Address</div>
                    </div>
                  ) : null}
                  {record.location_name ? (
                    <div className="site-location-card" style={{ gridColumn: '1 / -1' }}>
                      <div className="site-location-val">{enName(record.location_name)}</div>
                      <div className="site-location-title">Place Name</div>
                    </div>
                  ) : null}
                </div>
              </Section>
            )}

            {hasPlanning && (
              <Section icon="receipt_long" title="Imported Details">
                <div className="rd-rows">
                  <Row label="Unique ID" value={record.unique_id} mono />
                  <Row label="Source" value={<SourceBadge source={record.source} isManual={record.is_manually_added} />} />
                  <Row label="Survey No" value={record.survey_no || record.survey_number} />
                  <Row label="Subdivision No" value={record.subdivision_no || record.sub_division} />
                  
                  <Row label="Land Type / Land Use" value={record.land_use} />
                  <Row label="Owner Name" value={record.owner_name_en} wide />
                  <Row label="Taluk" value={record.taluk} />
                  <Row label="Village" value={record.village} />
                  <Row label="District" value={record.district} />
                  {record.priority_tier && <Row label="Priority Tier" value={record.priority_tier} />}
                  <Row label="Govt DTCP Permit" value={record.govt_dtcp_permit ? 'Yes (Granted)' : (record.govt_dtcp_permit === false ? 'No' : undefined)} />
                  {record.dtcp_application_no && <Row label="DTCP Application No" value={record.dtcp_application_no} />}
                  {record.dtcp_permit_date && <Row label="DTCP Permit Date" value={record.dtcp_permit_date} />}
                  <Row label="Site Address" value={record.site_address} wide />
                </div>
              </Section>
            )}

            {/* Audit decision + QC assessment */}
            <Section
              icon="fact_check"
              title="Audit & QC Assessment Details"
              boxed
              badges={
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {(record.qc_edited_at || record.audit_status === 'RE_AUDITED') && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        background: '#fef3c7',
                        color: '#92400e',
                        border: '1px solid #fde68a',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 9999,
                        letterSpacing: '0.02em',
                      }}
                    >
                      Edited
                    </span>
                  )}
                  <AuditStatusChip status={record.audit_status} />
                </div>
              }
              action={
                <div className="fancy-action-btn-group">
                  <button
                    type="button"
                    className="fancy-btn-history"
                    onClick={() => setShowQcHistoryModal(true)}
                    title="View QC Assessment & Audit Decision history"
                  >
                    <Icon name="history" size={13} />
                    <span>QC Audit Details History</span>
                  </button>
                  <button
                    type="button"
                    className={`fancy-btn-edit${isEditingQc ? ' active' : ''}`}
                    onClick={() => {
                      if (isEditingQc) {
                        setIsEditingQc(false);
                        setAuditNotice(null);
                      } else {
                        setIsEditingQc(true);
                      }
                    }}
                    title="Edit QC assessment and decision"
                  >
                    <Icon name={isEditingQc ? 'close' : 'edit'} size={13} />
                    <span>{isEditingQc ? 'Close Edit' : 'Edit QC & Decision'}</span>
                  </button>
                </div>
              }
            >
              {!isEditingQc ? (
                <>
                  <FourColumnTable
                    fields={[
                      { key: 'auditor', label: 'Assigned QA / QC User', value: record.assigned_auditor_name || record.qc_by_name || 'Not assigned' },
                      { key: 'qc_done', label: 'QC Completed At', value: record.qc_completed_at ? formatDateTime(record.qc_completed_at) : '—' },
                      { key: 'by', label: 'Audited By', value: record.audited_by_name ?? 'Not audited yet' },
                      { key: 'qc_vhr', label: 'QC Comments (VHR Imagery)', value: record.qc_vhr_comment ?? 'No QC assessment recorded' },
                      { key: 'qc_street', label: 'QC Additional Details (Street View)', value: record.qc_street_details ?? '—' },
                      { key: 'qc_contact', label: 'Builder / Contact (Street View)', value: record.qc_builder_contact ?? '—' },
                      { key: 'sqfeet', label: 'Sq.ft', value: record.qc_sqfeet ?? '—' },
                      { key: 'coords', label: 'QC Coordinates', value: record.coordinates ? prettyCoords(record.coordinates) : '—' },
                      { key: 'audit_comment', label: 'Audit Comments', value: record.audit_comment ?? '—' },
                      { key: 'last_mod', label: 'Last Modified Date', value: (record.last_modified_at || record.reassigned_at || record.assigned_at || record.created_at) ? formatDateTime(record.last_modified_at || record.reassigned_at || record.assigned_at || record.created_at) : '—' },
                    ]}
                  />

                  {record.qc_reference_image_url && (
                    <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: 10, marginTop: 12, display: 'flex', alignItems: 'center', gap: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
                      <div
                        style={{ position: 'relative', width: 90, height: 70, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: '1px solid #cbd5e1', flexShrink: 0, background: '#0f172a' }}
                        onClick={() => setRefViewerUrl(`${SERVER_BASE}${record.qc_reference_image_url}`)}
                        title="Click to view full image"
                      >
                        <img
                          src={`${SERVER_BASE}${record.qc_reference_image_url}?thumb=true`}
                          alt="QC Reference"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `${SERVER_BASE}${record.qc_reference_image_url}`;
                          }}
                        />
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="zoom_in" size={20} style={{ color: '#fff' }} />
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1e293b' }}>QC Reference Image</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', color: '#16a34a', fontWeight: 600 }}>
                            <Icon name="cloud_done" size={13} /> GDrive Synced
                          </span>
                        </div>
                        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Visible to Admin and Field Verifiers in the mobile app</span>
                        <div style={{ marginTop: 2 }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => setRefViewerUrl(`${SERVER_BASE}${record.qc_reference_image_url}`)}
                            style={{ fontSize: '0.75rem', height: 24, padding: '0 8px' }}
                          >
                            <Icon name="visibility" size={12} /> View Full Image
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ marginTop: 12, padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon name="edit" size={15} style={{ color: '#0284c7' }} />
                        <strong style={{ fontSize: '0.74rem', letterSpacing: '0.05em', color: '#0369a1', textTransform: 'uppercase' }}>
                          Record QC Assessment & Decision (Editing)
                        </strong>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', height: 26, padding: '0 8px', color: '#64748b' }}
                        onClick={() => {
                          setIsEditingQc(false);
                          setQcVhr(record.qc_vhr_comment || '');
                          setQcStreet(record.qc_street_details || '');
                          setQcBuilder(record.qc_builder_contact || '');
                          setQcSqfeet(record.qc_sqfeet || '');
                          setAuditComment(record.audit_comment || '');
                          setAuditStatus((record.audit_status as AuditStatus) || '');
                          setEditQcCoordinates(record.coordinates || '');
                          setShowPinPicker(false);
                          setAuditNotice(null);
                        }}
                      >
                        <Icon name="close" size={13} />
                        <span>Cancel</span>
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px 14px', alignItems: 'start' }}>
                      <div>
                        <label className="sub-field-label" htmlFor="imp-qc-vhr">QC Comments (VHR Imagery)</label>
                        <CustomSelect
                          value={qcVhr}
                          onChange={(val) => {
                            setQcVhr(val);
                            setAuditStatus('RE_AUDITED');
                          }}
                          options={[
                            { value: '', label: 'Select comments' },
                            ...(qcVhr && !QC_VHR_OPTIONS.some((o) => o.toLowerCase() === qcVhr.trim().toLowerCase())
                              ? [{ value: qcVhr.trim(), label: qcVhr.trim() }]
                              : []),
                            ...QC_VHR_OPTIONS.map((o) => ({ value: o, label: o })),
                          ]}
                          ariaLabel="QC comments from VHR imagery"
                        />
                      </div>
                      <div>
                        <label className="sub-field-label" htmlFor="imp-qc-street">Street view comments</label>
                        <CustomSelect
                          value={qcStreet}
                          onChange={(val) => {
                            setQcStreet(val);
                            setAuditStatus('RE_AUDITED');
                          }}
                          options={[
                            { value: '', label: 'Select comments' },
                            ...(qcStreet && !QC_STREET_OPTIONS.some((o) => o.toLowerCase() === qcStreet.trim().toLowerCase())
                              ? [{ value: qcStreet.trim(), label: qcStreet.trim() }]
                              : []),
                            ...QC_STREET_OPTIONS.map((o) => ({ value: o, label: o })),
                          ]}
                          ariaLabel="QC comments from Street view"
                        />
                      </div>
                      <div>
                        <label className="sub-field-label" htmlFor="imp-qc-builder">Builder / Contact Details (if seen in Street View)</label>
                        <input
                          id="imp-qc-builder"
                          type="text"
                          className="fld"
                          maxLength={2000}
                          placeholder="e.g. G Square, 089395 40008"
                          value={qcBuilder}
                          onChange={(e) => {
                            setQcBuilder(e.target.value);
                            setAuditStatus('RE_AUDITED');
                          }}
                        />
                      </div>
                      <div>
                        <label className="sub-field-label" htmlFor="imp-qc-sqfeet">Sq.ft</label>
                        <input
                          id="imp-qc-sqfeet"
                          type="text"
                          className="fld"
                          maxLength={50}
                          placeholder="e.g. 1500, 2400 sq.ft"
                          value={qcSqfeet}
                          onChange={(e) => {
                            setQcSqfeet(e.target.value);
                            setAuditStatus('RE_AUDITED');
                          }}
                        />
                      </div>

                      <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: 10, display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Icon name="pin_drop" size={14} style={{ color: '#0284c7' }} />
                            <strong style={{ fontSize: '0.72rem', letterSpacing: '0.05em', color: '#0369a1', textTransform: 'uppercase' }}>
                              QC Coordinates (Edit if wrong)
                            </strong>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            style={{ fontSize: '0.75rem', height: 26, padding: '0 8px' }}
                            onClick={() => setShowPinPicker(!showPinPicker)}
                          >
                            <Icon name={showPinPicker ? 'expand_less' : 'map'} size={13} />
                            {showPinPicker ? 'Hide pin map' : 'Edit pin location'}
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            id="imp-qc-coordinates"
                            type="text"
                            className="fld"
                            style={{ fontFamily: 'monospace', fontSize: '0.85rem', flex: '1 1 240px', minWidth: 200 }}
                            placeholder="Latitude, Longitude (e.g. 11.016844, 76.955832)"
                            value={editQcCoordinates}
                            onChange={(e) => {
                              setEditQcCoordinates(e.target.value);
                              setAuditStatus('RE_AUDITED');
                            }}
                          />
                          {(editQcCoordinates.trim() !== (record.coordinates || '').trim() ||
                            qcVhr.trim() !== (record.qc_vhr_comment || '').trim() ||
                            qcStreet.trim() !== (record.qc_street_details || '').trim() ||
                            qcBuilder.trim() !== (record.qc_builder_contact || '').trim() ||
                            qcSqfeet.trim() !== (record.qc_sqfeet || '').trim()) && (
                            <span style={{ fontSize: '0.75rem', color: '#0284c7', fontWeight: 600, whiteSpace: 'nowrap', background: '#e0f2fe', padding: '4px 8px', borderRadius: 6 }}>
                              QC / Coordinates edited (Re-Audit)
                            </span>
                          )}
                        </div>
                        {showPinPicker && (() => {
                          const parts = (editQcCoordinates || record.coordinates || '').split(',').map((s) => parseFloat(s.trim()));
                          const lat = !isNaN(parts[0]) ? parts[0] : 11.016844;
                          const lng = !isNaN(parts[1]) ? parts[1] : 76.955832;
                          return (
                            <div style={{ marginTop: 6, borderRadius: 8, overflow: 'hidden', border: '1px solid #cbd5e1' }}>
                              <CoordinateMap
                                latitude={lat}
                                longitude={lng}
                                height={200}
                                editable={true}
                                onCoordinatesChange={(newCoords) => {
                                  setEditQcCoordinates(newCoords);
                                  setAuditStatus('RE_AUDITED');
                                }}
                              />
                            </div>
                          );
                        })()}
                      </div>

                      <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, gridColumn: '1 / -1' }}>
                        <div style={{ display: 'grid', gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Icon name="badge" size={14} style={{ color: '#0284c7' }} />
                            <strong style={{ fontSize: '0.75rem', letterSpacing: '0.05em', color: '#0369a1', textTransform: 'uppercase' }}>
                              Assigned QA / QC User
                            </strong>
                          </div>
                          <div
                            style={{
                              minHeight: 38,
                              padding: '8px 12px',
                              background: '#f8fafc',
                              border: '1px solid #cbd5e1',
                              borderRadius: 6,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              fontSize: '0.85rem',
                              fontWeight: 500,
                              color: '#0f172a',
                            }}
                          >
                            <span>
                              {(() => {
                                const found = auditors.find((a) => String(a.id) === String(assignedAuditorId));
                                if (found) {
                                  return `${found.full_name || found.email}${found.role ? ` (${found.role})` : ''}`;
                                }
                                return (
                                  record.assigned_auditor_name ||
                                  record.qc_by_name ||
                                  (assignedAuditorId ? `Auditor #${assignedAuditorId}` : 'Unassigned')
                                );
                              })()}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Icon name="fact_check" size={14} style={{ color: '#c2410c' }} />
                            <strong style={{ fontSize: '0.75rem', letterSpacing: '0.05em', color: '#9a3412', textTransform: 'uppercase' }}>
                              Audit Decision
                            </strong>
                          </div>
                          <CustomSelect
                            value={auditStatus}
                            onChange={(val) => setAuditStatus(val as AuditStatus | '')}
                            options={[{ value: '', label: 'Select Decision' }, ...AUDIT_OPTIONS]}
                            ariaLabel={`Audit status for record ${record.unique_id || record.id}`}
                          />
                        </div>

                        <div style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Icon name="comment" size={14} style={{ color: '#0369a1' }} />
                            <strong style={{ fontSize: '0.75rem', letterSpacing: '0.05em', color: '#0369a1', textTransform: 'uppercase' }}>
                              Audit Comments / Remarks
                            </strong>
                          </div>
                          <textarea
                            id="rd-qc-audit-comment-imp"
                            className="fld"
                            rows={2}
                            maxLength={2000}
                            placeholder="Enter audit remarks, approval justification, or instructions..."
                            value={auditComment}
                            onChange={(e) => {
                              setAuditComment(e.target.value);
                              setAuditStatus('RE_AUDITED');
                            }}
                          />
                        </div>
                      </div>

                      {/* QC Reference Image Section with Paste (Ctrl+V) & Browse & GDrive Sync */}
                      <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: 12, marginTop: 4, display: 'grid', gap: 8, gridColumn: '1 / -1' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Icon name="photo_camera" size={15} style={{ color: '#0284c7' }} />
                            <strong style={{ fontSize: '0.72rem', letterSpacing: '0.05em', color: '#0369a1', textTransform: 'uppercase' }}>
                              QC Reference Image
                            </strong>
                            <span style={{ fontSize: '0.7rem', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                              Google Drive Synced
                            </span>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            Paste screenshot (Ctrl+V) or browse image
                          </span>
                        </div>

                        {record.qc_reference_image_url ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
                            <div
                              style={{ position: 'relative', width: 90, height: 70, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: '1px solid #cbd5e1', flexShrink: 0, background: '#0f172a' }}
                              onClick={() => setRefViewerUrl(`${SERVER_BASE}${record.qc_reference_image_url}`)}
                              title="Click to view full image"
                            >
                              <img
                                src={`${SERVER_BASE}${record.qc_reference_image_url}?thumb=true`}
                                alt="QC Reference"
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = `${SERVER_BASE}${record.qc_reference_image_url}`;
                                }}
                              />
                              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Icon name="zoom_in" size={20} style={{ color: '#fff' }} />
                              </div>
                            </div>

                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1e293b' }}>Reference Image Attached</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', color: '#16a34a', fontWeight: 600 }}>
                                <Icon name="cloud_done" size={13} /> Saved in GDrive & Server
                                </span>
                              </div>
                              <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b' }}>
                                Visible in Admin & Field Verifier portals.
                              </p>
                              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs"
                                  onClick={() => setRefViewerUrl(`${SERVER_BASE}${record.qc_reference_image_url}`)}
                                  style={{ fontSize: '0.75rem', height: 26, padding: '0 8px' }}
                                >
                                  <Icon name="visibility" size={13} /> View
                                </button>
                                <label
                                  className="btn btn-ghost btn-xs"
                                  style={{ fontSize: '0.75rem', height: 26, padding: '0 8px', cursor: 'pointer', margin: 0 }}
                                >
                                  <Icon name="upload" size={13} /> Replace
                                  <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) uploadReferenceImage(f);
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs"
                                  onClick={deleteReferenceImage}
                                  disabled={qcImageDeleting}
                                  style={{ fontSize: '0.75rem', height: 26, padding: '0 8px', color: '#dc2626' }}
                                >
                                  <Icon name="delete" size={13} /> {qcImageDeleting ? 'Removing…' : 'Remove'}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div
                            tabIndex={0}
                            onPaste={(e) => {
                              const items = e.clipboardData?.items;
                              if (!items) return;
                              for (let i = 0; i < items.length; i++) {
                                if (items[i].type.indexOf('image') !== -1) {
                                  const f = items[i].getAsFile();
                                  if (f) {
                                    e.preventDefault();
                                    uploadReferenceImage(f);
                                    break;
                                  }
                                }
                              }
                            }}
                            onDragOver={(e) => { e.preventDefault(); setIsDraggingRef(true); }}
                            onDragLeave={() => setIsDraggingRef(false)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setIsDraggingRef(false);
                              const f = e.dataTransfer.files?.[0];
                              if (f && f.type.startsWith('image/')) uploadReferenceImage(f);
                            }}
                            style={{
                              border: isDraggingRef ? '2px dashed #0284c7' : '2px dashed #cbd5e1',
                              borderRadius: 8,
                              padding: '14px 16px',
                              textAlign: 'center',
                              background: isDraggingRef ? '#f0f9ff' : '#f8fafc',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              outline: 'none',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 5,
                            }}
                            onClick={() => refFileInputRef.current?.click()}
                          >
                            <input
                              ref={refFileInputRef}
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) uploadReferenceImage(f);
                                e.target.value = '';
                              }}
                            />
                            {qcImageUploading ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0284c7' }}>
                                <Icon name="refresh" size={18} className="fos-spin" />
                                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Uploading & syncing to Google Drive…</span>
                              </div>
                            ) : (
                              <>
                                <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <Icon name="add_photo_alternate" size={18} />
                                </div>
                                <div>
                                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1e293b' }}>
                                    Paste image (Ctrl+V) or click to browse
                                  </span>
                                  <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: '#64748b' }}>
                                    Copy screenshot or image file, then paste here. Automatically uploads to Google Drive.
                                  </p>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, gridColumn: '1 / -1', alignSelf: 'end' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={saveAuditAssessment}
                          disabled={auditSaving}
                        >
                          {auditSaving ? <Icon name="refresh" size={13} className="fos-spin" /> : <Icon name="save" size={13} />}
                          Save QC & Decision
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setIsEditingQc(false);
                            setQcVhr(record.qc_vhr_comment || '');
                            setQcStreet(record.qc_street_details || '');
                            setQcBuilder(record.qc_builder_contact || '');
                            setQcSqfeet(record.qc_sqfeet || '');
                            setAuditComment(record.audit_comment || '');
                            setAuditStatus((record.audit_status as AuditStatus) || '');
                            setEditQcCoordinates(record.coordinates || '');
                            setShowPinPicker(false);
                            setAuditNotice(null);
                          }}
                          disabled={auditSaving}
                        >
                          Cancel
                        </button>
                        {auditNotice && (
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: auditNotice.ok ? '#059669' : '#dc2626' }}>
                            {auditNotice.text}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
            </Section>

            {/* Field Verification */}
            {(() => {
              const effectiveCapturedAt = (() => {
                const imgDate = record.images?.length ? record.images[0]?.captured_at : null;
                const fieldDate = record.field_captured_at;
                if (imgDate && fieldDate) {
                  try {
                    return new Date(imgDate).getTime() >= new Date(fieldDate).getTime() ? imgDate : fieldDate;
                  } catch {
                    return fieldDate || imgDate;
                  }
                }
                return imgDate || fieldDate || record.date_of_visit;
              })();

              return (
                <Section
                  icon="assignment_turned_in"
                  title="Field Verification"
                  boxed
                  action={
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {record.construction_happening ? (
                        <span
                          className={`rd-chip ${
                            record.construction_happening === 'Yes' ? 'rd-chip-ok' : 'rd-chip-neutral'
                          }`}
                        >
                          <span className="rd-dot" />
                          {record.construction_happening === 'Yes' ? 'Active Construction' : 'No Construction'}
                        </span>
                      ) : undefined}
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: '0.75rem',
                          height: 26,
                          padding: '0 10px',
                          borderRadius: 6,
                          fontWeight: 600,
                          color: '#334155',
                          borderColor: '#cbd5e1',
                          background: '#ffffff',
                        }}
                        onClick={() => setShowEditHistoryModal(true)}
                        title="View Field Verification history and previous inspection details"
                      >
                        <Icon name="history" size={13} />
                        <span>Field Verification History</span>
                      </button>
                      {canAdmin && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: '0.75rem',
                            height: 26,
                            padding: '0 10px',
                            borderRadius: 6,
                            fontWeight: 600,
                            color: '#0369a1',
                            borderColor: '#bae6fd',
                            background: '#f0f9ff',
                          }}
                          onClick={() => {
                            setFieldDraft({
                              construction_happening: record.construction_happening || 'Yes',
                              date_of_visit: record.date_of_visit || '',
                              type_of_construction: record.type_of_construction || '',
                              stage_of_construction: record.stage_of_construction || '',
                              no_of_floors: record.no_of_floors || '',
                              built_up_area: record.built_up_area || '',
                              expected_completion: record.expected_completion || '',
                              relationship_with_building: record.relationship_with_building || '',
                              building_user_name: record.building_user_name || '',
                              spoken_with: record.spoken_with || '',
                              contact_number: record.contact_number || '',
                              site_contractor_architect_name: record.site_contractor_architect_name || '',
                              site_contractor_architect_number: record.site_contractor_architect_number || '',
                              remarks: record.remarks || '',
                            });
                            setIsEditingField((prev) => !prev);
                            setFieldNotice(null);
                          }}
                          title="Edit Field Verification details"
                        >
                          <Icon name="edit" size={13} />
                          <span>{isEditingField ? 'Close Edit' : 'Edit Field Verification'}</span>
                        </button>
                      )}
                    </div>
                  }
                >
                  {isEditingField ? (
                    <div style={{ padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Icon name="edit" size={16} style={{ color: '#0284c7' }} />
                          <strong style={{ fontSize: '0.78rem', letterSpacing: '0.05em', color: '#0369a1', textTransform: 'uppercase' }}>
                            Edit Field Verification Details
                          </strong>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          style={{ color: '#64748b' }}
                          onClick={() => {
                            setIsEditingField(false);
                            setFieldNotice(null);
                          }}
                        >
                          <Icon name="close" size={13} /> Cancel
                        </button>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px 16px' }}>
                        <div>
                          <label className="sub-field-label" style={{ display: 'block', marginBottom: 4 }}>
                            Construction Happening
                          </label>
                          <CustomSelect
                            value={fieldDraft.construction_happening}
                            onChange={(val) => setFieldDraft((d) => ({ ...d, construction_happening: val }))}
                            options={[
                              { value: 'Yes', label: 'Yes - Active Construction' },
                              { value: 'No', label: 'No - No Construction' },
                            ]}
                            ariaLabel="Construction Happening"
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="imp-fld-date-visit" style={{ display: 'block', marginBottom: 4 }}>
                            Date of Visit
                          </label>
                          <input
                            id="imp-fld-date-visit"
                            type="date"
                            className="fld"
                            value={fieldDraft.date_of_visit}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, date_of_visit: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" style={{ display: 'block', marginBottom: 4 }}>
                            Type of Construction
                          </label>
                          <CustomSelect
                            value={CONSTRUCTION_TYPES.includes(fieldDraft.type_of_construction) ? fieldDraft.type_of_construction : (fieldDraft.type_of_construction ? 'Other' : '')}
                            onChange={(val) => {
                              if (val === 'Other') {
                                if (CONSTRUCTION_TYPES.includes(fieldDraft.type_of_construction)) {
                                  setFieldDraft((d) => ({ ...d, type_of_construction: '' }));
                                }
                              } else {
                                setFieldDraft((d) => ({ ...d, type_of_construction: val }));
                              }
                            }}
                            options={[
                              { value: '', label: 'Select Type' },
                              ...CONSTRUCTION_TYPES.map((t) => ({ value: t, label: t })),
                            ]}
                            ariaLabel="Type of Construction"
                          />
                          {(!CONSTRUCTION_TYPES.includes(fieldDraft.type_of_construction) || fieldDraft.type_of_construction === 'Other') && (
                            <input
                              type="text"
                              className="fld"
                              style={{ marginTop: 6 }}
                              placeholder="Specify construction type..."
                              value={fieldDraft.type_of_construction === 'Other' ? '' : fieldDraft.type_of_construction}
                              onChange={(e) => setFieldDraft((d) => ({ ...d, type_of_construction: e.target.value }))}
                            />
                          )}
                        </div>

                        <div>
                          <label className="sub-field-label" style={{ display: 'block', marginBottom: 4 }}>
                            Stage of Construction
                          </label>
                          <CustomSelect
                            value={STAGES_OF_CONSTRUCTION.includes(fieldDraft.stage_of_construction) ? fieldDraft.stage_of_construction : (fieldDraft.stage_of_construction ? 'Other' : '')}
                            onChange={(val) => {
                              if (val === 'Other') {
                                if (STAGES_OF_CONSTRUCTION.includes(fieldDraft.stage_of_construction)) {
                                  setFieldDraft((d) => ({ ...d, stage_of_construction: '' }));
                                }
                              } else {
                                setFieldDraft((d) => ({ ...d, stage_of_construction: val }));
                              }
                            }}
                            options={[
                              { value: '', label: 'Select Stage' },
                              ...STAGES_OF_CONSTRUCTION.map((s) => ({ value: s, label: s })),
                            ]}
                            ariaLabel="Stage of Construction"
                          />
                          {(!STAGES_OF_CONSTRUCTION.includes(fieldDraft.stage_of_construction) || fieldDraft.stage_of_construction === 'Other') && (
                            <input
                              type="text"
                              className="fld"
                              style={{ marginTop: 6 }}
                              placeholder="Specify construction stage..."
                              value={fieldDraft.stage_of_construction === 'Other' ? '' : fieldDraft.stage_of_construction}
                              onChange={(e) => setFieldDraft((d) => ({ ...d, stage_of_construction: e.target.value }))}
                            />
                          )}
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="imp-fld-no-floors" style={{ display: 'block', marginBottom: 4 }}>
                            No. of Floors
                          </label>
                          <input
                            id="imp-fld-no-floors"
                            type="text"
                            className="fld"
                            placeholder="e.g. G+1, G+2..."
                            value={fieldDraft.no_of_floors}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, no_of_floors: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="imp-fld-built-up-area" style={{ display: 'block', marginBottom: 4 }}>
                            Built-up Area (Sq.ft)
                          </label>
                          <input
                            id="imp-fld-built-up-area"
                            type="text"
                            className="fld"
                            placeholder="e.g. 2400 sq.ft"
                            value={fieldDraft.built_up_area}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, built_up_area: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="imp-fld-expected-completion" style={{ display: 'block', marginBottom: 4 }}>
                            Expected Completion
                          </label>
                          <input
                            id="imp-fld-expected-completion"
                            type="text"
                            className="fld"
                            placeholder="e.g. Dec 2025"
                            value={fieldDraft.expected_completion}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, expected_completion: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="imp-fld-rel-bldg" style={{ display: 'block', marginBottom: 4 }}>
                            Relationship with Building
                          </label>
                          <input
                            id="imp-fld-rel-bldg"
                            type="text"
                            className="fld"
                            list="imp-rd-rel-options-list"
                            placeholder="e.g. Owner, Contractor, Architect..."
                            value={fieldDraft.relationship_with_building}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, relationship_with_building: e.target.value }))}
                          />
                          <datalist id="imp-rd-rel-options-list">
                            {RELATIONSHIP_OPTIONS.map((o) => (
                              <option key={o} value={o} />
                            ))}
                          </datalist>
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="imp-fld-bldg-user" style={{ display: 'block', marginBottom: 4 }}>
                            Building User Name
                          </label>
                          <input
                            id="imp-fld-bldg-user"
                            type="text"
                            className="fld"
                            placeholder="e.g. Rajesh Kumar"
                            value={fieldDraft.building_user_name}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, building_user_name: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="imp-fld-spoken-with" style={{ display: 'block', marginBottom: 4 }}>
                            Spoken With
                          </label>
                          <input
                            id="imp-fld-spoken-with"
                            type="text"
                            className="fld"
                            list="imp-rd-spoken-options-list"
                            placeholder="e.g. Owner, Engineer, Supervisor..."
                            value={fieldDraft.spoken_with}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, spoken_with: e.target.value }))}
                          />
                          <datalist id="imp-rd-spoken-options-list">
                            {SPOKEN_WITH_OPTIONS.map((o) => (
                              <option key={o} value={o} />
                            ))}
                          </datalist>
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="imp-fld-contact-num" style={{ display: 'block', marginBottom: 4 }}>
                            Contact Number
                          </label>
                          <input
                            id="imp-fld-contact-num"
                            type="tel"
                            className="fld"
                            placeholder="e.g. 9876543210"
                            value={fieldDraft.contact_number}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, contact_number: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="imp-fld-contractor-name" style={{ display: 'block', marginBottom: 4 }}>
                            Site Contractor / Architect Name
                          </label>
                          <input
                            id="imp-fld-contractor-name"
                            type="text"
                            className="fld"
                            placeholder="e.g. V-Build Constructions"
                            value={fieldDraft.site_contractor_architect_name}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, site_contractor_architect_name: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="imp-fld-contractor-num" style={{ display: 'block', marginBottom: 4 }}>
                            Site Contractor / Architect Number
                          </label>
                          <input
                            id="imp-fld-contractor-num"
                            type="tel"
                            className="fld"
                            placeholder="e.g. 9876543210"
                            value={fieldDraft.site_contractor_architect_number}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, site_contractor_architect_number: e.target.value }))}
                          />
                        </div>

                        <div style={{ gridColumn: '1 / -1' }}>
                          <label className="sub-field-label" htmlFor="imp-fld-remarks" style={{ display: 'block', marginBottom: 4 }}>
                            Inspection Remarks / Notes
                          </label>
                          <textarea
                            id="imp-fld-remarks"
                            className="fld"
                            rows={2}
                            maxLength={3000}
                            placeholder="Enter on-site observations or notes..."
                            value={fieldDraft.remarks}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, remarks: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={saveFieldVerification}
                          disabled={fieldSaving}
                        >
                          {fieldSaving ? <Icon name="refresh" size={13} className="fos-spin" /> : <Icon name="save" size={13} />}
                          Save Field Verification
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setIsEditingField(false);
                            setFieldNotice(null);
                          }}
                          disabled={fieldSaving}
                        >
                          Cancel
                        </button>
                        {fieldNotice && (
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: fieldNotice.ok ? '#059669' : '#dc2626' }}>
                            {fieldNotice.text}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {!record.user_id && !record.reassigned_to_id && !record.date_of_visit && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.78rem', color: '#64748b', marginBottom: 10 }}>
                          <Icon name="info" size={15} style={{ color: '#0284c7' }} />
                          <span>Field verifier not yet assigned. On-site verification details will be recorded after assignment.</span>
                        </div>
                      )}
                      <FourColumnTable
                        fields={[
                          {
                            key: 'op_name',
                            label: 'Field Verifier',
                            value: record.reassigned_to_name
                              ? `${record.reassigned_to_name}${record.user_name && record.user_name !== record.reassigned_to_name ? ` (Reassigned from ${record.user_name})` : ''}`
                              : (record.user_name ? record.user_name : 'Not assigned yet'),
                          },
                          {
                            key: 'assigned_at',
                            label: 'Date of Visit / Assigned',
                            value: record.date_of_visit
                              ? record.date_of_visit
                              : ((record.user_id || record.reassigned_to_id) && record.assigned_at ? formatDateTime(record.assigned_at) : undefined),
                          },
                          {
                            key: 'v_status',
                            label: 'Verification Status',
                            value: (() => {
                              if (!record.user_id && !record.reassigned_to_id && !record.date_of_visit && (record.status === 'NOT_COMPLETED' || !record.status)) {
                                return 'Not Assigned';
                              }
                              const s = (record.status || '').toUpperCase();
                              if (s === 'COMPLETED' || record.revisit_status === 'COMPLETED') return 'Completed';
                              if (s === 'UPDATED_REVISITED' || s === 'UPDATED REVISITED') return 'Completed (Revisited)';
                              if (s === 'NOT_INTERESTED' || s === 'NOT INTERESTED') return 'Not Interested';
                              if (s === 'DUPLICATE') return 'Duplicate';
                              if (s === 'CONSTRUCTION_FINISHED' || s === 'CONSTRUCTION FINISHED') return 'Construction Finished';
                              if (record.user_id || record.reassigned_to_id) return 'Assigned';
                              return 'Pending';
                            })(),
                          },
                          {
                            key: 'captured_at',
                            label: 'Captured or Inspection Completed',
                            value: effectiveCapturedAt ? formatDateTime(effectiveCapturedAt) : undefined,
                          },
                          { key: 'type_const', label: 'Type of Construction', value: record.type_of_construction },
                          { key: 'stage_const', label: 'Stage of Construction', value: record.stage_of_construction },
                          { key: 'floors', label: 'No of Floors', value: record.no_of_floors },
                          { key: 'built_up', label: 'Built up area', value: record.built_up_area },
                          { key: 'exp_comp', label: 'Expected Completion', value: record.expected_completion },
                          { key: 'rel_bldg', label: 'Relationship with Building', value: record.relationship_with_building },
                          { key: 'user_bldg', label: 'Building User', value: record.building_user_name },
                          { key: 'spoken_with', label: 'Spoken With', value: record.spoken_with },
                          { key: 'contact', label: 'Contact Number', value: record.contact_number },
                          { key: 'contractor', label: 'Contractor / Architect', value: record.site_contractor_architect_name },
                          { key: 'remarks', label: 'Inspection Remarks', value: record.remarks },
                          { key: 'contr_contact', label: 'Contractor Contact', value: record.site_contractor_architect_number },
                        ]}
                      />
                      {fieldNotice && (
                        <div style={{ marginTop: 8, fontSize: '0.8rem', fontWeight: 600, color: fieldNotice.ok ? '#059669' : '#dc2626' }}>
                          {fieldNotice.text}
                        </div>
                      )}
                    </>
                  )}
                </Section>
              );
            })()}

            {/* Telecaller Verification & Notes */}
            <Section
              icon="call"
              title="Telecaller Verification"
              boxed
              action={
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {record.telecaller_status ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 8px',
                        borderRadius: 9999,
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: record.telecaller_status === 'CONSTRUCTION_CONFIRMED' ? '#ecfdf5' : '#eff6ff',
                        color: record.telecaller_status === 'CONSTRUCTION_CONFIRMED' ? '#059669' : '#1d4ed8',
                        border: `1px solid ${record.telecaller_status === 'CONSTRUCTION_CONFIRMED' ? '#a7f3d0' : '#bfdbfe'}`,
                      }}
                    >
                      <Icon name={record.telecaller_status === 'CONSTRUCTION_CONFIRMED' ? 'check_circle' : 'call'} size={13} />
                      {record.telecaller_status.replace(/_/g, ' ')}
                    </span>
                  ) : undefined}
                  {(canAdmin || canAudit) && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: '0.75rem',
                        height: 26,
                        padding: '0 10px',
                        borderRadius: 6,
                        fontWeight: 600,
                        color: '#0369a1',
                        borderColor: '#bae6fd',
                        background: '#f0f9ff',
                      }}
                      onClick={() => {
                        setTelecallerDraft({
                          assigned_telecaller_id: record.assigned_telecaller_id ? String(record.assigned_telecaller_id) : '',
                          telecaller_status: record.telecaller_status || 'PENDING',
                          telecaller_comment: record.telecaller_comment || '',
                          telecaller_no_of_floors: record.telecaller_no_of_floors || '',
                          telecaller_built_up_area: record.telecaller_built_up_area || '',
                          telecaller_expected_completion: record.telecaller_expected_completion || '',
                          telecaller_stage_of_construction: record.telecaller_stage_of_construction || '',
                        });
                        setIsEditingTelecaller((prev) => !prev);
                        setTelecallerNotice(null);
                      }}
                      title="Edit Telecaller Verification details"
                    >
                      <Icon name="edit" size={13} />
                      <span>{isEditingTelecaller ? 'Close Edit' : 'Edit Telecaller Details'}</span>
                    </button>
                  )}
                </div>
              }
            >
              {isEditingTelecaller ? (
                <div style={{ padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="edit" size={16} style={{ color: '#0284c7' }} />
                      <strong style={{ fontSize: '0.78rem', letterSpacing: '0.05em', color: '#0369a1', textTransform: 'uppercase' }}>
                        Edit Telecaller Verification
                      </strong>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      style={{ color: '#64748b' }}
                      onClick={() => {
                        setIsEditingTelecaller(false);
                        setTelecallerNotice(null);
                      }}
                    >
                      <Icon name="close" size={13} /> Cancel
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px 16px' }}>
                    <div>
                      <label className="sub-field-label" style={{ display: 'block', marginBottom: 4 }}>
                        Assigned Telecaller
                      </label>
                      <CustomSelect
                        value={telecallerDraft.assigned_telecaller_id}
                        onChange={(val) => setTelecallerDraft((d) => ({ ...d, assigned_telecaller_id: val }))}
                        options={[
                          { value: '', label: 'Unassigned' },
                          ...telecallers.map((t) => ({
                            value: String(t.id),
                            label: `${t.full_name || t.email} (${t.email})`,
                          })),
                        ]}
                        ariaLabel="Assigned Telecaller"
                      />
                    </div>

                    <div>
                      <label className="sub-field-label" style={{ display: 'block', marginBottom: 4 }}>
                        Call Decision / Status
                      </label>
                      <CustomSelect
                        value={telecallerDraft.telecaller_status}
                        onChange={(val) => setTelecallerDraft((d) => ({ ...d, telecaller_status: val }))}
                        options={TELECALLER_STATUS_OPTIONS.map((o) => ({
                          value: o.value,
                          label: o.label,
                        }))}
                        ariaLabel="Telecaller Call Decision"
                      />
                    </div>

                    <div>
                      <label className="sub-field-label" htmlFor="imp-fld-tc-floors" style={{ display: 'block', marginBottom: 4 }}>
                        No. of Floors (Telecaller)
                      </label>
                      <input
                        id="imp-fld-tc-floors"
                        type="text"
                        className="fld"
                        placeholder="e.g. G+2"
                        value={telecallerDraft.telecaller_no_of_floors}
                        onChange={(e) => setTelecallerDraft((d) => ({ ...d, telecaller_no_of_floors: e.target.value }))}
                      />
                    </div>

                    <div>
                      <label className="sub-field-label" htmlFor="imp-fld-tc-built-up" style={{ display: 'block', marginBottom: 4 }}>
                        Built-up Area (Telecaller)
                      </label>
                      <input
                        id="imp-fld-tc-built-up"
                        type="text"
                        className="fld"
                        placeholder="e.g. 2500 sq.ft"
                        value={telecallerDraft.telecaller_built_up_area}
                        onChange={(e) => setTelecallerDraft((d) => ({ ...d, telecaller_built_up_area: e.target.value }))}
                      />
                    </div>

                    <div>
                      <label className="sub-field-label" htmlFor="imp-fld-tc-exp-comp" style={{ display: 'block', marginBottom: 4 }}>
                        Expected Completion (Telecaller)
                      </label>
                      <input
                        id="imp-fld-tc-exp-comp"
                        type="text"
                        className="fld"
                        placeholder="e.g. 1 year, Dec 2026"
                        value={telecallerDraft.telecaller_expected_completion}
                        onChange={(e) => setTelecallerDraft((d) => ({ ...d, telecaller_expected_completion: e.target.value }))}
                      />
                    </div>

                    <div>
                      <label className="sub-field-label" htmlFor="imp-fld-tc-stage" style={{ display: 'block', marginBottom: 4 }}>
                        Stage of Construction (Telecaller)
                      </label>
                      <input
                        id="imp-fld-tc-stage"
                        type="text"
                        className="fld"
                        placeholder="e.g. Foundation Work (Piling)"
                        value={telecallerDraft.telecaller_stage_of_construction}
                        onChange={(e) => setTelecallerDraft((d) => ({ ...d, telecaller_stage_of_construction: e.target.value }))}
                      />
                    </div>

                    <div style={{ gridColumn: '1 / -1' }}>
                      <label className="sub-field-label" htmlFor="imp-fld-telecaller-comment" style={{ display: 'block', marginBottom: 4 }}>
                        Telecaller Comments / Conversation Notes
                      </label>
                      <textarea
                        id="imp-fld-telecaller-comment"
                        className="fld"
                        rows={3}
                        maxLength={3000}
                        placeholder="Enter conversation notes, scheduled callback time, or lead details..."
                        value={telecallerDraft.telecaller_comment}
                        onChange={(e) => setTelecallerDraft((d) => ({ ...d, telecaller_comment: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={saveTelecallerVerification}
                      disabled={telecallerSaving}
                    >
                      {telecallerSaving ? <Icon name="refresh" size={13} className="fos-spin" /> : <Icon name="save" size={13} />}
                      Save Telecaller Details
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setIsEditingTelecaller(false);
                        setTelecallerNotice(null);
                      }}
                      disabled={telecallerSaving}
                    >
                      Cancel
                    </button>
                    {telecallerNotice && (
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: telecallerNotice.ok ? '#059669' : '#dc2626' }}>
                        {telecallerNotice.text}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <FourColumnTable
                    fields={[
                      { key: 'telecaller_user', label: 'Assigned Telecaller', value: record.assigned_telecaller_name ?? 'Not assigned' },
                      { key: 'telecaller_called_at', label: 'Call Logged At', value: record.telecaller_called_at ? formatDateTime(record.telecaller_called_at) : '—' },
                      { key: 'telecaller_by', label: 'Called By', value: record.telecaller_by_name ?? '—' },
                      { key: 'telecaller_status', label: 'Call Decision / Status', value: record.telecaller_status ? record.telecaller_status.replace(/_/g, ' ') : 'No call recorded' },
                      { key: 'tc_floors', label: 'No of Floors (Telecaller)', value: record.telecaller_no_of_floors },
                      { key: 'tc_built_up', label: 'Built up area (Telecaller)', value: record.telecaller_built_up_area },
                      { key: 'tc_exp_comp', label: 'Expected Completion (Telecaller)', value: record.telecaller_expected_completion },
                      { key: 'tc_stage', label: 'Stage of Construction (Telecaller)', value: record.telecaller_stage_of_construction },
                      { key: 'telecaller_follow_up', label: 'Follow-up Date', value: record.follow_up_date ? formatDate(record.follow_up_date) : undefined },
                    ]}
                  />
                  {record.telecaller_comment && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>
                        Call & Follow-up History Log (Table)
                      </div>
                      <TelecallerHistoryTable comment={record.telecaller_comment} isEditing={false} maxHeight={220} />
                    </div>
                  )}
                  {telecallerNotice && (
                    <div style={{ marginTop: 8, fontSize: '0.8rem', fontWeight: 600, color: telecallerNotice.ok ? '#059669' : '#dc2626' }}>
                      {telecallerNotice.text}
                    </div>
                  )}
                </>
              )}
            </Section>

            <Section
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
            >


              <div className="rd-coord-grid">
                {prettyCoords(record.coordinates) ? (
                  <div className="rd-coord-item">
                    <span className="rd-label">Admin Given Coordinates</span>
                    <span className="rd-coord-val">
                      <Icon name="pin_drop" size={14} />
                      {prettyCoords(record.coordinates)}
                    </span>
                  </div>
                ) : null}
                {fieldLat != null && fieldLon != null ? (
                  <div className="rd-coord-item">
                    <span className="rd-label">Watermark Coordinates</span>
                    <span className="rd-coord-val">
                      <Icon name="near_me" size={14} />
                      {`${fieldLat.toFixed(6)}, ${fieldLon.toFixed(6)}`}
                    </span>
                  </div>
                ) : null}
                {/* Only shown when there is a capture position to compare against —
                    an empty "—" tile is noise on a backfilled record. */}
                {coordVariance && (
                  <div className="rd-coord-item rd-coord-item-wide">
                    <span className="rd-label">Deviation</span>
                    <span className={`rd-value ${varianceTone.dev}`}>
                      {coordVariance.formatted} ({coordVariance.distanceMeters} m)
                    </span>
                  </div>
                )}
              </div>
              {record.coordinates && (
                <div className="rd-map-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="rd-link-btn"
                    onClick={() => {
                      const parts = (record.coordinates || '').split(',').map((s) => s.trim());
                      navigate(`/map?record_id=${record.id}&lat=${parts[0] || ''}&lng=${parts[1] || ''}&highlight=blue`);
                    }}
                    title="Open in Admin Geospatial Field Map"
                  >
                    <Icon name="pin_drop" size={15} />
                    Open in Geospatial Field Map
                  </button>
                  <a
                    className="rd-link-btn"
                    href={`https://www.google.com/maps?q=${encodeURIComponent(record.coordinates)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the exact coordinates in Google Maps (satellite view) in a new tab"
                  >
                    <Icon name="my_location" size={15} />
                    Open in Google Maps
                  </a>
                </div>
              )}


            </Section>



            <Section icon="schedule" title="Capture Details">
              <div className="rd-meta-grid">
                <div className="rd-meta-item">
                  <span className="rd-label">Imported At</span>
                  <span className="rd-meta-val">
                    <Icon name="schedule" size={14} />
                    {formatDateTime(record.created_at)}
                  </span>
                </div>
                <div className="rd-meta-item">
                  <span className="rd-label">Attached Media</span>
                  <span className="rd-meta-val">
                    <Icon name="photo_library" size={14} />
                    {record.images.length} photo{record.images.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="rd-meta-item">
                  <span className="rd-label">Photo GPS</span>
                  <span className="rd-meta-val">
                    <Icon name="my_location" size={14} />
                    {gpsCount} of {sortedImages.length} frames
                  </span>
                </div>
                <div className="rd-meta-item">
                  <span className="rd-label">Origin</span>
                  <span className="rd-meta-val">
                    <Icon name="upload_file" size={14} />
                    {allFramesLocated ? 'Imported · photos placed' : 'Imported by admin'}
                  </span>
                </div>
              </div>

              {currentImage && (
                <div className="rd-coord-grid">
                  <div className="rd-coord-item">
                    <span className="rd-label">Frame #{currentImage.photo_order} Coordinates</span>
                    <span className="rd-coord-val">
                      <Icon name="my_location" size={14} />
                      {formatCoords(currentImage.latitude, currentImage.longitude) || '—'}
                    </span>
                  </div>
                  <div className="rd-coord-item">
                    <span className="rd-label">Frame #{currentImage.photo_order} Accuracy</span>
                    <span className="rd-coord-val">
                      <Icon name="near_me" size={14} />±{(currentImage.location_accuracy ?? 0).toFixed(1)} m
                    </span>
                  </div>
                </div>
              )}
            </Section>

            {/* Record History */}
            <Section
              icon="history"
              title="Record History"
              boxed
              action={
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
                  {loadingActivityLogs ? 'Loading...' : `${recordActivityLogs.length} event${recordActivityLogs.length === 1 ? '' : 's'}`}
                </span>
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
                {loadingActivityLogs && (
                  <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', padding: 8 }}>
                    Fetching audit and activity events...
                  </div>
                )}
                {!loadingActivityLogs && recordActivityLogs.length === 0 && (
                  <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', padding: '12px 8px' }}>
                    No audit or activity events logged for this record yet.
                  </div>
                )}
                {recordActivityLogs.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      background: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '8px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ color: '#0f172a' }}>{entry.title}</strong>
                      <span style={{ color: '#64748b', fontSize: 11 }}>{formatDateTime(entry.ts)}</span>
                    </div>
                    {entry.detail && <div style={{ color: '#475569', fontSize: 11.5 }}>{entry.detail}</div>}
                    {entry.user_name && (
                      <div style={{ color: '#64748b', fontSize: 10.5, marginTop: 2 }}>
                        By: <strong>{entry.user_name}</strong>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {/* RIGHT COLUMN — media studio + photo upload */}
          <div className="record-media-card">
            {sortedImages.length === 0 ? (
              <div className="state-panel" style={{ flex: 1 }}>
                <Icon name="broken_image" size={34} />
                <span>No photos attached yet. Upload the site photos below.</span>
              </div>
            ) : (
              <>
                <div className="record-photo-viewport">
                  {currentImage && imageBlobUrls[currentImage.id] ? (
                    <img
                      src={imageBlobUrls[currentImage.id]}
                      alt={`Photo ${currentImage.photo_order}`}
                      className="record-photo-full"
                    />
                  ) : (
                    <div className="hero-placeholder">
                      <Icon
                        name={currentImage && imageFailures[currentImage.id] ? 'broken_image' : 'refresh'}
                        size={34}
                        className={currentImage && imageFailures[currentImage.id] ? undefined : 'fos-spin'}
                      />
                      <span>
                        {currentImage && imageFailures[currentImage.id]
                          ? 'Image not available'
                          : 'Loading image…'}
                      </span>
                    </div>
                  )}

                  {currentImage && (
                    <>
                      <div className="stage-hud-top-left">
                        <span className="stage-badge">
                          <Icon name="photo_camera" size={13} />
                          Frame {currentImage.photo_order} of {sortedImages.length}
                        </span>
                      </div>
                      <div className="stage-hud-top-right">
                        <button
                          type="button"
                          className="stage-action-btn"
                          disabled={!imageBlobUrls[currentImage.id]}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (imageBlobUrls[currentImage.id]) {
                              downloadImage(
                                imageBlobUrls[currentImage.id],
                                photoLabel(record.id, currentImage.photo_order)
                              );
                            }
                          }}
                          title="Download photo"
                        >
                          <Icon name="upload" style={{ transform: 'rotate(180deg)' }} size={14} />
                          <span>Download</span>
                        </button>
                        <button
                          type="button"
                          className="stage-action-btn"
                          disabled={!imageBlobUrls[currentImage.id]}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (imageBlobUrls[currentImage.id]) setLightbox(selectedImage);
                          }}
                          title="View full screen"
                        >
                          <Icon name="fullscreen" size={15} />
                          <span>Full screen</span>
                        </button>
                      </div>
                      {sortedImages.length > 1 && (
                        <>
                          <button
                            type="button"
                            className="stage-nav-arrow stage-nav-prev"
                            onClick={() =>
                              setSelectedImage((prev) => (prev > 0 ? prev - 1 : sortedImages.length - 1))
                            }
                            title="Previous frame"
                          >
                            <Icon name="chevron_left" size={22} />
                          </button>
                          <button
                            type="button"
                            className="stage-nav-arrow stage-nav-next"
                            onClick={() =>
                              setSelectedImage((prev) => (prev < sortedImages.length - 1 ? prev + 1 : 0))
                            }
                            title="Next frame"
                          >
                            <Icon name="chevron_right" size={22} />
                          </button>
                        </>
                      )}
                      <div className="stage-hud-bottom">
                        <span className="stage-hud-pill">
                          <Icon name="my_location" size={13} />
                          <span>{formatCoords(currentImage.latitude, currentImage.longitude)}</span>
                        </span>
                        <span className="stage-hud-pill">
                          <Icon name="near_me" size={13} />
                          <span>±{(currentImage.location_accuracy ?? 0).toFixed(1)} m</span>
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <div className="record-seq-dock">
                  <div className="seq-dock-header">
                    <div className="seq-dock-title-group">
                      <Icon name="photo_library" size={13} style={{ color: '#64748b' }} />
                      <span className="seq-dock-title">PHOTO SEQUENCE</span>
                    </div>
                    <span className="seq-dock-count mono-sm">{sortedImages.length} frames indexed</span>
                  </div>
                  <div className="seq-dock-scroll">
                    {sortedImages.map((img, idx) => {
                      const failed = !!imageFailures[img.id];
                      const loaded = !!imageBlobUrls[img.id];
                      return (
                        <button
                          type="button"
                          key={img.id}
                          className={`seq-dock-item ${selectedImage === idx ? 'active' : ''}`}
                          onClick={() => setSelectedImage(idx)}
                          disabled={!loaded && !failed}
                          title={`Select photo #${img.photo_order} — ${photoLabel(record.id, img.photo_order)}`}
                        >
                          <div className="seq-item-thumb">
                            {loaded ? (
                              <img
                                src={imageBlobUrls[img.id]}
                                alt={`Photo ${img.photo_order}`}
                                className="seq-dock-thumb-img"
                              />
                            ) : failed ? (
                              <div className="seq-broken">
                                <Icon name="broken_image" size={16} />
                              </div>
                            ) : (
                              <div className="seq-loading">
                                <Icon name="refresh" size={16} className="fos-spin" />
                              </div>
                            )}
                            <span className="seq-num">#{img.photo_order}</span>
                            <div className="seq-status-dot">
                              <Icon
                                name={failed ? 'warning' : 'check_circle'}
                                size={12}
                                style={{ color: failed ? '#ef4444' : '#10b981' }}
                              />
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Photo upload — server-stamped “Uploaded”, never the field HUD */}
            <div
              style={{
                borderTop: '1px solid #e2e8f0',
                padding: '14px 16px',
                background: '#fbfdff',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="add_photo_alternate" size={17} style={{ color: '#4f46e5' }} />
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>
                  Upload site photos
                </span>
                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                  stamped “Uploaded by &lt;your email&gt;” — no GPS/time HUD
                </span>
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  border: '1.5px dashed #c7d2fe',
                  borderRadius: 10,
                  padding: '12px 10px',
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#4f46e5',
                  background: '#fafaff',
                }}
              >
                <Icon name="upload" size={16} />
                Select photos (multiple allowed)
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  disabled={uploading}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    pickPhotos(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>

              {pending.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                    gap: 8,
                  }}
                >
                  {pending.map((p, i) => (
                    <div key={`${p.file.name}-${i}`} style={{ position: 'relative' }}>
                      <img
                        src={p.url}
                        alt={p.file.name}
                        style={{
                          width: '100%',
                          height: 78,
                          objectFit: 'cover',
                          borderRadius: 8,
                          border: '1px solid #e2e8f0',
                          display: 'block',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => removePending(i)}
                        disabled={uploading}
                        title="Remove this photo"
                        style={{
                          position: 'absolute',
                          top: 4,
                          right: 4,
                          width: 20,
                          height: 20,
                          borderRadius: 9999,
                          border: 'none',
                          background: 'rgba(15,23,42,0.7)',
                          color: '#fff',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                        }}
                      >
                        <Icon name="close" size={12} />
                      </button>
                      <div
                        style={{
                          fontSize: '0.64rem',
                          color: '#64748b',
                          marginTop: 3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={p.file.name}
                      >
                        {p.file.name}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {uploadError && (
                <div
                  className="alert alert-error"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem' }}
                  role="alert"
                >
                  <Icon name="error" size={15} />
                  <span>{uploadError}</span>
                </div>
              )}
              {uploadNote && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: '0.78rem',
                    color: '#065f46',
                    background: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    borderRadius: 8,
                    padding: '8px 10px',
                  }}
                >
                  <Icon name="check_circle" size={15} />
                  <span>{uploadNote}</span>
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={pending.length === 0 || uploading}
                onClick={uploadPhotos}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Icon
                  name={uploading ? 'refresh' : 'upload'}
                  size={14}
                  className={uploading ? 'fos-spin' : undefined}
                />
                {uploading
                  ? 'Uploading & watermarking…'
                  : pending.length > 0
                    ? `Upload ${pending.length} photo${pending.length === 1 ? '' : 's'}`
                    : 'Upload Photos'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Full-screen lightbox ─── */}
      {lightboxImage && (
        <div className="lb" onClick={() => setLightbox(null)}>
          <div className="lb-top">
            <div className="lb-title">
              <span className="mono-sm">{formatRecordNo(record.id)}</span>
              <span>
                Photo #{lightboxImage.photo_order} of {sortedImages.length}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                disabled={!imageBlobUrls[lightboxImage.id]}
                onClick={(e) => {
                  e.stopPropagation();
                  if (imageBlobUrls[lightboxImage.id]) {
                    downloadImage(
                      imageBlobUrls[lightboxImage.id],
                      photoLabel(record.id, lightboxImage.photo_order)
                    );
                  }
                }}
                style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: 'none' }}
                title="Download full-resolution photo"
              >
                <Icon name="upload" style={{ transform: 'rotate(180deg)' }} />
                Download
              </button>
              <button
                type="button"
                className="lb-close"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox(null);
                }}
                title="Close (Esc)"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
          </div>

          <div className="lb-body">
            {imageBlobUrls[lightboxImage.id] ? (
              <img
                src={imageBlobUrls[lightboxImage.id]}
                alt={`Photo ${lightboxImage.photo_order} full view`}
                className="lb-img"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="lb-body-placeholder">
                {imageFailures[lightboxImage.id] ? 'Image not uploaded yet' : 'Loading image…'}
              </span>
            )}
          </div>

          {sortedImages.length > 1 && (
            <>
              <button
                type="button"
                className="lb-nav prev"
                onClick={(e) => {
                  e.stopPropagation();
                  stepLightbox(-1);
                }}
                title="Previous photo"
              >
                <Icon name="chevron_left" size={22} />
              </button>
              <button
                type="button"
                className="lb-nav next"
                onClick={(e) => {
                  e.stopPropagation();
                  stepLightbox(1);
                }}
                title="Next photo"
              >
                <Icon name="chevron_right" size={22} />
              </button>
            </>
          )}
        </div>
      )}

      {/* ─── QC Reference Image Lightbox ─── */}
      {refViewerUrl && (
        <div className="lb" onClick={() => setRefViewerUrl(null)}>
          <div className="lb-top">
            <div className="lb-title">
              <span className="mono-sm">{formatRecordNo(record.id)}</span>
              <span>QC Reference Image</span>
            </div>
            <button
              type="button"
              className="lb-close"
              onClick={(e) => {
                e.stopPropagation();
                setRefViewerUrl(null);
              }}
              title="Close (Esc)"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          <div className="lb-body">
            <img src={refViewerUrl} alt="QC Reference Full View" className="lb-img" />
          </div>
        </div>
      )}

      {/* ─── Edit / Save modal — every field of the record ─── */}
      {showEdit && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            backdropFilter: 'blur(4px)',
            padding: 16,
          }}
          onClick={() => !saving && setShowEdit(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 860,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '18px 24px',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="edit_note" size={20} style={{ color: 'var(--c-royal)' }} />
                Edit Imported Record
              </h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowEdit(false)} disabled={saving}>
                <Icon name="close" size={18} />
              </button>
            </div>

            <div style={{ padding: '18px 24px', overflowY: 'auto' }}>
              {saveError && (
                <div className="alert alert-error" style={{ marginBottom: 14, display: 'flex', gap: 8 }}>
                  <Icon name="error" size={16} />
                  <span>{saveError}</span>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="field">
                  <label className="field-label" htmlFor="imp-name">
                    Record Name
                  </label>
                  <input
                    id="imp-name"
                    className="fld"
                    value={form.name || ''}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    disabled={saving}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="imp-construction">
                    Construction Happening
                  </label>
                  <select
                    id="imp-construction"
                    className="fld"
                    value={form.construction_happening || ''}
                    onChange={(e) => setForm((f) => ({ ...f, construction_happening: e.target.value }))}
                    disabled={saving}
                  >
                    <option value="">Not recorded</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', letterSpacing: '0.05em', marginBottom: 8 }}>
                  SITE &amp; PLANNING
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {PLANNING_FIELDS.map((field) => (
                    <div className="field" key={field.key as string}>
                      <label className="field-label" htmlFor={`imp-${field.key as string}`}>
                        {field.label}
                      </label>
                      <input
                        id={`imp-${field.key as string}`}
                        className={`fld${field.mono ? ' fld-mono' : ''}`}
                        value={form[field.key as string] || ''}
                        onChange={(e) => setForm((f) => ({ ...f, [field.key as string]: e.target.value }))}
                        disabled={saving}
                        placeholder={field.key === 'coordinates' ? '11.0168, 76.9558' : undefined}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', letterSpacing: '0.05em', marginBottom: 8 }}>
                  FIELD INSPECTION
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {INSPECTION_FIELDS.map((field) => (
                    <div className="field" key={field.key as string}>
                      <label className="field-label" htmlFor={`imp-${field.key as string}`}>
                        {field.label}
                      </label>
                      <input
                        id={`imp-${field.key as string}`}
                        className={`fld${field.mono ? ' fld-mono' : ''}`}
                        value={form[field.key as string] || ''}
                        onChange={(e) => setForm((f) => ({ ...f, [field.key as string]: e.target.value }))}
                        disabled={saving}
                        placeholder={field.key === 'date_of_visit' ? 'YYYY-MM-DD' : undefined}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <div className="field">
                  <label className="field-label" htmlFor="imp-remarks">
                    Inspection Remarks
                  </label>
                  <textarea
                    id="imp-remarks"
                    className="fld"
                    rows={3}
                    value={form.remarks || ''}
                    onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                    disabled={saving}
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
                padding: '16px 24px',
                borderTop: '1px solid #f1f5f9',
                background: '#f8fafc',
                borderRadius: '0 0 16px 16px',
              }}
            >
              <button type="button" className="btn btn-ghost" onClick={() => setShowEdit(false)} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveDetails}
                disabled={saving}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Icon name={saving ? 'refresh' : 'save'} size={15} className={saving ? 'fos-spin' : undefined} />
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Field Verification History Modal ─── */}
      {showEditHistoryModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            backdropFilter: 'blur(4px)',
            padding: 16,
          }}
          onClick={() => setShowEditHistoryModal(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 680,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15)',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="history" size={22} style={{ color: '#2563eb' }} />
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' }}>Field Verification History</h3>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    Record #{record.id} — {record.unique_id || record.name}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowEditHistoryModal(false)}
                style={{ padding: '4px 8px', fontSize: 18, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Revision Card: Latest Inspection */}
              <div style={{ border: '1px solid #bfdbfe', borderRadius: 10, background: '#f8fafc', padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#1e3a8a' }}>
                    <Icon name="check_circle" size={16} style={{ color: '#2563eb' }} />
                    Latest Inspection / Verification Details
                  </span>
                  {record.revisit_status && (
                    <span style={{ background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700 }}>
                      {record.revisit_status}
                    </span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 16px', fontSize: 12 }}>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Field Verifier</span>
                    <strong style={{ color: '#0f172a' }}>{record.reassigned_to_name || record.user_name || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Date of Visit</span>
                    <strong style={{ color: '#0f172a' }}>{record.date_of_visit || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Captured / Completed At</span>
                    <strong style={{ color: '#0f172a' }}>{record.field_captured_at ? formatDateTime(record.field_captured_at) : (record.date_of_visit ? formatDateTime(record.date_of_visit) : '—')}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Construction Status</span>
                    <strong style={{ color: '#0f172a' }}>{record.construction_happening || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Stage of Construction</span>
                    <strong style={{ color: '#0f172a' }}>{record.stage_of_construction || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>No of Floors</span>
                    <strong style={{ color: '#0f172a' }}>{record.no_of_floors || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Built-up Area</span>
                    <strong style={{ color: '#0f172a' }}>{record.built_up_area || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Expected Completion</span>
                    <strong style={{ color: '#0f172a' }}>{record.expected_completion || '—'}</strong>
                  </div>
                </div>
                {record.remarks && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1', fontSize: 12 }}>
                    <span style={{ color: '#64748b', display: 'block', marginBottom: 4 }}>Inspection Remarks</span>
                    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', color: '#1e293b', whiteSpace: 'pre-wrap' }}>
                      {record.remarks}
                    </div>
                  </div>
                )}
              </div>

              {/* Initial Visit Card */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#334155' }}>
                    <Icon name="assignment_turned_in" size={16} style={{ color: '#64748b' }} />
                    Original / Initial Field Verification
                  </span>
                  <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700 }}>
                    Initial Record
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 16px', fontSize: 12 }}>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Initial Field Verifier</span>
                    <strong style={{ color: '#0f172a' }}>{record.user_name || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Initial Assigned Date</span>
                    <strong style={{ color: '#0f172a' }}>{record.assigned_at ? formatDateTime(record.assigned_at) : '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Initial Captured Date</span>
                    <strong style={{ color: '#0f172a' }}>{record.field_captured_at ? formatDateTime(record.field_captured_at) : (record.date_of_visit ? formatDateTime(record.date_of_visit) : '—')}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Date of Visit</span>
                    <strong style={{ color: '#0f172a' }}>{record.date_of_visit || '—'}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: '0 0 16px 16px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowEditHistoryModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QC Audit Details History Modal */}
      {showQcHistoryModal && record && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setShowQcHistoryModal(false)}
        >
          <div
            className="modal-card"
            style={{
              background: '#ffffff',
              borderRadius: 16,
              maxWidth: 820,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: '16px 16px 0 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="fact_check" size={24} style={{ color: '#0284c7' }} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#0f172a' }}>QC Audit Details History</h3>
                    <AuditStatusChip status={record.audit_status} />
                    {(record.qc_edited_at || record.audit_status === 'RE_AUDITED') && (
                      <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700 }}>
                        Edited / Re-audited
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    Record #{record.id} — <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{record.unique_id || record.name}</span>
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowQcHistoryModal(false)}
                style={{ padding: '6px 10px', fontSize: 18, lineHeight: 1, borderRadius: 8 }}
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Latest / Current QC Assessment */}
              <div style={{ border: '1px solid #bae6fd', borderRadius: 12, background: '#f0f9ff', padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#0369a1' }}>
                    <Icon name="verified" size={17} style={{ color: '#0284c7' }} />
                    Latest QC Assessment & Audit Decision
                  </span>
                  <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700 }}>
                    Active Audit Record
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px 14px', fontSize: 12, background: '#ffffff', padding: 12, borderRadius: 8, border: '1px solid #e0f2fe' }}>
                  <div>
                    <span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>Audited By</span>
                    <strong style={{ color: '#0f172a' }}>{record.audited_by_name || 'Not audited yet'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>Audited At</span>
                    <strong style={{ color: '#0f172a' }}>{record.audited_at ? formatDateTime(record.audited_at) : '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>Assigned QA User</span>
                    <strong style={{ color: '#0f172a' }}>{record.assigned_auditor_name || record.qc_by_name || 'Not assigned'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>QC Last Edited At</span>
                    <strong style={{ color: '#0f172a' }}>{record.qc_edited_at ? formatDateTime(record.qc_edited_at) : '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>QC Coordinates</span>
                    <strong style={{ color: '#0284c7', fontFamily: 'monospace' }}>{record.coordinates || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>Last Modified Date</span>
                    <strong style={{ color: '#0f172a' }}>
                      {(record.last_modified_at || record.reassigned_at || record.assigned_at || record.created_at)
                        ? formatDateTime(record.last_modified_at || record.reassigned_at || record.assigned_at || record.created_at)
                        : '—'}
                    </strong>
                  </div>
                </div>

                {/* 2-Column Balanced QC Observations */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px 14px', marginTop: 14 }}>
                  <div>
                    <span style={{ color: '#475569', fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>QC Comments (VHR Imagery)</span>
                    <div style={{ background: '#fff', border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 12px', fontWeight: 600, color: '#0f172a', fontSize: 13 }}>
                      {record.qc_vhr_comment || 'No QC assessment recorded'}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: '#475569', fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Street View Comments</span>
                    <div style={{ background: '#fff', border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 12px', color: '#1e293b', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                      {record.qc_street_details || '—'}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: '#475569', fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Builder / Contact Details</span>
                    <div style={{ background: '#fff', border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 12px', color: '#1e293b', fontSize: 13 }}>
                      {record.qc_builder_contact || '—'}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: '#475569', fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Sq.ft</span>
                    <div style={{ background: '#fff', border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 12px', color: '#0f172a', fontWeight: 600, fontSize: 13 }}>
                      {record.qc_sqfeet || '—'}
                    </div>
                  </div>
                </div>

                {record.audit_comment && (
                  <div style={{ marginTop: 12 }}>
                    <span style={{ color: '#475569', fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Audit Remarks / Comment</span>
                    <div style={{ background: '#fff', border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 12px', color: '#334155', fontSize: 13 }}>
                      {record.audit_comment}
                    </div>
                  </div>
                )}
              </div>

              {/* QC Reference Image Card (if present) */}
              {record.qc_reference_image_url && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#ffffff', padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{ position: 'relative', width: 80, height: 64, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', border: '1px solid #cbd5e1', flexShrink: 0, background: '#0f172a' }}
                    onClick={() => setRefViewerUrl(`${SERVER_BASE}${record.qc_reference_image_url}`)}
                    title="Click to view full image"
                  >
                    <img
                      src={`${SERVER_BASE}${record.qc_reference_image_url}?thumb=true`}
                      alt="QC Reference"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `${SERVER_BASE}${record.qc_reference_image_url}`;
                      }}
                    />
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="zoom_in" size={18} style={{ color: '#fff' }} />
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>QC Reference Image</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#16a34a', fontWeight: 600 }}>
                        <Icon name="cloud_done" size={12} /> GDrive Synced
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: '#64748b' }}>Attached reference photo used during desktop QC & audit verification</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => setRefViewerUrl(`${SERVER_BASE}${record.qc_reference_image_url}`)}
                    style={{ fontSize: 11, height: 28, padding: '0 10px', flexShrink: 0 }}
                  >
                    <Icon name="visibility" size={13} /> View Full
                  </button>
                </div>
              )}

              {/* Lifecycle & Initial QC Card */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#ffffff', padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#334155' }}>
                    <Icon name="history" size={16} style={{ color: '#64748b' }} />
                    Initial QC & Routing Lifecycle
                  </span>
                  <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700 }}>
                    Lifecycle
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px 14px', fontSize: 12 }}>
                  <div>
                    <span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>Initial Assigned Auditor</span>
                    <strong style={{ color: '#0f172a' }}>{record.assigned_auditor_name || 'Not assigned'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>Record Created / Staged At</span>
                    <strong style={{ color: '#0f172a' }}>{record.created_at ? formatDateTime(record.created_at) : '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>Initial QC Completed At</span>
                    <strong style={{ color: '#0f172a' }}>{record.qc_completed_at ? formatDateTime(record.qc_completed_at) : '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>Initial QC Evaluator</span>
                    <strong style={{ color: '#0f172a' }}>{record.qc_by_name || record.audited_by_name || '—'}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 22px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: '0 0 16px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                <Icon name="info" size={14} style={{ color: '#94a3b8' }} />
                <span>All modifications write immutable audit entries.</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowQcHistoryModal(false)}
                style={{ padding: '6px 16px', fontWeight: 600 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
