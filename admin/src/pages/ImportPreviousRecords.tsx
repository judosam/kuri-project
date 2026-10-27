/**
 * Import Previous Records — backfill field work completed before the app went
 * live. Dedicated three-step flow: upload the Excel sheet, preview + validate
 * every row, then import only the valid rows into the existing records table
 * (flagged as "Uploaded / Imported").
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { previousRecordsApi } from '../services/api';
import type { PreviousRecordsImportReport, PreviousRecordsPreview } from '../services/api';
import { Icon, InfoHint, PageShell } from '../components/ui';
import { useTopHeader } from '../context/HeaderContext';
import { describeApiError } from '../utils/errors';

type Step = 'pick' | 'preview' | 'done';

const ACCEPT = '.xlsx, .xls';

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: 'pick', label: '1 · Upload sheet' },
  { key: 'preview', label: '2 · Preview & validate' },
  { key: 'done', label: '3 · Imported' },
];

function stepIndex(step: Step): number {
  return STEP_LABELS.findIndex((s) => s.key === step);
}

const cellText = (value?: string | number | null) =>
  value == null || value === '' ? '—' : String(value);

export default function ImportPreviousRecords() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [step, setStep] = useState<Step>('pick');
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviousRecordsPreview | null>(null);
  const [report, setReport] = useState<PreviousRecordsImportReport | null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setStep('pick');
    setError('');
    setPreview(null);
    setReport(null);
    setShowAllErrors(false);
  };

  const selectFile = (picked: File | null) => {
    setError('');
    setPreview(null);
    setReport(null);
    setStep('pick');
    if (!picked) {
      setFile(null);
      return;
    }
    const name = picked.name.toLowerCase();
    if (name.endsWith('.csv')) {
      setError(
        'CSV is not supported. In Google Sheets: File → Download → Microsoft Excel (.xlsx).'
      );
      setFile(null);
      return;
    }
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      setError('Please upload a Microsoft Excel (.xlsx) file.');
      setFile(null);
      return;
    }
    setFile(picked);
  };

  const runPreview = async () => {
    if (!file) return;
    setBusy('preview');
    setError('');
    try {
      const res = await previousRecordsApi.preview(file);
      setPreview(res);
      setShowAllErrors(false);
      setStep('preview');
    } catch (e: any) {
      setError(describeApiError(e, 'Could not read the sheet.'));
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!file) return;
    setBusy('commit');
    setError('');
    try {
      const res = await previousRecordsApi.commit(file);
      setReport(res);
      setStep('done');
    } catch (e: any) {
      setError(describeApiError(e, 'Import failed.'));
    } finally {
      setBusy(null);
    }
  };

  useTopHeader(
    {
      left: (
        <div className="topbar-cmd-left">
          <button
            type="button"
            className="topbar-back-btn"
            onClick={() => navigate('/records')}
            title="Return to the records table"
          >
            <Icon name="arrow_back" size={15} />
            <span>Records</span>
          </button>
          <span className="topbar-cmd-divider" />
          <div className="topbar-cmd-titles">
            <div className="topbar-cmd-title-row">
              <h1 className="topbar-record-title">Import Previous Records</h1>
            </div>
          </div>
        </div>
      ),
    },
    [navigate]
  );

  const errorsToShow = preview?.errors ?? [];
  const visibleErrors = showAllErrors ? errorsToShow : errorsToShow.slice(0, 8);

  return (
    <PageShell>
      {/* Intro + step rail */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
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
          <div style={{ flex: 1, minWidth: 260 }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
              Backfill old field work
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5 }}>
              Upload the register of inspections completed before the app was deployed. Rows are
              validated first, imported records land in the same Records table and are marked{' '}
              <strong style={{ color: '#E64A4E' }}>Uploaded / Imported</strong>, where site photos can
              be attached — those carry an “Uploaded” stamp, not the field capture HUD.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STEP_LABELS.map((s, i) => {
              const active = stepIndex(step) >= i;
              return (
                <span
                  key={s.key}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 9999,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    background: active ? '#fff1f2' : '#f8fafc',
                    color: active ? '#E64A4E' : '#94a3b8',
                    border: `1px solid ${active ? '#ffd0d2' : '#e2e8f0'}`,
                  }}
                >
                  {s.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step 1 — pick a sheet */}
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
              padding: '40px 20px',
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
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#dc2626',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Icon name="cloud_upload" size={38} style={{ color: '#E64A4E' }} />
                <div style={{ fontWeight: 700, color: '#0f172a' }}>
                  Drop the old records Excel sheet here, or click to browse
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  .xlsx only · Google Sheets: File → Download → Microsoft Excel (.xlsx)
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
              fontSize: '0.8rem',
              color: '#64748b',
            }}
          >
            <Icon name="table_view" size={16} style={{ color: '#0284c7' }} />
            <span>Includes site details and previous inspection answers</span>
            <InfoHint label="Which columns this sheet understands">
              <strong>Required:</strong> <code>operator_email</code> — the operator the visit belongs
              to.
              <br />
              <br />
              <strong>Optional:</strong> <code>unique_id</code>, <code>visit_order</code>,{' '}
              <code>coordinates</code>, <code>site_address</code>, <code>street_address</code>,{' '}
              <code>owner_name_en</code>, <code>land_use</code>, <code>survey_no</code>,{' '}
              <code>subdivision_no</code>, <code>survey_number</code>, <code>sub_division</code>,{' '}
              <code>taluk</code>, <code>village</code>, <code>district</code>,{' '}
              <code>date_of_visit</code>, <code>construction_happening</code>, <code>remarks</code>,{' '}
              <code>type_of_construction</code>, <code>building_user_name</code>,{' '}
              <code>contact_number</code>, <code>stage_of_construction</code>,{' '}
              <code>site_contractor_architect_name</code>, <code>site_contractor_architect_number</code>.
              <br />
              <br />
              Extra columns are ignored. Rows without a valid operator are listed as skipped rather
              than imported.
            </InfoHint>
          </div>

          {error && (
            <div
              className="alert alert-error"
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}
              role="alert"
            >
              <Icon name="error" size={16} />
              <span>{error}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                previousRecordsApi
                  .downloadTemplate()
                  .catch((e) => setError(describeApiError(e, 'Failed to download the template.')))
              }
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Download the previous records template with inspection fields"
            >
              <Icon name="download" size={15} />
              Download Template (.xlsx)
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!file || busy !== null}
              onClick={runPreview}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 220, justifyContent: 'center' }}
            >
              <Icon
                name={busy === 'preview' ? 'refresh' : 'check_circle'}
                size={16}
                className={busy === 'preview' ? 'fos-spin' : undefined}
              />
              {busy === 'preview' ? 'Validating…' : 'Validate & Preview'}
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
              Previous Records Template Columns & Guide:
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6, color: '#475569' }}>
              <li>
                <strong>Planning Columns:</strong> <code>operator_email</code> (required), <code>visit_order</code>, <code>unique_id</code>, <code>coordinates</code>, <code>site_address</code>, <code>street_address</code>, <code>village</code>, <code>taluk</code>, <code>district</code>, <code>survey_no</code>, <code>subdivision_no</code>, <code>land_use</code>, <code>owner_name_en</code>, <code>cumulative_road_distance_km</code>.
              </li>
              <li>
                <strong>Inspection Columns:</strong> <code>date_of_visit</code>, <code>construction_happening</code> (Yes/No), <code>type_of_construction</code>, <code>stage_of_construction</code>, <code>building_user_name</code>, <code>relationship_with_building</code>, <code>contact_number</code>, <code>site_contractor_architect_name</code>, <code>site_contractor_architect_number</code>, <code>remarks</code>.
              </li>
              <li>
                <strong>Master Village Auto-Resolution:</strong> Missing Village, Taluk, or District values will be auto-filled from the Tamil Nadu Village Master using GPS coordinates and street address.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Step 2 — preview + validation */}
      {step === 'preview' && preview && (
        <>
          <div
            className="card"
            style={{
              padding: '16px 20px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <Icon
              name={preview.valid_count > 0 ? 'check_circle' : 'warning'}
              size={22}
              style={{ color: preview.valid_count > 0 ? '#059669' : '#d97706' }}
            />
            <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem' }}>
              {preview.valid_count} of {preview.total_rows} row{preview.total_rows === 1 ? '' : 's'} ready
              to import
            </span>
            {preview.invalid_count > 0 && (
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 9999,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  background: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                }}
              >
                {preview.invalid_count} row{preview.invalid_count === 1 ? '' : 's'} with errors
              </span>
            )}
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Sheet: {preview.sheet_name}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={reset} disabled={busy !== null}>
                <Icon name="arrow_back" size={14} /> Choose another file
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={preview.valid_count === 0 || busy !== null}
                onClick={runImport}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                title={
                  preview.valid_count === 0
                    ? 'No valid rows to import — fix the sheet and upload it again'
                    : 'Import only the valid rows into the records table'
                }
              >
                <Icon
                  name={busy === 'commit' ? 'refresh' : 'upload'}
                  size={15}
                  className={busy === 'commit' ? 'fos-spin' : undefined}
                />
                {busy === 'commit'
                  ? 'Importing…'
                  : `Import ${preview.valid_count} Record${preview.valid_count === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>

          {error && (
            <div
              className="alert alert-error"
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}
              role="alert"
            >
              <Icon name="error" size={16} />
              <span>{error}</span>
            </div>
          )}

          {errorsToShow.length > 0 && (
            <div
              className="card"
              style={{
                padding: '14px 18px',
                marginBottom: 16,
                background: '#fff7ed',
                border: '1px solid #fed7aa',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 700,
                  color: '#9a3412',
                  fontSize: '0.85rem',
                  marginBottom: 8,
                }}
              >
                <Icon name="warning" size={16} />
                Rows that will be skipped
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {visibleErrors.map((e, i) => (
                  <div key={i} style={{ fontSize: '0.8rem', color: '#9a3412', lineHeight: 1.5 }}>
                    <strong>Row {e.row}</strong> · <span style={{ fontFamily: 'monospace', fontSize: '0.74rem' }}>{e.column}</span> — {e.message}
                  </div>
                ))}
              </div>
              {errorsToShow.length > 8 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowAllErrors((v) => !v)}
                  style={{ marginTop: 8 }}
                >
                  <Icon name={showAllErrors ? 'expand_less' : 'expand_more'} size={14} />
                  {showAllErrors ? 'Show fewer' : `Show all ${errorsToShow.length} errors`}
                </button>
              )}
            </div>
          )}

          <div className="card table-card">
            <div className="table-scroll">
              <table className="fos-table records-table">
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>Row</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ minWidth: 150 }}>Operator</th>
                    <th style={{ width: 130 }}>Unique ID</th>
                    <th style={{ minWidth: 170 }}>Site Address</th>
                    <th style={{ width: 170 }}>Coordinates</th>
                    <th style={{ width: 110 }}>Visit Order</th>
                    <th style={{ width: 120 }}>Date of Visit</th>
                    <th style={{ width: 110 }}>Construction</th>
                    <th style={{ minWidth: 160 }}>Owner Name</th>
                    <th style={{ minWidth: 160 }}>Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr
                      key={`${r.row}-${r.unique_id}`}
                      style={{ background: r.valid ? undefined : '#fffbfa' }}
                    >
                      <td>
                        <span className="mono-sm" style={{ fontWeight: 700, color: '#0f172a' }}>
                          {r.row}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '3px 9px',
                            borderRadius: 9999,
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            background: r.valid ? '#ecfdf5' : '#fef2f2',
                            color: r.valid ? '#059669' : '#b91c1c',
                            border: `1px solid ${r.valid ? '#a7f3d0' : '#fecaca'}`,
                          }}
                        >
                          <Icon name={r.valid ? 'check_circle' : 'error'} size={12} />
                          {r.valid ? 'Valid' : 'Error'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.82rem' }}>
                            {r.operator_name || '—'}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            {r.operator_email || '—'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="mono-sm" style={{ fontWeight: 700, color: '#0f172a' }}>
                          {cellText(r.unique_id)}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.82rem', color: '#0f172a' }}>{cellText(r.site_address)}</td>
                      <td>
                        <span className="mono-sm" style={{ color: '#0f172a', fontWeight: 600 }}>
                          {cellText(r.coordinates)}
                        </span>
                      </td>
                      <td>{cellText(r.visit_order)}</td>
                      <td>{cellText(r.date_of_visit)}</td>
                      <td>{cellText(r.construction_happening)}</td>
                      <td style={{ fontSize: '0.82rem', color: '#0f172a' }}>{cellText(r.owner_name_en)}</td>
                      <td>
                        {r.valid ? (
                          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Ready to import</span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {r.errors.map((e, i) => (
                              <span key={i} style={{ fontSize: '0.74rem', color: '#b91c1c', lineHeight: 1.4 }}>
                                <strong style={{ fontFamily: 'monospace' }}>{e.column}</strong>: {e.message}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <span className="table-foot-note">
                {preview.total_rows} row{preview.total_rows === 1 ? '' : 's'} parsed from{' '}
                {preview.sheet_name}
                {preview.preview_truncated ? ` · showing the first ${preview.rows.length}` : ''}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Step 3 — imported */}
      {step === 'done' && report && (
        <>
          <div
            className="card"
            style={{ padding: '18px 24px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
          >
            <Icon name="check_circle" size={22} style={{ color: '#059669' }} />
            <span style={{ fontWeight: 700, color: '#065f46', fontSize: '0.95rem' }}>
              Imported {report.imported_count} record{report.imported_count === 1 ? '' : 's'}
              {report.skipped_count > 0 && ` · ${report.skipped_count} row${report.skipped_count === 1 ? '' : 's'} skipped`}
            </span>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              They now appear in the Records table marked “Uploaded / Imported”.
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

          {report.errors.length > 0 && (
            <div
              className="card"
              style={{
                padding: '14px 18px',
                marginBottom: 16,
                background: '#fff7ed',
                border: '1px solid #fed7aa',
                fontSize: '0.82rem',
                color: '#9a3412',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Skipped rows</div>
              {report.errors.slice(0, 8).map((e, i) => (
                <div key={i} style={{ lineHeight: 1.6 }}>
                  Row {e.row} · {e.column}: {e.message}
                </div>
              ))}
              {report.errors.length > 8 && (
                <div style={{ marginTop: 4, color: '#c2410c' }}>+{report.errors.length - 8} more…</div>
              )}
            </div>
          )}

          <div
            className="card"
            style={{ padding: '16px 20px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Icon name="add_photo_alternate" size={18} style={{ color: '#E64A4E' }} />
            <span style={{ fontSize: '0.85rem', color: '#334155' }}>
              Attach the site photos next — open an imported record to upload them. Each upload is
              stamped “Uploaded by &lt;your email&gt;” by the server (no device GPS/time, since
              no phone took it).
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {report.records.map((rec) => (
              <div key={rec.record_id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                      #{rec.record_id}{' '}
                      {rec.unique_id && <span style={{ fontWeight: 600, color: '#E64A4E' }}>{rec.unique_id}</span>}
                    </div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: '#64748b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={rec.site_address}
                    >
                      {rec.site_address || '—'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>
                      {rec.operator_name} · {rec.operator_email}
                    </div>
                  </div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '3px 9px',
                      borderRadius: 9999,
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      background: '#fff1f2',
                      color: '#E64A4E',
                    }}
                  >
                    <Icon name="upload_file" size={11} /> Imported
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 12, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={() => window.open(`/records/imported/${rec.record_id}`, '_blank', 'noopener')}
                  title="Open the imported record page to attach watermarked photos"
                >
                  <Icon name="open_in_new" size={14} /> Open imported record
                </button>
              </div>
            ))}
          </div>

          {report.records.length === 0 && (
            <div className="card" style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>
              No records were imported. Fix the skipped rows above and upload the sheet again.
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
