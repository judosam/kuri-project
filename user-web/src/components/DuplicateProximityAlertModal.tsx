import React from 'react';
import { createPortal } from 'react-dom';
import Icon from './common/Icon';
import type { CaptureRecord } from '../types';

interface DuplicateProximityAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProceed: () => void;
  onViewMatched?: (recordId: number) => void;
  onMarkDuplicate?: (record: CaptureRecord) => void;
  currentRecord?: CaptureRecord | null;
  matchedSiteId?: string | null;
  matchedRecordId?: number | null;
  distanceMeters?: number | null;
  warningText?: string | null;
  isVisited?: boolean;
}

export default function DuplicateProximityAlertModal({
  isOpen,
  onClose,
  onProceed,
  onViewMatched,
  onMarkDuplicate,
  currentRecord,
  matchedSiteId,
  matchedRecordId,
  distanceMeters,
  warningText,
  isVisited = true,
}: DuplicateProximityAlertModalProps) {
  if (!isOpen || typeof document === 'undefined') return null;

  const displayDistance = distanceMeters != null ? Math.round(distanceMeters) : null;
  const targetId = currentRecord?.unique_id || (currentRecord?.id ? `#${currentRecord.id}` : 'New Site');

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(5px)',
        zIndex: 9999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 18,
          width: '100%',
          maxWidth: 440,
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.35)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          border: '2px solid #fecaca',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            backgroundColor: '#fef2f2',
            borderBottom: '1px solid #fee2e2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                backgroundColor: '#fee2e2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#dc2626',
                flexShrink: 0,
              }}
            >
              <Icon name="warning" size={22} color="#dc2626" />
            </div>
            <div>
              <h2
                style={{
                  fontSize: '1rem',
                  fontWeight: 800,
                  color: '#991b1b',
                  margin: 0,
                  lineHeight: 1.25,
                }}
              >
                Proximity Alert: Potential Duplicate
              </h2>
              <span style={{ fontSize: '0.74rem', color: '#b91c1c', fontWeight: 600 }}>
                Check site before opening camera
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
            }}
            aria-label="Close"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Main Warning Box */}
          <div
            style={{
              backgroundColor: '#fff1f2',
              border: '1.5px solid #fecdd3',
              borderRadius: 12,
              padding: '12px 14px',
            }}
          >
            <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#be123c', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="error" size={16} color="#e11d48" />
              <span>Site may have already been visited!</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.80rem', color: '#475569', lineHeight: 1.45 }}>
              {warningText || 'An existing site was detected within the 40m/50m proximity threshold of this location.'}
            </p>
          </div>

          {/* Details Table */}
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: '0.82rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b', fontWeight: 600 }}>Current Target:</span>
              <span style={{ fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>{targetId}</span>
            </div>

            {matchedSiteId && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Matched Existing Site:</span>
                <span style={{ fontWeight: 800, color: '#be123c', fontFamily: 'monospace', backgroundColor: '#ffe4e6', padding: '1px 6px', borderRadius: 4 }}>
                  {matchedSiteId}
                </span>
              </div>
            )}

            {displayDistance !== null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Distance to Existing:</span>
                <span style={{ fontWeight: 700, color: '#1e293b' }}>
                  {displayDistance} meters away
                </span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b', fontWeight: 600 }}>Existing Site Status:</span>
              <span style={{ fontWeight: 700, color: isVisited ? '#15803d' : '#b45309' }}>
                {isVisited ? 'Visited & Captured' : 'Pending / Staged'}
              </span>
            </div>
          </div>

          <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.4, textAlign: 'center' }}>
            Is this an <strong>adjacent new plot</strong> or a <strong>duplicate inspection</strong> of the existing building?
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {/* Proceed to Camera */}
            <button
              type="button"
              className="btn btn-primary"
              onClick={onProceed}
              style={{
                width: '100%',
                padding: '10px 16px',
                fontSize: '0.88rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                borderRadius: 9,
                backgroundColor: '#1e293b',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <Icon name="photo_camera" size={18} color="#ffffff" />
              <span>It's a New Plot — Open Camera</span>
            </button>

            {/* View Matched Site */}
            {matchedRecordId && onViewMatched && (
              <button
                type="button"
                onClick={() => onViewMatched(matchedRecordId)}
                style={{
                  width: '100%',
                  padding: '9px 16px',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  borderRadius: 9,
                  backgroundColor: '#f0f9ff',
                  color: '#0284c7',
                  border: '1.5px solid #bae6fd',
                  cursor: 'pointer',
                }}
              >
                <Icon name="visibility" size={17} color="#0284c7" />
                <span>View Existing Record ({matchedSiteId})</span>
              </button>
            )}

            {/* Mark as Duplicate directly */}
            {currentRecord && onMarkDuplicate && (
              <button
                type="button"
                onClick={() => onMarkDuplicate(currentRecord)}
                style={{
                  width: '100%',
                  padding: '9px 16px',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  borderRadius: 9,
                  backgroundColor: '#faf5ff',
                  color: '#7c3aed',
                  border: '1.5px solid #ddd6fe',
                  cursor: 'pointer',
                }}
              >
                <Icon name="content_copy" size={17} color="#7c3aed" />
                <span>Mark as Duplicate (Skip Inspection)</span>
              </button>
            )}

            {/* Cancel Button */}
            <button
              type="button"
              onClick={onClose}
              style={{
                width: '100%',
                padding: '8px 16px',
                fontSize: '0.82rem',
                fontWeight: 600,
                backgroundColor: 'transparent',
                color: '#64748b',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
