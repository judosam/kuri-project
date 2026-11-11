/**
 * Import Records — Kuri Upload Specification & Task Dispatch.
 *
 * Supports two distinct workflows:
 * 1. Kuri GIS Upload Specification (Primary):
 *    - 12 GIS signals validation (all-or-nothing reject rules for lat/lon, Village Master, Coimbatore taluk, area > 0).
 *    - Site ID pre-assignment check (strictly rejected if present; platform mints CBE-XXXXXX).
 *    - 40m spatial deduplication (50m for multiunit projects; updates metadata rather than duplicating).
 *    - ~11m coordinate collision handling (stores reference in old_unique_id).
 *    - Sub-threshold plots (<1,500 sq ft) imported with "Not Eligible" warning pre-check for QC.
 *    - TNGIS WFS Cadastral Auto-Resolution (Survey Number, Sub-division Number, ULPIN).
 *    - 2-Step wizard: Step 1 Dry-Run inspection -> Step 2 Atomic Commit.
 *
 * 2. Legacy Task Sheet Dispatch (Secondary):
 *    - Streaming NDJSON dispatch of inspection tasks to field operators.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { recordsApi } from '../services/api';
import { Icon, InfoHint, PageShell } from '../components/ui';
import { describeApiError } from '../utils/errors';
import { validateExcelFile } from '../utils/validators';

interface DispatchedTask {
  record_id: number;
  unique_id: string;
  operator_email?: string | null;
  operator_name?: string | null;
  auditor_email?: string | null;
  auditor_name?: string | null;
  site_address: string;
  village?: string;
  taluk?: string;
  district?: string;
  staged?: boolean;
}

interface DispatchResult {
  success: boolean;
  total_rows: number;
  total_dispatched: number;
  failed_count: number;
  skipped_duplicates_count?: number;
  duplicate_warnings?: Array<{ row: number; column: string; message: string }>;
  auto_resolved_count?: number;
  sheet_name: string;
  errors: Array<{ row: number; column: string; message: string }>;
  dispatched_tasks: DispatchedTask[];
}

interface ProgressLogItem {
  id: string;
  text: string;
  success: boolean;
  autoResolved?: boolean;
}

interface ImportLiveProgress {
  current: number;
  total: number;
  percent: number;
  status: string;
  autoResolvedCount: number;
  logs: ProgressLogItem[];
}

// GIS Specification Ingestion Types
interface GisValidationError {
  row: number;
  column: string;
  reason: string;
}

interface GisValidationWarning {
  row: number;
  column: string;
  type: string;
  message: string;
}

interface GisCandidateItem {
  row_num: number;
  lat: number;
  lon: number;
  village: string;
  taluk: string;
  district: string;
  detection_type: string;
  detected_stage: string;
  area_sqm: number;
  area_sqft: number;
  is_eligible: boolean;
  model_confidence_score: number;
  priority_tier: string;
  meets_strict_construction_definition: boolean;
  contradicts_planetscope_vegetated: boolean;
  dtcp_building_type?: string;
  gmaps_link: string;
}

interface GisMergedCandidate {
  row_num: number;
  existing_record_id: number;
  existing_unique_id: string;
  distance_m: number;
  lat: number;
  lon: number;
  parsed_data: GisCandidateItem;
}

interface GisValidationResponse {
  valid: boolean;
  rejected?: boolean;
  reject_reason?: string;
  total_rows: number;
  valid_count: number;
  errors: GisValidationError[];
  warnings: GisValidationWarning[];
  merged_candidates: GisMergedCandidate[];
  new_candidates: GisCandidateItem[];
  parsed_rows?: GisCandidateItem[];
}

interface GisCommittedRecord {
  record_id: number;
  unique_id: string;
  action: string;
  village?: string;
  taluk?: string;
  survey_no?: string;
  subdivision_no?: string;
  ulpin?: string;
  is_eligible?: boolean;
  cadastral_status?: string;
}

interface GisCommitResponse {
  valid: boolean;
  committed: boolean;
  created_count: number;
  merged_count: number;
  total_processed: number;
  committed_records: GisCommittedRecord[];
  updated_records: any[];
  warnings: GisValidationWarning[];
}

type TabMode = 'gis_specification' | 'legacy_dispatch';
type Step = 'pick' | 'inspect' | 'committed';

const ACCEPT_ALL = '.xlsx, .xls, .csv';

export default function ImportRecords() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabMode>('gis_specification');

  // GIS Specification State
  const [gisFile, setGisFile] = useState<File | null>(null);
  const [gisStep, setGisStep] = useState<Step>('pick');
  const [gisDragOver, setGisDragOver] = useState(false);
  const [gisInspecting, setGisInspecting] = useState(false);
  const [gisCommitting, setGisCommitting] = useState(false);
  const [gisError, setGisError] = useState('');
  const [gisValidation, setGisValidation] = useState<GisValidationResponse | null>(null);
  const [gisCommitResult, setGisCommitResult] = useState<GisCommitResponse | null>(null);
  const [gisSetName, setGisSetName] = useState<string>('CBE Corporation');
  const gisInputRef = useRef<HTMLInputElement>(null);

  // Legacy Task Sheet State
  const [legacyFile, setLegacyFile] = useState<File | null>(null);
  const [legacyStep, setLegacyStep] = useState<'pick' | 'review'>('pick');
  const [legacyDragOver, setLegacyDragOver] = useState(false);
  const [legacyImporting, setLegacyImporting] = useState(false);
  const [legacyDownloading, setLegacyDownloading] = useState(false);
  const [legacyError, setLegacyError] = useState('');
  const [legacyResult, setLegacyResult] = useState<DispatchResult | null>(null);
  const [legacyLiveProgress, setLegacyLiveProgress] = useState<ImportLiveProgress | null>(null);
  const [legacySetName, setLegacySetName] = useState<string>('CBE Corporation');
  const legacyInputRef = useRef<HTMLInputElement>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // GIS Specification Handlers
  // ──────────────────────────────────────────────────────────────────────────

  const selectGisFile = async (picked: File | null) => {
    setGisError('');
    setGisValidation(null);
    setGisCommitResult(null);
    setGisStep('pick');

    if (!picked) {
      setGisFile(null);
      return;
    }

    const lowerName = picked.name.toLowerCase();
    if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls') && !lowerName.endsWith('.csv')) {
      setGisError('Please upload a valid .xlsx or .csv file matching the Kuri GIS upload specification.');
      setGisFile(null);
      return;
    }

    setGisFile(picked);
    await runGisDryRun(picked);
  };

  const runGisDryRun = async (fileToInspect: File) => {
    setGisInspecting(true);
    setGisError('');
    try {
      const res = await recordsApi.importGisRecords(fileToInspect, true, gisSetName.trim());
      setGisValidation(res);
      setGisStep('inspect');
    } catch (err: any) {
      setGisError(describeApiError(err, 'Failed to inspect GIS file. Please check file formatting.'));
    } finally {
      setGisInspecting(false);
    }
  };

  const commitGisBatch = async () => {
    if (!gisFile || !gisValidation || !gisValidation.valid) return;
    if (!gisSetName.trim()) {
      setGisError('SET Name is required before importing.');
      return;
    }
    setGisCommitting(true);
    setGisError('');
    try {
      const res = await recordsApi.importGisRecords(gisFile, false, gisSetName.trim());
      setGisCommitResult(res);
      setGisStep('committed');
    } catch (err: any) {
      setGisError(describeApiError(err, 'Failed to commit GIS batch to database.'));
    } finally {
      setGisCommitting(false);
    }
  };

  const resetGis = () => {
    setGisFile(null);
    setGisValidation(null);
    setGisCommitResult(null);
    setGisStep('pick');
    setGisError('');
    if (gisInputRef.current) gisInputRef.current.value = '';
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Legacy Dispatch Sheet Handlers
  // ──────────────────────────────────────────────────────────────────────────

  const selectLegacyFile = (picked: File | null) => {
    setLegacyError('');
    setLegacyResult(null);
    setLegacyLiveProgress(null);
    setLegacyStep('pick');
    if (!picked) {
      setLegacyFile(null);
      return;
    }
    const err = validateExcelFile(picked);
    if (err) {
      setLegacyError(err);
      setLegacyFile(null);
      return;
    }
    setLegacyFile(picked);
  };

  const runLegacyImport = async () => {
    if (!legacyFile) return;
    if (!legacySetName.trim()) {
      setLegacyError('SET Name is required before importing.');
      return;
    }
    setLegacyImporting(true);
    setLegacyError('');
    setLegacyLiveProgress({
      current: 0,
      total: 0,
      percent: 0,
      status: 'Analyzing sheet and preparing import pipeline...',
      autoResolvedCount: 0,
      logs: [],
    });

    try {
      const res = await recordsApi.uploadSheetStream(legacyFile, 'dispatch', (evt) => {
        if (evt.type === 'init') {
          setLegacyLiveProgress({
            current: 0,
            total: evt.total_rows || 0,
            percent: 0,
            status: `Loaded sheet "${evt.sheet_name}" (${evt.total_rows} rows). Starting import...`,
            autoResolvedCount: 0,
            logs: [{
              id: 'init',
              text: `Sheet "${evt.sheet_name}" loaded with ${evt.total_rows} rows. Beginning processing...`,
              success: true,
            }],
          });
        } else if (evt.type === 'progress') {
          setLegacyLiveProgress((prev) => {
            const nextCurrent = evt.row_index || (prev ? prev.current + 1 : 1);
            const nextTotal = evt.total_rows || (prev ? prev.total : 0);
            const nextPercent = evt.percent ?? (nextTotal > 0 ? Math.round((nextCurrent / nextTotal) * 100) : 0);
            const isAuto = Boolean(evt.auto_resolved);
            const logText = `Row ${nextCurrent}: ${evt.unique_id || `Record #${evt.record_id}`} — ${evt.village || '—'}, ${evt.taluk || '—'}`;
            const newLog: ProgressLogItem = {
              id: `${nextCurrent}-${Date.now()}`,
              text: logText,
              success: true,
              autoResolved: isAuto,
            };
            const existing = prev?.logs || [];
            return {
              current: nextCurrent,
              total: nextTotal,
              percent: nextPercent,
              status: evt.status || `Imported row ${nextCurrent} of ${nextTotal}`,
              autoResolvedCount: (prev?.autoResolvedCount || 0) + (isAuto ? 1 : 0),
              logs: [newLog, ...existing.slice(0, 49)],
            };
          });
        }
      }, legacySetName.trim());

      setLegacyResult({
        ...res,
        errors: res.errors ?? [],
        dispatched_tasks: res.dispatched_tasks ?? [],
      });
      setLegacyStep('review');
    } catch (e) {
      setLegacyError(describeApiError(e, 'Import failed.'));
    } finally {
      setLegacyImporting(false);
      setLegacyLiveProgress(null);
    }
  };

  const resetLegacy = () => {
    setLegacyFile(null);
    setLegacyResult(null);
    setLegacyStep('pick');
    setLegacyError('');
  };

  const downloadLegacyTemplate = async () => {
    setLegacyDownloading(true);
    try {
      await recordsApi.downloadTemplate();
    } catch (e) {
      setLegacyError(describeApiError(e, 'Failed to download the template.'));
    } finally {
      setLegacyDownloading(false);
    }
  };

  return (
    <PageShell>
      {/* Page Header */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: '#fff1f2',
                color: '#E64A4E',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Icon name="upload_file" size={26} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  Kuri Ingestion Studio
                </h1>
                <InfoHint label="Upload Specification">
                  Enforces strict 12 GIS signals, Coimbatore envelope, Village Master validation,
                  40m spatial deduplication (50m for multiunit projects), standard 6-digit CBE-XXXXXX IDs,
                  and TNGIS WFS cadastral auto-enrichment.
                </InfoHint>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                Batch ingestion, all-or-nothing validation, 40m deduplication, and cadastral parcel resolution.
              </p>
            </div>
          </div>

        </div>

        {/* Workflow Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            marginTop: 18,
            borderBottom: '1px solid #e2e8f0',
            paddingBottom: 2,
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('gis_specification')}
            style={{
              background: 'none',
              border: 'none',
              padding: '8px 14px',
              fontSize: '0.88rem',
              fontWeight: 700,
              color: activeTab === 'gis_specification' ? '#fc602b' : '#64748b',
              borderBottom: activeTab === 'gis_specification' ? '2.5px solid #fc602b' : '2.5px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.15s ease',
            }}
          >
            <Icon name="satellite_alt" size={17} />
            Kuri GIS Upload (12 Signals & Cadastral)
            <span
              style={{
                fontSize: 10,
                background: '#fee2e2',
                color: '#fc602b',
                padding: '2px 6px',
                borderRadius: 4,
                fontWeight: 800,
              }}
            >
              Authoritative
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('legacy_dispatch')}
            style={{
              background: 'none',
              border: 'none',
              padding: '8px 14px',
              fontSize: '0.88rem',
              fontWeight: 600,
              color: activeTab === 'legacy_dispatch' ? '#fc602b' : '#64748b',
              borderBottom: activeTab === 'legacy_dispatch' ? '2.5px solid #fc602b' : '2.5px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <Icon name="assignment_turned_in" size={17} />
            Task Dispatch Sheet (Legacy)
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          TAB 1: KURI GIS SPECIFICATION (2-STEP WIZARD)
          ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'gis_specification' && (
        <>
          {/* Rules Banner */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 16px',
              borderRadius: 10,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              marginBottom: 16,
              flexWrap: 'wrap',
              fontSize: '0.8rem',
            }}
          >
            <span style={{ fontWeight: 700, color: '#1e293b', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name="verified" size={15} style={{ color: '#059669' }} /> Specification Gates:
            </span>
            <span style={{ background: '#ecfdf5', color: '#065f46', padding: '2px 8px', borderRadius: 4, fontWeight: 650 }}>
              ✓ Auto-minted 6-digit CBE-XXXXXX
            </span>
            <span style={{ background: '#f0f9ff', color: '#0284c7', padding: '2px 8px', borderRadius: 4, fontWeight: 650 }}>
              ✓ 40m Proximity Deduplication (50m multiunit)
            </span>
            <span style={{ background: '#f5f3ff', color: '#6d28d9', padding: '2px 8px', borderRadius: 4, fontWeight: 650 }}>
              ✓ TNGIS WFS Cadastral Auto-Resolution
            </span>
            <span style={{ background: '#fffbeb', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontWeight: 650 }}>
              ✓ Sub-threshold (&lt;1,500 sq ft) QC Pre-check
            </span>
          </div>

          {/* STEP 1: PICK FILE */}
          {gisStep === 'pick' && (
            <div className="card" style={{ padding: 24 }}>
              {/* SET Name Selection (Required) */}
              <div
                style={{
                  marginBottom: 18,
                  padding: '12px 16px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label htmlFor="gis-set-name-input" style={{ fontSize: '0.825rem', fontWeight: 700, color: '#1e293b' }}>
                    SET Name <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Required for categorizing imported GIS sites</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input
                    id="gis-set-name-input"
                    type="text"
                    className="fld"
                    value={gisSetName}
                    onChange={(e) => {
                      setGisSetName(e.target.value);
                      if (gisError) setGisError('');
                    }}
                    placeholder="e.g. CBE Corporation, CBE District..."
                    style={{ flex: 1, padding: '7px 11px', fontSize: '0.875rem', backgroundColor: '#ffffff' }}
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Quick Select:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setGisSetName('CBE Corporation');
                      if (gisError) setGisError('');
                    }}
                    style={{
                      padding: '3px 10px',
                      fontSize: '0.75rem',
                      borderRadius: 9999,
                      border: '1px solid ' + (gisSetName === 'CBE Corporation' ? '#16a34a' : '#cbd5e1'),
                      background: gisSetName === 'CBE Corporation' ? '#f0fdf4' : '#ffffff',
                      color: gisSetName === 'CBE Corporation' ? '#15803d' : '#475569',
                      fontWeight: gisSetName === 'CBE Corporation' ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    CBE Corporation
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGisSetName('CBE District');
                      if (gisError) setGisError('');
                    }}
                    style={{
                      padding: '3px 10px',
                      fontSize: '0.75rem',
                      borderRadius: 9999,
                      border: '1px solid ' + (gisSetName === 'CBE District' ? '#2563eb' : '#cbd5e1'),
                      background: gisSetName === 'CBE District' ? '#eff6ff' : '#ffffff',
                      color: gisSetName === 'CBE District' ? '#1d4ed8' : '#475569',
                      fontWeight: gisSetName === 'CBE District' ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    CBE District
                  </button>
                </div>
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={() => gisInputRef.current?.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && gisInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setGisDragOver(true);
                }}
                onDragLeave={() => setGisDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setGisDragOver(false);
                  const files = e.dataTransfer.files;
                  if (files && files.length > 0) {
                    selectGisFile(files[0]);
                  }
                }}
                style={{
                  border: `2px dashed ${gisDragOver ? '#fc602b' : '#cbd5e1'}`,
                  borderRadius: 14,
                  padding: '36px 20px',
                  textAlign: 'center',
                  background: gisDragOver ? '#fef2f2' : '#fafafa',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  marginBottom: 16,
                }}
              >
                <input
                  ref={gisInputRef}
                  type="file"
                  accept={ACCEPT_ALL}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      selectGisFile(e.target.files[0]);
                    }
                  }}
                />

                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background: '#f1f5f9',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 12px',
                  }}
                >
                  <Icon name="upload" size={28} />
                </div>

                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
                  {gisFile ? gisFile.name : 'Choose GIS Task File (.xlsx or .csv)'}
                </div>
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 4 }}>
                  Drag & drop your 12-signal GIS sheet or click to browse.
                </div>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 8 }}>
                  Strict all-or-nothing validation rules apply automatically.
                </div>
              </div>

              {gisInspecting && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    padding: '16px',
                    borderRadius: 10,
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    fontWeight: 600,
                    fontSize: '0.88rem',
                  }}
                >
                  <Icon name="refresh" size={18} className="fos-spin" />
                  Running GIS validation, Village Master check, and 40m spatial deduplication inspection...
                </div>
              )}

              {gisError && (
                <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <Icon name="error" size={16} />
                  <span>{gisError}</span>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: DRY-RUN INSPECTION RESULTS */}
          {gisStep === 'inspect' && gisValidation && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* REJECTION ALERT (ALL-OR-NOTHING HALT) */}
              {(!gisValidation.valid || gisValidation.rejected) && (
                <div
                  className="card"
                  style={{
                    padding: '20px 24px',
                    background: '#fef2f2',
                    border: '1.5px solid #f87171',
                    borderRadius: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: '#fc602b',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="block" size={22} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#991b1b' }}>
                        Batch Validation Failed — All-or-Nothing Rule Enforced
                      </h2>
                      <p style={{ margin: '4px 0 12px', fontSize: '0.86rem', color: '#b91c1c', lineHeight: 1.4 }}>
                        {gisValidation.reject_reason || 'Batch was rejected because one or more rows violated strict GIS upload rules.'}
                      </p>

                      {/* Error List Table */}
                      {gisValidation.errors.length > 0 && (
                        <div
                          style={{
                            background: '#ffffff',
                            borderRadius: 8,
                            border: '1px solid #fca5a5',
                            overflow: 'hidden',
                            maxHeight: 280,
                            overflowY: 'auto',
                          }}
                        >
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                            <thead>
                              <tr style={{ background: '#fee2e2', borderBottom: '1px solid #fca5a5', color: '#7f1d1d' }}>
                                <th style={{ padding: '8px 12px', textAlign: 'left', width: 70 }}>Row #</th>
                                <th style={{ padding: '8px 12px', textAlign: 'left', width: 130 }}>Column</th>
                                <th style={{ padding: '8px 12px', textAlign: 'left' }}>Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {gisValidation.errors.map((err, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                  <td style={{ padding: '8px 12px', fontWeight: 700, color: '#991b1b' }}>
                                    Row {err.row}
                                  </td>
                                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600, color: '#475569' }}>
                                    {err.column}
                                  </td>
                                  <td style={{ padding: '8px 12px', color: '#1e293b' }}>
                                    {err.reason}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div style={{ marginTop: 14 }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={resetGis}>
                          <Icon name="refresh" size={14} /> Upload Corrected File
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SUCCESSFUL INSPECTION SUMMARY */}
              {gisValidation.valid && (
                <>
                  {/* Summary Metric Cards */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: 12,
                    }}
                  >
                    <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #6366f1' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 650, color: '#64748b', textTransform: 'uppercase' }}>
                        Total Rows Inspected
                      </span>
                      <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0f172a', margin: '4px 0 2px' }}>
                        {gisValidation.total_rows}
                      </div>
                      <span style={{ fontSize: '0.74rem', color: '#475569' }}>All format checks passed</span>
                    </div>

                    <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #059669' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 650, color: '#065f46', textTransform: 'uppercase' }}>
                        New Sites to Create
                      </span>
                      <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#059669', margin: '4px 0 2px' }}>
                        {gisValidation.new_candidates.length}
                      </div>
                      <span style={{ fontSize: '0.74rem', color: '#047857' }}>Will mint standard CBE-XXXXXX IDs</span>
                    </div>

                    <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #0284c7' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 650, color: '#0369a1', textTransform: 'uppercase' }}>
                        40m Spatial Merges
                      </span>
                      <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0284c7', margin: '4px 0 2px' }}>
                        {gisValidation.merged_candidates.length}
                      </div>
                      <span style={{ fontSize: '0.74rem', color: '#0284c7' }}>Metadata updated, no duplicate created</span>
                    </div>

                    <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #d97706' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 650, color: '#b45309', textTransform: 'uppercase' }}>
                        QC Review Warnings
                      </span>
                      <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#d97706', margin: '4px 0 2px' }}>
                        {gisValidation.warnings.length}
                      </div>
                      <span style={{ fontSize: '0.74rem', color: '#92400e' }}>Preserved for desk QC audit</span>
                    </div>
                  </div>

                  {/* QC Warnings Alert Box */}
                  {gisValidation.warnings.length > 0 && (
                    <div
                      className="card"
                      style={{
                        padding: '14px 18px',
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <Icon name="warning" size={17} style={{ color: '#d97706' }} />
                        <span style={{ fontWeight: 700, fontSize: '0.86rem', color: '#92400e' }}>
                          QC Review Warnings ({gisValidation.warnings.length})
                        </span>
                      </div>
                      <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: '0.78rem', color: '#78350f', lineHeight: 1.5 }}>
                        {gisValidation.warnings.map((w, idx) => (
                          <div key={idx}>
                            • Row {w.row} ({w.column}): {w.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 40m Merged Duplicates Alert Box */}
                  {gisValidation.merged_candidates.length > 0 && (
                    <div
                      className="card"
                      style={{
                        padding: '14px 18px',
                        background: '#f0f9ff',
                        border: '1px solid #bae6fd',
                        borderRadius: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <Icon name="pin_drop" size={17} style={{ color: '#0284c7' }} />
                        <span style={{ fontWeight: 700, fontSize: '0.86rem', color: '#0369a1' }}>
                          40m Spatial Deduplication Match Detected ({gisValidation.merged_candidates.length})
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: '#0c4a6e', lineHeight: 1.4 }}>
                        The following incoming rows are within 40.0m of existing live sites. In accordance with the Kuri specification,
                        their metadata (area, detection signals, stage) will be merged into the existing records without creating duplicates.
                      </p>
                      <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {gisValidation.merged_candidates.map((m, idx) => (
                          <span
                            key={idx}
                            style={{
                              background: '#ffffff',
                              border: '1px solid #7dd3fc',
                              borderRadius: 4,
                              padding: '2px 8px',
                              fontSize: '0.72rem',
                              fontFamily: 'monospace',
                              color: '#0369a1',
                            }}
                          >
                            Row {m.row_num} → Matched {m.existing_unique_id} ({m.distance_m}m)
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Candidate Records Preview Table */}
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div
                      style={{
                        padding: '14px 20px',
                        borderBottom: '1px solid #f1f5f9',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: '#fafafa',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon name="table_view" size={17} style={{ color: '#6366f1' }} />
                        <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f172a' }}>
                          Candidate Records Preview
                        </span>
                      </div>
                      <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        Showing first 25 candidate rows
                      </span>
                    </div>

                    <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Row</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Action</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Coordinates</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Village</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Taluk</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Area (sqm / sqft)</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Eligibility</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Type</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Tier</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(gisValidation.parsed_rows || []).slice(0, 25).map((row) => {
                            const isMerged = gisValidation.merged_candidates.some((m) => m.row_num === row.row_num);
                            return (
                              <tr key={row.row_num} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '8px 12px', fontWeight: 700, color: '#334155' }}>
                                  #{row.row_num}
                                </td>
                                <td style={{ padding: '8px 12px' }}>
                                  {isMerged ? (
                                    <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: 4, fontWeight: 700, fontSize: '0.72rem' }}>
                                      40m Merge
                                    </span>
                                  ) : (
                                    <span style={{ background: '#ecfdf5', color: '#047857', padding: '2px 6px', borderRadius: 4, fontWeight: 700, fontSize: '0.72rem' }}>
                                      New Site
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                                  {row.lat.toFixed(5)}, {row.lon.toFixed(5)}
                                </td>
                                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{row.village}</td>
                                <td style={{ padding: '8px 12px', color: '#475569' }}>{row.taluk}</td>
                                <td style={{ padding: '8px 12px' }}>
                                  {row.area_sqm} sqm ({Math.round(row.area_sqft)} sqft)
                                </td>
                                <td style={{ padding: '8px 12px' }}>
                                  {row.is_eligible ? (
                                    <span style={{ color: '#059669', fontWeight: 700 }}>✓ Eligible</span>
                                  ) : (
                                    <span style={{ color: '#d97706', fontWeight: 700 }}>⚠ Not Eligible</span>
                                  )}
                                </td>
                                <td style={{ padding: '8px 12px', textTransform: 'capitalize' }}>
                                  {row.detection_type}
                                </td>
                                <td style={{ padding: '8px 12px' }}>
                                  <span style={{ fontWeight: 650, color: '#6366f1' }}>{row.priority_tier}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Commit Action Controls */}
                  <div
                    className="card"
                    style={{
                      padding: '16px 24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <button type="button" className="btn btn-secondary" onClick={resetGis} disabled={gisCommitting}>
                      <Icon name="arrow_back" size={15} /> Cancel & Choose Another File
                    </button>

                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={commitGisBatch}
                      disabled={gisCommitting}
                      style={{
                        minWidth: 260,
                        height: 42,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        fontWeight: 750,
                        background: '#fc602b',
                        borderColor: '#fc602b',
                      }}
                    >
                      <Icon name={gisCommitting ? 'refresh' : 'check_circle'} size={18} className={gisCommitting ? 'fos-spin' : undefined} />
                      {gisCommitting
                        ? 'Committing & Auto-Enriching Cadastral...'
                        : `Commit Import (${gisValidation.new_candidates.length} New, ${gisValidation.merged_candidates.length} Merged)`}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3: COMMIT SUCCESS RESULT */}
          {gisStep === 'committed' && gisCommitResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                className="card"
                style={{
                  padding: '24px',
                  background: '#f0fdf4',
                  border: '1.5px solid #86efac',
                  borderRadius: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: '#059669',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="check_circle" size={28} />
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#065f46' }}>
                      GIS Batch Successfully Ingested!
                    </h2>
                    <p style={{ margin: '4px 0 0', fontSize: '0.88rem', color: '#047857' }}>
                      Created <strong>{gisCommitResult.created_count}</strong> new records with standard 6-digit CBE-XXXXXX IDs,
                      and updated <strong>{gisCommitResult.merged_count}</strong> 40m spatial duplicates.
                      Initial status is strictly set to <strong>QC Pending</strong>.
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => navigate('/records')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
                  >
                    <Icon name="folder_open" size={16} /> View in Records / QC Queue
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={resetGis}>
                    <Icon name="refresh" size={15} /> Ingest Another Batch
                  </button>
                </div>
              </div>

              {/* Committed Records Table */}
              {gisCommitResult.committed_records.length > 0 && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div
                    style={{
                      padding: '14px 20px',
                      borderBottom: '1px solid #f1f5f9',
                      background: '#fafafa',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f172a' }}>
                      Newly Created Records ({gisCommitResult.committed_records.length})
                    </span>
                    <span style={{ fontSize: '0.76rem', color: '#059669', fontWeight: 650 }}>
                      ✦ Cadastral Auto-Enriched
                    </span>
                  </div>

                  <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>Unique ID</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>Village</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>Taluk</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>Survey No</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>Sub-division No</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>ULPIN</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>Status</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gisCommitResult.committed_records.map((rec) => (
                          <tr key={rec.record_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 800, color: '#0f172a' }}>
                              {rec.unique_id}
                            </td>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{rec.village || '—'}</td>
                            <td style={{ padding: '8px 12px', color: '#475569' }}>{rec.taluk || '—'}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                              {rec.survey_no ? (
                                <span style={{ background: '#ecfdf5', color: '#065f46', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                                  {rec.survey_no}
                                </span>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                              {rec.subdivision_no ? (
                                <span style={{ background: '#f0fdf4', color: '#15803d', padding: '1px 6px', borderRadius: 4, fontWeight: 650 }}>
                                  {rec.subdivision_no}
                                </span>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.72rem', color: '#64748b' }}>
                              {rec.ulpin || '—'}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 7px', borderRadius: 4, fontWeight: 700 }}>
                                QC Pending
                              </span>
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                              <button
                                type="button"
                                className="btn btn-secondary btn-xs"
                                onClick={() => navigate(`/records/${rec.record_id}`)}
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          TAB 2: LEGACY TASK DISPATCH SHEET
          ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'legacy_dispatch' && (
        <>
          {legacyStep === 'pick' && (
            <div className="card" style={{ padding: 24 }}>
              {/* SET Name Selection (Required) */}
              <div
                style={{
                  marginBottom: 18,
                  padding: '12px 16px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label htmlFor="legacy-set-name-input" style={{ fontSize: '0.825rem', fontWeight: 700, color: '#1e293b' }}>
                    SET Name <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Required for categorizing dispatched tasks</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input
                    id="legacy-set-name-input"
                    type="text"
                    className="fld"
                    value={legacySetName}
                    onChange={(e) => {
                      setLegacySetName(e.target.value);
                      if (legacyError) setLegacyError('');
                    }}
                    placeholder="e.g. CBE Corporation, CBE District..."
                    style={{ flex: 1, padding: '7px 11px', fontSize: '0.875rem', backgroundColor: '#ffffff' }}
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Quick Select:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLegacySetName('CBE Corporation');
                      if (legacyError) setLegacyError('');
                    }}
                    style={{
                      padding: '3px 10px',
                      fontSize: '0.75rem',
                      borderRadius: 9999,
                      border: '1px solid ' + (legacySetName === 'CBE Corporation' ? '#16a34a' : '#cbd5e1'),
                      background: legacySetName === 'CBE Corporation' ? '#f0fdf4' : '#ffffff',
                      color: legacySetName === 'CBE Corporation' ? '#15803d' : '#475569',
                      fontWeight: legacySetName === 'CBE Corporation' ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    CBE Corporation
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLegacySetName('CBE District');
                      if (legacyError) setLegacyError('');
                    }}
                    style={{
                      padding: '3px 10px',
                      fontSize: '0.75rem',
                      borderRadius: 9999,
                      border: '1px solid ' + (legacySetName === 'CBE District' ? '#2563eb' : '#cbd5e1'),
                      background: legacySetName === 'CBE District' ? '#eff6ff' : '#ffffff',
                      color: legacySetName === 'CBE District' ? '#1d4ed8' : '#475569',
                      fontWeight: legacySetName === 'CBE District' ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    CBE District
                  </button>
                </div>
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={() => legacyInputRef.current?.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && legacyInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setLegacyDragOver(true);
                }}
                onDragLeave={() => setLegacyDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setLegacyDragOver(false);
                  const files = e.dataTransfer.files;
                  if (files && files.length > 0) {
                    selectLegacyFile(files[0]);
                  }
                }}
                style={{
                  border: `2px dashed ${legacyDragOver ? '#fc602b' : '#cbd5e1'}`,
                  borderRadius: 14,
                  padding: '36px 20px',
                  textAlign: 'center',
                  background: legacyDragOver ? '#fef2f2' : '#fafafa',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  marginBottom: 16,
                }}
              >
                <input
                  ref={legacyInputRef}
                  type="file"
                  accept=".xlsx, .xls"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      selectLegacyFile(e.target.files[0]);
                    }
                  }}
                />

                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background: '#f1f5f9',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 12px',
                  }}
                >
                  <Icon name="upload" size={28} />
                </div>

                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
                  {legacyFile ? legacyFile.name : 'Choose Legacy Task Sheet (.xlsx)'}
                </div>
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 4 }}>
                  Dispatches inspection tasks to field operators via streaming NDJSON.
                </div>
              </div>

              {legacyError && (
                <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <Icon name="error" size={16} />
                  <span>{legacyError}</span>
                </div>
              )}

              {/* Progress bar when legacy importing */}
              {legacyImporting && legacyLiveProgress && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: '16px',
                    borderRadius: 12,
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Streaming Task Import...</span>
                    <span style={{ fontWeight: 800, color: '#fc602b' }}>{legacyLiveProgress.percent}%</span>
                  </div>
                  <div style={{ width: '100%', height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${legacyLiveProgress.percent}%`,
                        height: '100%',
                        background: '#fc602b',
                        transition: 'width 0.2s ease',
                      }}
                    />
                  </div>
                  <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#64748b' }}>
                    {legacyLiveProgress.status}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={downloadLegacyTemplate}
                  disabled={legacyDownloading || legacyImporting}
                >
                  <Icon name={legacyDownloading ? 'refresh' : 'download'} size={15} className={legacyDownloading ? 'fos-spin' : undefined} />
                  {legacyDownloading ? 'Downloading…' : 'Download Legacy Template (.xlsx)'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!legacyFile || legacyImporting}
                  onClick={runLegacyImport}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
                >
                  <Icon name={legacyImporting ? 'refresh' : 'upload'} size={16} className={legacyImporting ? 'fos-spin' : undefined} />
                  {legacyImporting ? 'Dispatching...' : 'Dispatch Tasks'}
                </button>
              </div>
            </div>
          )}

          {legacyStep === 'review' && legacyResult && (
            <div className="card" style={{ padding: 24 }}>
              <div
                style={{
                  padding: '16px 20px',
                  borderRadius: 10,
                  background: legacyResult.total_dispatched > 0 ? '#f0fdf4' : '#fff7ed',
                  border: `1px solid ${legacyResult.total_dispatched > 0 ? '#bbf7d0' : '#fed7aa'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: legacyResult.total_dispatched > 0 ? '#065f46' : '#9a3412' }}>
                    {legacyResult.total_dispatched > 0
                      ? `Dispatched ${legacyResult.total_dispatched} task(s)`
                      : 'No tasks dispatched'}
                  </h3>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Sheet: {legacyResult.sheet_name} · {legacyResult.total_rows} row(s) read
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={resetLegacy}>
                    <Icon name="refresh" size={14} /> Import another sheet
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/records')}>
                    <Icon name="folder_open" size={14} /> View in Records
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
