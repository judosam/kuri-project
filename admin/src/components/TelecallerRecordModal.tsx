import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CaptureRecord } from '../types';
import { telecallerApi } from '../services/api';
import { Icon, AuthThumbnail, formatDateTime } from './ui';

interface TelecallerRecordModalProps {
  record: CaptureRecord;
  onClose: () => void;
  onUpdated: (updated: CaptureRecord) => void;
}

export const TELECALLER_STATUS_OPTIONS = [
  { value: 'CONSTRUCTION_CONFIRMED', label: 'Construction Confirmed', icon: 'check_circle', color: '#059669' },
  { value: 'CONNECTED_FOLLOW_UP', label: 'Connected - Follow Up Needed', icon: 'call', color: '#1d4ed8' },
  { value: 'NOT_REACHABLE', label: 'Ringing / Not Reachable', icon: 'block', color: '#c2410c' },
  { value: 'DISCONNECTED_BUSY', label: 'Call Disconnected / Busy', icon: 'call', color: '#b45309' },
  { value: 'WRONG_NUMBER', label: 'Wrong / Invalid Number', icon: 'block', color: '#dc2626' },
  { value: 'NOT_INTERESTED', label: 'Not Interested / Refused', icon: 'block', color: '#64748b' },
  { value: 'PENDING', label: 'Pending Call', icon: 'schedule', color: '#64748b' },
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

export function TelecallerRecordModal({ record, onClose, onUpdated }: TelecallerRecordModalProps) {
  // A fresh/next lead is one that hasn't had telecaller feedback logged yet
  const isFreshLead = !record.telecaller_called_at || !record.telecaller_status || record.telecaller_status === 'PENDING';

  const [status, setStatus] = useState<string>(record.telecaller_status || 'PENDING');
  const [noOfFloors, setNoOfFloors] = useState<string>(record.no_of_floors || '');
  const [expectedCompletion, setExpectedCompletion] = useState<string>(record.expected_completion || '');
  const [builtUpArea, setBuiltUpArea] = useState<string>(record.built_up_area || '');
  // Reset Stage of Construction to empty for next leads so it isn't pre-filled with field verification data
  const initialStage = isFreshLead ? '' : (record.stage_of_construction || '');
  const [stageOfConstruction, setStageOfConstruction] = useState<string>(initialStage);
  const [customStage, setCustomStage] = useState<string>(
    initialStage && !STAGES_OF_CONSTRUCTION.includes(initialStage)
      ? initialStage
      : ''
  );

  useEffect(() => {
    const fresh = !record.telecaller_called_at || !record.telecaller_status || record.telecaller_status === 'PENDING';
    setStatus(record.telecaller_status || 'PENDING');
    setNoOfFloors(record.no_of_floors || '');
    setExpectedCompletion(record.expected_completion || '');
    setBuiltUpArea(record.built_up_area || '');
    const stg = fresh ? '' : (record.stage_of_construction || '');
    setStageOfConstruction(stg);
    setCustomStage(stg && !STAGES_OF_CONSTRUCTION.includes(stg) ? stg : '');
    setNewComment('');
    setHistoryText(record.telecaller_comment || '');
    setIsEditingHistory(false);
    setNotice(null);
  }, [record.id]);

  // For appending comments & history
  const [newComment, setNewComment] = useState<string>('');
  const [historyText, setHistoryText] = useState<string>(record.telecaller_comment || '');
  const [isEditingHistory, setIsEditingHistory] = useState(false);

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [activePhoto, setActivePhoto] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!status) {
      setNotice({ tone: 'error', text: 'Please select a call decision status' });
      return;
    }
    if (status === 'CONNECTED_FOLLOW_UP' && !newComment.trim() && !record.telecaller_comment) {
      setNotice({ tone: 'error', text: 'Please enter follow-up details or notes.' });
      return;
    }
    if (newComment.length > 4000) {
      setNotice({ tone: 'error', text: 'Comment cannot exceed 4000 characters.' });
      return;
    }

    const effectiveStage = stageOfConstruction === 'Other' ? customStage : stageOfConstruction;

    setSaving(true);
    setNotice(null);
    try {
      const payload: any = {
        telecaller_status: status,
        no_of_floors: noOfFloors.trim() || undefined,
        expected_completion: expectedCompletion.trim() || undefined,
        built_up_area: builtUpArea.trim() || undefined,
        stage_of_construction: effectiveStage.trim() ? effectiveStage.trim() : '',
      };

      if (isEditingHistory) {
        payload.telecaller_comment = historyText.trim() || undefined;
        payload.overwrite_comment = true;
      } else {
        payload.telecaller_comment = newComment.trim() || undefined;
        payload.overwrite_comment = false;
      }

      const updated = await telecallerApi.saveFeedback(record.id, payload);

      setNotice({ tone: 'ok', text: 'Call feedback and follow-up saved successfully!' });
      onUpdated(updated);
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: any) {
      setNotice({
        tone: 'error',
        text: err.response?.data?.detail || 'Failed to save feedback. Please retry.',
      });
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setNotice({ tone: 'ok', text: `Copied ${label} to clipboard!` });
    setTimeout(() => setNotice(null), 2500);
  };

  return createPortal(
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card"
        style={{
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          maxWidth: 880,
          width: '100%',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#f8fafc',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#fee2e2',
                color: '#bf3646',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Icon name="call" size={18} />
            </div>
            <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {record.unique_id || `Record #${record.id}`}
                </h3>
                {record.owner_name_en && (
                  <span
                    style={{
                      fontSize: 13,
                      color: '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '520px',
                    }}
                    title={record.owner_name_en}
                  >
                    • {record.owner_name_en}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: '#64748b', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Telecaller Desk Verification • {record.village || 'Village'}, {record.district || 'District'}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            style={{ width: 30, height: 30, padding: 0, borderRadius: 6, flexShrink: 0 }}
            aria-label="Close modal"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {notice && (
            <div
              role="alert"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: notice.tone === 'ok' ? '#ecfdf5' : '#fef2f2',
                color: notice.tone === 'ok' ? '#065f46' : '#991b1b',
                border: `1px solid ${notice.tone === 'ok' ? '#a7f3d0' : '#fecaca'}`,
              }}
            >
              <Icon name={notice.tone === 'ok' ? 'check_circle' : 'error'} size={15} />
              <span>{notice.text}</span>
            </div>
          )}

          {/* Quick Phone Call Action Bar */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              background: '#f1f5f9',
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid #cbd5e1',
            }}
          >
            {record.contact_number && record.contact_number.trim() && record.contact_number !== '-' ? (
              <div
                style={{
                  flex: 1,
                  minWidth: 220,
                  background: '#ffffff',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: '#64748b' }}>
                    Owner / Contact No
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', letterSpacing: '0.02em' }}>
                    {record.contact_number}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => copyToClipboard(record.contact_number!, 'Contact Number')}
                    title="Copy number"
                    style={{ height: 30, padding: '0 8px' }}
                  >
                    <Icon name="content_copy" size={14} />
                  </button>
                  <a
                    href={`tel:${record.contact_number}`}
                    className="btn btn-primary btn-sm"
                    style={{
                      height: 30,
                      padding: '0 12px',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      background: '#059669',
                      borderColor: '#059669',
                    }}
                  >
                    <Icon name="call" size={14} /> Call
                  </a>
                </div>
              </div>
            ) : null}

            {record.site_contractor_architect_number &&
            record.site_contractor_architect_number.trim() &&
            record.site_contractor_architect_number !== '-' ? (
              <div
                style={{
                  flex: 1,
                  minWidth: 220,
                  background: '#ffffff',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: '#64748b' }}>
                    Contractor / Architect ({record.site_contractor_architect_name || 'Site'})
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', letterSpacing: '0.02em' }}>
                    {record.site_contractor_architect_number}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      copyToClipboard(record.site_contractor_architect_number!, 'Contractor Number')
                    }
                    title="Copy number"
                    style={{ height: 30, padding: '0 8px' }}
                  >
                    <Icon name="content_copy" size={14} />
                  </button>
                  <a
                    href={`tel:${record.site_contractor_architect_number}`}
                    className="btn btn-primary btn-sm"
                    style={{
                      height: 30,
                      padding: '0 12px',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      background: '#0284c7',
                      borderColor: '#0284c7',
                    }}
                  >
                    <Icon name="call" size={14} /> Call
                  </a>
                </div>
              </div>
            ) : null}
          </div>

          {/* Side by side: Imported Details and Field Verification Details */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
            {/* 1. Imported Details */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: 14,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#475569',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  marginBottom: 10,
                  borderBottom: '1px solid #f1f5f9',
                  paddingBottom: 6,
                }}
              >
                <Icon name="folder_open" size={15} style={{ color: '#bf3646' }} />
                Imported Details
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 10px', fontSize: 12 }}>
                <span style={{ color: '#64748b' }}>Owner Name:</span>
                <span
                  style={{
                    fontWeight: 600,
                    color: '#0f172a',
                    maxHeight: 56,
                    overflowY: 'auto',
                    wordBreak: 'break-word',
                    display: 'block',
                  }}
                  title={record.owner_name_en || undefined}
                >
                  {record.owner_name_en || '—'}
                </span>

                <span style={{ color: '#64748b' }}>Site Address:</span>
                <span style={{ color: '#0f172a' }}>{record.site_address || record.street_address || '—'}</span>

                <span style={{ color: '#64748b' }}>Village / Taluk:</span>
                <span style={{ color: '#0f172a' }}>
                  {[record.village, record.taluk].filter(Boolean).join(', ') || '—'}
                </span>

                <span style={{ color: '#64748b' }}>District:</span>
                <span style={{ color: '#0f172a' }}>{record.district || '—'}</span>

                <span style={{ color: '#64748b' }}>Survey No:</span>
                <span style={{ color: '#0f172a' }}>{record.survey_no || record.survey_number || '—'}</span>

                <span style={{ color: '#64748b' }}>Contractor Name:</span>
                <span style={{ color: '#0f172a' }}>{record.site_contractor_architect_name || '—'}</span>

                {record.qc_builder_contact && (
                  <>
                    <span style={{ color: '#64748b' }}>QC Builder / Contact:</span>
                    <span style={{ color: '#0f172a' }}>{record.qc_builder_contact}</span>
                  </>
                )}

                <span style={{ color: '#64748b' }}>Coordinates:</span>
                <span style={{ color: '#0f172a', fontFamily: 'monospace', fontSize: 11 }}>
                  {record.coordinates || '—'}
                  {record.coordinates && (
                    <a
                      href={`https://www.google.com/maps?q=${encodeURIComponent(record.coordinates)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginLeft: 6, color: '#bf3646', textDecoration: 'none' }}
                      title="Open in Maps"
                    >
                      Maps ↗
                    </a>
                  )}
                </span>
              </div>
            </div>

            {/* 2. Field Verification Details */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: 14,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#475569',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  marginBottom: 10,
                  borderBottom: '1px solid #f1f5f9',
                  paddingBottom: 6,
                }}
              >
                <Icon name="task_alt" size={15} style={{ color: '#059669' }} />
                Field Verification Details
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '6px 10px', fontSize: 12 }}>
                <span style={{ color: '#64748b' }}>Verification Status:</span>
                <div>
                  {(() => {
                    const s = (record.status || '').toUpperCase();
                    let bg = '#fff7ed';
                    let color = '#d97706';
                    let dotBg = '#f59e0b';
                    let label = 'Pending Inspection';
                    if (s === 'COMPLETED' || s === 'UPDATED_REVISITED' || s === 'UPDATED REVISITED') {
                      bg = '#ecfdf5'; color = '#059669'; dotBg = '#10b981'; label = 'Inspection Completed';
                    } else if (s === 'NOT_INTERESTED' || s === 'NOT INTERESTED') {
                      bg = '#fef3c7'; color = '#b45309'; dotBg = '#f59e0b'; label = 'Not Interested';
                    } else if (s === 'DUPLICATE') {
                      bg = '#ede9fe'; color = '#6d28d9'; dotBg = '#8b5cf6'; label = 'Duplicate';
                    } else if (s === 'CONSTRUCTION_FINISHED' || s === 'CONSTRUCTION FINISHED') {
                      bg = '#ccfbf1'; color = '#0f766e'; dotBg = '#14b8a6'; label = 'Construction Finished';
                    }
                    return (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '1px 7px',
                          borderRadius: 9999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: bg,
                          color: color,
                        }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: dotBg,
                          }}
                        />
                        {label}
                      </span>
                    );
                  })()}
                </div>

                <span style={{ color: '#64748b' }}>Field Verifier:</span>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>{record.user_name || 'Not assigned'}</span>

                <span style={{ color: '#64748b' }}>Date of Visit:</span>
                <span style={{ color: '#0f172a' }}>{record.date_of_visit || '—'}</span>

                <span style={{ color: '#64748b' }}>Construction Happening:</span>
                <span style={{ fontWeight: 700, color: record.construction_happening?.toLowerCase() === 'yes' ? '#059669' : '#475569' }}>
                  {record.construction_happening || '—'}
                </span>

                <span style={{ color: '#64748b' }}>Type of Construction:</span>
                <span style={{ color: '#0f172a' }}>{record.type_of_construction || '—'}</span>

                <span style={{ color: '#64748b' }}>Stage of Construction:</span>
                <span style={{ color: '#0f172a' }}>{record.stage_of_construction || '—'}</span>

                {record.no_of_floors && (
                  <>
                    <span style={{ color: '#64748b' }}>No of Floors:</span>
                    <span style={{ color: '#0f172a' }}>{record.no_of_floors}</span>
                  </>
                )}

                {record.built_up_area && (
                  <>
                    <span style={{ color: '#64748b' }}>Built up area:</span>
                    <span style={{ color: '#0f172a' }}>{record.built_up_area}</span>
                  </>
                )}

                {record.expected_completion && (
                  <>
                    <span style={{ color: '#64748b' }}>Expected Completion:</span>
                    <span style={{ color: '#0f172a' }}>{record.expected_completion}</span>
                  </>
                )}

                {record.follow_up_date && (
                  <>
                    <span style={{ color: '#64748b' }}>Follow-up Date:</span>
                    <span style={{ color: '#1d4ed8', fontWeight: 600 }}>{record.follow_up_date}</span>
                  </>
                )}

                <span style={{ color: '#64748b' }}>Relationship with Bldg:</span>
                <span style={{ color: '#0f172a' }}>{record.relationship_with_building || '—'}</span>

                <span style={{ color: '#64748b' }}>Building User:</span>
                <span style={{ color: '#0f172a' }}>{record.building_user_name || '—'}</span>

                <span style={{ color: '#64748b' }}>Inspection Remarks:</span>
                <span style={{ color: '#0f172a', fontStyle: record.remarks ? 'normal' : 'italic' }}>
                  {record.remarks || 'No remarks provided'}
                </span>
              </div>

              {/* Photos Preview if any */}
              {record.images && record.images.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>
                    Captured Field Photos ({record.images.length}):
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {record.images.map((img) => (
                      <div
                        key={img.id}
                        style={{
                          cursor: 'pointer',
                          borderRadius: 6,
                          overflow: 'hidden',
                          border: '1px solid #cbd5e1',
                        }}
                        onClick={() => setActivePhoto(img.image_url || null)}
                        title="Click to view full photo"
                      >
                        <AuthThumbnail imageUrl={img.image_url} size={48} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 3. Telecaller Call Feedback, Building Parameters & Follow-up Form */}
          <form
            onSubmit={handleSave}
            style={{
              background: '#f8fafc',
              border: '1.5px solid #bf3646',
              borderRadius: 10,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#bf3646' }}>
                <Icon name="edit_note" size={19} />
                Telecaller Decision, Parameters & Follow-up
              </div>
              {record.telecaller_called_at && (
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Last called: {formatDateTime(record.telecaller_called_at)}
                  {record.telecaller_by_name && ` by ${record.telecaller_by_name}`}
                </span>
              )}
            </div>

            {/* A. Call Decision */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                Call Decision / Status <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <select
                className="fld"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                style={{ width: '100%', height: 36, fontSize: 12.5, fontWeight: 600, borderRadius: 6 }}
                required
              >
                {TELECALLER_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* B. Construction Parameters Grid */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 10 }}>
                <Icon name="apartment" size={14} style={{ color: '#0284c7' }} />
                Construction & Building Details
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                {/* 1. Stage of Construction */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>
                      Stage of Construction
                    </label>
                    {stageOfConstruction && (
                      <button
                        type="button"
                        onClick={() => {
                          setStageOfConstruction('');
                          setCustomStage('');
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: '0 4px',
                          fontSize: 10.5,
                          color: '#dc2626',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                          fontWeight: 600,
                        }}
                        title="Reset stage to unselected"
                      >
                        <Icon name="restart_alt" size={12} /> Reset
                      </button>
                    )}
                  </div>
                  <select
                    className="fld"
                    value={
                      STAGES_OF_CONSTRUCTION.includes(stageOfConstruction)
                        ? stageOfConstruction
                        : (stageOfConstruction ? 'Other' : '')
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'Other') {
                        setStageOfConstruction('Other');
                      } else {
                        setStageOfConstruction(val);
                        setCustomStage('');
                      }
                    }}
                    style={{ width: '100%', height: 34, fontSize: 11.5, borderRadius: 6 }}
                  >
                    <option value="">— Select Stage —</option>
                    {STAGES_OF_CONSTRUCTION.map((stg) => (
                      <option key={stg} value={stg}>
                        {stg}
                      </option>
                    ))}
                  </select>
                  {stageOfConstruction === 'Other' && (
                    <input
                      type="text"
                      className="fld"
                      value={customStage}
                      onChange={(e) => setCustomStage(e.target.value)}
                      placeholder="Specify stage..."
                      style={{ width: '100%', height: 30, fontSize: 11, marginTop: 4, borderRadius: 4 }}
                    />
                  )}
                </div>

                {/* 2. No of Floors */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    No of Floors
                  </label>
                  <input
                    type="text"
                    className="fld"
                    value={noOfFloors}
                    onChange={(e) => setNoOfFloors(e.target.value)}
                    placeholder="e.g. G+1, G+2, 3 Floors"
                    style={{ width: '100%', height: 34, fontSize: 11.5, borderRadius: 6 }}
                  />
                </div>

                {/* 3. Built up area */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Built up area
                  </label>
                  <input
                    type="text"
                    className="fld"
                    value={builtUpArea}
                    onChange={(e) => setBuiltUpArea(e.target.value)}
                    placeholder="e.g. 1,500 sq.ft"
                    style={{ width: '100%', height: 34, fontSize: 11.5, borderRadius: 6 }}
                  />
                </div>

                {/* 4. Expected Completion */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Expected Completion
                  </label>
                  <input
                    type="text"
                    className="fld"
                    value={expectedCompletion}
                    onChange={(e) => setExpectedCompletion(e.target.value)}
                    placeholder="e.g. Dec 2026, 6 Months"
                    style={{ width: '100%', height: 34, fontSize: 11.5, borderRadius: 6 }}
                  />
                </div>
              </div>
            </div>

            {/* C. Call History & New Appended Follow-up Notes */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  <Icon name="history" size={14} style={{ color: '#8b5cf6' }} />
                  Call & Follow-up History (Appended Log)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {record.telecaller_comment && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => setIsEditingHistory(!isEditingHistory)}
                      style={{ fontSize: 10.5, color: '#64748b' }}
                      title="Toggle direct editing of previous notes if needed to fix errors"
                    >
                      <Icon name="edit" size={12} />
                      {isEditingHistory ? 'Back to Add Note' : 'Edit Full History'}
                    </button>
                  )}
                </div>
              </div>

              {/* Existing Log Box */}
              {record.telecaller_comment ? (
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    padding: '8px 10px',
                    maxHeight: 140,
                    overflowY: 'auto',
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    color: '#334155',
                    whiteSpace: 'pre-wrap',
                    marginBottom: 10,
                  }}
                >
                  {record.telecaller_comment}
                </div>
              ) : (
                <div
                  style={{
                    background: '#f8fafc',
                    borderRadius: 6,
                    padding: '8px 10px',
                    fontSize: 11,
                    color: '#94a3b8',
                    fontStyle: 'italic',
                    marginBottom: 10,
                  }}
                >
                  No prior call logs or follow-up notes recorded yet.
                </div>
              )}

              {/* Direct History Editor or New Note Input */}
              {isEditingHistory ? (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#d97706', marginBottom: 4 }}>
                    ⚠️ Editing raw history (saving will overwrite the full history log above):
                  </div>
                  <textarea
                    className="fld"
                    rows={4}
                    value={historyText}
                    onChange={(e) => setHistoryText(e.target.value)}
                    style={{ width: '100%', fontSize: 11.5, borderRadius: 6 }}
                  />
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    Add New Note / Follow-up Details
                  </label>
                  <textarea
                    className="fld"
                    rows={2}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Enter call notes, customer conversation summary, or next action steps..."
                    style={{ width: '100%', minHeight: 52, fontSize: 12, borderRadius: 6, resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }}>
                    <span style={{ fontSize: 10, color: '#64748b' }}>
                      ✨ This note will be appended with current date, time, and your username.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Notice */}
            {notice && (
              <div
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  background: notice.tone === 'ok' ? '#ecfdf5' : '#fef2f2',
                  color: notice.tone === 'ok' ? '#059669' : '#dc2626',
                  border: `1px solid ${notice.tone === 'ok' ? '#a7f3d0' : '#fecaca'}`,
                }}
              >
                {notice.text}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={saving}
                style={{ background: '#bf3646', borderColor: '#bf3646', minWidth: 140 }}
              >
                <Icon name={saving ? 'refresh' : 'check_circle'} size={14} className={saving ? 'fos-spin' : undefined} />
                {saving ? 'Saving...' : 'Save Feedback'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Lightbox for previewing photo */}
      {activePhoto && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setActivePhoto(null)}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <AuthThumbnail imageUrl={activePhoto} size={600} />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setActivePhoto(null)}
              style={{ position: 'absolute', top: -12, right: -12, borderRadius: '50%', width: 28, height: 28, padding: 0 }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
