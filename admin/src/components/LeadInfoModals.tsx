import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { CaptureRecord } from '../types';
import { Icon } from './ui';
import { TelecallerHistoryTable } from './TelecallerHistoryTable';

interface ModalProps {
  record: CaptureRecord;
  onClose: () => void;
}

export function TelecallingInfoModal({ record, onClose }: ModalProps) {
  return createPortal(
    <div
      className="fos-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: 16,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fos-modal-card"
        style={{
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          maxWidth: 780,
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', padding: 8, borderRadius: 8, background: '#eff6ff', color: '#2563eb' }}>
              <Icon name="call" size={20} />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Telecalling Information</h3>
              <div style={{ fontSize: 12, color: '#64748b' }}>Lead: {record.unique_id || record.id} • {record.name || 'Site Lead'}</div>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} title="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 4 }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ padding: '20px', maxHeight: '75vh', overflowY: 'auto' }}>
          {/* Key Info Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Telecaller</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{record.assigned_telecaller_name || record.telecaller_by_name || 'Unassigned'}</div>
            </div>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Call Status</div>
              <div>
                <span className={`status-pill ${record.telecaller_status ? 'info' : 'neutral'}`} style={{ fontSize: 12, padding: '3px 8px' }}>
                  {record.telecaller_status ? record.telecaller_status.replace(/_/g, ' ') : 'Not Called'}
                </span>
              </div>
            </div>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Follow-up Date</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: record.follow_up_date ? '#b45309' : '#0f172a' }}>
                {record.follow_up_date ? `📅 ${record.follow_up_date}` : 'None scheduled'}
              </div>
            </div>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Last Call Date</div>
              <div style={{ fontSize: 13, color: '#0f172a' }}>
                {record.telecaller_called_at ? new Date(record.telecaller_called_at).toLocaleString() : 'N/A'}
              </div>
            </div>
          </div>

          {/* Construction details synced */}
          <div style={{ padding: '12px 14px', background: '#f1f5f9', borderRadius: 8, marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Synced Construction Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, fontSize: 12 }}>
              <div><strong>Stage:</strong> {record.stage_of_construction || '—'}</div>
              <div><strong>Floors:</strong> {record.no_of_floors || '—'}</div>
              <div><strong>Built-up Area:</strong> {record.built_up_area || '—'}</div>
              <div><strong>Expected Completion:</strong> {record.expected_completion || '—'}</div>
            </div>
          </div>

          {/* Call History / Comments Table */}
          <div>
            <h4 style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 700, color: '#334155', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="table_view" size={16} style={{ color: '#0284c7' }} />
              Call & Follow-up History (Table Format)
            </h4>
            <TelecallerHistoryTable
              comment={record.telecaller_comment}
              isEditing={false}
              maxHeight={320}
            />
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', background: '#f8fafc' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function FieldVerifierInfoModal({ record, onClose }: ModalProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const images = record.images || [];

  return createPortal(
    <div
      className="fos-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: 16,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fos-modal-card"
        style={{
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          maxWidth: 780,
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', padding: 8, borderRadius: 8, background: '#ecfdf5', color: '#059669' }}>
              <Icon name="photo_camera" size={20} />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Field Verification Details</h3>
              <div style={{ fontSize: 12, color: '#64748b' }}>Lead: {record.unique_id || record.id} • {record.name || 'Site Lead'}</div>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} title="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 4 }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ padding: '20px', maxHeight: '75vh', overflowY: 'auto' }}>
          {/* Key Info Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Field Verifier</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{record.user_name || 'Unassigned'}</div>
            </div>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Field Status</div>
              <div>
                <span className={`status-pill ${record.status === 'COMPLETED' ? 'success' : record.status === 'Updated Revisited' ? 'info' : 'warning'}`} style={{ fontSize: 12, padding: '3px 8px' }}>
                  {record.status || 'Pending'}
                </span>
              </div>
            </div>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Inspection Date</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                {record.date_of_visit || (record.field_captured_at ? new Date(record.field_captured_at).toLocaleDateString() : 'Not visited')}
              </div>
            </div>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>GPS Coordinates</div>
              <div style={{ fontSize: 12, color: '#0f172a', fontFamily: 'monospace' }}>
                {record.field_latitude && record.field_longitude ? `${record.field_latitude.toFixed(6)}, ${record.field_longitude.toFixed(6)}` : record.coordinates || 'N/A'}
              </div>
            </div>
          </div>

          {/* On-Site Findings */}
          <div style={{ padding: '14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 20 }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: 13, fontWeight: 700, color: '#334155' }}>On-Site Inspection Findings</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, fontSize: 13 }}>
              <div><strong>Construction Happening:</strong> {record.construction_happening || '—'}</div>
              <div><strong>Type of Construction:</strong> {record.type_of_construction || '—'}</div>
              <div><strong>Stage of Construction:</strong> {record.stage_of_construction || '—'}</div>
              <div><strong>No. of Floors:</strong> {record.no_of_floors || '—'}</div>
              <div><strong>Built-up Area:</strong> {record.built_up_area || '—'}</div>
              <div><strong>Expected Completion:</strong> {record.expected_completion || '—'}</div>
              <div><strong>Relationship with Building:</strong> {record.relationship_with_building || '—'}</div>
              <div><strong>Building User Name:</strong> {record.building_user_name || '—'}</div>
              <div><strong>Spoken With:</strong> {record.spoken_with || '—'}</div>
              <div><strong>Contact Number:</strong> {record.contact_number || '—'}</div>
              <div><strong>Contractor/Architect:</strong> {record.site_contractor_architect_name || '—'}</div>
              <div><strong>Contractor Contact:</strong> {record.site_contractor_architect_number || '—'}</div>
            </div>
            {record.remarks && (
              <div style={{ marginTop: 12, padding: 10, background: '#ffffff', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <strong style={{ fontSize: 12, color: '#64748b' }}>Remarks:</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#1e293b' }}>{record.remarks}</p>
              </div>
            )}
          </div>

          {/* Captured Photos Gallery */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: 13, fontWeight: 700, color: '#334155' }}>
              Captured On-Site Photos ({images.length})
            </h4>
            {images.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', background: '#f8fafc', borderRadius: 8, color: '#94a3b8', fontSize: 13 }}>
                No photos captured yet for this lead.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
                {images.map((img: any) => {
                  const url = `/api/images/${img.id}/thumbnail`;
                  const fullUrl = `/api/images/${img.id}`;
                  return (
                    <div
                      key={img.id}
                      onClick={() => setSelectedImage(fullUrl)}
                      style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0', aspectRatio: '1', position: 'relative' }}
                    >
                      <img src={url} alt={`Photo ${img.photo_order || img.id}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Full Image Preview Overlay */}
        {selectedImage && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100000,
              padding: 20,
            }}
            onClick={() => setSelectedImage(null)}
          >
            <div style={{ maxWidth: '90vw', maxHeight: '90vh', position: 'relative' }}>
              <img src={selectedImage} alt="Full preview" style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 8 }} />
              <button
                type="button"
                className="btn-icon"
                onClick={() => setSelectedImage(null)}
                style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', padding: 8, cursor: 'pointer' }}
              >
                <Icon name="close" size={20} />
              </button>
            </div>
          </div>
        )}

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', background: '#f8fafc' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function QaInfoModal({ record, onClose }: ModalProps) {
  const qcRefImg = record.qc_reference_image_url;

  return createPortal(
    <div
      className="fos-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: 16,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fos-modal-card"
        style={{
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          maxWidth: 700,
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', padding: 8, borderRadius: 8, background: '#fef3c7', color: '#d97706' }}>
              <Icon name="fact_check" size={20} />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>QA & Desk-Review Details</h3>
              <div style={{ fontSize: 12, color: '#64748b' }}>Lead: {record.unique_id || record.id} • {record.name || 'Site Lead'}</div>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} title="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 4 }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ padding: '20px', maxHeight: '75vh', overflowY: 'auto' }}>
          {/* Key Info Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>QA Auditor</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{record.assigned_auditor_name || record.audited_by_name || 'Unassigned'}</div>
            </div>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Audit Status</div>
              <div>
                <span className={`status-pill ${record.audit_status === 'APPROVAL' ? 'success' : record.audit_status === 'DISAPPROVAL' ? 'danger' : 'warning'}`} style={{ fontSize: 12, padding: '3px 8px' }}>
                  {record.audit_status || 'PENDING'}
                </span>
              </div>
            </div>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>QC Status</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: record.qc_status === 'DONE' ? '#059669' : '#b45309' }}>
                {record.qc_status === 'DONE' ? '✓ Completed' : 'Pending'}
              </div>
            </div>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Audited At</div>
              <div style={{ fontSize: 12, color: '#0f172a' }}>
                {record.audited_at ? new Date(record.audited_at).toLocaleString() : 'N/A'}
              </div>
            </div>
          </div>

          {/* QA Assessment */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
            {record.audit_comment && (
              <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Auditor Decision Comment</div>
                <div style={{ fontSize: 13, color: '#0f172a' }}>{record.audit_comment}</div>
              </div>
            )}
            {record.qc_vhr_comment && (
              <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>QC Comments (VHR Imagery)</div>
                <div style={{ fontSize: 13, color: '#0f172a' }}>{record.qc_vhr_comment}</div>
              </div>
            )}
            {record.qc_street_details && (
              <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>QC Additional Details (Street View)</div>
                <div style={{ fontSize: 13, color: '#0f172a' }}>{record.qc_street_details}</div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Sq.ft</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{record.qc_sqfeet || '—'}</div>
              </div>
              <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>QC Builder Contact</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{record.qc_builder_contact || '—'}</div>
              </div>
            </div>
          </div>

          {/* QC Reference Image */}
          {qcRefImg && (
            <div>
              <h4 style={{ margin: '0 0 10px 0', fontSize: 13, fontWeight: 700, color: '#334155' }}>
                QC Reference Image
              </h4>
              <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0', maxWidth: 300 }}>
                <img src={qcRefImg} alt="QC Reference" style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', background: '#f8fafc' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
