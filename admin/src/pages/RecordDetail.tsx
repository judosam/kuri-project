import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { recordsApi, logsApi, SERVER_BASE } from '../services/api';
import type { AuditStatus, CaptureRecord, ActivityEntry, User } from '../types';
import { AuditStatusChip, AUDIT_OPTIONS } from './Records';
import { CustomSelect } from '../components/ui';
import { CoordinateMap } from '../components/CoordinateMap';

import { QC_VHR_OPTIONS, QC_STREET_OPTIONS } from '../utils/qcOptions';

import { TELECALLER_STATUS_OPTIONS } from '../components/TelecallerRecordModal';
import { TelecallerHistoryTable } from '../components/TelecallerHistoryTable';

export const CONSTRUCTION_TYPES = [
  'Residential',
  'Commercial',
  'Industrial',
  'Institutional',
  'Infrastructure',
  'Other',
];

export const STAGES_OF_CONSTRUCTION = [
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

export const RELATIONSHIP_OPTIONS = [
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

export const SPOKEN_WITH_OPTIONS = [
  'Owner',
  'Engineer',
  'Architect',
  'Contractor',
  'Supervisor',
  'Security / Watchman',
  'Neighbour',
  'Other',
];
import {
  Icon,
  Avatar,
  LoadingPanel,
  PageShell,
  formatCoords,
  formatDate,
  formatDateTime,
  formatRecordNo,
  type IconName,
} from '../components/ui';
import { enName } from '../utils/english';
import { useTopHeader } from '../context/HeaderContext';
import {
  calculateCoordVariance,
  getFieldCoordinates,
  parseCoordinates,
  fetchGoogleDistance,
  NEARBY_LOCK_METERS,
  type CoordVarianceResult,
} from '../utils/geo';
import { useLightboxKeys } from '../hooks/useLightboxKeys';
import { DetailValueCell, isFieldEmpty, capturedTime } from '../components/RecordWorkflowFields';

/** Human-readable photo label — mirrors the backend's canonical naming. */
function photoLabel(recordId: number, order: number): string {
  return `Record_${recordId}_Photo_${order}.jpg`;
}

/** "11.047,77.036" → "11.047, 77.036" so the value wraps at the comma, never mid-number. */
function prettyCoords(raw?: string | null): string {
  return (raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

/** One titled block of the detail panel. Pass boxed to render it as a highlighted card. */
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
                <DetailValueCell
                  value={String(fieldA.value)}
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


export default function RecordDetail({ canAdmin = true, canAudit = false }: { canAdmin?: boolean; canAudit?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [record, setRecord] = useState<CaptureRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<number>(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [addressResolving, setAddressResolving] = useState(false);

  // Auditor QC + decision panel (mirrors the old records-list popup).
  const [qcVhr, setQcVhr] = useState('');
  const [qcStreet, setQcStreet] = useState('');
  const [qcBuilder, setQcBuilder] = useState('');
  const [qcSqfeet, setQcSqfeet] = useState('');
  const [auditComment, setAuditComment] = useState('');
  const [auditStatus, setAuditStatus] = useState<AuditStatus | ''>('');
  const [editCoordinates, setEditCoordinates] = useState('');
  const [showPinPicker, setShowPinPicker] = useState(false);
  const [auditSaving, setAuditSaving] = useState(false);
  const [assignedAuditorId, setAssignedAuditorId] = useState<string>('');
  const [auditors, setAuditors] = useState<User[]>([]);
  const [auditNotice, setAuditNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [isEditingQc, setIsEditingQc] = useState(false);
  const [qcImageUploading, setQcImageUploading] = useState(false);
  const [qcImageDeleting, setQcImageDeleting] = useState(false);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [refViewerUrl, setRefViewerUrl] = useState<string | null>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);

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
    follow_up_date: '',
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
  const [showEditHistoryModal, setShowEditHistoryModal] = useState(false);
  const [showQcHistoryModal, setShowQcHistoryModal] = useState(false);
  const [recordActivityLogs, setRecordActivityLogs] = useState<ActivityEntry[]>([]);
  const [loadingActivityLogs, setLoadingActivityLogs] = useState(false);

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

  // Edit / Delete state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fetch image with auth token → blob URL for <img> display
  const [imageBlobUrls, setImageBlobUrls] = useState<Record<number, string>>({});
  const [imageFailures, setImageFailures] = useState<Record<number, boolean>>({});

  const sortedImages = [...(record?.images || [])].sort((a, b) => a.photo_order - b.photo_order);
  const currentImage = sortedImages[selectedImage] ?? null;
  const lightboxImage = lightbox !== null ? sortedImages[lightbox] ?? null : null;

  const selectedHasGps =
    currentImage &&
    currentImage.latitude != null &&
    currentImage.longitude != null &&
    !(currentImage.latitude === 0 && currentImage.longitude === 0);
  const updatedCoords = parseCoordinates(record?.updated_coordinates);
  const updatedGps = updatedCoords ? { latitude: updatedCoords[0], longitude: updatedCoords[1] } : null;
  const primaryGps = getFieldCoordinates(sortedImages);
  // No-photo inspections store their GPS fix on the record itself.
  const noPhotoGps = record?.field_latitude != null && record?.field_longitude != null
    ? { latitude: record.field_latitude, longitude: record.field_longitude }
    : null;
  const fieldLat = selectedHasGps ? currentImage!.latitude : (updatedGps?.latitude ?? primaryGps?.latitude ?? noPhotoGps?.latitude ?? null);
  const fieldLon = selectedHasGps ? currentImage!.longitude : (updatedGps?.longitude ?? primaryGps?.longitude ?? noPhotoGps?.longitude ?? null);

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

  const handleBack = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/records');
    }
  };

  useTopHeader({
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
                <h1 className="topbar-record-title">{record.name || `Field Capture #${record.id}`}</h1>
                <span className="topbar-record-pill">{formatRecordNo(record.id)}</span>
              </div>
              <span className="topbar-cmd-subtitle" title="Date assigned to the current operator; older records use their creation date">
                Assigned {record.assigned_at ? formatDateTime(record.assigned_at) : '—'}
              </span>
            </div>
          </>
        )}
      </div>
    ),
    right: record ? (
      <div className="topbar-cmd-right">
        {canAdmin && <>
        <button type="button" className="topbar-btn topbar-btn-secondary" onClick={() => recordsApi.downloadRecord(record.id).catch(() => window.alert('Could not download this record. Please retry.'))}>Download Full Record (.xlsx)</button>
        <button
          type="button"
          className="topbar-btn topbar-btn-secondary"
          onClick={() => {
            setEditName(record.name);
            setEditError('');
            setShowEditModal(true);
          }}
          title="Edit record details"
        >
          <Icon name="tune" size={14} />
          <span>Edit</span>
        </button>
        <button
          type="button"
          className="topbar-btn topbar-btn-danger"
          onClick={() => setShowDeleteModal(true)}
          title="Delete this record"
        >
          <Icon name="delete" size={14} />
          <span>Delete</span>
        </button>
        <div className="topbar-cmd-divider" />
        </>}
        <span className="topbar-verified-pill">
          <Icon name="verified" size={13} />
          <span>{record.images?.some((image) => image.source !== 'uploaded' && (image.latitude !== 0 || image.longitude !== 0)) ? 'Camera capture' : 'Inspection record'}</span>
        </span>
      </div>
    ) : null,
  }, [record, navigate, canAdmin]);

  // Keyboard navigation for main stage (cycles frames with ArrowLeft / ArrowRight)
  useEffect(() => {
    if (lightbox !== null || sortedImages.length <= 1) return;
    const handler = (e: KeyboardEvent) => {
      if (showEditModal || showDeleteModal) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedImage((prev) => (prev > 0 ? prev - 1 : sortedImages.length - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedImage((prev) => (prev < sortedImages.length - 1 ? prev + 1 : 0));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightbox, sortedImages.length, showEditModal, showDeleteModal]);

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

  const downloadImage = (url: string, filename: string, imageId?: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (record && imageId) {
      recordsApi.logDownload(record.id, imageId).catch((err) => {
        console.warn('Failed to log image download audit event:', err);
      });
    }
  };

  const handleSaveEdit = async () => {
    if (!record) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError('Record name cannot be empty.');
      return;
    }
    if (trimmed.length < 2) {
      setEditError('Record name must be at least 2 characters long.');
      return;
    }
    if (trimmed.length > 255) {
      setEditError('Record name cannot exceed 255 characters.');
      return;
    }

    setSavingEdit(true);
    setEditError('');
    try {
      const updated = await recordsApi.update(record.id, {
        name: trimmed,
      });
      setRecord((prev) => (prev ? { ...prev, name: updated.name } : updated));
      setShowEditModal(false);
    } catch (err: any) {
      setEditError(err.response?.data?.detail || 'Failed to update record');
    } finally {
      setSavingEdit(false);
    }
  };


  const handleDeleteRecord = async () => {
    if (!record) return;
    setDeleting(true);
    try {
      await recordsApi.delete(record.id);
      navigate('/records');
    } catch {
      alert('Failed to delete record');
      setDeleting(false);
    }
  };

  const fetchImageBlob = useCallback(async (imageUrl: string, imageId: number) => {
    if (imageBlobUrls[imageId] || imageFailures[imageId]) return; // already fetched / failed
    try {
      const token = localStorage.getItem('token');
      const normalized = imageUrl.startsWith('/api') ? imageUrl : `/api${imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`}`;
      const resp = await fetch(`${SERVER_BASE}${normalized}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      setImageBlobUrls((prev) => ({ ...prev, [imageId]: url }));
    } catch {
      // Image failed to load (pending/not uploaded) — show placeholder, don't spin forever
      setImageFailures((prev) => ({ ...prev, [imageId]: true }));
    }
  }, [imageBlobUrls, imageFailures]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    recordsApi
      .get(parseInt(id))
      .then((data) => {
        setRecord(data);
        setQcVhr(data.qc_vhr_comment || '');
        setQcStreet(data.qc_street_details || '');
        setQcBuilder(data.qc_builder_contact || '');
        setQcSqfeet(data.qc_sqfeet || '');
        setAuditComment(data.audit_comment || '');
        setAuditStatus((data.audit_status as AuditStatus) || '');
        setEditCoordinates(data.coordinates || '');
        setEditName(data.name || '');
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
          follow_up_date: data.follow_up_date || '',
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
        setSelectedImage(0);
        // Pre-fetch all images with auth
        data.images.forEach((img: any) => {
          if (img.image_url) fetchImageBlob(img.image_url, img.id);
        });
      })
      .catch(() => setError('Failed to load record.'))
      .finally(() => setLoading(false));
  }, [id]);

  // Records captured while the geocoding key was missing have no address stored.
  // Resolve it from the captured GPS so the panel never shows a blank location.
  useEffect(() => {
    if (!canAdmin || !record) return;
    const hasGps = (record.images || []).some(
      (img) => img.latitude != null && img.longitude != null && (img.latitude !== 0 || img.longitude !== 0)
    ) || (record.field_latitude != null && record.field_longitude != null && (record.field_latitude !== 0 || record.field_longitude !== 0));
    // Only ask for an address we have a source for, so a record without admin
    // coordinates never triggers a pointless lookup on every open.
    const needsField = !record.formatted_address && hasGps;
    const needsAdmin = !record.admin_formatted_address && !!record.coordinates?.trim();
    if (!needsField && !needsAdmin) return;

    let active = true;
    setAddressResolving(true);
    recordsApi
      .resolveAddress(record.id)
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
      })
      .catch(() => {
        // Geocoding error ignored
      })
      .finally(() => {
        if (active) setAddressResolving(false);
      });

    return () => {
      active = false;
    };
  }, [record?.id, record?.formatted_address, canAdmin]);

  /** Save the auditor's QC assessment + audit decision (in-place on this page). */
  const saveAuditAssessment = async () => {
    if (!record || auditSaving) return;
    const coordsChanged = editCoordinates.trim() !== (record.coordinates || '').trim();
    const auditorChanged = (assignedAuditorId ? Number(assignedAuditorId) : null) !== (record.assigned_auditor_id || null);
    const commentChanged = auditComment.trim() !== (record.audit_comment || '').trim();
    const qcChanged =
      qcVhr.trim() !== (record.qc_vhr_comment || '').trim() ||
      qcStreet.trim() !== (record.qc_street_details || '').trim() ||
      qcBuilder.trim() !== (record.qc_builder_contact || '').trim() ||
      qcSqfeet.trim() !== (record.qc_sqfeet || '').trim() ||
      commentChanged ||
      auditorChanged;

    // Mandatory validation: Audit Decision, QC Comments (VHR Imagery), Street view comments
    if (!auditStatus?.trim()) {
      setAuditNotice({ ok: false, text: 'Audit Decision is mandatory. Please select an audit decision.' });
      return;
    }
    if (!qcVhr.trim()) {
      setAuditNotice({ ok: false, text: 'QC Comments (VHR Imagery) is mandatory. Please select a comment.' });
      return;
    }
    if (!qcStreet.trim()) {
      setAuditNotice({ ok: false, text: 'Street view comments is mandatory. Please select a comment.' });
      return;
    }

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
          coordinates: coordsChanged ? editCoordinates.trim() : undefined,
          assigned_auditor_id: assignedAuditorId ? Number(assignedAuditorId) : null,
        }
      );
      const fresh = await recordsApi.get(record.id);
      setRecord(fresh);
      setAuditStatus((fresh.audit_status as AuditStatus) || '');
      setAuditComment(fresh.audit_comment || '');
      setEditCoordinates(fresh.coordinates || '');
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
        follow_up_date: fieldDraft.follow_up_date || undefined,
      });
      setRecord(updated);
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
        <LoadingPanel text="Loading record…" />
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell>
        <div style={{ marginBottom: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleBack}>
            <Icon name="arrow_back" size={15} /> Return to Records
          </button>
        </div>
        <div className="state-panel">
          <Icon name="error" size={30} />
          <span>{error}</span>
        </div>
      </PageShell>
    );
  }
  if (!record) {
    return (
      <PageShell>
        <div style={{ marginBottom: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleBack}>
            <Icon name="arrow_back" size={15} /> Return to Records
          </button>
        </div>
        <div className="state-panel">
          <Icon name="folder_open" size={30} />
          <span>Record not found</span>
        </div>
      </PageShell>
    );
  }

  const isCompleted = record.status === 'COMPLETED' || record.status === 'Updated Revisited' || record.status === 'UPDATED_REVISITED' || record.revisit_status === 'COMPLETED';
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
          {/* LEFT COLUMN — ordered record details */}
          <div className="record-audit-card">
            {/* 1. Operator */}
            <Section
              icon="person"
              title="Field Operator"
              action={
                record.property_type === 'Commercial Property' || record.audit_status === 'COMMERCIAL_PROPERTY' ? (
                  <span className="rd-chip" style={{ background: '#fef3c7', color: '#b45309', borderColor: '#fde68a' }}>
                    <span className="rd-dot" style={{ background: '#d97706' }} />
                    Commercial Property (QC Only)
                  </span>
                ) : (
                  <span className={`rd-chip ${(record.is_manually_added || record.source === 'manual') ? 'rd-chip-neutral' : (isCompleted ? 'rd-chip-ok' : ((record.reassigned_to_id != null || record.revisit_status === 'REASSIGNED' || record.revisit_status === 'PENDING_REVISIT') ? 'rd-chip-info' : 'rd-chip-warn'))}`}>
                    <span className="rd-dot" />
                    {(record.is_manually_added || record.source === 'manual')
                      ? 'Manually Added'
                      : (isCompleted
                        ? 'Completed'
                        : ((record.reassigned_to_id != null || record.revisit_status === 'REASSIGNED' || record.revisit_status === 'PENDING_REVISIT') ? 'Reassigned' : 'Pending Inspection'))}
                  </span>
                )
              }
            >
              <div className="rd-operator">
                <Avatar name={record.user_name || 'Unassigned'} size="md" />
                <div className="rd-operator-meta">
                  <span className="rd-operator-name">
                    {record.user_name || (record.staged_operator_name ? `${record.staged_operator_name} (staged)` : 'Unassigned')}
                  </span>
                  <span className="rd-operator-sub">
                    {record.user_id != null
                      ? `Operator ID #${record.user_id}`
                      : record.assigned_auditor_name
                        ? `With auditor ${record.assigned_auditor_name} — awaiting decision`
                        : 'No field operator assigned yet'}
                  </span>
                </div>
              </div>
            </Section>

            {/* 2. Site & location */}
            {(record.formatted_address || record.admin_formatted_address || record.location_name || addressResolving) && (
              <Section icon="location_on" title="Site & Location">
                <div className="site-location-two-col-grid">
                  {(record.formatted_address || (addressResolving && !record.formatted_address)) ? (
                    <div className="site-location-card">
                      <div className="site-location-val">
                        {addressResolving && !record.formatted_address ? (
                          <span className="rd-value-pending">
                            <span className="rd-mini-spinner" /> Resolving from coordinates…
                          </span>
                        ) : (
                          enName(record.formatted_address)
                        )}
                      </div>
                      <div className="site-location-title">Field Inspection Address</div>
                    </div>
                  ) : null}

                  {(record.admin_formatted_address || (addressResolving && !record.admin_formatted_address && record.coordinates?.trim())) ? (
                    <div className="site-location-card">
                      <div className="site-location-val">
                        {addressResolving && !record.admin_formatted_address ? (
                          <span className="rd-value-pending">
                            <span className="rd-mini-spinner" /> Resolving from coordinates…
                          </span>
                        ) : (
                          enName(record.admin_formatted_address)
                        )}
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

            {/* 3. Admin-given dispatch data */}
            {hasPlanning && (
              <Section icon="receipt_long" title="Imported Details">
                <FourColumnTable
                  fields={[
                    { key: 'uid', label: 'Unique ID', value: record.unique_id },
                    { key: 'property_type', label: 'Property Type', value: record.property_type },
                    { key: 'survey_no', label: 'Survey No', value: record.survey_no || record.survey_number },
                    { key: 'subdiv_no', label: 'Subdivision No', value: record.subdivision_no || record.sub_division },
                    { key: 'land_use', label: 'Land Type / Land Use', value: record.land_use },
                    { key: 'owner_name', label: 'Owner Name', value: record.owner_name_en },
                    { key: 'taluk', label: 'Taluk', value: record.taluk },
                    { key: 'village', label: 'Village', value: record.village },
                    { key: 'district', label: 'District', value: record.district },
                    { key: 'priority_tier', label: 'Priority Tier', value: record.priority_tier },
                    { key: 'govt_dtcp_permit', label: 'Govt DTCP Permit', value: record.govt_dtcp_permit ? 'Yes (Granted)' : (record.govt_dtcp_permit === false ? 'No' : undefined) },
                    { key: 'dtcp_application_no', label: 'DTCP Application No', value: record.dtcp_application_no },
                    { key: 'dtcp_permit_date', label: 'DTCP Permit Date', value: record.dtcp_permit_date },
                    { key: 'site_addr', label: 'Site Address', value: record.site_address },
                  ]}
                />
              </Section>
            )}

            {/* 4. Audit decision + QC assessment */}
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
                (canAdmin || canAudit) ? (
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
                ) : undefined
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
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Icon name="edit" size={15} style={{ color: '#0284c7' }} />
                          <strong style={{ fontSize: '0.74rem', letterSpacing: '0.05em', color: '#0369a1', textTransform: 'uppercase' }}>
                            Record QC Assessment & Decision (Editing)
                          </strong>
                        </div>
                        <button
                          type="button"
                          className="fancy-btn-edit active"
                          onClick={() => {
                            setIsEditingQc(false);
                            setQcVhr(record.qc_vhr_comment || '');
                            setQcStreet(record.qc_street_details || '');
                            setQcBuilder(record.qc_builder_contact || '');
                            setQcSqfeet(record.qc_sqfeet || '');
                            setAuditComment(record.audit_comment || '');
                            setAuditStatus((record.audit_status as AuditStatus) || '');
                            setEditCoordinates(record.coordinates || '');
                            setShowPinPicker(false);
                            setAuditNotice(null);
                          }}
                          title="Close edit"
                        >
                          <Icon name="close" size={13} />
                          <span>Close Edit</span>
                        </button>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px 14px', alignItems: 'start' }}>
                        <div>
                          <label className="sub-field-label" htmlFor="rd-qc-vhr">QC Comments (VHR Imagery)</label>
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
                          <label className="sub-field-label" htmlFor="rd-qc-street">Street view comments</label>
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
                          <label className="sub-field-label" htmlFor="rd-qc-builder">Builder / Contact Details (if seen in Street View)</label>
                          <input
                            id="rd-qc-builder"
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
                          <label className="sub-field-label" htmlFor="rd-qc-sqfeet">Sq.ft</label>
                          <input
                            id="rd-qc-sqfeet"
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
                              id="rd-qc-coordinates"
                              type="text"
                              className="fld"
                              style={{ fontFamily: 'monospace', fontSize: '0.85rem', flex: '1 1 240px', minWidth: 200 }}
                              placeholder="Latitude, Longitude (e.g. 11.016844, 76.955832)"
                              value={editCoordinates}
                              onChange={(e) => {
                                setEditCoordinates(e.target.value);
                                setAuditStatus('RE_AUDITED');
                              }}
                            />
                            {(editCoordinates.trim() !== (record.coordinates || '').trim() ||
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
                            const parts = (editCoordinates || record.coordinates || '').split(',').map((s) => parseFloat(s.trim()));
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
                                    setEditCoordinates(newCoords);
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
                                Audit Decision *
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
                              id="rd-qc-audit-comment"
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
                              setEditCoordinates(record.coordinates || '');
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

            {/* 5. Field operator inspection */}
            {(() => {
              const isRevisitOrEdited = Boolean(
                record.reassigned_to_name ||
                record.revisit_status ||
                record.updated_coordinates ||
                record.updated_information ||
                record.status === 'Updated Revisited' ||
                record.status === 'UPDATED_REVISITED'
              );
              const effectiveCapturedAt = capturedTime(record);

              if (!canAdmin) return null;

              return (
                <Section
                  icon="assignment_turned_in"
                  title="Field Verification"
                  boxed
                  badges={
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {isRevisitOrEdited && (
                        <span
                          className="rd-chip"
                          style={{
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            border: '1px solid #bfdbfe',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 8px',
                            borderRadius: 9999,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                          }}
                          title={record.revisit_status ? `Status: ${record.revisit_status}` : 'Field verification edited/revisited'}
                        >
                          <Icon name="history" size={13} />
                          Edited
                        </span>
                      )}
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
                    </div>
                  }
                  action={
                    <div className="fancy-action-btn-group">
                      <button
                        type="button"
                        className="fancy-btn-history"
                        onClick={() => setShowEditHistoryModal(true)}
                        title="View Field Verification history and previous inspection details"
                      >
                        <Icon name="history" size={13} />
                        <span>Field Verification History</span>
                      </button>
                      {canAdmin && (
                        <button
                          type="button"
                          className={`fancy-btn-edit${isEditingField ? ' active' : ''}`}
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
                              follow_up_date: record.follow_up_date || '',
                            });
                            setIsEditingField((prev) => !prev);
                            setFieldNotice(null);
                          }}
                          title="Edit Field Verification details"
                        >
                          <Icon name={isEditingField ? 'close' : 'edit'} size={13} />
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
                          <label className="sub-field-label" htmlFor="fld-date-visit" style={{ display: 'block', marginBottom: 4 }}>
                            Date of Visit
                          </label>
                          <input
                            id="fld-date-visit"
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
                          <label className="sub-field-label" htmlFor="fld-no-floors" style={{ display: 'block', marginBottom: 4 }}>
                            No. of Floors
                          </label>
                          <input
                            id="fld-no-floors"
                            type="text"
                            className="fld"
                            placeholder="e.g. G+1, G+2..."
                            value={fieldDraft.no_of_floors}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, no_of_floors: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="fld-built-up-area" style={{ display: 'block', marginBottom: 4 }}>
                            Built-up Area (Sq.ft)
                          </label>
                          <input
                            id="fld-built-up-area"
                            type="text"
                            className="fld"
                            placeholder="e.g. 2400 sq.ft"
                            value={fieldDraft.built_up_area}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, built_up_area: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="fld-expected-completion" style={{ display: 'block', marginBottom: 4 }}>
                            Expected Completion
                          </label>
                          <input
                            id="fld-expected-completion"
                            type="text"
                            className="fld"
                            placeholder="e.g. Dec 2025"
                            value={fieldDraft.expected_completion}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, expected_completion: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="fld-rel-bldg" style={{ display: 'block', marginBottom: 4 }}>
                            Relationship with Building
                          </label>
                          <input
                            id="fld-rel-bldg"
                            type="text"
                            className="fld"
                            list="rd-rel-options-list"
                            placeholder="e.g. Owner, Contractor, Architect..."
                            value={fieldDraft.relationship_with_building}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, relationship_with_building: e.target.value }))}
                          />
                          <datalist id="rd-rel-options-list">
                            {RELATIONSHIP_OPTIONS.map((o) => (
                              <option key={o} value={o} />
                            ))}
                          </datalist>
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="fld-bldg-user" style={{ display: 'block', marginBottom: 4 }}>
                            Building User Name
                          </label>
                          <input
                            id="fld-bldg-user"
                            type="text"
                            className="fld"
                            placeholder="e.g. Rajesh Kumar"
                            value={fieldDraft.building_user_name}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, building_user_name: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="fld-spoken-with" style={{ display: 'block', marginBottom: 4 }}>
                            Spoken With
                          </label>
                          <input
                            id="fld-spoken-with"
                            type="text"
                            className="fld"
                            list="rd-spoken-options-list"
                            placeholder="e.g. Owner, Engineer, Supervisor..."
                            value={fieldDraft.spoken_with}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, spoken_with: e.target.value }))}
                          />
                          <datalist id="rd-spoken-options-list">
                            {SPOKEN_WITH_OPTIONS.map((o) => (
                              <option key={o} value={o} />
                            ))}
                          </datalist>
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="fld-contact-num" style={{ display: 'block', marginBottom: 4 }}>
                            Contact Number
                          </label>
                          <input
                            id="fld-contact-num"
                            type="tel"
                            className="fld"
                            placeholder="e.g. 9876543210"
                            value={fieldDraft.contact_number}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, contact_number: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="fld-contractor-name" style={{ display: 'block', marginBottom: 4 }}>
                            Site Contractor / Architect Name
                          </label>
                          <input
                            id="fld-contractor-name"
                            type="text"
                            className="fld"
                            placeholder="e.g. V-Build Constructions"
                            value={fieldDraft.site_contractor_architect_name}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, site_contractor_architect_name: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="fld-contractor-num" style={{ display: 'block', marginBottom: 4 }}>
                            Site Contractor / Architect Number
                          </label>
                          <input
                            id="fld-contractor-num"
                            type="tel"
                            className="fld"
                            placeholder="e.g. 9876543210"
                            value={fieldDraft.site_contractor_architect_number}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, site_contractor_architect_number: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="sub-field-label" htmlFor="fld-follow-up-date" style={{ display: 'block', marginBottom: 4 }}>
                            Follow-up Date
                          </label>
                          <input
                            id="fld-follow-up-date"
                            type="date"
                            className="fld"
                            value={fieldDraft.follow_up_date}
                            onChange={(e) => setFieldDraft((d) => ({ ...d, follow_up_date: e.target.value }))}
                          />
                        </div>

                        <div style={{ gridColumn: '1 / -1' }}>
                          <label className="sub-field-label" htmlFor="fld-remarks" style={{ display: 'block', marginBottom: 4 }}>
                            Inspection Remarks / Notes
                          </label>
                          <textarea
                            id="fld-remarks"
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
                      <FourColumnTable
                        fields={[
                          {
                            key: 'op_name',
                            label: 'Field Verifier',
                            value: record.reassigned_to_name
                              ? `${record.reassigned_to_name}${record.user_name && record.user_name !== record.reassigned_to_name ? ` (Reassigned from ${record.user_name})` : ''}`
                              : (record.user_name ?? 'Not assigned yet'),
                          },
                          {
                            key: 'assigned_at',
                            label: 'Assigned At',
                            value: record.reassigned_at
                              ? formatDateTime(record.reassigned_at)
                              : (record.assigned_at ? formatDateTime(record.assigned_at) : undefined),
                          },
                          {
                            key: 'v_status',
                            label: 'Verification Status',
                            value: (() => {
                              const s = (record.status || '').toUpperCase();
                              if (s === 'NOT_INTERESTED' || s === 'NOT INTERESTED') return 'Not Interested';
                              if (s === 'DUPLICATE') return 'Duplicate';
                              if (s === 'CONSTRUCTION_FINISHED' || s === 'CONSTRUCTION FINISHED') return 'Construction Finished';
                              if (record.is_manually_added || record.source === 'manual') return 'Manually Added';
                              if (record.status === 'Updated Revisited' || record.status === 'UPDATED_REVISITED' || record.revisit_status === 'COMPLETED' || record.status === 'COMPLETED') {
                                return isRevisitOrEdited ? 'Completed (Revisited)' : 'Completed';
                              }
                              return (record.reassigned_to_id != null || record.revisit_status === 'REASSIGNED' || record.revisit_status === 'PENDING_REVISIT') ? 'Reassigned' : 'Pending';
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
                          { key: 'remarks', label: 'Inspection Remarks', value: record.remarks || record.updated_information },
                          { key: 'contr_contact', label: 'Contractor Contact', value: record.site_contractor_architect_number },
                          { key: 'follow_up', label: 'Follow-up Date', value: record.follow_up_date ? formatDate(record.follow_up_date) : undefined },
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
              badges={
                record.telecaller_status ? (
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
                ) : undefined
              }
              action={
                (canAdmin || canAudit) ? (
                  <div className="fancy-action-btn-group">
                    <button
                      type="button"
                      className={`fancy-btn-edit${isEditingTelecaller ? ' active' : ''}`}
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
                      <Icon name={isEditingTelecaller ? 'close' : 'edit'} size={13} />
                      <span>{isEditingTelecaller ? 'Close Edit' : 'Edit Telecaller Details'}</span>
                    </button>
                  </div>
                ) : undefined
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
                      <label className="sub-field-label" htmlFor="fld-tc-floors" style={{ display: 'block', marginBottom: 4 }}>
                        No. of Floors (Telecaller)
                      </label>
                      <input
                        id="fld-tc-floors"
                        type="text"
                        className="fld"
                        placeholder="e.g. G+2"
                        value={telecallerDraft.telecaller_no_of_floors}
                        onChange={(e) => setTelecallerDraft((d) => ({ ...d, telecaller_no_of_floors: e.target.value }))}
                      />
                    </div>

                    <div>
                      <label className="sub-field-label" htmlFor="fld-tc-built-up" style={{ display: 'block', marginBottom: 4 }}>
                        Built-up Area (Telecaller)
                      </label>
                      <input
                        id="fld-tc-built-up"
                        type="text"
                        className="fld"
                        placeholder="e.g. 2500 sq.ft"
                        value={telecallerDraft.telecaller_built_up_area}
                        onChange={(e) => setTelecallerDraft((d) => ({ ...d, telecaller_built_up_area: e.target.value }))}
                      />
                    </div>

                    <div>
                      <label className="sub-field-label" htmlFor="fld-tc-exp-comp" style={{ display: 'block', marginBottom: 4 }}>
                        Expected Completion (Telecaller)
                      </label>
                      <input
                        id="fld-tc-exp-comp"
                        type="text"
                        className="fld"
                        placeholder="e.g. 1 year, Dec 2026"
                        value={telecallerDraft.telecaller_expected_completion}
                        onChange={(e) => setTelecallerDraft((d) => ({ ...d, telecaller_expected_completion: e.target.value }))}
                      />
                    </div>

                    <div>
                      <label className="sub-field-label" htmlFor="fld-tc-stage" style={{ display: 'block', marginBottom: 4 }}>
                        Stage of Construction (Telecaller)
                      </label>
                      <input
                        id="fld-tc-stage"
                        type="text"
                        className="fld"
                        placeholder="e.g. Foundation Work (Piling)"
                        value={telecallerDraft.telecaller_stage_of_construction}
                        onChange={(e) => setTelecallerDraft((d) => ({ ...d, telecaller_stage_of_construction: e.target.value }))}
                      />
                    </div>

                    <div style={{ gridColumn: '1 / -1' }}>
                      <label className="sub-field-label" htmlFor="fld-telecaller-comment" style={{ display: 'block', marginBottom: 4 }}>
                        Telecaller Comments / Conversation Notes
                      </label>
                      <textarea
                        id="fld-telecaller-comment"
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

            {/* 6. Coordinate verification */}
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
                    <span className="rd-label">Field Captured Coordinates</span>
                    <span className="rd-coord-val">
                      <Icon name="near_me" size={14} />
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

              {(record.coordinates || (fieldLat != null && fieldLon != null)) && (
                <div className="rd-map-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="rd-link-btn"
                    onClick={() => {
                      const parts = (record.coordinates || '').split(',').map((s) => s.trim());
                      const lat = parts[0] || (fieldLat != null ? String(fieldLat) : '');
                      const lng = parts[1] || (fieldLon != null ? String(fieldLon) : '');
                      navigate(`/map?record_id=${record.id}&lat=${lat}&lng=${lng}&highlight=blue`);
                    }}
                    title="Open in Geospatial Field Map with focused blue pin"
                  >
                    <Icon name="pin_drop" size={15} />
                    Open in Geospatial Field Map
                  </button>
                  {record.coordinates && (
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
                  )}
                </div>
              )}


            </Section>

            {/* 7. Capture metadata */}
            <Section
              icon="schedule"
              title="Capture Details"
              boxed
            >
              <div className="rd-meta-grid">
                {capturedTime(record) ? (
                  <div className="rd-meta-item">
                    <span className="rd-label">Captured At</span>
                    <span className="rd-meta-val">
                      <Icon name="schedule" size={14} />
                      {formatDateTime(capturedTime(record)!)}
                    </span>
                  </div>
                ) : null}
                <div className="rd-meta-item">
                  <span className="rd-label">Record Created</span>
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
                  <span className="rd-label">GPS Coverage</span>
                  <span className="rd-meta-val">
                    <Icon name="my_location" size={14} />
                    {gpsCount} of {sortedImages.length} frames
                  </span>
                </div>
                <div className="rd-meta-item">
                  <span className="rd-label">Verification</span>
                  <span className="rd-meta-val">
                    <Icon name={allFramesLocated ? 'check_circle' : 'info'} size={14} />
                    {allFramesLocated ? 'All frames geotagged' : 'Partial GPS coverage'}
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
                      <Icon name="near_me" size={14} />
                      ±{(currentImage.location_accuracy ?? 0).toFixed(1)} m
                    </span>
                  </div>
                </div>
              )}
            </Section>

            {/* 8. Record History */}
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

          {/* RIGHT COLUMN — Media Studio (Photo Viewport + Docked Sequence Filmstrip) - Hidden in QA portal */}
          {canAdmin && (
          <div className="record-media-card">
            {sortedImages.length === 0 ? (
              <div className="state-panel" style={{ flex: 1 }}>
                <Icon name="broken_image" size={34} />
                <span>No photos attached to this record.</span>
              </div>
            ) : (
              <>
                {/* Main Photo Viewport */}
                <div
                  className="record-photo-viewport"
                  style={{ cursor: currentImage && !imageFailures[currentImage.id] ? 'zoom-in' : 'default' }}
                  onClick={() => {
                    if (currentImage && !imageFailures[currentImage.id]) setLightbox(selectedImage);
                  }}
                >
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
                          ? 'Image not uploaded yet'
                          : 'Loading image…'}
                      </span>
                    </div>
                  )}

                  {currentImage && (
                    <>
                      {/* Top-Left Chip */}
                      <div className="stage-hud-top-left">
                        <span className="stage-badge">
                          <Icon name="photo_camera" size={13} />
                          Frame {currentImage.photo_order} of {sortedImages.length}
                        </span>
                      </div>

                      {/* Top-Right HUD Actions */}
                      <div className="stage-hud-top-right">
                        {canAdmin && <button
                          type="button"
                          className="stage-action-btn"
                          disabled={!imageBlobUrls[currentImage.id]}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (imageBlobUrls[currentImage.id]) {
                              downloadImage(
                                imageBlobUrls[currentImage.id],
                                photoLabel(record.id, currentImage.photo_order),
                                currentImage.id
                              );
                            }
                          }}
                          title="Download photo"
                        >
                          <Icon name="upload" style={{ transform: 'rotate(180deg)' }} size={14} />
                          <span>Download</span>
                        </button>}
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

                      {/* Floating Previous / Next arrows inside Photo Stage */}
                      {sortedImages.length > 1 && (
                        <>
                          <button
                            type="button"
                            className="stage-nav-arrow stage-nav-prev"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedImage((prev) => (prev > 0 ? prev - 1 : sortedImages.length - 1));
                            }}
                            title="Previous frame (ArrowLeft)"
                          >
                            <Icon name="chevron_left" size={22} />
                          </button>
                          <button
                            type="button"
                            className="stage-nav-arrow stage-nav-next"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedImage((prev) => (prev < sortedImages.length - 1 ? prev + 1 : 0));
                            }}
                            title="Next frame (ArrowRight)"
                          >
                            <Icon name="chevron_right" size={22} />
                          </button>
                        </>
                      )}

                      {/* Bottom HUD: Coordinates & Accuracy */}
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

                {/* Photo Sequence Filmstrip Dock */}
                <div className="record-seq-dock">
                  <div className="seq-dock-header">
                    <div className="seq-dock-title-group">
                      <Icon name="photo_library" size={13} style={{ color: '#64748b' }} />
                      <span className="seq-dock-title">PHOTO SEQUENCE</span>
                    </div>
                    <span className="seq-dock-count mono-sm">{sortedImages.length} frames indexed · Use ← → keys to switch</span>
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
                          title={`Select photo #${img.photo_order}`}
                        >
                          <div className="seq-item-thumb">
                            {loaded ? (
                              <img src={imageBlobUrls[img.id]} alt={`Photo ${img.photo_order}`} className="seq-dock-thumb-img" />
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
          </div>
          )}
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
              {canAdmin && <button
                type="button"
                className="btn btn-soft btn-sm"
                disabled={!imageBlobUrls[lightboxImage.id]}
                onClick={(e) => {
                  e.stopPropagation();
                  if (imageBlobUrls[lightboxImage.id]) {
                    downloadImage(
                      imageBlobUrls[lightboxImage.id],
                      photoLabel(record.id, lightboxImage.photo_order),
                      lightboxImage.id
                    );
                  }
                }}
                style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: 'none' }}
                title="Download full-resolution photo"
              >
                <Icon name="upload" style={{ transform: 'rotate(180deg)' }} />
                Download
              </button>}
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
                {imageFailures[lightboxImage.id]
                  ? 'Image not uploaded yet'
                  : 'Loading image…'}
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

          <div className="lb-foot" onClick={(e) => e.stopPropagation()}>
            <span>
              {photoLabel(record.id, lightboxImage.photo_order)} ·{' '}
              {formatCoords(lightboxImage.latitude, lightboxImage.longitude)}
            </span>
            <span>{formatDateTime(lightboxImage.captured_at)}</span>
          </div>
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

      {/* ─── Edit Record Modal ─── */}
      {canAdmin && showEditModal && (
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
          }}
          onClick={() => setShowEditModal(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 480,
              padding: 24,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2
                style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <Icon name="edit_note" size={20} style={{ color: 'var(--c-royal)' }} />
                Edit Record
              </h2>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowEditModal(false)}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            {editError && (
              <div className="alert alert-error" style={{ marginBottom: 12 }}>
                <Icon name="error" size={16} />
                <span>{editError}</span>
              </div>
            )}
            <div className="field" style={{ marginBottom: 14 }}>
              <label className="field-label" htmlFor="edit-rec-name">
                Record Name
              </label>
              <input
                id="edit-rec-name"
                className="fld"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Record name"
                disabled={savingEdit}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowEditModal(false)}
                disabled={savingEdit}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveEdit}
                disabled={savingEdit || !editName.trim()}
              >
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete Confirmation Modal ─── */}
      {canAdmin && showDeleteModal && (
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
          }}
          onClick={() => setShowDeleteModal(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 420,
              padding: 24,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid #fee2e2',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', marginBottom: 12 }}>
              <Icon name="warning" size={24} />
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' }}>Delete Record?</h2>
            </div>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.5, margin: '0 0 20px 0' }}>
              Are you sure you want to permanently delete <strong>{record.name}</strong> ({formatRecordNo(record.id)})? All attached photos and audit metadata will be removed. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteRecord}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Edited / Revisit History Modal ─── */}
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
              maxWidth: 620,
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
              {/* Revision Card: Latest / Revisit Inspection */}
              <div style={{ border: '1px solid #bfdbfe', borderRadius: 10, background: '#f8fafc', padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#1e3a8a' }}>
                    <Icon name="check_circle" size={16} style={{ color: '#2563eb' }} />
                    Latest Inspection / Revisit Details
                  </span>
                  {record.revisit_status && (
                    <span style={{ background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700 }}>
                      {record.revisit_status}
                    </span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 16px', fontSize: 12 }}>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Reassigned Field Verifier</span>
                    <strong style={{ color: '#0f172a' }}>{record.reassigned_to_name || record.user_name || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Reassigned At</span>
                    <strong style={{ color: '#0f172a' }}>{record.reassigned_at ? formatDateTime(record.reassigned_at) : '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Captured / Inspection Completed</span>
                    <strong style={{ color: '#0f172a' }}>{capturedTime(record) ? formatDateTime(capturedTime(record)!) : '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Updated Coordinates</span>
                    <strong style={{ color: '#0f172a' }}>{record.updated_coordinates || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Last Modified Date</span>
                    <strong style={{ color: '#0f172a' }}>{record.last_modified_at ? formatDateTime(record.last_modified_at) : (record.reassigned_at ? formatDateTime(record.reassigned_at) : (record.assigned_at ? formatDateTime(record.assigned_at) : (record.created_at ? formatDateTime(record.created_at) : '—')))}</strong>
                  </div>
                </div>
                {record.updated_information && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1', fontSize: 12 }}>
                    <span style={{ color: '#64748b', display: 'block', marginBottom: 4 }}>Updated Information / Notes</span>
                    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', color: '#1e293b', whiteSpace: 'pre-wrap' }}>
                      {record.updated_information}
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
                {record.remarks && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e2e8f0', fontSize: 12 }}>
                    <span style={{ color: '#64748b', display: 'block', marginBottom: 4 }}>Initial Remarks</span>
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', color: '#334155', whiteSpace: 'pre-wrap' }}>
                      {record.remarks}
                    </div>
                  </div>
                )}
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

      {/* ─── QC & Audit Details History Modal ─── */}
      {showQcHistoryModal && (
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
          onClick={() => setShowQcHistoryModal(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 820,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
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
