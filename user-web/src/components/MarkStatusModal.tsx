import { useState, useEffect } from 'react';
import type { CaptureRecord } from '../types';
import { api } from '../services/api';
import Icon from './common/Icon';

interface MarkStatusModalProps {
  record: CaptureRecord;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedRecord: CaptureRecord) => void;
}

const STATUS_OPTIONS = [
  {
    key: 'NOT_INTERESTED',
    label: 'Not Interested',
    icon: 'block',
    iconColor: '#b45309',
    bgColor: '#fef3c7',
    description: 'Owner or contact person refuses or is not interested in verification',
  },
  {
    key: 'DUPLICATE',
    label: 'Duplicate',
    icon: 'content_copy',
    iconColor: '#6d28d9',
    bgColor: '#ede9fe',
    description: 'Record is duplicate of an existing or already visited site',
  },
  {
    key: 'CONSTRUCTION_FINISHED',
    label: 'Construction Finished',
    icon: 'task_alt',
    iconColor: '#0f766e',
    bgColor: '#ccfbf1',
    description: 'Construction work is fully finished and site is complete',
  },
];

export default function MarkStatusModal({
  record,
  isOpen,
  onClose,
  onSuccess,
}: MarkStatusModalProps) {
  const currentNorm = (record.status || '').toUpperCase();
  const isCurrentlyClosed = [
    'NOT_INTERESTED',
    'NOT INTERESTED',
    'DUPLICATE',
    'CONSTRUCTION_FINISHED',
    'CONSTRUCTION FINISHED',
  ].includes(currentNorm);

  const initialStatus = (() => {
    if (currentNorm.includes('INTERESTED')) return 'NOT_INTERESTED';
    if (currentNorm === 'DUPLICATE') return 'DUPLICATE';
    if (currentNorm.includes('FINISHED')) return 'CONSTRUCTION_FINISHED';
    return 'NOT_INTERESTED';
  })();

  const [selectedStatus, setSelectedStatus] = useState<string>(initialStatus);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedStatus(initialStatus);
    setRemarks('');
    setError(null);
  }, [isOpen, initialStatus]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStatus) {
      setError('Please select a status');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      // Marking status must NOT update or alter coordinates
      const updated = await api.markRecordStatus(record.id, {
        status: selectedStatus,
        remarks: remarks.trim() || undefined,
      });
      onSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update record status');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mark-status-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          backgroundColor: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#f8fafc',
          }}
        >
          <div>
            <h2
              id="mark-status-title"
              style={{
                fontSize: '1.05rem',
                fontWeight: 700,
                color: '#0f172a',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="label" size={20} color="#FF6467" />
              Mark Verification Status
            </h2>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
              Record #{record.id} · {record.name}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'none',
              border: 'none',
              cursor: submitting ? 'not-allowed' : 'pointer',
              color: '#64748b',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Close"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '18px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                backgroundColor: '#fee2e2',
                color: '#b91c1c',
                fontSize: '0.82rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Icon name="error" size={16} color="#b91c1c" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 8 }}>
              Select Status Reason <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {STATUS_OPTIONS.map((opt) => {
                const isSelected = selectedStatus === opt.key;
                return (
                  <div
                    key={opt.key}
                    onClick={() => setSelectedStatus(opt.key)}
                    style={{
                      border: `1.5px solid ${isSelected ? opt.iconColor : '#e2e8f0'}`,
                      backgroundColor: isSelected ? opt.bgColor : '#ffffff',
                      borderRadius: 10,
                      padding: '10px 14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      transition: 'all 0.15s ease-in-out',
                    }}
                  >
                    <input
                      type="radio"
                      name="mark_status_choice"
                      id={`status-${opt.key}`}
                      checked={isSelected}
                      onChange={() => setSelectedStatus(opt.key)}
                      style={{ marginTop: 3, accentColor: opt.iconColor, cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.88rem', color: isSelected ? opt.iconColor : '#1e293b' }}>
                        <Icon name={opt.icon} size={17} color={opt.iconColor} />
                        <span>{opt.label}</span>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: 2, lineHeight: 1.35 }}>
                        {opt.description}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isCurrentlyClosed && (
                <div
                  onClick={() => setSelectedStatus('PENDING')}
                  style={{
                    border: `1.5px solid ${selectedStatus === 'PENDING' ? '#0284c7' : '#e2e8f0'}`,
                    backgroundColor: selectedStatus === 'PENDING' ? '#f0f9ff' : '#ffffff',
                    borderRadius: 10,
                    padding: '10px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    marginTop: 4,
                  }}
                >
                  <input
                    type="radio"
                    name="mark_status_choice"
                    id="status-PENDING"
                    checked={selectedStatus === 'PENDING'}
                    onChange={() => setSelectedStatus('PENDING')}
                    style={{ marginTop: 3, accentColor: '#0284c7', cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.88rem', color: selectedStatus === 'PENDING' ? '#0284c7' : '#1e293b' }}>
                      <Icon name="restore" size={17} color="#0284c7" />
                      <span>Reset to Pending</span>
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: 2 }}>
                      Move this record back to active Pending verification queue
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label htmlFor="mark-remarks" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 5 }}>
              Remarks / Comments (Optional)
            </label>
            <textarea
              id="mark-remarks"
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Owner met on site, declined to share details..."
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: '0.84rem',
                fontFamily: 'inherit',
                resize: 'vertical',
                outline: 'none',
              }}
            />
          </div>



          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 6, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              disabled={submitting}
              style={{ padding: '7px 14px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={submitting}
              style={{ padding: '7px 18px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {submitting ? (
                <>
                  <Icon name="sync" size={16} className="spin" />
                  <span>Saving…</span>
                </>
              ) : (
                <span>Confirm Status</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
