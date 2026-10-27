/**
 * Import Task Sheet — dispatch inspection tasks to field operators from Excel.
 *
 * Backfilling *completed* work is a different job, with a different sheet (15
 * planning + 9 inspection columns) and a photo step, so it lives on its own
 * page: Records → "Import Previous Records" (/records/import-previous). This
 * page only dispatches, which is why the old mode toggle is gone.
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

type Step = 'pick' | 'review';

const ACCEPT = '.xlsx, .xls';

export default function ImportRecords({ canImportHistory = false }: { canImportHistory?: boolean }) {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('pick');
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [liveProgress, setLiveProgress] = useState<ImportLiveProgress | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFile = (picked: File | null) => {
    setError('');
    setResult(null);
    setLiveProgress(null);
    setStep('pick');
    if (!picked) {
      setFile(null);
      return;
    }
    const err = validateExcelFile(picked);
    if (err) {
      setError(err);
      setFile(null);
      return;
    }
    setFile(picked);
  };


  const runImport = async () => {
    if (!file) return;
    setImporting(true);
    setError('');
    setLiveProgress({
      current: 0,
      total: 0,
      percent: 0,
      status: 'Analyzing sheet and preparing import pipeline...',
      autoResolvedCount: 0,
      logs: [],
    });

    try {
      const res = await recordsApi.uploadSheetStream(file, 'dispatch', (evt) => {
        if (evt.type === 'init') {
          setLiveProgress({
            current: 0,
            total: evt.total_rows || 0,
            percent: 0,
            status: `Loaded sheet "${evt.sheet_name}" (${evt.total_rows} rows). Starting import and village auto-resolution...`,
            autoResolvedCount: 0,
            logs: [{
              id: 'init',
              text: `Sheet "${evt.sheet_name}" loaded with ${evt.total_rows} rows. Beginning live processing...`,
              success: true,
            }],
          });
        } else if (evt.type === 'progress') {
          setLiveProgress((prev) => {
            const nextCurrent = evt.row_index || (prev ? prev.current + 1 : 1);
            const nextTotal = evt.total_rows || (prev ? prev.total : 0);
            const nextPercent = evt.percent ?? (nextTotal > 0 ? Math.round((nextCurrent / nextTotal) * 100) : 0);
            const isAuto = Boolean(evt.auto_resolved);
            const logText = `Row ${nextCurrent}: ${evt.unique_id || `Record #${evt.record_id}`} — Village: ${evt.village || '—'}, Taluk: ${evt.taluk || '—'}, District: ${evt.district || '—'}${isAuto ? ' [✦ Auto-Filled from Master]' : ''}`;
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
        } else if (evt.type === 'row_error') {
          setLiveProgress((prev) => {
            const errLog: ProgressLogItem = {
              id: `err-${Date.now()}`,
              text: `Row ${evt.row_index}: Error in '${evt.error?.column}': ${evt.error?.message}`,
              success: false,
            };
            const existing = prev?.logs || [];
            return prev ? { ...prev, logs: [errLog, ...existing.slice(0, 49)] } : null;
          });
        }
      });

      setResult({
        ...res,
        errors: res.errors ?? [],
        dispatched_tasks: res.dispatched_tasks ?? [],
      });
      setStep('review');
    } catch (e) {
      setError(describeApiError(e, 'Import failed.'));
    } finally {
      setImporting(false);
      setLiveProgress(null);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setStep('pick');
    setError('');
  };

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      await recordsApi.downloadTemplate();
    } catch (e) {
      setError(describeApiError(e, 'Failed to download the template.'));
    } finally {
      setDownloading(false);
    }
  };

  const imported = result?.total_dispatched ?? 0;

  return (
    <PageShell>
      {/* Page head */}
      <div className="card" style={{ padding: '22px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
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
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                Import Task Sheet
              </h1>
              <InfoHint label="How task dispatch works">
                Import tasks, route them to an auditor, then assign approved records to a field verifier.
                Records appear in the verifier's app only after that assignment. Optional operator emails
                must match an active field account.
              </InfoHint>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              Import tasks for auditor review and field verification.
            </p>
          </div>
          {canImportHistory && <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/records/import-previous')}
            style={{ whiteSpace: 'normal', maxWidth: '100%' }}
            title="Backfill inspections that were already completed before the app went live"
          >
            <Icon name="history" size={15} />
            Import Previous Records
          </button>}
        </div>
      </div>

      {step === 'pick' && (
        <div className="card" style={{ padding: 24 }}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              selectFile(e.dataTransfer.files?.[0] ?? null);
            }}
            style={{
              border: `2px dashed ${dragOver ? '#E64A4E' : '#cbd5e1'}`,
              borderRadius: 14,
              padding: '44px 20px',
              textAlign: 'center',
              background: dragOver ? '#fff1f2' : '#f8fafc',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              marginBottom: 16,
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              style={{ display: 'none' }}
              onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Icon name="check_circle" size={38} style={{ color: '#059669' }} />
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>{file.name}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  {(file.size / 1024).toFixed(1)} KB · Excel
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectFile(null);
                  }}
                  style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Icon name="cloud_upload" size={38} style={{ color: '#E64A4E' }} />
                <div style={{ fontWeight: 700, color: '#0f172a' }}>
                  Drop your task sheet here, or click to browse
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  .xlsx only · Google Sheets: File → Download → Microsoft Excel (.xlsx)
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }} role="alert">
              <Icon name="error" size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Live Progress Card when importing */}
          {importing && liveProgress && (
            <div
              style={{
                marginTop: 16,
                marginBottom: 16,
                padding: '18px 20px',
                borderRadius: 14,
                backgroundColor: '#ffffff',
                border: '1.5px solid #cbd5e1',
                boxShadow: '0 4px 16px rgba(15, 23, 42, 0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      background: '#eff6ff',
                      color: '#2563eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="refresh" size={18} className="fos-spin" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      Importing Records & Auto-Resolving Locations...
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      Master village resolution active (Tamil Nadu revenue villages)
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#FF6467', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {liveProgress.percent}%
                </div>
              </div>

              {/* Progress Bar Track */}
              <div
                style={{
                  width: '100%',
                  height: 10,
                  backgroundColor: '#f1f5f9',
                  borderRadius: 9999,
                  overflow: 'hidden',
                  marginBottom: 12,
                  border: '1px solid #e2e8f0',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Math.max(2, liveProgress.percent))}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #FF6467 0%, #059669 100%)',
                    borderRadius: 9999,
                    transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />
              </div>

              {/* Real-time Metric Badges */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ padding: '4px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.76rem', color: '#334155' }}>
                  <strong>Progress:</strong> {liveProgress.current} / {liveProgress.total} rows
                </span>
                <span style={{ padding: '4px 10px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: '0.76rem', color: '#065f46', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="auto_awesome" size={13} style={{ color: '#059669' }} />
                  <strong>Auto-Filled Locations:</strong> {liveProgress.autoResolvedCount}
                </span>
                <span style={{ padding: '4px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.74rem', color: '#64748b', flex: 1, minWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {liveProgress.status}
                </span>
              </div>

              {/* Live Activity Feed */}
              {liveProgress.logs.length > 0 && (
                <div
                  style={{
                    background: '#0b1c30',
                    borderRadius: 10,
                    padding: '10px 12px',
                    maxHeight: 160,
                    overflowY: 'auto',
                    fontFamily: 'monospace',
                    fontSize: '0.72rem',
                    color: '#e2e8f0',
                    lineHeight: 1.6,
                  }}
                >
                  {liveProgress.logs.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 6,
                        color: log.success ? (log.autoResolved ? '#6ee7b7' : '#94a3b8') : '#fca5a5',
                      }}
                    >
                      <span>{log.success ? (log.autoResolved ? '✦' : '✓') : '⚠'}</span>
                      <span>{log.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={downloadTemplate}
              disabled={downloading || importing}
              title="Download the standard task dispatch template"
            >
              <Icon name={downloading ? 'refresh' : 'download'} size={15} className={downloading ? 'fos-spin' : undefined} />
              {downloading ? 'Downloading…' : 'Download Template (.xlsx)'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!file || importing}
              onClick={runImport}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 230, justifyContent: 'center' }}
            >
              <Icon name={importing ? 'refresh' : 'upload'} size={16} className={importing ? 'fos-spin' : undefined} />
              {importing ? `Importing (${liveProgress?.percent || 0}%)…` : 'Dispatch Tasks'}
            </button>
          </div>

          {/* Template Guidance & Instructions */}
          <div
            style={{
              marginTop: 20,
              padding: '16px 20px',
              borderRadius: 12,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              fontSize: '0.82rem',
              color: '#334155',
            }}
          >
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="info" size={16} style={{ color: '#0284c7' }} />
              Task Sheet Guidelines & Template Columns:
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6, color: '#475569' }}>
              <li>
                <strong>Template Columns:</strong> <code>unique_id</code>, <code>coordinates</code> (lat, lng), <code>site_address</code>, <code>street_address</code>, <code>village</code>, <code>taluk</code>, <code>district</code>, <code>survey_no</code>, <code>subdivision_no</code>, <code>land_use</code>, <code>owner_name_en</code>, <code>visit_order</code>, <code>auditor_email</code>, <code>operator_email</code>.
              </li>
              <li>
                <strong>Optional Assignments:</strong> Both <code>auditor_email</code> and <code>operator_email</code> are optional. If left blank, tasks are imported into the QA pool as unassigned pending records, ready for assignment at any time.
              </li>
              <li>
                <strong>Auto-Resolution:</strong> Missing Village, Taluk, or District values are automatically resolved from the Tamil Nadu Village Master database using GPS coordinates.
              </li>
            </ul>
          </div>
        </div>
      )}

      {step === 'review' && result && (
        <>
          {/* Summary — states plainly how many rows landed, even when none did */}
          <div
            className="card"
            style={{
              padding: '18px 24px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              background: imported > 0 ? '#f0fdf4' : '#fff7ed',
              border: `1px solid ${imported > 0 ? '#bbf7d0' : '#fed7aa'}`,
            }}
          >
            <Icon
              name={imported > 0 ? 'check_circle' : 'warning'}
              size={22}
              style={{ color: imported > 0 ? '#059669' : '#d97706' }}
            />
            <span style={{ fontWeight: 700, color: imported > 0 ? '#065f46' : '#9a3412', fontSize: '0.95rem' }}>
              {imported > 0
                ? `Dispatched ${imported} task${imported === 1 ? '' : 's'}`
                : 'No tasks were dispatched'}
              {result.failed_count > 0 &&
                ` · ${result.failed_count} row${result.failed_count === 1 ? '' : 's'} skipped`}
            </span>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Sheet: {result.sheet_name} · {result.total_rows} row{result.total_rows === 1 ? '' : 's'} read
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>
                <Icon name="refresh" size={14} /> Import another sheet
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/records')}>
                <Icon name="folder_open" size={14} /> View in Records
              </button>
            </div>
          </div>

          {/* Auto-resolved locations banner */}
          {(result.auto_resolved_count ?? 0) > 0 && (
            <div
              className="card"
              style={{
                padding: '14px 18px',
                marginBottom: 16,
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: '#065f46',
                fontSize: '0.85rem',
              }}
            >
              <Icon name="auto_awesome" size={20} style={{ color: '#059669' }} />
              <div>
                <strong>Master Village Sheet Auto-Resolution:</strong> Successfully filled empty Village, Taluk, or District for <strong>{result.auto_resolved_count}</strong> record{result.auto_resolved_count === 1 ? '' : 's'} using coordinates and the Tamil Nadu Village Master.
              </div>
            </div>
          )}

          {/* Skipped rows — the reason a row never becomes a task */}
          {result.errors.length > 0 && (
            <div
              className="card"
              style={{ padding: '14px 18px', marginBottom: 16, background: '#fff7ed', border: '1px solid #fed7aa', fontSize: '0.82rem', color: '#9a3412' }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                {result.errors.length} row{result.errors.length === 1 ? '' : 's'} not dispatched
              </div>
              {result.errors.slice(0, 12).map((er, i) => (
                <div key={i} style={{ lineHeight: 1.6 }}>
                  Row {er.row} · {er.column}: {er.message}
                </div>
              ))}
              {result.errors.length > 12 && (
                <div style={{ marginTop: 4, color: '#c2410c' }}>+{result.errors.length - 12} more…</div>
              )}
              <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#7c2d12' }}>
                Optional <strong>operator_email</strong> values must match an active field account. Imported tasks must be audited before field assignment.
              </div>
            </div>
          )}

          {/* Dispatched tasks — one scrollable list, so a long sheet cannot
              stretch the page into a wall of cards. */}
          {result.dispatched_tasks.length > 0 && (
            <div className="card list-card">
              <div className="list-card-head">
                <span className="list-card-title">
                  <Icon name="task_alt" size={16} style={{ color: '#059669' }} />
                  Dispatched tasks
                </span>
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  {result.dispatched_tasks.length} task
                  {result.dispatched_tasks.length === 1 ? '' : 's'} · scroll the list for more
                </span>
              </div>

              <div className="list-scroll">
                {result.dispatched_tasks.map((t) => (
                  <div key={t.record_id} className="task-row">
                    <span className="task-row-id">#{t.record_id}</span>

                    <div className="task-row-main">
                      <div className="task-row-name" title={t.unique_id || t.site_address}>
                        {t.unique_id || t.site_address || '—'}
                      </div>
                      {t.unique_id && (
                        <div className="task-row-site" title={t.site_address}>
                          {t.site_address || '—'}
                        </div>
                      )}
                      {(t.village || t.taluk) && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                          {t.village && (
                            <span style={{ fontSize: '0.70rem', background: '#e0f2fe', color: '#0369a1', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                              📍 {t.village}
                            </span>
                          )}
                          {t.taluk && (
                            <span style={{ fontSize: '0.70rem', background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: 4 }}>
                              {t.taluk}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="task-row-op" title={t.operator_email || t.auditor_email || 'Unassigned'}>
                      {t.operator_name || (t.auditor_name ? `Auditor: ${t.auditor_name}` : 'Unassigned')}
                      <small>{t.operator_email || (t.auditor_email ? t.auditor_email : 'Pending assignment')}</small>
                    </div>

                    <span className="rd-chip rd-chip-warn" title="Waiting for the operator to inspect">
                      <span className="rd-dot" />
                      Pending
                    </span>

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(`/records/${t.record_id}`)}
                    >
                      <Icon name="open_in_new" size={14} />
                      Open
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.dispatched_tasks.length === 0 && (
            <div className="card" style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>
              Nothing was written. Fix the skipped rows above and upload the sheet again.
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
