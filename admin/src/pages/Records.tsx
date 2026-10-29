import { SourceBadge } from '../components/SourceBadge';
import { TelecallingInfoModal, FieldVerifierInfoModal, QaInfoModal } from '../components/LeadInfoModals';
import BulkEditModal from '../components/BulkEditModal';
import QaCreateRecordModal from '../components/QaCreateRecordModal';
import { getLatestCommentSummary } from '../utils/telecallerHistory';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { recordsApi, usersApi, SERVER_BASE } from '../services/api';
import type { AuditStatus, CaptureRecord, User } from '../types';
import {
  formatDateTime,
  formatCapturedDateOrTime,
  Icon,
  Avatar,
  EmptyPanel,
  LoadingPanel,
  Pager,
  PageShell,
  AuthThumbnail,
  CustomSelect,
  type IconName,
} from '../components/ui';
import RecordColumnHeader from '../components/RecordColumnHeader';
import { readRecordState, saveRecordState } from '../utils/recordState';
import { useTopHeader } from '../context/HeaderContext';
import { calculateCoordVariance, getFieldCoordinates } from '../utils/geo';
import { ExpandableCellText } from '../components/ExpandableCellText';
import { CoordinateMap } from '../components/CoordinateMap';
import {
  RECORD_GROUPS,
  RecordFieldValue,
  RecordWorkflowDetails,
  recordGroupFields,
  CoordinatesCell,
  MapLinkCell,
  QcCommentsCell,
  QcDoneAtCell,
  QcStatusCell,
  AuditStatusCell,
  capturedTime,
  type RecordView,
} from '../components/RecordWorkflowFields';

const PAGE_SIZE = 15;
/**
 * "All Status" loads a wider page. At 15 rows the page fills up with whichever
 * status was created last (a fresh dispatch batch), so the unfiltered list read
 * as pending-only while the completed records sat on page 2.
 * ponytail: one wide page; group the list by status (pending, then completed)
 * if a single status block ever grows past this.
 */
const ALL_STATUS_PAGE_SIZE = 50;

/** Auditor decision options shown in each row's dropdown. */
/** Google Maps link from a "lat, lng" string — null when no coordinates. */
function gmapUrl(coords?: string | null): string | null {
  const c = (coords || '').trim();
  return c ? `https://www.google.com/maps?q=${encodeURIComponent(c)}` : null;
}


/** Keyless Google Maps embed (interactive viewer) for a "lat, lng" string. */
function gmapEmbedUrl(coords?: string | null): string | null {
  const c = (coords || '').trim();
  return c ? `https://maps.google.com/maps?q=${encodeURIComponent(c)}&z=17&output=embed` : null;
}

import { QC_VHR_OPTIONS, QC_STREET_OPTIONS } from '../utils/qcOptions';

/**
 * Sort keys the toolbar's Sort dropdown already lists. A header click on any
 * other key is appended to the dropdown so the active order is always visible.
 */
const KNOWN_SORT_KEYS = [
  'created_at', 'assigned_at', 'captured_at', 'name', 'id', 'status', 'unique_id',
  'qc_completed_at', 'audit_status', 'audited_by', 'qc_status', 'qc_vhr_comment',
  'qc_street_details', 'date_of_visit', 'type_of_construction',
  'stage_of_construction', 'relationship_with_building', 'building_user_name', 'spoken_with',
  'contact_number', 'site_contractor_architect_name', 'site_contractor_architect_number', 'remarks',
  'telecaller_status', 'telecaller_comment', 'telecaller_called_at',
];

/**
 * Default sort per view: the auditor QC desk opens on QC date; the admin /
 * manager records panel opens on the newest assignment date.
 */
const defaultSortKeyFor = (isAuditorView: boolean) => (isAuditorView ? 'qc_completed_at' : 'assigned_at');

/**
 * Location Verification chip tones for the records table — mirrors the
 * Record Detail page's coordinate-variance chips (10 m exact / 30 m nearby).
 */
export const LOCATION_VERIFICATION_TONE = {
  exact: { label: 'Exact Match', bg: '#ecfdf5', fg: '#059669', dot: '#10b981', border: '#a7f3d0' },
  close: { label: 'Nearby Lock', bg: '#fffbeb', fg: '#b45309', dot: '#f59e0b', border: '#fde68a' },
  far: { label: 'Position Discrepancy', bg: '#fef2f2', fg: '#b91c1c', dot: '#ef4444', border: '#fecaca' },
} as const;

export const AUDIT_OPTIONS = [
  { value: 'APPROVAL', label: 'Approval' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'DISAPPROVAL', label: 'Disapproval' },
  { value: 'COMMERCIAL_PROPERTY', label: 'Commercial Property' },
  { value: 'RE_AUDITED', label: 'Reaudited' },
];

export type UnifiedQcFilter = 'ALL' | 'APPROVAL' | 'DISAPPROVAL' | 'COMMERCIAL_PROPERTY' | 'RE_AUDITED' | 'DONE' | 'PENDING';

export const QC_STATUS_OPTIONS: { value: UnifiedQcFilter; label: string }[] = [
  { value: 'ALL', label: 'All QC Status' },
  { value: 'APPROVAL', label: 'Approval' },
  { value: 'DISAPPROVAL', label: 'Disapproval' },
  { value: 'COMMERCIAL_PROPERTY', label: 'Commercial Property' },
  { value: 'RE_AUDITED', label: 'Reaudited' },
  { value: 'DONE', label: 'QC Done' },
  { value: 'PENDING', label: 'QC Pending' },
];

const AUDIT_CHIP_META: Record<AuditStatus, { label: string; icon: IconName; cls: string; fullTitle: string }> = {
  PENDING: { label: 'Pending', icon: 'pending_actions', cls: 'audit-chip-pending', fullTitle: 'Pending' },
  APPROVAL: { label: 'Approval', icon: 'check_circle', cls: 'audit-chip-approval', fullTitle: 'Approval' },
  DISAPPROVAL: { label: 'Disapproval', icon: 'block', cls: 'audit-chip-disapproval', fullTitle: 'Disapproval' },
  COMMERCIAL_PROPERTY: { label: 'Commercial', icon: 'storefront', cls: 'audit-chip-commercial_property', fullTitle: 'Commercial Property' },
  RE_AUDITED: { label: 'Reaudited', icon: 'history', cls: 'audit-chip-re_audited', fullTitle: 'Reaudited' },
};

/** Compact audit badge used in read-only contexts. */
export function AuditStatusChip({ status }: { status?: AuditStatus | null }) {
  if (!status) {
    return (
      <span className="audit-chip audit-chip-unset" title="No audit decision recorded">
        <Icon name="info" size={13} />
        <span>No audit</span>
      </span>
    );
  }
  const meta = AUDIT_CHIP_META[status] ?? AUDIT_CHIP_META.PENDING;
  return (
    <span className={`audit-chip ${meta.cls}`} title={`Audit status: ${meta.fullTitle || meta.label}`}>
      <Icon name={meta.icon} size={13} />
      <span>{meta.label}</span>
    </span>
  );
}

export function TelecallerStatusChip({ status }: { status?: string | null }) {
  if (!status) return <span style={{ color: '#0f172a', fontWeight: 600 }}>-</span>;
  const s = status.toUpperCase();
  if (s === 'CONSTRUCTION_CONFIRMED' || s === 'CONFIRMED') {
    return (
      <span className="telecaller-chip telecaller-status-confirmed" title="Construction Confirmed">
        <Icon name="check_circle" size={12} />
        Confirmed
      </span>
    );
  }
  if (s === 'CONNECTED_FOLLOW_UP' || s === 'FOLLOW_UP') {
    return (
      <span className="telecaller-chip telecaller-status-followup" title="Connected - Follow Up Needed">
        <Icon name="call" size={12} />
        Follow Up
      </span>
    );
  }
  if (s === 'NOT_REACHABLE' || s === 'UNREACHABLE') {
    return (
      <span className="telecaller-chip telecaller-status-unreachable" title="Ringing / Not Reachable">
        <Icon name="block" size={12} />
        Not Reachable
      </span>
    );
  }
  if (s === 'WRONG_NUMBER') {
    return (
      <span className="telecaller-chip telecaller-status-wrong" title="Wrong / Invalid Number">
        <Icon name="block" size={12} />
        Wrong No
      </span>
    );
  }
  if (s === 'DISCONNECTED_BUSY') {
    return (
      <span className="telecaller-chip telecaller-status-unreachable" title="Call Disconnected / Busy">
        <Icon name="call" size={12} />
        Busy
      </span>
    );
  }
  if (s === 'NOT_INTERESTED') {
    return (
      <span className="telecaller-chip telecaller-status-pending" title="Not Interested">
        <Icon name="block" size={12} />
        Not Interested
      </span>
    );
  }
  if (s === 'PENDING') {
    return (
      <span className="telecaller-chip telecaller-status-pending" title="Pending Call">
        <Icon name="schedule" size={12} />
        Pending
      </span>
    );
  }
  return <span className="telecaller-chip telecaller-status-pending">{status}</span>;
}

function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier) return <span style={{ color: '#0f172a', fontWeight: 600 }}>-</span>;
  const lower = tier.toLowerCase();
  let bg = '#f8fafc';
  let color = '#475569';
  let border = '#e2e8f0';

  if (lower.includes('tier 1') || lower.includes('tier-1') || lower.includes('high')) {
    bg = '#ecfdf5';
    color = '#047857';
    border = '#a7f3d0';
  } else if (lower.includes('tier 2') || lower.includes('tier-2') || lower.includes('moderate') || lower.includes('medium')) {
    bg = '#eff6ff';
    color = '#1d4ed8';
    border = '#bfdbfe';
  } else if (lower.includes('tier 3') || lower.includes('tier-3') || lower.includes('capacity') || lower.includes('low')) {
    bg = '#fef3c7';
    color = '#b45309';
    border = '#fde68a';
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: '0.72rem',
        fontWeight: 700,
        background: bg,
        color: color,
        border: `1px solid ${border}`,
        whiteSpace: 'nowrap',
      }}
      title={tier}
    >
      {tier}
    </span>
  );
}

type DatePreset = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'allTime' | 'custom';

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function toApiStart(date: string): string | undefined {
  return date ? new Date(`${date}T00:00:00+05:30`).toISOString() : undefined;
}
function toApiEnd(date: string): string | undefined {
  return date ? new Date(`${date}T23:59:59.999+05:30`).toISOString() : undefined;
}
function businessToday(): Date {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${date}T12:00:00`);
}
function startOfThisWeek(): Date {
  const now = businessToday();
  const diff = (now.getDay() + 6) % 7; // Monday start
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
}

export default function Records({
  canAdmin = true,
  auditOnly = false,
  canAudit = false,
  canRoute = false,
  pageTitle,
  roleBadge,
  storageKey = 'pc_record_filters',
  currentUser,
}: {
  canAdmin?: boolean;
  auditOnly?: boolean;
  canAudit?: boolean;
  canRoute?: boolean;
  pageTitle?: string;
  roleBadge?: string;
  storageKey?: string;
  currentUser?: User | null;
}) {
  const navigate = useNavigate();
  // Auditor's queue: per-row decision controls, no bulk selection (selection
  // checkboxes and bulk bars belong to the Record Assigner's workflow).
  // Compact Overview is the default and standard view.
  const recordView = 'overview' as RecordView;
  const visibleGroups = RECORD_GROUPS.filter(group => recordView === 'all' || recordView === group.key).map(group =>
    recordView !== 'all' && group.key !== 'imported'
      ? { ...group, fields: [RECORD_GROUPS[0].fields[1], ...recordGroupFields(group.key, recordView)] }
      : { ...group, fields: recordGroupFields(group.key, recordView) });
  const visibleFields = visibleGroups.flatMap(group => group.fields);
  // Every record manager shares one table: auditors get the QC-desk columns,
  // admins and managers get the field-verification columns.
  const isAuditorView = auditOnly && !canRoute;
  const [searchParams] = useSearchParams();
  const [saved] = useState(() => readRecordState(storageKey, {
    page: 1, statusFilter: 'ALL' as 'ALL' | 'NOT_COMPLETED' | 'COMPLETED' | 'MANUALLY_ADDED',
    qcFilter: 'ALL' as 'ALL' | 'DONE' | 'PENDING', auditFilter: '' as '' | AuditStatus,
    search: '', searchInput: '', preset: 'allTime' as DatePreset, dateFrom: '', dateTo: '', userId: '', auditorId: isAuditorView ? (currentUser?.id ? String(currentUser.id) : '') : '',
    sortBy: defaultSortKeyFor(isAuditorView), sortOrder: 'desc' as 'asc' | 'desc', columnFilters: {} as Record<string, string[]>,
  }));
  const [columnFilters, setColumnFilters] = useState(saved.columnFilters);
  const columnFilterKey = JSON.stringify(columnFilters);

  const [records, setRecords] = useState<CaptureRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(saved.page);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'NOT_COMPLETED' | 'COMPLETED' | 'MANUALLY_ADDED' | 'NOT_INTERESTED' | 'DUPLICATE' | 'CONSTRUCTION_FINISHED' | 'CLOSED'>(saved.statusFilter as any);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const lastInteractedHeaderRef = useRef<string | null>(null);
  const savedScrollLeftRef = useRef<number>(0);
  // Unified QC Status filter: All, Approval, Disapproval, Commercial, Reaudited, QC Done, QC Pending.
  const [qcStatusFilter, setQcStatusFilter] = useState<UnifiedQcFilter>(
    (saved.auditFilter as UnifiedQcFilter) || (saved.qcFilter !== 'ALL' ? (saved.qcFilter as UnifiedQcFilter) : 'ALL')
  );
  const [search, setSearch] = useState(saved.search);
  const [searchInput, setSearchInput] = useState(saved.searchInput);
  // Default to "All time" so the list never opens with records silently filtered out.
  const [preset, setPreset] = useState<DatePreset>(saved.preset);
  const [dateFrom, setDateFrom] = useState(saved.dateFrom);
  const [dateTo, setDateTo] = useState(saved.dateTo);
  const [userId, setUserId] = useState(saved.userId);
  const [auditorId, setAuditorId] = useState(isAuditorView ? (currentUser?.id ? String(currentUser.id) : '') : saved.auditorId);
  const [users, setUsers] = useState<User[]>([]);
  const [hasFetchedUsers, setHasFetchedUsers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const defaultSortKey = defaultSortKeyFor(isAuditorView);
  const [sortBy, setSortBy] = useState(saved.sortBy);
  const dateField = isAuditorView ? (qcStatusFilter === 'PENDING' ? 'assigned_at' : 'qc_completed_at') : statusFilter === 'NOT_COMPLETED' ? 'assigned_at' : 'captured_at';
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(saved.sortOrder);
  const requestSeq = useRef(0);

  // Auditor row-details popup: open the full record without leaving the queue.
  // These are only used when isAuditorView is true.
  const [detailRecord, setDetailRecord] = useState<CaptureRecord | null>(null);
  const [showQaCreateModal, setShowQaCreateModal] = useState(false);
  const [qcDraft, setQcDraft] = useState<{
    auditStatus: string;
    vhr: string;
    street: string;
    builder: string;
    sqfeet: string;
    coordinates: string;
    area: string;
    auditComment: string;
    assignedAuditorId: string;
  }>({
    auditStatus: 'APPROVAL',
    vhr: '',
    street: '',
    builder: '',
    sqfeet: '',
    coordinates: '',
    area: '',
    auditComment: '',
    assignedAuditorId: '',
  });
  const [showQcPinPicker, setShowQcPinPicker] = useState(false);
  const [qcSaving, setQcSaving] = useState(false);
  const [qcNotice, setQcNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [streetView, setStreetView] = useState<{ loading: boolean; monthYear: string | null; message: string | null }>({ loading: false, monthYear: null, message: null });
  const [photoViewer, setPhotoViewer] = useState<{ url: string; name: string } | null>(null);
  const [photoViewerLoading, setPhotoViewerLoading] = useState(false);
  const [qcImageUploading, setQcImageUploading] = useState(false);
  const [qcImageDeleting, setQcImageDeleting] = useState(false);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const refFileInputRef = useRef<HTMLInputElement>(null);

  // Sheet Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadClientError, setUploadClientError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    total_rows?: number;
    total_dispatched: number;
    failed_count?: number;
    sheet_name?: string;
    errors: Array<{ row: number; column: string; message: string } | string>;
    dispatched_tasks?: Array<{
      record_id: number;
      unique_id: string;
      operator_email: string;
      operator_name: string;
      site_address: string;
    }>;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [telecallingModalRecord, setTelecallingModalRecord] = useState<CaptureRecord | null>(null);
  const [verifierModalRecord, setVerifierModalRecord] = useState<CaptureRecord | null>(null);
  const [qaModalRecord, setQaModalRecord] = useState<CaptureRecord | null>(null);
  const [exportSections, setExportSections] = useState({
    planning: true,
    audit: true,
    field: true,
    telecaller: true,
    reassign: true,
  });
  const [exportIncludeImages, setExportIncludeImages] = useState(true);

  // Row selection (by record id, so a selection survives paging)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [targetUserId, setTargetUserId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [bulkAuditDecision, setBulkAuditDecision] = useState<string>('');
  const [bulkAuditing, setBulkAuditing] = useState(false);
  const [bulkVerificationStatus, setBulkVerificationStatus] = useState<string>('COMPLETED');
  const [bulkUpdatingStatus, setBulkUpdatingStatus] = useState(false);

  // Delete flow — serves both the checked rows and a single row's action button
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<CaptureRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 });
  const [deleteNotice, setDeleteNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);


  // Record Assigner workflow — route staged rows to an auditor, then release
  // auditor-approved rows to a field verifier.
  const [auditors, setAuditors] = useState<User[]>([]);
  const [routeTo, setRouteTo] = useState('');
  const [verifierTo, setVerifierTo] = useState('');
  const [assigning, setAssigning] = useState(false);

  // Operators (non-admin) or the full user list (admin) for filters + assignment.
  useEffect(() => {
    if (hasFetchedUsers) return;
    let cancelled = false;
    (async () => {
      const all: User[] = [];
      if (!canAdmin) {
        const operators = await recordsApi.assignmentOperators();
        if (!cancelled) { setUsers(operators); setHasFetchedUsers(true); }
        return;
      }
      for (let page = 1; ; page++) {
        const res = await usersApi.list({ page, page_size: 100 });
        all.push(...(res.users || []));
        if (!res.users?.length || all.length >= res.total) break;
      }
      if (!cancelled) {
        setUsers(all);
        setHasFetchedUsers(true);
      }
    })().catch(() => {
      if (!cancelled) setDeleteNotice({ tone: 'error', text: 'Could not load operators. Refresh the page to retry.' });
    });
    return () => { cancelled = true; };
  }, [hasFetchedUsers, canAdmin]);

  // Auditors directory for the assigner's bulk routing action.
  useEffect(() => {
    let cancelled = false;
    recordsApi.auditors()
      .then((list) => { if (!cancelled) setAuditors(list as User[]); })
      .catch(() => { /* dropdown simply stays empty */ });
    return () => { cancelled = true; };
  }, []);

  // Telecallers directory for bulk telecaller assignment
  const [telecallers, setTelecallers] = useState<User[]>([]);
  const [telecallerTo, setTelecallerTo] = useState('');
  const [assigningTelecaller, setAssigningTelecaller] = useState(false);

  useEffect(() => {
    let cancelled = false;
    recordsApi.telecallers()
      .then((list) => { if (!cancelled) setTelecallers(list as User[]); })
      .catch(() => { /* dropdown simply stays empty */ });
    return () => { cancelled = true; };
  }, []);

  /** Open a field photo full-size in the popup's viewer (authenticated fetch → blob URL). */
  const openPhotoViewer = async (img: { image_url?: string; file_name?: string }) => {
    if (!img.image_url || photoViewerLoading) return;
    setPhotoViewerLoading(true);
    try {
      const normalized = img.image_url.startsWith('/api') ? img.image_url : `/api${img.image_url.startsWith('/') ? img.image_url : `/${img.image_url}`}`;
      const token = localStorage.getItem('token');
      const res = await fetch(`${SERVER_BASE}${normalized}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setPhotoViewer({ url: URL.createObjectURL(blob), name: img.file_name || 'Field photo' });
    } catch {
      setPhotoViewer(null);
    } finally {
      setPhotoViewerLoading(false);
    }
  };

  // Revoke blob URLs when replaced or on unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (photoViewer) URL.revokeObjectURL(photoViewer.url);
    };
  }, [photoViewer]);

  // Seed the QC + audit drafts from the record whenever the popup opens.
  useEffect(() => {
    if (detailRecord) {
      setQcDraft({
        auditStatus: detailRecord.audit_status || 'APPROVAL',
        vhr: detailRecord.qc_vhr_comment || '',
        street: detailRecord.qc_street_details || '',
        builder: detailRecord.qc_builder_contact || '',
        sqfeet: detailRecord.qc_sqfeet || '',
        coordinates: detailRecord.coordinates || '',
        area: detailRecord.area || '',
        auditComment: detailRecord.audit_comment || '',
        assignedAuditorId: detailRecord.assigned_auditor_id ? String(detailRecord.assigned_auditor_id) : '',
      });
      setShowQcPinPicker(false);
      setQcNotice(null);
    }
  }, [detailRecord?.id]);

  // Fetch Street View capture info when the popup opens on a coordinate.
  useEffect(() => {
    if (!detailRecord) return;
    const coords = (detailRecord.coordinates || '').trim();
    const m = coords.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) {
      setStreetView({ loading: false, monthYear: null, message: null });
      return;
    }
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    let active = true;
    setStreetView({ loading: true, monthYear: null, message: null });
    recordsApi.streetViewMeta(lat, lng)
      .then((res) => {
        if (!active) return;
        setStreetView({ loading: false, monthYear: res.month_year || null, message: res.available ? null : (res.message || 'Street View unavailable') });
      })
      .catch(() => {
        if (!active) return;
        setStreetView({ loading: false, monthYear: null, message: 'Street View lookup failed' });
      });
    return () => { active = false; };
  }, [detailRecord?.id]);

  const saveQcAssessment = async () => {
    if (!detailRecord || qcSaving) return;

    // Mandatory validation: Audit Decision, QC Comments (VHR Imagery), Street view comments
    const auditStatus = qcDraft.auditStatus?.trim();
    const vhr = qcDraft.vhr?.trim();
    const street = qcDraft.street?.trim();

    if (!auditStatus) {
      setQcNotice({ ok: false, text: 'Audit Decision is mandatory. Please select an audit decision.' });
      return;
    }
    if (!vhr) {
      setQcNotice({ ok: false, text: 'QC Comments (VHR Imagery) is mandatory. Please select a comment.' });
      return;
    }
    if (!street) {
      setQcNotice({ ok: false, text: 'Street view comments is mandatory. Please select a comment.' });
      return;
    }

    setQcSaving(true);
    setQcNotice(null);
    try {
      const coordsChanged = qcDraft.coordinates.trim() !== (detailRecord.coordinates || '').trim();
      const auditorChanged = (qcDraft.assignedAuditorId ? Number(qcDraft.assignedAuditorId) : null) !== (detailRecord.assigned_auditor_id || null);
      const effectiveAuditStatus = (qcDraft.auditStatus as AuditStatus) || ((coordsChanged || auditorChanged) ? 'RE_AUDITED' : ((detailRecord.audit_status as AuditStatus) || 'APPROVAL'));

      await recordsApi.audit(
        detailRecord.id,
        effectiveAuditStatus,
        qcDraft.auditComment.trim() || undefined,
        {
          qc_vhr_comment: qcDraft.vhr.trim() || undefined,
          qc_street_details: qcDraft.street.trim() || undefined,
          qc_builder_contact: qcDraft.builder.trim() || undefined,
          qc_sqfeet: qcDraft.sqfeet.trim() || undefined,
          coordinates: coordsChanged ? qcDraft.coordinates.trim() : undefined,
          area: qcDraft.area.trim() || undefined,
          assigned_auditor_id: qcDraft.assignedAuditorId ? Number(qcDraft.assignedAuditorId) : (auditorChanged ? null : undefined),
        }
      );
      await loadRecords();
      setDetailRecord(null);
      setDeleteNotice({ tone: 'ok', text: `QC assessment saved for ${detailRecord.unique_id || detailRecord.id}.` });
    } catch (err: any) {
      setQcNotice({ ok: false, text: err.response?.data?.detail || 'Could not save QC assessment.' });
    } finally {
      setQcSaving(false);
    }
  };

  const uploadReferenceImage = async (file: File | Blob) => {
    if (!detailRecord || qcImageUploading) return;
    setQcImageUploading(true);
    setQcNotice(null);
    try {
      const updated = await recordsApi.uploadQcReferenceImage(detailRecord.id, file);
      setDetailRecord(updated);
      setRecords((prev) =>
        prev.map((r) =>
          r.id === updated.id
            ? {
                ...r,
                qc_reference_image_key: updated.qc_reference_image_key,
                qc_reference_image_url: updated.qc_reference_image_url,
              }
            : r
        )
      );
      setQcNotice({ ok: true, text: 'QC reference image saved and synced to Google Drive.' });
    } catch (err: any) {
      setQcNotice({
        ok: false,
        text: err.response?.data?.detail || 'Failed to upload QC reference image.',
      });
    } finally {
      setQcImageUploading(false);
    }
  };

  const deleteReferenceImage = async () => {
    if (!detailRecord || qcImageDeleting) return;
    if (!window.confirm('Are you sure you want to remove the QC reference image?')) return;
    setQcImageDeleting(true);
    setQcNotice(null);
    try {
      const updated = await recordsApi.deleteQcReferenceImage(detailRecord.id);
      setDetailRecord(updated);
      setRecords((prev) =>
        prev.map((r) =>
          r.id === updated.id
            ? {
                ...r,
                qc_reference_image_key: null,
                qc_reference_image_url: null,
              }
            : r
        )
      );
      setQcNotice({ ok: true, text: 'QC reference image removed.' });
    } catch (err: any) {
      setQcNotice({
        ok: false,
        text: err.response?.data?.detail || 'Failed to delete QC reference image.',
      });
    } finally {
      setQcImageDeleting(false);
    }
  };

  // Listen for paste anywhere on window when detailRecord popup is open
  useEffect(() => {
    if (!detailRecord) return;
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
  }, [detailRecord?.id, qcImageUploading]);

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    const now = businessToday();
    if (p === 'today' || p === 'yesterday') {
      if (p === 'yesterday') now.setDate(now.getDate() - 1);
      setDateFrom(toISODate(now));
      setDateTo(toISODate(now));
    } else if (p === 'thisWeek') {
      setDateFrom(toISODate(startOfThisWeek()));
      setDateTo(toISODate(now));
    } else if (p === 'thisMonth') {
      setDateFrom(toISODate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setDateTo(toISODate(now));
    } else if (p === 'allTime') {
      setDateFrom('');
      setDateTo('');
    }
    setPage(1);
  };

  useEffect(() => {
    const requestedQc = searchParams.get('qc_status') || searchParams.get('audit_status');
    if (requestedQc && ['ALL', 'APPROVAL', 'DISAPPROVAL', 'COMMERCIAL_PROPERTY', 'RE_AUDITED', 'DONE', 'PENDING'].includes(requestedQc)) {
      setQcStatusFilter(requestedQc as UnifiedQcFilter);
      setColumnFilters({});
      setStatusFilter('ALL');
      setSearch('');
      setSearchInput('');
      setUserId('');
      setAuditorId('');
      setDateFrom('');
      setDateTo('');
      setPreset('allTime');
      setPage(1);
    }
    const operator = searchParams.get('user_id');
    if (operator) setUserId(operator);
    if (!isAuditorView) {
      const status = searchParams.get('status');
      if (status === 'COMPLETED' || status === 'NOT_COMPLETED' || status === 'MANUALLY_ADDED') setStatusFilter(status);
      const requested = searchParams.get('preset');
      if (requested === 'todayCompleted') { setStatusFilter('COMPLETED'); applyPreset('today'); }
      else if (['today', 'yesterday', 'thisWeek', 'allTime'].includes(requested || '')) { applyPreset(requested as DatePreset); }
    } else {
      const requested = searchParams.get('preset');
      if (['today', 'yesterday', 'thisWeek', 'allTime'].includes(requested || '')) { applyPreset(requested as DatePreset); }
    }
  }, [searchParams, isAuditorView]);

  const ALLOWED_HEADER_FILTER_COLUMNS = new Set([
    'unique_id',
    'assigned_at',
    'audit_status',
    'audit_comment',
    'audited_by',
    'qc_status',
    'qc_completed_at',
    'qc_vhr_comment',
    'qc_street_details',
    'qc_sqfeet',
    'user_name',
    'status',
    'captured_at',
    'construction_happening',
    'type_of_construction',
    'stage_of_construction',
    'relationship_with_building',
    'building_user_name',
    'spoken_with',
    'contact_number',
    'site_contractor_architect_name',
    'remarks',
    'site_contractor_architect_number',
    'telecaller_status',
    'telecaller_comment',
    'village',
    'taluk',
    'district',
    'area',
    'priority_tier',
    'coordinates',
    'last_modified_at',
    'follow_up_date',
  ]);

  const sortHeader = (label: string, key: string, width?: number, sortable = true, maxWidth?: number, minWidth?: number) => (
    <RecordColumnHeader
      label={label}
      sortKey={sortable ? key : undefined}
      field={ALLOWED_HEADER_FILTER_COLUMNS.has(key) ? key : undefined}
      sortBy={sortBy}
      sortOrder={sortOrder}
      width={width}
      minWidth={minWidth}
      maxWidth={maxWidth}
      values={columnFilters[key] || []}
      params={listParams(1, activePageSize)}
      onSort={next => {
        if (tableScrollRef.current) {
          savedScrollLeftRef.current = tableScrollRef.current.scrollLeft;
        }
        lastInteractedHeaderRef.current = next;
        setSortOrder(sortBy === next && sortOrder === 'asc' ? 'desc' : 'asc');
        setSortBy(next);
        setPage(1);
      }}
      onFilter={values => {
        if (tableScrollRef.current) {
          savedScrollLeftRef.current = tableScrollRef.current.scrollLeft;
        }
        lastInteractedHeaderRef.current = key;
        setColumnFilters(previous => {
          const next = { ...previous };
          if (values.length) next[key] = values;
          else delete next[key];
          return next;
        });
        setPage(1);
      }}
    />
  );

  const reassignSelected = async () => {
    if (!targetUserId || !selectedIds.size) return;
    setReassigning(true);
    setDeleteNotice(null);
    try {
      const result = await recordsApi.reassign({ record_ids: [...selectedIds], target_user_id: Number(targetUserId) });
      setDeleteNotice({ tone: 'ok', text: result.message });
      setSelectedIds(new Set()); setTargetUserId('');
      if (page !== 1) setPage(1); else await loadRecords();
    } catch (err: any) {
      setDeleteNotice({ tone: 'error', text: err.response?.data?.detail || 'Could not reassign records. Please retry.' });
    } finally { setReassigning(false); }
  };


  /** Bulk-route the selected staged rows to an auditor for review. */
  const routeSelectedToAuditor = async () => {
    if (!routeTo || !selectedIds.size) return;
    setAssigning(true);
    setDeleteNotice(null);
    try {
      const result = await recordsApi.assignAuditor([...selectedIds], Number(routeTo));
      setDeleteNotice({ tone: 'ok', text: result.message });
      setRouteTo('');
      setSelectedIds(new Set());
      await loadRecords();
    } catch (err: any) {
      setDeleteNotice({ tone: 'error', text: err.response?.data?.detail || 'Could not route records to the auditor. Please retry.' });
    } finally {
      setAssigning(false);
    }
  };

  /** Bulk unassign the selected rows from their auditor. */
  const unassignSelectedAuditor = async () => {
    if (!selectedIds.size) return;
    setAssigning(true);
    setDeleteNotice(null);
    try {
      const result = await recordsApi.unassignAuditor([...selectedIds]);
      setDeleteNotice({ tone: 'ok', text: result.message });
      setSelectedIds(new Set());
      await loadRecords();
    } catch (err: any) {
      setDeleteNotice({ tone: 'error', text: err.response?.data?.detail || 'Could not unassign auditors. Please retry.' });
    } finally {
      setAssigning(false);
    }
  };

  /** Bulk-release the selected rows to a field verifier. */
  const assignSelectedVerifier = async () => {
    if (!verifierTo || !selectedIds.size) return;
    setAssigning(true);
    setDeleteNotice(null);
    try {
      const result = await recordsApi.assignVerifier([...selectedIds], Number(verifierTo));
      setDeleteNotice({ tone: 'ok', text: result.message });
      setSelectedIds(new Set());
      setVerifierTo('');
      await loadRecords();
    } catch (err: any) {
      setDeleteNotice({ tone: 'error', text: err.response?.data?.detail || 'Could not assign the field verifier. Please retry.' });
    } finally {
      setAssigning(false);
    }
  };

  /** Bulk unassign the selected rows from their field verifier. */
  const unassignSelectedVerifier = async () => {
    if (!selectedIds.size) return;
    setAssigning(true);
    setDeleteNotice(null);
    try {
      const result = await recordsApi.unassignVerifier([...selectedIds]);
      setDeleteNotice({ tone: 'ok', text: result.message });
      setSelectedIds(new Set());
      await loadRecords();
    } catch (err: any) {
      setDeleteNotice({ tone: 'error', text: err.response?.data?.detail || 'Could not unassign field verifiers. Please retry.' });
    } finally {
      setAssigning(false);
    }
  };

  /** Bulk audit decision on selected records. */
  const applyBulkAudit = async () => {
    if (!bulkAuditDecision || !selectedIds.size) return;
    setBulkAuditing(true);
    setDeleteNotice(null);
    try {
      const result = await recordsApi.bulkAudit(
        [...selectedIds],
        bulkAuditDecision as AuditStatus,
        ''
      );
      setDeleteNotice({ tone: 'ok', text: result.message });
      setSelectedIds(new Set());
      setBulkAuditDecision('');
      await loadRecords();
    } catch (err: any) {
      setDeleteNotice({
        tone: 'error',
        text: err.response?.data?.detail || 'Could not apply bulk audit decision. Please retry.',
      });
    } finally {
      setBulkAuditing(false);
    }
  };

  /** Bulk update verification status on selected records. */
  const applyBulkVerificationStatus = async () => {
    if (!bulkVerificationStatus || !selectedIds.size) return;
    const count = selectedIds.size;
    const statusLabels: Record<string, string> = {
      COMPLETED: 'Completed',
      NOT_COMPLETED: 'Pending',
      NOT_INTERESTED: 'Not Interested',
      DUPLICATE: 'Duplicate',
      CONSTRUCTION_FINISHED: 'Construction Finished',
    };
    const label = statusLabels[bulkVerificationStatus] || bulkVerificationStatus;
    if (!window.confirm(`Are you sure you want to update verification status to "${label}" for ${count} selected record(s)?`)) {
      return;
    }
    setBulkUpdatingStatus(true);
    setDeleteNotice(null);
    try {
      const result = await recordsApi.bulkUpdateStatus(
        Array.from(selectedIds),
        bulkVerificationStatus
      );
      setDeleteNotice({
        tone: 'ok',
        text: result.message || `Successfully updated ${result.updated_count} record(s) to ${label}.`,
      });
      clearSelection();
      await loadRecords();
    } catch (err: any) {
      setDeleteNotice({
        tone: 'error',
        text: err.response?.data?.detail || 'Could not update verification status in bulk. Please retry.',
      });
    } finally {
      setBulkUpdatingStatus(false);
    }
  };

  /** Bulk assign the selected rows to a telecaller. */
  const assignSelectedTelecaller = async () => {
    if (!telecallerTo || !selectedIds.size) return;
    setAssigningTelecaller(true);
    setDeleteNotice(null);
    try {
      const result = await recordsApi.assignTelecaller([...selectedIds], Number(telecallerTo));
      setDeleteNotice({ tone: 'ok', text: result.message });
      setSelectedIds(new Set());
      setTelecallerTo('');
      await loadRecords();
    } catch (err: any) {
      setDeleteNotice({ tone: 'error', text: err.response?.data?.detail || 'Could not assign telecaller. Please retry.' });
    } finally {
      setAssigningTelecaller(false);
    }
  };

  /** Bulk unassign the selected rows from their telecaller. */
  const unassignSelectedTelecaller = async () => {
    if (!selectedIds.size) return;
    setAssigningTelecaller(true);
    setDeleteNotice(null);
    try {
      const result = await recordsApi.unassignTelecaller([...selectedIds]);
      setDeleteNotice({ tone: 'ok', text: result.message });
      setSelectedIds(new Set());
      await loadRecords();
    } catch (err: any) {
      setDeleteNotice({ tone: 'error', text: err.response?.data?.detail || 'Could not unassign telecaller. Please retry.' });
    } finally {
      setAssigningTelecaller(false);
    }
  };

  const activePageSize = statusFilter === 'ALL' ? ALL_STATUS_PAGE_SIZE : PAGE_SIZE;

  /** The active filters — shared by the paged list and "select all matching". */
  const listParams = (pageNo: number, pageSize: number) => ({
    page: pageNo,
    page_size: pageSize,
    status: isAuditorView ? undefined : (statusFilter === 'ALL' ? undefined : statusFilter),
    search: search || undefined,
    user_id: userId && userId !== 'UNASSIGNED' ? Number(userId) : undefined,
    unassigned_user: userId === 'UNASSIGNED' ? true : undefined,
    assigned_auditor_id: isAuditorView
      ? (currentUser?.id || (auditorId && auditorId !== 'UNASSIGNED' ? Number(auditorId) : undefined))
      : (auditorId && auditorId !== 'UNASSIGNED' ? Number(auditorId) : undefined),
    unassigned_auditor: isAuditorView ? undefined : (auditorId === 'UNASSIGNED' ? true : undefined),
    date_from: toApiStart(dateFrom),
    date_to: toApiEnd(dateTo),
    sort_by: sortBy,
    sort_order: sortOrder,
    date_field: dateField,
    qc_status: (qcStatusFilter === 'DONE' || qcStatusFilter === 'PENDING') ? qcStatusFilter : undefined,
    audit_status: ['APPROVAL', 'DISAPPROVAL', 'COMMERCIAL_PROPERTY', 'RE_AUDITED'].includes(qcStatusFilter) ? (qcStatusFilter as AuditStatus) : undefined,
    column_filters: Object.keys(columnFilters).length ? columnFilterKey : undefined,
  });

  const loadRecords = async (opts?: { silent?: boolean }) => {
    const seq = ++requestSeq.current;
    if (!opts?.silent) setLoading(true);
    try {
      const res = await recordsApi.list(listParams(page, activePageSize));
      if (seq !== requestSeq.current) return;
      setRecords(res.records || []);
      setTotal(res.total);
      if (page > Math.max(1, Math.ceil(res.total / activePageSize))) setPage(Math.max(1, Math.ceil(res.total / activePageSize)));
      setLoadError(null);
    } catch (err: any) {
      if (seq === requestSeq.current) setLoadError(err.response?.data?.detail || 'Could not load records. Please retry.');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  // Live sync: while the assigner's merged audit queue is open, silently
  // refetch every 15s so auditor decisions (status + comment) reach the
  // list without a manual refresh. The visible fetch spinner is suppressed
  // so polling never blinks the table.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void loadRecords({ silent: true }); };
    const timer = window.setInterval(() => {
      refresh();
    }, 15000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [auditOnly, page, statusFilter, qcStatusFilter, search, dateFrom, dateTo, userId, auditorId, sortBy, sortOrder, dateField, columnFilterKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchInput.trim() !== search) { setSearch(searchInput.trim()); setPage(1); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput, search]);

  useEffect(() => {
    loadRecords();
  }, [page, statusFilter, qcStatusFilter, search, dateFrom, dateTo, userId, auditorId, sortBy, sortOrder, dateField, columnFilterKey]);

  useEffect(() => {
    if (tableScrollRef.current) {
      if (lastInteractedHeaderRef.current) {
        const targetCol = lastInteractedHeaderRef.current;
        const th = tableScrollRef.current.querySelector<HTMLElement>(`th[data-col="${targetCol}"]`);
        if (th) {
          th.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'auto' });
          savedScrollLeftRef.current = tableScrollRef.current.scrollLeft;
          lastInteractedHeaderRef.current = null;
          return;
        }
      }
      if (savedScrollLeftRef.current > 0) {
        tableScrollRef.current.scrollLeft = savedScrollLeftRef.current;
      }
    }
  }, [records]);

  // A selection only ever refers to the rows the current filters produce, so it
  // is dropped whenever the filters, search or sort change (paging keeps it).
  useEffect(() => {
    setSelectedIds(new Set());
  }, [statusFilter, qcStatusFilter, search, dateFrom, dateTo, userId, auditorId, sortBy, sortOrder, dateField, columnFilterKey]);

  useEffect(() => {
    saveRecordState(storageKey, {
      page,
      statusFilter,
      qcFilter: (qcStatusFilter === 'DONE' || qcStatusFilter === 'PENDING') ? qcStatusFilter : 'ALL',
      auditFilter: ['APPROVAL', 'DISAPPROVAL', 'COMMERCIAL_PROPERTY', 'RE_AUDITED'].includes(qcStatusFilter) ? (qcStatusFilter as AuditStatus) : '',
      search,
      searchInput,
      preset,
      dateFrom,
      dateTo,
      userId,
      auditorId,
      sortBy,
      sortOrder,
      columnFilters,
    });
  }, [storageKey, page, statusFilter, qcStatusFilter, search, searchInput, preset, dateFrom, dateTo, userId, auditorId, sortBy, sortOrder, columnFilterKey]);

  const pageIds = records.map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length;

  const toggleRecord = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllOnPage = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  /**
   * "Select all" beyond this page: walk the filtered list in pages of 100 and
   * collect the ids. Bounded so a huge table can never spin forever.
   */
  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const ids = new Set(selectedIds);
      const CHUNK = 100;
      const MAX_PAGES = 100;
      for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
        const res = await recordsApi.list(listParams(pageNo, CHUNK));
        const batch = res.records || [];
        if (batch.length === 0) break;
        batch.forEach((r) => ids.add(r.id));
        if (ids.size >= res.total || batch.length < CHUNK) break;
      }
      setSelectedIds(ids);
    } finally {
      setSelectingAll(false);
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectingAll(false);
    setBulkAuditDecision('');
    setBulkVerificationStatus('COMPLETED');
  };

  /**
   * Delete records through the same audited endpoint the record detail page
   * uses, one at a time so a single failure cannot abort the batch. Records
   * that fail stay selected so the admin can retry them.
   */
  const deleteRecords = async (ids: number[]) => {
    if (ids.length === 0) return;

    setDeleting(true);
    setDeleteNotice(null);
    setDeleteProgress({ done: 0, total: ids.length });

    const failed: number[] = [];
    for (const id of ids) {
      try {
        await recordsApi.delete(id);
      } catch {
        failed.push(id);
      }
      setDeleteProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }

    const deleted = ids.length - failed.length;
    setDeleting(false);
    setShowDeleteModal(false);
    setRowToDelete(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      failed.forEach((id) => next.add(id));
      return next;
    });
    setDeleteNotice(
      failed.length === 0
        ? { tone: 'ok', text: `${deleted} record${deleted === 1 ? '' : 's'} deleted.` }
        : {
            tone: 'error',
            text: `${deleted} of ${ids.length} records deleted — ${failed.length} could not be removed and stay selected.`,
          }
    );

    // Deleting the last rows of the final page would otherwise leave it blank.
    const remaining = Math.max(0, total - deleted);
    const lastPage = Math.max(1, Math.ceil(remaining / activePageSize));
    const targetPage = Math.min(page, lastPage);
    if (targetPage !== page) setPage(targetPage);
    else await loadRecords();
  };

  // The confirmation modal is shared by "Delete selected" and a row's own delete.
  const pendingDeleteIds = rowToDelete ? [rowToDelete.id] : Array.from(selectedIds);
  const deleteModalOpen = showDeleteModal || rowToDelete !== null;
  const closeDeleteModal = () => {
    if (deleting) return;
    setShowDeleteModal(false);
    setRowToDelete(null);
  };

  const handleReset = () => {
    setSearch('');
    setSearchInput('');
    setStatusFilter('ALL');
    setQcStatusFilter('ALL');
    setColumnFilters({});
    applyPreset('allTime');
    setUserId(''); setAuditorId(isAuditorView ? (currentUser?.id ? String(currentUser.id) : '') : '');
    setSortBy(defaultSortKey);
    setSortOrder('desc');
    setPage(1);
    clearSelection();
  };

  const handleSelectFile = (file: File) => {
    setUploadClientError(null);
    setUploadResult(null);
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) {
      setUploadClientError(
        'CSV format is not supported. Please upload an Excel sheet (.xlsx). If you are using Google Sheets, choose File → Download → Microsoft Excel (.xlsx).'
      );
      setUploadFile(null);
      return;
    }
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      setUploadClientError('Invalid file type. Please upload a Microsoft Excel (.xlsx) file.');
      setUploadFile(null);
      return;
    }
    setUploadFile(file);
  };

  const handleUploadSubmit = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadClientError(null);
    setUploadResult(null);
    try {
      const res = await recordsApi.uploadSheet(uploadFile);
      setUploadResult(res);
      if (res.success) {
        setUploadFile(null);
        loadRecords();
      }
    } catch (err: any) {
      const detailMsg =
        err.response?.data?.detail ||
        (err.message === 'Network Error'
          ? 'Network Error: Unable to reach the backend API server. Check your connection or server status.'
          : err.message) ||
        'Upload failed';
      setUploadResult({
        success: false,
        total_dispatched: 0,
        errors: [{ row: 0, column: 'File', message: detailMsg }],
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      await recordsApi.downloadTemplate();
    } catch (err: any) {
      alert(err.message || 'Failed to download Excel template');
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleExportClick = () => {
    setShowExportModal(true);
  };

  const handleExportConfirm = async () => {
    setExporting(true);
    const activeSecs = Object.entries(exportSections)
      .filter(([_, v]) => v)
      .map(([k]) => k)
      .join(',');

    try {
      await recordsApi.downloadExport({
        status: isAuditorView ? undefined : (statusFilter === 'ALL' ? undefined : statusFilter),
        user_id: userId && userId !== 'UNASSIGNED' ? Number(userId) : undefined,
        unassigned_user: userId === 'UNASSIGNED' ? true : undefined,
        assigned_auditor_id: isAuditorView
          ? (currentUser?.id || (auditorId && auditorId !== 'UNASSIGNED' ? Number(auditorId) : undefined))
          : (auditorId && auditorId !== 'UNASSIGNED' ? Number(auditorId) : undefined),
        unassigned_auditor: isAuditorView ? undefined : (auditorId === 'UNASSIGNED' ? true : undefined),
        search: search || undefined,
        date_from: toApiStart(dateFrom),
        date_to: toApiEnd(dateTo),
        date_field: dateField,
        audit_status: ['APPROVAL', 'DISAPPROVAL', 'COMMERCIAL_PROPERTY', 'RE_AUDITED'].includes(qcStatusFilter) ? (qcStatusFilter as AuditStatus) : undefined,
        column_filters: Object.keys(columnFilters).length ? columnFilterKey : undefined,
        qc_status: (qcStatusFilter === 'DONE' || qcStatusFilter === 'PENDING') ? qcStatusFilter : undefined,
        include_images: exportIncludeImages,
        sections: activeSecs || undefined,
      });
      setShowExportModal(false);
    } catch (err: any) {
      alert(err.message || 'Failed to export Excel report');
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / activePageSize));
  const shownFrom = total === 0 ? 0 : (page - 1) * activePageSize + 1;
  const shownTo = Math.min(page * activePageSize, total);
  const isFiltered =
    !!search ||
    !!userId || (!isAuditorView && !!auditorId) ||
    (!isAuditorView && statusFilter !== 'ALL') ||
    qcStatusFilter !== 'ALL' || Object.keys(columnFilters).length > 0 ||
    preset !== 'allTime' ||
    sortBy !== defaultSortKey ||
    sortOrder !== 'desc' ||
    !!dateFrom || !!dateTo;

  const computedTitle = pageTitle || (isAuditorView ? 'QA Records' : 'Records');
  const computedBadge = roleBadge || (isAuditorView ? 'Auditor' : canAdmin ? 'Admin' : undefined);

  useTopHeader({
    left: (
      <div className="topbar-page-left">
        <h1 className="topbar-page-title">{computedTitle}</h1>
        <span className="count-pill">{total.toLocaleString()}</span>
        {computedBadge && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 9px',
              borderRadius: 6,
              background: isAuditorView ? '#f3e8ff' : '#e0e7ff',
              color: isAuditorView ? '#7c3aed' : '#3730a3',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            {computedBadge}
          </span>
        )}
      </div>
    ),
    right: auditOnly ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowQaCreateModal(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', fontSize: 11, height: 30, borderRadius: 6, fontWeight: 600, background: '#7c3aed', color: '#fff' }}
          title="Create a new lead by picking a point on the map or pasting coordinates"
        >
          <Icon name="add" size={14} />
          <span className="btn-label">+ Create Record</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => navigate('/audit/dashboard')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', fontSize: 11, height: 30, borderRadius: 6 }}
          title="Open QC Analytics Dashboard"
        >
          <Icon name="dashboard" size={14} style={{ color: '#059669' }} />
          <span className="btn-label">QC Dashboard</span>
        </button>
        <span className="topbar-badge-pill" style={{ padding: '3px 8px', fontSize: 11, height: 28, borderRadius: 6 }}>
          <Icon name="fact_check" size={13} style={{ color: '#7c3aed' }} />
          <span className="btn-label">QA Queue</span>
        </span>
      </div>
    ) : canAdmin ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowQaCreateModal(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', fontSize: 11, height: 30, borderRadius: 6, fontWeight: 600, background: '#7c3aed', color: '#fff' }}
          title="Create a new lead by picking a point on the map or pasting coordinates"
        >
          <Icon name="add" size={14} />
          <span className="btn-label">+ Create Record</span>
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => navigate('/records/import-previous')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 11, height: 30, borderRadius: 6 }}
          title="Upload an Excel sheet of field records collected before the app was deployed"
        >
          <Icon name="upload_file" size={14} />
          <span className="btn-label">Import Previous</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setShowBulkEditModal(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 11, height: 30, borderRadius: 6 }}
          title="Bulk update existing leads via Excel template"
        >
          <Icon name="edit_note" size={14} />
          <span className="btn-label">Bulk Edit</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleExportClick}
          disabled={exporting}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 11, height: 30, borderRadius: 6 }}
          title="Export records to Excel (.xlsx) with customizable sections and photos"
        >
          <Icon name="table_view" size={14} />
          <span className="btn-label">{exporting ? 'Exporting…' : 'Export Excel'}</span>
        </button>
        <span className="topbar-badge-pill" style={{ padding: '3px 8px', fontSize: 11, height: 28, borderRadius: 6 }}>
          <Icon name="cloud_done" size={13} style={{ color: '#10b981' }} />
          <span className="btn-label">Sync Active</span>
        </span>
      </div>
    ) : <span className="topbar-badge-pill">Review and monitor records</span>,
  }, [total, exporting, statusFilter, userId, auditorId, search, dateFrom, dateTo, dateField, canAdmin, auditOnly, qcStatusFilter, columnFilterKey]);

  return (
    <PageShell>
      {loadError && <div role="alert" className="record-load-error">{loadError} <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadRecords()}>Retry</button></div>}
      {/* Search and ordering stay above the compact record filters. */}
      <div className="toolbar records-toolbar compact-records-toolbar">
        <div className="toolbar-row toolbar-row-main">
          <div className="search-wrap records-search-wrap">
            <Icon name="search" />
            <input type="search" name="record-search" autoComplete="off" className="fld fld-soft"
              placeholder="Search UID, address, survey no or owner…" value={searchInput}
              onChange={event => { setSearchInput(event.target.value); setPage(1); }} aria-label="Search records" />
            {searchInput && <button type="button" className="search-clear-btn" onClick={() => setSearchInput('')} aria-label="Clear search"><Icon name="close" size={14} /></button>}
          </div>
          <div className="toolbar-inline-group">
            <div className="field filter-sort">
              <span className="field-label">Sort</span>
              <CustomSelect
                value={`${sortBy}:${sortOrder}`}
                onChange={(val) => {
                  const [by, order] = val.split(':') as [string, 'asc' | 'desc'];
                  setSortBy(by);
                  setSortOrder(order);
                  setPage(1);
                }}
                options={[
                  ...(!KNOWN_SORT_KEYS.includes(sortBy) ? [{ value: `${sortBy}:${sortOrder}`, label: `${sortBy.replaceAll('_', ' ')} ${sortOrder === 'asc' ? '↑' : '↓'}` }] : []),
                  { value: 'qc_completed_at:desc', label: 'QA Done at (Newest first)' },
                  { value: 'qc_completed_at:asc', label: 'QA Done at (Oldest first)' },
                  { value: 'date_of_visit:desc', label: 'Date of visit (Newest first)' },
                  { value: 'date_of_visit:asc', label: 'Date of visit (Oldest first)' },
                  { value: 'created_at:desc', label: 'Newest first' },
                  { value: 'created_at:asc', label: 'Oldest first' },
                  { value: 'audit_status:asc', label: 'QC Status (A–Z)' },
                  { value: 'audit_status:desc', label: 'QC Status (Z–A)' },
                  { value: 'unique_id:asc', label: 'Unique ID (A–Z)' },
                  { value: 'unique_id:desc', label: 'Unique ID (Z–A)' },
                  { value: 'name:asc', label: 'Name A–Z' },
                  { value: 'name:desc', label: 'Name Z–A' },
                  { value: 'status:desc', label: 'Inspection (Completed first)' },
                  { value: 'status:asc', label: 'Inspection (Pending first)' },
                  { value: 'captured_at:desc', label: 'Capture date (Newest first)' },
                  { value: 'captured_at:asc', label: 'Capture date (Oldest first)' },
                  { value: 'assigned_at:desc', label: 'Assigned date (Newest first)' },
                  { value: 'assigned_at:asc', label: 'Assigned date (Oldest first)' },
                  { value: 'type_of_construction:asc', label: 'Type of construction (A–Z)' },
                  { value: 'stage_of_construction:asc', label: 'Stage of construction (A–Z)' },
                  { value: 'relationship_with_building:asc', label: 'Relationship with building (A–Z)' },
                  { value: 'building_user_name:asc', label: 'Building user (A–Z)' },
                  { value: 'contact_number:asc', label: 'Contact number (A–Z)' },
                  { value: 'site_contractor_architect_name:asc', label: 'Contractor / architect (A–Z)' },
                  { value: 'site_contractor_architect_number:asc', label: 'Contractor contact (A–Z)' },
                  { value: 'remarks:asc', label: 'Inspection remarks (A–Z)' },
                  { value: 'id:desc', label: 'Record ID high–low' },
                  { value: 'id:asc', label: 'Record ID low–high' },
                ].filter(option => isAuditorView ? (!option.value.startsWith('audit_status:') && !option.value.startsWith('status:')) : (!option.value.startsWith('audit_status:') && !option.value.startsWith('qc_completed_at:')))}
                ariaLabel="Sort records"
              />
            </div>
            {isFiltered && <button type="button" className="btn btn-ghost btn-sm records-reset-btn" onClick={handleReset} aria-label="Reset filters"><Icon name="restart_alt" size={15} />Reset</button>}
          </div>
        </div>
        <div className="toolbar-row records-filter-bar">
          {!isAuditorView && (
            <div className="filter-bar-group filter-assignment">
              <span className="filter-bar-label">Auditor</span>
              <CustomSelect value={auditorId} onChange={value => { setAuditorId(value); setPage(1); }} ariaLabel="Filter by auditor"
                options={[{ value: '', label: 'All auditors' }, { value: 'UNASSIGNED', label: 'Unassigned' }, ...auditors.map(user => ({ value: String(user.id), label: user.full_name || user.email }))]} />
            </div>
          )}
          {canRoute && <div className="filter-bar-group filter-assignment">
            <span className="filter-bar-label">Field verifier</span>
            <CustomSelect value={userId} onChange={value => { setUserId(value); setPage(1); }} ariaLabel="Filter by field verifier"
              options={[{ value: '', label: 'All verifiers' }, { value: 'UNASSIGNED', label: 'Unassigned' }, ...users.filter(user => user.role === 'USER' || user.role === 'FIELD_VERIFIER').map(user => ({ value: String(user.id), label: user.full_name || user.email }))]} />
          </div>}
          {!isAuditorView && (
            <div className="filter-bar-group filter-verification">
              <span className="filter-bar-label">Verification</span>
              <CustomSelect value={statusFilter} onChange={value => { setStatusFilter(value as typeof statusFilter); setPage(1); }} ariaLabel="Filter by verification status"
                options={[
                  { value: 'ALL', label: 'All' },
                  { value: 'COMPLETED', label: 'Completed' },
                  { value: 'NOT_COMPLETED', label: 'Pending' },
                  { value: 'NOT_INTERESTED', label: 'Not Interested' },
                  { value: 'DUPLICATE', label: 'Duplicate' },
                  { value: 'CONSTRUCTION_FINISHED', label: 'Construction Finished' },
                  { value: 'CLOSED', label: 'All Closed' },
                  { value: 'MANUALLY_ADDED', label: 'Manually Added' },
                ]} />
            </div>
          )}
          <div className="filter-bar-group filter-source">
            <span className="filter-bar-label">Source</span>
            <CustomSelect
              value={columnFilters.source?.[0] || ''}
              onChange={(value) => {
                setColumnFilters((prev) => {
                  const copy = { ...prev };
                  if (value) copy.source = [value];
                  else delete copy.source;
                  return copy;
                });
                setPage(1);
              }}
              ariaLabel="Filter by record source"
              options={[
                { value: '', label: 'All sources' },
                { value: 'imported', label: 'Imported' },
                { value: 'qa_portal', label: 'QA User Added' },
                { value: 'manual', label: 'Field User Added' },
                { value: 'captured', label: 'Admin Added' },
              ]}
            />
          </div>
          <div className="filter-bar-group filter-qc-status">
            <span className="filter-bar-label">QC Status</span>
            <CustomSelect
              value={qcStatusFilter}
              onChange={value => { setQcStatusFilter(value as UnifiedQcFilter); setPage(1); }}
              ariaLabel="Filter by QC status"
              options={QC_STATUS_OPTIONS}
            />
          </div>
          <div className="filter-bar-group filter-date-preset">
            <span className="filter-bar-label">Date</span>
            <CustomSelect value={preset} onChange={value => applyPreset(value as DatePreset)} ariaLabel="Filter by date range"
              options={[{ value: 'allTime', label: 'All time' }, { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'thisWeek', label: 'This week' }, { value: 'thisMonth', label: 'This month' }, { value: 'custom', label: 'Custom range' }]} />
          </div>
          {preset === 'custom' && <>
            <label className="filter-bar-group filter-custom-date"><span className="filter-bar-label">From</span>
              <input type="date" name="date-from" className="fld fld-date-input filter-bar-date" value={dateFrom} max={dateTo || undefined}
                onChange={event => { setDateFrom(event.target.value); setPage(1); }} aria-label="Date from" />
            </label>
            <label className="filter-bar-group filter-custom-date"><span className="filter-bar-label">To</span>
              <input type="date" name="date-to" className="fld fld-date-input filter-bar-date" value={dateTo} min={dateFrom || undefined}
                onChange={event => { setDateTo(event.target.value); setPage(1); }} aria-label="Date to" />
            </label>
          </>}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <section className="card selection-bar compact-selection-bar" aria-label="Selected record actions">
          <div className="selection-summary">
            <Icon name="check_circle" size={17} />
            <strong>{selectedIds.size.toLocaleString()} record{selectedIds.size === 1 ? '' : 's'} selected</strong>
            {selectedIds.size < total && <button type="button" className="btn btn-secondary btn-sm" onClick={selectAllMatching} disabled={selectingAll}
              title="Select every record that matches the current filters">
              <Icon name={selectingAll ? 'refresh' : 'playlist_add'} size={14} className={selectingAll ? 'fos-spin' : undefined} />
              {selectingAll ? 'Selecting…' : `Select all ${total.toLocaleString()} matching`}
            </button>}
            <span className="selection-page-count">{selectedOnPage} of {pageIds.length} on this page</span>
            <div className="selection-clear-actions">
              {canAdmin && <button type="button" className="btn btn-danger btn-sm" onClick={() => { setDeleteNotice(null); setShowDeleteModal(true); }}
                disabled={assigning || bulkAuditing || reassigning} title="Permanently delete the selected records"><Icon name="delete" size={14} />Delete</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection} disabled={reassigning} aria-label="Clear selection"><Icon name="close" size={14} />Clear</button>
            </div>
          </div>
          <div className="selection-action-groups">
            {/* 1. QC / Auditor assignment: available to Admin, QA, or when canRoute */}
            {(canRoute || canAudit || isAuditorView) && (
              <div className="selection-action-pair">
                <CustomSelect
                  value={routeTo}
                  onChange={setRouteTo}
                  ariaLabel="Assign or reassign selected records to QC user"
                  options={[
                    { value: '', label: 'Choose QC user…' },
                    ...auditors.map((user) => ({
                      value: String(user.id),
                      label: `${user.full_name || user.email}${user.role ? ` (${user.role})` : ''}`,
                    })),
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!routeTo || assigning || selectingAll || bulkAuditing}
                  onClick={routeSelectedToAuditor}
                  aria-label="Reassign QC user"
                  title="Assign or reassign selected records to the chosen QC user"
                >
                  <Icon name="badge" size={14} />
                  {assigning ? 'Assigning…' : 'Reassign QC'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={assigning || selectingAll || bulkAuditing}
                  onClick={unassignSelectedAuditor}
                  aria-label="Unassign QC user"
                  title="Remove QC user assignment from selected records"
                >
                  <Icon name="person_off" size={14} />
                  Unassign QC
                </button>
              </div>
            )}

            {/* 2. Bulk audit decision: available in Auditor view or when canAudit / canAdmin */}
            {(isAuditorView || canAudit || canAdmin) && (
              <div className="selection-action-pair">
                <CustomSelect
                  value={bulkAuditDecision}
                  onChange={setBulkAuditDecision}
                  ariaLabel="Bulk audit decision for selected records"
                  options={[
                    { value: '', label: 'Audit decision…' },
                    { value: 'APPROVAL', label: 'Approve' },
                    { value: 'PENDING', label: 'Pending' },
                    { value: 'DISAPPROVAL', label: 'Disapprove' },
                    { value: 'COMMERCIAL_PROPERTY', label: 'Commercial Property' },
                    { value: 'RE_AUDITED', label: 'Reaudited' },
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!bulkAuditDecision || bulkAuditing || selectingAll}
                  onClick={applyBulkAudit}
                  aria-label="Apply Decision"
                >
                  <Icon name="fact_check" size={14} />
                  {bulkAuditing ? 'Applying…' : 'Apply'}
                </button>
              </div>
            )}

            {/* 3. Field Verifier assignment (Admins / Managers with canRoute) */}
            {canRoute && (
              <div className="selection-action-pair">
                <CustomSelect
                  value={verifierTo}
                  onChange={setVerifierTo}
                  ariaLabel="Assign selected records to field verifier"
                  options={[
                    { value: '', label: 'Choose verifier…' },
                    ...users
                      .filter((user) => user.is_active && (user.role === 'USER' || user.role === 'FIELD_VERIFIER'))
                      .map((user) => ({ value: String(user.id), label: user.full_name || user.email })),
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!verifierTo || assigning || selectingAll || bulkAuditing}
                  onClick={assignSelectedVerifier}
                  aria-label="Assign to verifier"
                  title="Release selected records to the field verifier"
                >
                  <Icon name="how_to_reg" size={14} />
                  {assigning ? 'Assigning…' : 'Assign'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={assigning || selectingAll || bulkAuditing}
                  onClick={unassignSelectedVerifier}
                  aria-label="Unassign verifier"
                  title="Remove field verifier assignment from selected uncompleted records"
                >
                  <Icon name="person_off" size={14} />
                  Unassign
                </button>
              </div>
            )}

            {/* 4. Telecaller assignment (Admins / Managers with canRoute) */}
            {canRoute && (
              <div className="selection-action-pair">
                <CustomSelect
                  value={telecallerTo}
                  onChange={setTelecallerTo}
                  ariaLabel="Assign selected records to telecaller"
                  options={[
                    { value: '', label: 'Choose telecaller…' },
                    ...telecallers.map((user) => ({ value: String(user.id), label: user.full_name || user.email })),
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!telecallerTo || assigningTelecaller || selectingAll || bulkAuditing}
                  onClick={assignSelectedTelecaller}
                  aria-label="Assign to telecaller"
                  title="Assign selected records to telecaller"
                >
                  <Icon name="call" size={14} />
                  {assigningTelecaller ? 'Assigning…' : 'Assign caller'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={assigningTelecaller || selectingAll || bulkAuditing}
                  onClick={unassignSelectedTelecaller}
                  aria-label="Unassign telecaller"
                  title="Remove telecaller assignment from selected records"
                >
                  <Icon name="person_off" size={14} />
                  Unassign
                </button>
              </div>
            )}

            {/* 5. Field Operator reassignment (if not canRoute and not auditorView) */}
            {!canRoute && !isAuditorView && (
              <div className="selection-action-pair">
                <CustomSelect
                  value={targetUserId}
                  onChange={setTargetUserId}
                  ariaLabel="Reassign records to operator"
                  options={[
                    { value: '', label: 'Choose operator…' },
                    ...users
                      .filter((user) => user.is_active && (user.role === 'USER' || user.role === 'FIELD_VERIFIER'))
                      .map((user) => ({ value: String(user.id), label: user.full_name || user.email })),
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!targetUserId || reassigning || selectingAll || deleting}
                  onClick={reassignSelected}
                >
                  {reassigning ? 'Reassigning…' : 'Reassign'}
                </button>
              </div>
            )}

            {/* Bulk Verification Status update (Completed, Pending, Not Interested, Duplicate, Construction Finished) */}
            {(canAdmin || canRoute || isAuditorView || canAudit) && (
              <div className="selection-action-pair">
                <CustomSelect
                  value={bulkVerificationStatus}
                  onChange={setBulkVerificationStatus}
                  ariaLabel="Bulk update verification status"
                  options={[
                    { value: '', label: 'Verification status…' },
                    { value: 'COMPLETED', label: 'Completed' },
                    { value: 'NOT_COMPLETED', label: 'Pending' },
                    { value: 'NOT_INTERESTED', label: 'Not Interested' },
                    { value: 'DUPLICATE', label: 'Duplicate' },
                    { value: 'CONSTRUCTION_FINISHED', label: 'Construction Finished' },
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!bulkVerificationStatus || bulkUpdatingStatus || selectingAll || bulkAuditing || assigning}
                  onClick={applyBulkVerificationStatus}
                  aria-label="Update Verification Status"
                  title="Update verification status for selected records"
                >
                  <Icon name="task_alt" size={14} />
                  {bulkUpdatingStatus ? 'Updating…' : 'Update Status'}
                </button>
              </div>
            )}
          </div>
          <p className="selection-help">
            {canRoute || canAdmin
              ? 'Bulk update verification status, assign QC users, field verifiers, or telecallers for selected records.'
              : isAuditorView || canAudit
                ? 'Reassign QC users, update verification status, or apply bulk audit decisions for selected records.'
                : 'Reassignment applies to selected pending records.'}
          </p>
        </section>
      )}

      {deleteNotice && (
        <div
          className="card"
          role="status"
          style={{
            padding: '10px 16px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: '0.82rem',
            fontWeight: 600,
            color: deleteNotice.tone === 'ok' ? '#065f46' : '#991b1b',
            border: `1px solid ${deleteNotice.tone === 'ok' ? '#a7f3d0' : '#fecaca'}`,
            background: deleteNotice.tone === 'ok' ? '#ecfdf5' : '#fef2f2',
          }}
        >
          <Icon name={deleteNotice.tone === 'ok' ? 'check_circle' : 'error'} size={16} />
          <span>{deleteNotice.text}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setDeleteNotice(null)}
            style={{ marginLeft: 'auto' }}
            title="Dismiss"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {Object.keys(columnFilters).length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 12,
          }}
        >
          <span style={{ fontWeight: 700, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="filter_alt" size={14} /> Active column filters:
          </span>
          {Object.entries(columnFilters).map(([field, vals]) => (
            <span
              key={field}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: '#e0e7ff',
                color: '#3730a3',
                padding: '2px 8px',
                borderRadius: 999,
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              <span>{field}: {vals.join(', ')}</span>
              <button
                type="button"
                onClick={() => {
                  setColumnFilters(prev => {
                    const next = { ...prev };
                    delete next[field];
                    return next;
                  });
                  setPage(1);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'inline-flex',
                  color: '#4338ca',
                }}
                title={`Remove ${field} filter`}
              >
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleReset}
            style={{ fontSize: 11, height: 24, padding: '0 8px', marginLeft: 'auto', color: '#dc2626' }}
          >
            Reset all
          </button>
        </div>
      )}

      {loading && records.length === 0 && <LoadingPanel text="Loading records…" />}
      {!loading && !loadError && records.length === 0 && isFiltered && (
        <div className="state-panel" style={{ flexDirection: 'column', gap: 12, padding: '36px 20px', textAlign: 'center' }}>
          <Icon name="filter_alt" size={36} style={{ color: '#94a3b8' }} />
          <div style={{ maxWidth: 440 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
              No records match your active filters
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              One or more filters (e.g. column filters, search, or status selection) filtered out all 702 records in the database.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleReset}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, marginTop: 4 }}
          >
            <Icon name="restart_alt" size={16} />
            Reset all filters & show all records
          </button>
        </div>
      )}
      {!loading && !loadError && records.length === 0 && !isFiltered && (
        <EmptyPanel icon="folder_open" text="No records found. Capture a new record from the mobile app or import a task sheet." />
      )}

      {records.length > 0 && (
        <div className="card table-card" style={{ position: 'relative' }}>
          {loading && (
            <div className="table-loading-bar-wrap">
              <div className="table-loading-bar-inner" />
            </div>
          )}
          <div
            className="table-scroll"
            ref={tableScrollRef}
            onScroll={(e) => {
              savedScrollLeftRef.current = e.currentTarget.scrollLeft;
            }}
            style={loading ? { opacity: 0.65, pointerEvents: 'none', transition: 'opacity 150ms ease' } : undefined}
          >
            <table className="fos-table records-table">
              <thead>
{recordView !== 'overview' && <tr className="workflow-group-head">
  {!isAuditorView && <th aria-label="Selection" />}
  {visibleGroups.map(group => <th key={group.key} colSpan={group.fields.length} scope="colgroup">{group.label}</th>)}
</tr>}
<tr>
{!isAuditorView && <th className="rec-select-cell">
                    <input
                      type="checkbox"
                      className="rec-select-box"
                      checked={allOnPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedOnPage > 0 && !allOnPageSelected;
                      }}
                      onChange={toggleAllOnPage}
                      disabled={records.length === 0}
                      aria-label="Select all records on this page"
                      title="Select all records on this page"
                    />
                  </th>}
{recordView !== 'overview' ? visibleFields.map(item => item.sort
  ? <th key={item.key} aria-sort={sortBy === item.sort ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" className="record-sort-heading" onClick={() => { setSortOrder(sortBy === item.sort && sortOrder === 'asc' ? 'desc' : 'asc'); setSortBy(item.sort!); setPage(1); }}>{item.label}<Icon name="unfold_more" size={14} /></button></th>
  : <th key={item.key}>{item.label}</th>) : isAuditorView ? (
  <>
    {sortHeader('Unique ID', 'unique_id', 225, true, 260, 210)}
    {sortHeader('Source', 'source', 140, true, 160)}
    {sortHeader('Last Modified Date', 'last_modified_at', 172, true, 185, 165)}
    {sortHeader('QA Done at', 'qc_completed_at', 145, true, 155)}
    {sortHeader('QC Status', 'qc_status', 125, true, 135, 115)}
    {sortHeader('Audit Status', 'audit_status', 160, true, 180, 150)}
    {sortHeader('Tier', 'priority_tier', 140, true, 160)}
    {sortHeader('QC Comments (VHR Imagery)', 'qc_vhr_comment', 200, true, 220)}
    {sortHeader('Sq.ft', 'qc_sqfeet', 120, true, 130)}
    {sortHeader('Audit Comments', 'audit_comment', 200, true, 220)}
    {sortHeader('Area', 'area', 130, true, 140)}
    {sortHeader('Village', 'village', 125, true, 135)}
    {sortHeader('Taluk', 'taluk', 115, true, 125)}
    {sortHeader('District', 'district', 115, true, 125)}
    {sortHeader('Coordinates', 'coordinates', 155, true, 165)}
    <th style={{ width: 80, minWidth: 75, maxWidth: 90 }}>Map</th>
  </>
) : (
  <>
    {sortHeader('Unique ID', 'unique_id', 225, true, 260, 210)}
    {sortHeader('Source', 'source', 140, true, 160)}
    {sortHeader('Last Modified Date', 'last_modified_at', 172, true, 185, 165)}
    {sortHeader('QC Status', 'qc_status', 125, true, 135, 115)}
    {sortHeader('Audit Status', 'audit_status', 160, true, 180, 150)}
    {sortHeader('Audited By', 'audited_by', 110, true, 120, 100)}
    {sortHeader('Tier', 'priority_tier', 140, true, 160)}
    {sortHeader('QC Comments (VHR Imagery)', 'qc_vhr_comment', 200, true, 220)}
    {sortHeader('QC Additional Details (Street View)', 'qc_street_details', 220, true, 240)}
    {sortHeader('Sq.ft', 'qc_sqfeet', 120, true, 130)}
    {sortHeader('Field Verifier', 'user_name', 135, true, 145)}
    {sortHeader('Verification Status', 'status', 170, true, 195, 155)}
    <th style={{ width: 78, minWidth: 72, maxWidth: 86 }} className="col-photos">Photos</th>
    {sortHeader('Captured / Inspection Completed', 'captured_at', 225, true, 255, 210)}
    <th style={{ width: 100, minWidth: 100, maxWidth: 110 }}>Deviation</th>
    {sortHeader('Constructions Happened', 'construction_happening', 160, true, 175)}
    {sortHeader('Type of Construction', 'type_of_construction', 145, true, 155)}
    {sortHeader('Stage of Construction', 'stage_of_construction', 150, true, 160)}
    {sortHeader('Relationship with Building', 'relationship_with_building', 160, true, 170)}
    {sortHeader('Building User', 'building_user_name', 135, true, 145)}
    {sortHeader('Spoken With', 'spoken_with', 135, true, 145)}
    {sortHeader('Contact Number', 'contact_number', 125, true, 135)}
    {sortHeader('Contractor / Architect', 'site_contractor_architect_name', 155, true, 165)}
    {sortHeader('Inspection Remarks', 'remarks', 200, true, 220)}
    {sortHeader('Contractor Contact', 'site_contractor_architect_number', 125, true, 135)}
    {sortHeader('Telecaller Status', 'telecaller_status', 155, true, 170, 140)}
    {sortHeader('Telecaller Comment', 'telecaller_comment', 200, false, 240, 180)}
    {sortHeader('Follow-up Date', 'follow_up_date', 135, true, 145)}
    {sortHeader('Area', 'area', 130, true, 140)}
    {sortHeader('Village', 'village', 125, true, 135)}
    {sortHeader('Taluk', 'taluk', 115, true, 125)}
    {sortHeader('District', 'district', 115, true, 125)}
    {sortHeader('Coordinates', 'coordinates', 155, true, 165)}
    <th style={{ width: 145, minWidth: 140, maxWidth: 155 }}>Location Verification</th>
    <th style={{ width: 175, minWidth: 165, maxWidth: 195, textAlign: 'center' }}>Quick Modals</th>
  </>
)}
</tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  // No-photo inspections store their GPS fix on the record
                  // itself instead of on a CapturedImage row.
                  const fieldCoords = getFieldCoordinates(r.images) ?? (r.field_latitude != null && r.field_longitude != null
                    ? { latitude: r.field_latitude, longitude: r.field_longitude }
                    : null);
                  const isComplete = r.status === 'COMPLETED' || r.status === 'Updated Revisited' || r.status === 'UPDATED_REVISITED' || r.revisit_status === 'COMPLETED';
                  const coordsDisplay = (r.coordinates && r.coordinates.trim())
                    ? r.coordinates
                    : (fieldCoords
                        ? `${fieldCoords.latitude.toFixed(6)}, ${fieldCoords.longitude.toFixed(6)}`
                        : null);

                  const nil = <span style={{ color: '#0f172a', fontWeight: 600 }}>-</span>;
                  // Empty inspection cells read as a dash instead of a blank gap.
                  const cellText = (value?: string | number | null) =>
                    value == null || value === '' ? nil : <span title={String(value)}>{value}</span>;

                  const isImported = r.source === 'imported';
                  const mapLink = gmapUrl(coordsDisplay);
                  // Distance between the admin-given coordinates and the field
                  // GPS fix (backend computes it; recomputed locally as fallback).
                  const locationVariance = r.deviation_formatted
                    ? { formatted: r.deviation_formatted, status: (r.deviation_status || 'far') as keyof typeof LOCATION_VERIFICATION_TONE }
                    : calculateCoordVariance(r.coordinates, fieldCoords?.latitude ?? null, fieldCoords?.longitude ?? null);
                  const locationTone =
                    LOCATION_VERIFICATION_TONE[locationVariance?.status ?? 'far'] ?? LOCATION_VERIFICATION_TONE.far;

                  return (
                    <tr
                      key={r.id}
                      className={`rowlink${selectedIds.has(r.id) ? ' row-selected' : ''}`}
                      data-source={isImported ? 'imported' : 'captured'}
                      onClick={() => {
                        // Auditor queue: open the full record in a popup so
                        // review never loses the list position.
                        if (isAuditorView) {
                          setDetailRecord(r);
                          return;
                        }
                        if (isImported) {
                          navigate(`/records/imported/${r.id}`);
                        } else {
                          navigate(`/records/${r.id}`);
                        }
                      }}
                      title={isAuditorView ? 'Click for full record details' : 'Open record details'}
                    >
{recordView !== 'overview' ? <>
  {!isAuditorView && <td className="rec-select-cell" onClick={e => e.stopPropagation()}><input type="checkbox" className="rec-select-box" checked={selectedIds.has(r.id)} onChange={() => toggleRecord(r.id)} aria-label={`Select record ${r.unique_id || `#${r.id}`}`} /></td>}
  {visibleFields.map(item => <td key={item.key}><RecordFieldValue record={r} item={item} /></td>)}
</> : isAuditorView ? (
  <>
    <td>
      {r.unique_id ? (
        <span className="mono-sm rec-unique-id" style={{ fontWeight: 700, color: '#0f172a' }}>{r.unique_id}</span>
      ) : nil}
    </td>
    <td><SourceBadge source={r.source} isManual={r.is_manually_added} /></td>
    <td className="rec-last-modified col-last-modified" style={{ whiteSpace: 'nowrap' }} title="When lead was assigned or reassigned">
      {(() => {
        const t = r.last_modified_at || r.reassigned_at || r.assigned_at || r.created_at;
        return t ? formatDateTime(t) : nil;
      })()}
    </td>
    <QcDoneAtCell record={r} />
    <QcStatusCell record={r} />
    <AuditStatusCell record={r} />
    <td><TierBadge tier={r.priority_tier} /></td>
    <QcCommentsCell record={r} />
    <td><div className="rec-text-cell" style={{ fontWeight: 600, color: '#0f172a' }}>{r.qc_sqfeet || '—'}</div></td>
    <td><div className="rec-text-cell"><ExpandableCellText text={r.audit_comment} /></div></td>
    <td><div className="rec-text-cell"><ExpandableCellText text={r.area} /></div></td>
    <td><div className="rec-text-cell"><ExpandableCellText text={r.village} /></div></td>
    <td><div className="rec-text-cell"><ExpandableCellText text={r.taluk} /></div></td>
    <td><div className="rec-text-cell"><ExpandableCellText text={r.district} /></div></td>
    <CoordinatesCell record={r} />
    <MapLinkCell url={mapLink} />
  </>
) : (
<>
{!isAuditorView && <td
                        className="rec-select-cell"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className="rec-select-box"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleRecord(r.id)}
                          aria-label={`Select record ${r.unique_id || `#${r.id}`}`}
                          title="Select this record"
                        />
                      </td>}
{/* 1. Unique ID — the record key operators quote on the phone. */}
<td className="col-unique-id" style={{ minWidth: 210, width: 225, maxWidth: 260, whiteSpace: 'nowrap' }}>
  {r.unique_id ? (
    <span className="mono-sm rec-unique-id" style={{ fontWeight: 700, color: '#0f172a' }}>{r.unique_id}</span>
  ) : nil}
</td>
<td><SourceBadge source={r.source} isManual={r.is_manually_added} /></td>
{/* 2. Last Modified Date — when lead was assigned or reassigned */}
<td className="rec-last-modified col-last-modified" style={{ whiteSpace: 'nowrap' }} title="When lead was assigned or reassigned">
  {(() => {
    const t = r.last_modified_at || r.reassigned_at || r.assigned_at || r.created_at;
    return t ? formatDateTime(t) : nil;
  })()}
</td>
{/* 3. QC Status (QC Done / QC Pending) */}
<QcStatusCell record={r} />
{/* 4. Audit Status (Approval / Disapproval / Commercial / Pending) */}
<AuditStatusCell record={r} />
{/* Audited By */}
<td className="col-audited-by">
  {r.audited_by_name ? (
    <div className="cell-person">
      <Avatar name={r.audited_by_name} size="sm" />
      <span className="pname" style={{ color: '#0f172a', fontWeight: 600 }}>
        {r.audited_by_name}
      </span>
    </div>
  ) : nil}
</td>
{/* Priority Tier */}
<td><TierBadge tier={r.priority_tier} /></td>
{/* QC Comments (VHR Imagery) */}
<QcCommentsCell record={r} />
{/* QC Additional Details (Street View) */}
<td className="col-qc-street-details"><div className="rec-text-cell"><ExpandableCellText text={r.qc_street_details} /></div></td>
{/* Sq.ft */}
<td><div className="rec-text-cell" style={{ fontWeight: 600, color: '#0f172a' }}>{r.qc_sqfeet || '—'}</div></td>
{/* 8. Field Verifier — who the task was released to. */}
<td title={r.unique_id ? `Unique ID: ${r.unique_id}` : undefined}>
  {r.user_id != null ? (
    <div className="cell-person">
      <Avatar name={r.user_name || `User ${r.user_id}`} size="sm" />
      <span className="pname" style={{ color: '#0f172a', fontWeight: 600 }}>
        {r.user_name || `User ${r.user_id}`}
      </span>
    </div>
  ) : (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: r.audit_status === 'APPROVAL' ? '#059669' : '#b45309', fontWeight: 600, fontSize: '0.78rem', whiteSpace: 'nowrap' }}
      title={r.audit_status === 'APPROVAL' ? 'Auditor approved — ready to assign a field verifier' : r.assigned_auditor_name ? `Routed to auditor ${r.assigned_auditor_name} — awaiting decision` : 'Staged — route it to an auditor for review'}>
      <Icon name={r.audit_status === 'APPROVAL' ? 'check_circle' : 'pending_actions'} size={13} />
      {r.audit_status === 'APPROVAL'
        ? 'Ready to assign'
        : r.assigned_auditor_name
          ? `With ${r.assigned_auditor_name}`
          : 'Staged'}
    </span>
  )}
</td>
{/* 9. Verification Status. */}
<td>
  {r.is_manually_added || r.source === 'manual' ? (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1.5px 7px',
        borderRadius: 9999,
        fontSize: '0.70rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        background: '#eff6ff',
        color: '#1d4ed8',
        border: '1px solid #bfdbfe',
        lineHeight: 1,
        height: 20,
      }}
      title="Manually added record"
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />
      Manually Added
    </span>
  ) : r.status ? (() => {
    const s = (r.status || '').toUpperCase();
    const isNotInterested = s === 'NOT_INTERESTED' || s === 'NOT INTERESTED';
    const isDuplicate = s === 'DUPLICATE';
    const isConstructionFinished = s === 'CONSTRUCTION_FINISHED' || s === 'CONSTRUCTION FINISHED';
    const isClosed = isNotInterested || isDuplicate || isConstructionFinished;

    const isReassigned = !isComplete && !isClosed && (r.reassigned_to_id != null || r.revisit_status === 'REASSIGNED' || r.revisit_status === 'PENDING_REVISIT');
    const isRevisited = isComplete && (r.status === 'Updated Revisited' || r.status === 'UPDATED_REVISITED' || r.revisit_status === 'Updated Revisited' || r.revisit_status === 'COMPLETED' || (r.reassigned_to_id != null && (r.updated_coordinates || r.updated_information)));
    
    let bg = isComplete ? '#ecfdf5' : isReassigned ? '#eff6ff' : '#fff7ed';
    let color = isComplete ? '#059669' : isReassigned ? '#1d4ed8' : '#d97706';
    let dotBg = isComplete ? '#10b981' : isReassigned ? '#3b82f6' : '#f59e0b';
    let border = isReassigned ? '1px solid #bfdbfe' : '1px solid transparent';
    let label = isComplete ? 'Completed' : isReassigned ? 'Reassigned' : 'Pending';
    let title = isComplete
      ? (r.status === 'Updated Revisited' || r.status === 'UPDATED_REVISITED' ? 'Field verification completed (Revisit completed)' : 'Field verification completed')
      : isReassigned
      ? 'Reassigned to field verifier — verification pending'
      : r.user_id != null
      ? 'Assigned to a field verifier — inspection pending'
      : 'Not yet assigned to a field verifier';

    if (isNotInterested) {
      bg = '#fef3c7'; color = '#b45309'; dotBg = '#f59e0b'; border = '1px solid #fde68a';
      label = 'Not Interested'; title = 'Owner or contact person not interested / refused verification';
    } else if (isDuplicate) {
      bg = '#ede9fe'; color = '#6d28d9'; dotBg = '#8b5cf6'; border = '1px solid #ddd6fe';
      label = 'Duplicate'; title = 'Duplicate of an existing or already visited site';
    } else if (isConstructionFinished) {
      bg = '#ccfbf1'; color = '#0f766e'; dotBg = '#14b8a6'; border = '1px solid #99f6e4';
      label = 'Construction Finished'; title = 'Construction work is finished on site';
    }
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'nowrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '1.5px 7px',
            borderRadius: 9999,
            fontSize: '0.70rem',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            background: bg,
            color: color,
            border: border,
            lineHeight: 1,
            height: 20,
          }}
          title={title}
        >
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotBg, flexShrink: 0 }} />
          {label}
        </span>
        {isRevisited && (
          <span
            className="revisited-tag"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '1.5px 6px',
              borderRadius: 4,
              fontSize: '0.68rem',
              fontWeight: 700,
              background: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              whiteSpace: 'nowrap',
              lineHeight: 1,
              height: 20,
            }}
            title={`Revisit completed by ${r.reassigned_to_name || r.user_name || 'verifier'}`}
          >
            <Icon name="history" size={11} />
            Revisited
          </span>
        )}
      </div>
    );
  })() : (
    nil
  )}
</td>
{/* Photos — thumbnails with badge count if captured/uploaded */}
<td className="col-photos cell-thumb" onClick={(e) => e.stopPropagation()}>
  {r.images && r.images.length > 0 ? (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        className="photo-thumb-btn"
        onClick={(e) => {
          e.stopPropagation();
          openPhotoViewer(r.images![0]);
        }}
        title={`View photo 1 of ${r.images.length}`}
      >
        <AuthThumbnail
          imageUrl={r.images[0].thumbnail_url || r.images[0].image_url}
          alt={r.images[0].file_name || 'Captured photo'}
          size={36}
        />
      </button>
      {r.images.length > 1 && (
        <span className="photo-count-chip">+{r.images.length - 1}</span>
      )}
    </div>
  ) : nil}
</td>
{/* 10. Captured / Inspection Completed. */}
<td style={{ whiteSpace: 'nowrap' }} className="col-captured-at">
  {(() => {
    const raw = capturedTime(r);
    return raw ? formatCapturedDateOrTime(raw) : nil;
  })()}
</td>
{/* 11. Deviation — metres between the admin-given fix and the field GPS. */}
<td style={{ whiteSpace: 'nowrap' }}>
  {locationVariance ? (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1.5px 7px',
        borderRadius: 9999,
        fontSize: '0.70rem',
        fontWeight: 700,
        background: locationTone.bg,
        color: locationTone.fg,
        border: `1px solid ${locationTone.border}`,
        lineHeight: 1,
        height: 20,
      }}
      title={`Field GPS is ${locationVariance.formatted} from the admin-given position (exact ≤ 10 m, nearby ≤ 30 m)`}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: locationTone.dot, flexShrink: 0 }} />
      {locationVariance.formatted}
    </span>
  ) : (
    <span style={{ color: '#94a3b8', fontWeight: 600, fontSize: '0.72rem' }} title="No field GPS fix yet — location cannot be verified">
      Not captured
    </span>
  )}
</td>
{/* Constructions Happened */}
<td>
  {r.construction_happening ? (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1.5px 7px',
        borderRadius: 9999,
        fontSize: '0.70rem',
        fontWeight: 700,
        background: r.construction_happening.toLowerCase() === 'yes' ? '#ecfdf5' : '#fef2f2',
        color: r.construction_happening.toLowerCase() === 'yes' ? '#047857' : '#b91c1c',
        border: `1px solid ${r.construction_happening.toLowerCase() === 'yes' ? '#a7f3d0' : '#fecaca'}`,
        lineHeight: 1,
        height: 20,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: r.construction_happening.toLowerCase() === 'yes' ? '#10b981' : '#ef4444', flexShrink: 0 }} />
      {r.construction_happening}
    </span>
  ) : (
    nil
  )}
</td>
{/* 12. Type of Construction */}
<td>{cellText(r.type_of_construction)}</td>
{/* 13. Stage of Construction */}
<td>{cellText(r.stage_of_construction)}</td>
{/* 14. Relationship with Building */}
<td><div className="rec-text-cell"><ExpandableCellText text={r.relationship_with_building} /></div></td>
{/* 15. Building User */}
<td>{cellText(r.building_user_name)}</td>
{/* 15b. Spoken With */}
<td>{cellText(r.spoken_with)}</td>
{/* 16. Contact Number */}
<td className="mono-sm" style={{ whiteSpace: 'nowrap' }}>{cellText(r.contact_number)}</td>
{/* 17. Contractor / Architect */}
<td><div className="rec-text-cell"><ExpandableCellText text={r.site_contractor_architect_name} /></div></td>
{/* 18. Inspection Remarks */}
<td className="col-remarks"><div className="rec-text-cell"><ExpandableCellText text={r.remarks} /></div></td>
{/* 19. Contractor Contact */}
<td className="mono-sm" style={{ whiteSpace: 'nowrap' }}>{cellText(r.site_contractor_architect_number)}</td>
{/* Telecaller Status & Comment */}
<td className="col-telecaller-status">
  <TelecallerStatusChip status={r.telecaller_status} />
</td>
<td className="col-telecaller-comment">
  <div className="rec-text-cell">
    <ExpandableCellText text={getLatestCommentSummary(r.telecaller_comment)} />
  </div>
</td>
{/* Follow-up / Revisit Date (Auto Reassign) */}
<td style={{ whiteSpace: 'nowrap' }}>
  {r.follow_up_date ? (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: '0.72rem',
        fontWeight: 600,
        background: '#eff6ff',
        color: '#1d4ed8',
        border: '1px solid #bfdbfe',
      }}
      title={`Auto-reassigned / Follow-up scheduled for: ${r.follow_up_date}`}
    >
      <Icon name="event" size={13} style={{ color: '#2563eb' }} />
      <span>{r.follow_up_date}</span>
    </span>
  ) : (
    nil
  )}
</td>
{/* 20-22. Area, Village, Taluk, District */}
<td><div className="rec-text-cell"><ExpandableCellText text={r.area} /></div></td>
<td><div className="rec-text-cell"><ExpandableCellText text={r.village} /></div></td>
<td><div className="rec-text-cell"><ExpandableCellText text={r.taluk} /></div></td>
<td><div className="rec-text-cell"><ExpandableCellText text={r.district} /></div></td>
{/* 23. Coordinates — the admin-given fix, else the field GPS capture. */}
<CoordinatesCell record={r} />
{/* 24. Location Verification — status chip plus the Maps deep link. */}
<td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
  {locationVariance ? (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1.5px 7px',
        borderRadius: 9999,
        fontSize: '0.70rem',
        fontWeight: 700,
        background: locationTone.bg,
        color: locationTone.fg,
        border: `1px solid ${locationTone.border}`,
        lineHeight: 1,
        height: 20,
      }}
      title={`Field GPS is ${locationVariance.formatted} from the admin-given position (exact ≤ 10 m, nearby ≤ 30 m)`}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: locationTone.dot, flexShrink: 0 }} />
      {locationTone.label}
    </span>
  ) : (
    <span style={{ color: '#94a3b8', fontWeight: 600, fontSize: '0.72rem' }} title="No field GPS fix yet — location cannot be verified">
      Not captured
    </span>
  )}
  
</td>
{/* Quick Modals Column with 3 dedicated buttons */}
<td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      style={{
        padding: '3px 8px',
        fontSize: '0.72rem',
        fontWeight: 600,
        height: 28,
        minHeight: 28,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: r.telecaller_status ? '#eff6ff' : '#f8fafc',
        border: `1px solid ${r.telecaller_status ? '#bfdbfe' : '#e2e8f0'}`,
        color: r.telecaller_status ? '#1d4ed8' : '#475569',
      }}
      onClick={(e) => {
        e.stopPropagation();
        setTelecallingModalRecord(r);
      }}
      title="View Telecalling Information"
    >
      <Icon name="call" size={13} style={{ color: r.telecaller_status ? '#2563eb' : '#64748b' }} />
      <span>Telecalling</span>
    </button>

    <button
      type="button"
      className="btn btn-secondary btn-sm"
      style={{
        padding: '3px 8px',
        fontSize: '0.72rem',
        fontWeight: 600,
        height: 28,
        minHeight: 28,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: isComplete ? '#ecfdf5' : '#f8fafc',
        border: `1px solid ${isComplete ? '#a7f3d0' : '#e2e8f0'}`,
        color: isComplete ? '#047857' : '#475569',
      }}
      onClick={(e) => {
        e.stopPropagation();
        setVerifierModalRecord(r);
      }}
      title="View Field Verifier Information"
    >
      <Icon name="photo_camera" size={13} style={{ color: isComplete ? '#059669' : '#64748b' }} />
      <span>Verifier</span>
    </button>

    <button
      type="button"
      className="btn btn-secondary btn-sm"
      style={{
        padding: '3px 8px',
        fontSize: '0.72rem',
        fontWeight: 600,
        height: 28,
        minHeight: 28,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: r.audit_status === 'APPROVAL' ? '#ecfdf5' : r.audit_status === 'DISAPPROVAL' ? '#fef2f2' : '#f8fafc',
        border: `1px solid ${r.audit_status === 'APPROVAL' ? '#a7f3d0' : r.audit_status === 'DISAPPROVAL' ? '#fecaca' : '#e2e8f0'}`,
        color: r.audit_status === 'APPROVAL' ? '#047857' : r.audit_status === 'DISAPPROVAL' ? '#b91c1c' : '#475569',
      }}
      onClick={(e) => {
        e.stopPropagation();
        setQaModalRecord(r);
      }}
      title="View QA & Audit Information"
    >
      <Icon name="fact_check" size={13} style={{ color: r.audit_status === 'APPROVAL' ? '#059669' : r.audit_status === 'DISAPPROVAL' ? '#dc2626' : '#64748b' }} />
      <span>QA</span>
    </button>
  </div>
</td>
</>
)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span className="table-foot-note">
              Showing {shownFrom}–{shownTo} of {total.toLocaleString()}
            </span>
            <Pager
              page={page}
              totalPages={totalPages}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (checked rows, or one row's action) */}
      {canAdmin && deleteModalOpen && (
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
          onClick={closeDeleteModal}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 460,
              padding: 24,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid #fee2e2',
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-record-title"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', marginBottom: 12 }}>
              <Icon name="warning" size={24} />
              <h2 id="delete-record-title" style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                {rowToDelete
                  ? `Delete ${rowToDelete.unique_id || `record #${rowToDelete.id}`}?`
                  : `Delete ${pendingDeleteIds.length} record${pendingDeleteIds.length === 1 ? '' : 's'}?`}
              </h2>
            </div>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.5, margin: '0 0 20px 0' }}>
              {rowToDelete ? (
                <>
                  This permanently removes this record, including any attached photos and capture metadata.
                  This action cannot be undone.
                </>
              ) : (
                <>
                  This permanently removes the {pendingDeleteIds.length} selected record
                  {pendingDeleteIds.length === 1 ? '' : 's'}, including any attached photos and capture metadata.
                  This action cannot be undone.
                </>
              )}
            </p>
            {deleting && deleteProgress.total > 1 && (
              <div style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 16 }}>
                Deleting… {deleteProgress.done} of {deleteProgress.total}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={closeDeleteModal}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => deleteRecords(pendingDeleteIds)}
                disabled={deleting}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Icon
                  name={deleting ? 'refresh' : 'delete'}
                  size={15}
                  className={deleting ? 'fos-spin' : undefined}
                />
                {deleting
                  ? 'Deleting…'
                  : rowToDelete
                    ? 'Delete record'
                    : `Delete ${pendingDeleteIds.length} record${pendingDeleteIds.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sheet Upload Modal */}
      {canAdmin && showUploadModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            overflowY: 'auto',
          }}
          onClick={() => !uploading && setShowUploadModal(false)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              maxWidth: 640,
              width: '100%',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '90vh',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: '20px 24px 16px',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    backgroundColor: '#ecfdf5',
                    color: '#059669',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon name="dataset" size={26} />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                    Import Tasks from Excel / Google Sheets
                  </h2>
                  <p style={{ fontSize: '0.825rem', color: '#64748b', margin: '4px 0 0 0' }}>
                    Assign field inspection tasks to operators using their registered email
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn-icon"
                disabled={uploading}
                onClick={() => setShowUploadModal(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#64748b',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                title="Close"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {/* Google Sheets Instruction Callout */}
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  fontSize: '0.825rem',
                  color: '#334155',
                }}
              >
                <Icon name="info" size={18} style={{ color: '#d97706', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <strong>Working in Google Sheets?</strong> Simply open your sheet, click{' '}
                  <span style={{ backgroundColor: '#e2e8f0', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                    File → Download → Microsoft Excel (.xlsx)
                  </span>
                  , then upload the downloaded file below. CSV format is not supported.
                </div>
              </div>

              {/* Drag & Drop File Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleSelectFile(e.dataTransfer.files[0]);
                  }
                }}
                style={{
                  border: isDragOver ? '2px dashed #2563eb' : '2px dashed #cbd5e1',
                  borderRadius: 12,
                  padding: '24px 20px',
                  textAlign: 'center',
                  backgroundColor: isDragOver ? '#eff6ff' : '#f8fafc',
                  transition: 'all 0.15s ease',
                  marginBottom: 16,
                }}
              >
                <input
                  type="file"
                  id="task-sheet-input-xlsx"
                  accept=".xlsx, .xls, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleSelectFile(e.target.files[0]);
                    }
                  }}
                />

                {uploadFile ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 10,
                        backgroundColor: '#dcfce7',
                        color: '#16a34a',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name="dataset" size={28} />
                    </div>
                    <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.95rem' }}>
                      {uploadFile.name}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      {(uploadFile.size / 1024).toFixed(1)} KB &bull; Microsoft Excel (.xlsx)
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <label
                        htmlFor="task-sheet-input-xlsx"
                        style={{
                          fontSize: '0.78rem',
                          color: '#2563eb',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          fontWeight: 500,
                        }}
                      >
                        Change file
                      </label>
                      <span style={{ color: '#cbd5e1' }}>|</span>
                      <button
                        type="button"
                        onClick={() => {
                          setUploadFile(null);
                          setUploadClientError(null);
                        }}
                        style={{
                          fontSize: '0.78rem',
                          color: '#ef4444',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          fontWeight: 500,
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label
                    htmlFor="task-sheet-input-xlsx"
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 10,
                        backgroundColor: '#e0f2fe',
                        color: '#0284c7',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name="upload" size={28} />
                    </div>
                    <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.925rem' }}>
                      Click to browse or drag & drop Excel (.xlsx) file
                    </span>
                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Strictly supports Microsoft Excel sheets (.xlsx)
                    </span>
                  </label>
                )}
              </div>

              {/* Client-side File Validation Alert */}
              {uploadClientError && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#991b1b',
                    fontSize: '0.825rem',
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}
                >
                  <Icon name="error" size={18} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                  <div>{uploadClientError}</div>
                </div>
              )}

              {/* Template download & rules banner */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '10px 14px',
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: '0.78rem', color: '#475569' }}>
                  <div style={{ fontWeight: 600, color: '#1e293b' }}>Assignment Rule:</div>
                  Tasks are assigned via the <strong>operator_email</strong> column.
                </div>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  disabled={downloadingTemplate}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: '0.8rem',
                    color: '#0284c7',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    padding: '5px 10px',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                  title="Download standard template with sample rows"
                >
                  <Icon name="download" size={14} />
                  <span>{downloadingTemplate ? 'Downloading…' : 'Download Template (.xlsx)'}</span>
                </button>
              </div>

              {/* Upload Result / Error Details */}
              {uploadResult && (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    backgroundColor: uploadResult.success ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${uploadResult.success ? '#bbf7d0' : '#fecaca'}`,
                    color: uploadResult.success ? '#166534' : '#991b1b',
                    fontSize: '0.85rem',
                    marginBottom: 12,
                  }}
                >
                  {uploadResult.success ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                      <Icon name="check_circle" size={20} style={{ color: '#16a34a' }} />
                      <span>
                        Successfully dispatched {uploadResult.total_dispatched} task
                        {uploadResult.total_dispatched === 1 ? '' : 's'} to field operators!
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 6 }}>
                      <Icon name="error" size={20} style={{ color: '#dc2626' }} />
                      <span>Upload could not be completed</span>
                    </div>
                  )}

                  {uploadResult.failed_count && uploadResult.failed_count > 0 ? (
                    <div style={{ fontSize: '0.8rem', color: '#b91c1c', marginTop: 4 }}>
                      {uploadResult.failed_count} row{uploadResult.failed_count === 1 ? '' : 's'} could not be dispatched due to errors.
                    </div>
                  ) : null}

                  {uploadResult.errors && uploadResult.errors.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 6, color: '#991b1b' }}>
                        Row Validation Breakdown:
                      </div>
                      <div
                        style={{
                          maxHeight: 180,
                          overflowY: 'auto',
                          borderRadius: 6,
                          border: '1px solid #fecaca',
                          backgroundColor: '#ffffff',
                        }}
                      >
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#7f1d1d' }}>
                              <th style={{ padding: '6px 10px', textAlign: 'left', width: 60 }}>Row</th>
                              <th style={{ padding: '6px 10px', textAlign: 'left', width: 110 }}>Field</th>
                              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {uploadResult.errors.map((err, i) => {
                              const isObj = typeof err === 'object' && err !== null;
                              const rowNum = isObj ? (err as any).row : '—';
                              const colName = isObj ? (err as any).column : 'File';
                              const msg = isObj ? (err as any).message : String(err);
                              return (
                                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', color: '#334155' }}>
                                  <td style={{ padding: '6px 10px', fontWeight: 600, color: '#991b1b' }}>
                                    {rowNum ? `Row ${rowNum}` : 'General'}
                                  </td>
                                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: '0.74rem' }}>
                                    {colName}
                                  </td>
                                  <td style={{ padding: '6px 10px', color: '#b91c1c' }}>{msg}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 10,
                padding: '16px 24px',
                borderTop: '1px solid #f1f5f9',
                backgroundColor: '#f8fafc',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                disabled={uploading}
                onClick={() => setShowUploadModal(false)}
              >
                {uploadResult?.success ? 'Done' : 'Cancel'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!uploadFile || uploading}
                onClick={handleUploadSubmit}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: '#16a34a',
                  borderColor: '#16a34a',
                }}
              >
                <Icon name="upload" size={16} />
                <span>{uploading ? 'Processing & Dispatching…' : 'Upload & Dispatch Tasks'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Options Modal */}
      {showExportModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !exporting && setShowExportModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Export Records Options"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 560,
              maxHeight: 'min(92vh, 680px)',
              boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '16px 22px',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    backgroundColor: '#eff6ff',
                    color: '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon name="table_view" size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                    Export Records to Excel
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                    Exporting <strong>{total.toLocaleString()}</strong> matching records based on current filters
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowExportModal(false)}
                disabled={exporting}
                style={{ color: '#94a3b8' }}
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            {/* Body */}
            <div
              style={{
                padding: '16px 22px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                overflowY: 'auto',
                flex: 1,
                minHeight: 0,
              }}
            >
              {/* Sections Selection */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b' }}>
                    Select Data Sections to Include:
                  </label>
                  <div style={{ display: 'flex', gap: 8, fontSize: '0.74rem' }}>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                      onClick={() => setExportSections({ planning: true, audit: true, field: true, telecaller: true, reassign: true })}
                      disabled={exporting}
                    >
                      Select All
                    </button>
                    <span style={{ color: '#cbd5e1' }}>•</span>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0 }}
                      onClick={() => setExportSections({ planning: true, audit: false, field: false, telecaller: false, reassign: false })}
                      disabled={exporting}
                    >
                      Site Only
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {/* Planning Section */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 9,
                      border: `1.5px solid ${exportSections.planning ? '#93c5fd' : '#e2e8f0'}`,
                      backgroundColor: exportSections.planning ? '#f0f7ff' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={exportSections.planning}
                      onChange={(e) => setExportSections((s) => ({ ...s, planning: e.target.checked }))}
                      disabled={exporting}
                      style={{ marginTop: 2, width: 15, height: 15, accentColor: '#2563eb' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>
                        1. Site & Task Planning (Imported Data)
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 1, lineHeight: 1.35 }}>
                        Unique ID, Coordinates, Site Address, Village, Taluk, District, Survey No, Land Use, Owner Name
                      </div>
                    </div>
                  </label>

                  {/* Audit Section */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 9,
                      border: `1.5px solid ${exportSections.audit ? '#93c5fd' : '#e2e8f0'}`,
                      backgroundColor: exportSections.audit ? '#f0f7ff' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={exportSections.audit}
                      onChange={(e) => setExportSections((s) => ({ ...s, audit: e.target.checked }))}
                      disabled={exporting}
                      style={{ marginTop: 2, width: 15, height: 15, accentColor: '#2563eb' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>
                        2. Audit & QA Review (DC Data)
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 1, lineHeight: 1.35 }}>
                        QC Status, QA User, QC VHR Comments, Street View Additional Details, Builder Contact, Audited At
                      </div>
                    </div>
                  </label>

                  {/* Field Verification Section */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 9,
                      border: `1.5px solid ${exportSections.field ? '#93c5fd' : '#e2e8f0'}`,
                      backgroundColor: exportSections.field ? '#f0f7ff' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={exportSections.field}
                      onChange={(e) => setExportSections((s) => ({ ...s, field: e.target.checked }))}
                      disabled={exporting}
                      style={{ marginTop: 2, width: 15, height: 15, accentColor: '#2563eb' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>
                        3. Field Verification & Inspection (Field Verifier Data)
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 1, lineHeight: 1.35 }}>
                        Field Verifier, Verification Status, Field GPS Coordinates, Deviation, Type & Stage of Construction, Contacts, Remarks
                      </div>
                    </div>
                  </label>

                  {/* Telecaller Section */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 9,
                      border: `1.5px solid ${exportSections.telecaller ? '#93c5fd' : '#e2e8f0'}`,
                      backgroundColor: exportSections.telecaller ? '#f0f7ff' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={exportSections.telecaller}
                      onChange={(e) => setExportSections((s) => ({ ...s, telecaller: e.target.checked }))}
                      disabled={exporting}
                      style={{ marginTop: 2, width: 15, height: 15, accentColor: '#2563eb' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>
                        4. Telecaller Details (Telecaller Data)
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 1, lineHeight: 1.35 }}>
                        Assigned Telecaller, Telecaller Status, Telecaller Comment, Telecaller Called At, Telecaller Done By
                      </div>
                    </div>
                  </label>

                  {/* Reassign Section */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 9,
                      border: `1.5px solid ${exportSections.reassign ? '#93c5fd' : '#e2e8f0'}`,
                      backgroundColor: exportSections.reassign ? '#f0f7ff' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={exportSections.reassign}
                      onChange={(e) => setExportSections((s) => ({ ...s, reassign: e.target.checked }))}
                      disabled={exporting}
                      style={{ marginTop: 2, width: 15, height: 15, accentColor: '#2563eb' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>
                        5. Reassign & Revisit Columns
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 1, lineHeight: 1.35 }}>
                        Reassigned Field Verifier, Reassign Date, Revisit Status, Updated Coordinates, Updated Information
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Photos & Images Option */}
              <div style={{ paddingTop: 4, borderTop: '1px solid #f1f5f9' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: 8 }}>
                  Photo Attachments:
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 9,
                    border: `1.5px solid ${exportIncludeImages ? '#a7f3d0' : '#e2e8f0'}`,
                    backgroundColor: exportIncludeImages ? '#f0fdf4' : '#ffffff',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={exportIncludeImages}
                    onChange={(e) => setExportIncludeImages(e.target.checked)}
                    disabled={exporting}
                    style={{ marginTop: 2, width: 15, height: 15, accentColor: '#059669' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="photo_library" size={15} style={{ color: '#059669' }} />
                      Include Photos Sheet with Embedded Images
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 1, lineHeight: 1.35 }}>
                      Embeds thumbnail images in a secondary &ldquo;Photos&rdquo; sheet. Disable to download a lightning-fast, lightweight spreadsheet without images.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 10,
                padding: '14px 22px',
                borderTop: '1px solid #f1f5f9',
                backgroundColor: '#f8fafc',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                disabled={exporting}
                onClick={() => setShowExportModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={exporting || (!exportSections.planning && !exportSections.audit && !exportSections.field && !exportSections.telecaller && !exportSections.reassign)}
                onClick={handleExportConfirm}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 160, justifyContent: 'center' }}
              >
                <Icon name={exporting ? 'refresh' : 'download'} size={15} className={exporting ? 'fos-spin' : undefined} />
                <span>{exporting ? 'Exporting Report…' : 'Export Excel (.xlsx)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auditor row-details popup: full record without leaving the queue */}
      {detailRecord && (
        <div
          className="auditor-popup-backdrop"
          onClick={() => setDetailRecord(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Record ${detailRecord.unique_id || detailRecord.id} details`}
            className="auditor-popup-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="auditor-popup-header">
              <div className="auditor-popup-header-lead">
                <div className="auditor-popup-icon-badge">
                  <Icon name="folder_open" size={18} />
                </div>
                <div className="auditor-popup-titles">
                  <div className="auditor-popup-title-row">
                    <h2 className="auditor-popup-title">
                      {detailRecord.unique_id || `Record #${detailRecord.id}`}
                    </h2>
                    {!isAuditorView && <AuditStatusChip status={detailRecord.audit_status} />}
                    <span className="auditor-role-pill">QA Review</span>
                  </div>
                  {detailRecord.name && detailRecord.name !== detailRecord.unique_id && (
                    <span className="auditor-popup-subtitle">{detailRecord.name}</span>
                  )}
                </div>
              </div>
              <div className="auditor-popup-header-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', height: 28, padding: '0 10px', borderRadius: 6, fontWeight: 600, color: '#0369a1', borderColor: '#bae6fd', background: '#f0f9ff' }}
                  onClick={() => navigate(`/records/${detailRecord.id}`)}
                  title="Open full record details page to edit all sections"
                >
                  <Icon name="open_in_new" size={13} />
                  <span>Open Full Record</span>
                </button>
                <button
                  type="button"
                  className="auditor-popup-close-btn"
                  onClick={() => setDetailRecord(null)}
                  aria-label="Close details"
                  title="Close (Esc)"
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
            </div>

            <div className="auditor-popup-body">
              {/* Top media section: Map & Photos */}
              <div className={`auditor-media-grid ${detailRecord.images && detailRecord.images.length > 0 ? 'has-photos' : 'map-only'}`}>
                {/* Location Map */}
                <div className="auditor-card auditor-map-card">
                  <div className="auditor-card-header">
                    <div className="auditor-card-title-wrap">
                      <Icon name="map" size={15} className="auditor-card-icon" />
                      <span className="auditor-card-title">Location Map & Street View</span>
                    </div>
                    {streetView.loading && (
                      <span className="auditor-pill auditor-pill-loading">
                        <Icon name="refresh" size={12} className="fos-spin" /> Checking Street View…
                      </span>
                    )}
                    {!streetView.loading && streetView.monthYear && (
                      <span
                        className="auditor-pill auditor-pill-streetview"
                        title={`Google Street View imagery captured in ${streetView.monthYear}`}
                      >
                        <Icon name="photo_camera" size={12} />
                        Street View: {streetView.monthYear}
                      </span>
                    )}
                    {!streetView.loading && !streetView.monthYear && streetView.message && (
                      <span className="auditor-pill auditor-pill-muted" title={streetView.message}>
                        {streetView.message}
                      </span>
                    )}
                    {gmapUrl(detailRecord.coordinates) && (
                      <a
                        className="auditor-external-btn"
                        href={gmapUrl(detailRecord.coordinates)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open this location in Google Maps (satellite view)"
                      >
                        <Icon name="open_in_new" size={13} />
                        <span>View on GMap</span>
                      </a>
                    )}
                  </div>
                  {gmapEmbedUrl(detailRecord.coordinates) ? (
                    <iframe
                      title={`Map of ${detailRecord.unique_id || detailRecord.id}`}
                      src={gmapEmbedUrl(detailRecord.coordinates)!}
                      width="100%"
                      height={240}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      allowFullScreen
                      className="auditor-map-frame"
                    />
                  ) : (
                    <div className="auditor-map-empty">
                      <Icon name="location_on" size={24} />
                      <p>No coordinates registered for this task — map view unavailable.</p>
                    </div>
                  )}
                </div>

                {/* Field Photos - Hidden in QA / Auditor portal */}
                {!isAuditorView && detailRecord.images && detailRecord.images.length > 0 && (
                  <div className="auditor-card auditor-photos-card">
                    <div className="auditor-card-header">
                      <div className="auditor-card-title-wrap">
                        <Icon name="photo_library" size={15} className="auditor-card-icon" />
                        <span className="auditor-card-title">Field Inspection Photos</span>
                      </div>
                      <span className="auditor-pill auditor-pill-count">
                        {detailRecord.images.length} photo{detailRecord.images.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="auditor-photos-scroller">
                      {detailRecord.images.map((img) => (
                        <button
                          key={img.id}
                          type="button"
                          className="auditor-photo-item"
                          onClick={() => openPhotoViewer(img)}
                          title={`${img.file_name || 'Photo'}${img.captured_at ? ` — ${formatDateTime(img.captured_at)}` : ''} — click to view full size`}
                        >
                          <AuthThumbnail imageUrl={img.image_url} alt={img.file_name || 'Field photo'} size={88} />
                          <span className="auditor-photo-zoom-hint">
                            <Icon name="fullscreen" size={14} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Record Details: specifications grid with 2-line clamp, show more down arrow button, show more for all, and no description */}
              <div className="auditor-details-container">
                <RecordWorkflowDetails record={detailRecord} />
              </div>

              

              {/* QC assessment + audit decision card */}
              {canAudit && (
                <div className="auditor-card auditor-qc-card">
                  <div className="auditor-qc-header">
                    <div className="auditor-qc-title-wrap">
                      <div className="auditor-qc-icon-badge">
                        <Icon name="verified" size={17} />
                      </div>
                      <div>
                        <h3 className="auditor-qc-title">QC Assessment</h3>
                        <p className="auditor-qc-subtitle">
                          Review VHR satellite imagery and Street View to complete the QC assessment
                        </p>
                      </div>
                    </div>
                    <div className="auditor-qc-actions">
                      {qcNotice && (
                        <span className={`auditor-qc-notice ${qcNotice.ok ? 'is-ok' : 'is-error'}`}>
                          <Icon name={qcNotice.ok ? 'check_circle' : 'error'} size={14} />
                          <span>{qcNotice.text}</span>
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn btn-primary auditor-save-btn"
                        onClick={saveQcAssessment}
                        disabled={qcSaving}
                      >
                        {qcSaving ? <Icon name="refresh" size={14} className="fos-spin" /> : <Icon name="save" size={14} />}
                        <span>{qcSaving ? 'Saving…' : 'Save QC Assessment'}</span>
                      </button>
                    </div>
                  </div>
                  <div className="auditor-qc-grid">
                    <div className="auditor-form-group">
                      <label className="sub-field-label" htmlFor="qc-audit-status">
                        Audit Decision <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <CustomSelect
                        value={qcDraft.auditStatus}
                        onChange={(val) => setQcDraft((d) => ({ ...d, auditStatus: val }))}
                        options={[
                          { value: 'APPROVAL', label: 'Approval (Release to field operator)' },
                          { value: 'PENDING', label: 'Pending (Hold for review)' },
                          { value: 'DISAPPROVAL', label: 'Disapproval (Reject / do not visit)' },
                          { value: 'COMMERCIAL_PROPERTY', label: 'Commercial Property' },
                          { value: 'RE_AUDITED', label: 'Re-Audited / QC Updated' },
                        ]}
                        ariaLabel="Audit Decision"
                      />
                    </div>
                    <div className="auditor-form-group">
                      <label className="sub-field-label" htmlFor="qc-vhr">
                        QC Comments (VHR Imagery) <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <CustomSelect
                        value={qcDraft.vhr}
                        onChange={(val) => setQcDraft((d) => ({ ...d, vhr: val }))}
                        options={[
                          { value: '', label: 'Select comments' },
                          ...(qcDraft.vhr && !QC_VHR_OPTIONS.some((o) => o.toLowerCase() === qcDraft.vhr.trim().toLowerCase())
                            ? [{ value: qcDraft.vhr.trim(), label: qcDraft.vhr.trim() }]
                            : []),
                          ...QC_VHR_OPTIONS.map((o) => ({ value: o, label: o })),
                        ]}
                        ariaLabel="QC comments from VHR imagery"
                      />
                    </div>
                    <div className="auditor-form-group">
                      <label className="sub-field-label" htmlFor="qc-street">
                        Street view comments <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <CustomSelect
                        value={qcDraft.street}
                        onChange={(val) => setQcDraft((d) => ({ ...d, street: val }))}
                        options={[
                          { value: '', label: 'Select comments' },
                          ...(qcDraft.street && !QC_STREET_OPTIONS.some((o) => o.toLowerCase() === qcDraft.street.trim().toLowerCase())
                            ? [{ value: qcDraft.street.trim(), label: qcDraft.street.trim() }]
                            : []),
                          ...QC_STREET_OPTIONS.map((o) => ({ value: o, label: o })),
                        ]}
                        ariaLabel="QC comments from Street view"
                      />
                    </div>
                    <div className="auditor-form-group">
                      <label className="sub-field-label" htmlFor="qc-builder">
                        Builder / Contact Details (if seen in Street View)
                      </label>
                      <input
                        id="qc-builder"
                        type="text"
                        className="fld auditor-input"
                        maxLength={2000}
                        placeholder="e.g. G Square, 089395 40008"
                        value={qcDraft.builder}
                        onChange={(e) => setQcDraft((d) => ({ ...d, builder: e.target.value }))}
                      />
                    </div>
                    <div className="auditor-form-group">
                      <label className="sub-field-label" htmlFor="qc-area">
                        Area
                      </label>
                      <input
                        id="qc-area"
                        type="text"
                        className="fld auditor-input"
                        maxLength={100}
                        placeholder="e.g. Saravanampatti, Tatabad, Peelamedu"
                        value={qcDraft.area}
                        onChange={(e) => setQcDraft((d) => ({ ...d, area: e.target.value }))}
                      />
                    </div>
                    <div className="auditor-form-group">
                      <label className="sub-field-label" htmlFor="qc-sqfeet">
                        Sq.ft
                      </label>
                      <input
                        id="qc-sqfeet"
                        type="text"
                        className="fld auditor-input"
                        maxLength={50}
                        placeholder="e.g. 1500, 2400 sq.ft"
                        value={qcDraft.sqfeet}
                        onChange={(e) => setQcDraft((d) => ({ ...d, sqfeet: e.target.value }))}
                      />
                    </div>
                    <div className="auditor-form-group">
                      <label className="sub-field-label" htmlFor="qc-audit-comment">
                        Audit Comments
                      </label>
                      <textarea
                        id="qc-audit-comment"
                        className="fld auditor-textarea"
                        rows={2}
                        maxLength={2000}
                        placeholder="Enter audit remarks or review comments"
                        value={qcDraft.auditComment}
                        onChange={(e) => setQcDraft((d) => ({ ...d, auditComment: e.target.value }))}
                      />
                    </div>
                    <div className="auditor-form-group">
                      <label className="sub-field-label">
                        Assigned QA / QC User
                      </label>
                      <div
                        id="qc-assigned-auditor"
                        style={{
                          height: 38,
                          padding: '0 12px',
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
                        <Icon name="badge" size={15} style={{ color: '#0284c7' }} />
                        <span>
                          {(() => {
                            const found = auditors.find((user) => String(user.id) === String(qcDraft.assignedAuditorId));
                            if (found) {
                              return `${found.full_name || found.email}${found.role ? ` (${found.role})` : ''}`;
                            }
                            return (
                              detailRecord.assigned_auditor_name ||
                              detailRecord.qc_by_name ||
                              (qcDraft.assignedAuditorId ? `Auditor #${qcDraft.assignedAuditorId}` : 'Unassigned')
                            );
                          })()}
                        </span>
                      </div>
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
                          onClick={() => setShowQcPinPicker(!showQcPinPicker)}
                        >
                          <Icon name={showQcPinPicker ? 'expand_less' : 'map'} size={13} />
                          {showQcPinPicker ? 'Hide pin map' : 'Edit pin location'}
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          id="qc-coordinates"
                          type="text"
                          className="fld"
                          style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                          placeholder="Latitude, Longitude (e.g. 11.016844, 76.955832)"
                          value={qcDraft.coordinates}
                          onChange={(e) => setQcDraft((d) => ({ ...d, coordinates: e.target.value }))}
                        />
                        {qcDraft.coordinates.trim() !== (detailRecord.coordinates || '').trim() && (
                          <span style={{ fontSize: '0.75rem', color: '#0284c7', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            Coordinates edited (Re-Audit)
                          </span>
                        )}
                      </div>
                      {showQcPinPicker && (() => {
                        const parts = (qcDraft.coordinates || detailRecord.coordinates || '').split(',').map((s) => parseFloat(s.trim()));
                        const lat = !isNaN(parts[0]) ? parts[0] : 11.016844;
                        const lng = !isNaN(parts[1]) ? parts[1] : 76.955832;
                        return (
                          <div style={{ marginTop: 6, borderRadius: 8, overflow: 'hidden', border: '1px solid #cbd5e1' }}>
                            <CoordinateMap
                              latitude={lat}
                              longitude={lng}
                              height={200}
                              editable={true}
                              onCoordinatesChange={(newCoords) => setQcDraft((d) => ({ ...d, coordinates: newCoords }))}
                            />
                          </div>
                        );
                      })()}
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

                      {detailRecord.qc_reference_image_url ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
                          <div
                            style={{ position: 'relative', width: 90, height: 70, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: '1px solid #cbd5e1', flexShrink: 0, background: '#0f172a' }}
                            onClick={() => openPhotoViewer({ image_url: detailRecord.qc_reference_image_url || undefined, file_name: `QC Reference - ${detailRecord.unique_id || detailRecord.id}` })}
                            title="Click to view full image"
                          >
                            <img
                              src={`${SERVER_BASE}${detailRecord.qc_reference_image_url}?thumb=true`}
                              alt="QC Reference"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = `${SERVER_BASE}${detailRecord.qc_reference_image_url}`;
                              }}
                            />
                            <div
                              style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
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
                                onClick={() => openPhotoViewer({ image_url: detailRecord.qc_reference_image_url || undefined, file_name: `QC Reference - ${detailRecord.unique_id || detailRecord.id}` })}
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


                  </div>
                </div>
              )}

              {detailRecord.status !== 'COMPLETED' && detailRecord.status !== 'Updated Revisited' && detailRecord.status !== 'UPDATED_REVISITED' && detailRecord.field_captured_at == null && detailRecord.images?.length === 0 && (
                <div className="auditor-empty-inspection-notice">
                  <Icon name="info" size={15} />
                  <span>Field inspection not completed yet — this task has no captured photos or GPS fix.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full-size photo viewer overlay (above the details popup) */}
      {photoViewer && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(2, 6, 23, 0.88)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setPhotoViewer(null)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: 860, marginBottom: 10 }}>
            <strong style={{ color: '#f8fafc', fontSize: '0.9rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {photoViewer.name}
            </strong>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={(e) => { e.stopPropagation(); setPhotoViewer(null); }}
              aria-label="Close photo viewer"
              title="Close"
              style={{ color: '#f8fafc' }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <img
            src={photoViewer.url}
            alt={photoViewer.name}
            style={{ maxWidth: '100%', maxHeight: '82vh', borderRadius: 10, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', display: 'block' }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
          {/* Modals */}
      {showQaCreateModal && (
        <QaCreateRecordModal
          isOpen={showQaCreateModal}
          onClose={() => setShowQaCreateModal(false)}
          onSuccess={(newRec) => {
            setShowQaCreateModal(false);
            loadRecords();
            setDeleteNotice({ tone: 'ok', text: `Lead ${newRec.unique_id || `#${newRec.id}`} created successfully!` });
          }}
        />
      )}
      {showBulkEditModal && (
        <BulkEditModal
          isOpen={showBulkEditModal}
          onClose={() => setShowBulkEditModal(false)}
          onSuccess={() => {
            setShowBulkEditModal(false);
            loadRecords();
          }}
        />
      )}
      {telecallingModalRecord && (
        <TelecallingInfoModal
          record={telecallingModalRecord}
          onClose={() => setTelecallingModalRecord(null)}
        />
      )}
      {verifierModalRecord && (
        <FieldVerifierInfoModal
          record={verifierModalRecord}
          onClose={() => setVerifierModalRecord(null)}
        />
      )}
      {qaModalRecord && (
        <QaInfoModal
          record={qaModalRecord}
          onClose={() => setQaModalRecord(null)}
        />
      )}

    </PageShell>
  );
}