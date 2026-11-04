import React from 'react';
import { createPortal } from 'react-dom';
import { useNotifications } from '../context/NotificationContext';
import Icon from './common/Icon';
import type { NotificationItem } from '../types';

interface NotificationToastContainerProps {
  onSelectRecord?: (recordId: number) => void;
}

export const NotificationToastContainer: React.FC<NotificationToastContainerProps> = ({ onSelectRecord }) => {
  const { toasts, dismissToast, markAsRead } = useNotifications();

  if (toasts.length === 0) return null;

  const handleToastClick = (toast: NotificationItem) => {
    markAsRead(toast.id);
    dismissToast(toast.id);
    if (toast.record_id && onSelectRecord) {
      onSelectRecord(toast.record_id);
    }
  };

  const getToastColors = (type: string) => {
    switch (type) {
      case 'verifier_assigned':
        return { border: '#3b82f6', color: '#1d4ed8', bg: '#eff6ff', icon: 'assignment' };
      case 'verifier_activity':
        return { border: '#0284c7', color: '#0369a1', bg: '#f0f9ff', icon: 'photo_camera' };
      case 'qa_assigned':
      case 'qa_done':
        return { border: '#8b5cf6', color: '#6d28d9', bg: '#f5f3ff', icon: 'verified' };
      default:
        return { border: '#f97316', color: '#ea580c', bg: '#fff7ed', icon: 'notifications' };
    }
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 99999999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 420,
        width: 'calc(100vw - 24px)',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => {
        const theme = getToastColors(toast.type);
        return (
          <div
            key={toast.id}
            style={{
              pointerEvents: 'auto',
              backgroundColor: '#ffffff',
              borderRadius: 14,
              boxShadow: '0 16px 36px rgba(15, 23, 42, 0.24), 0 6px 14px rgba(15, 23, 42, 0.1)',
              border: `1.5px solid ${theme.border}`,
              borderLeft: `5px solid ${theme.color}`,
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              animation: 'slideDownToast 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Icon */}
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: theme.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              <Icon name={theme.icon} size={18} color={theme.color} />
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0f172a' }}>
                  {toast.title}
                </span>
                {toast.with_sound && (
                  <span
                    style={{
                      fontSize: '0.66rem',
                      fontWeight: 700,
                      color: '#059669',
                      backgroundColor: '#ecfdf5',
                      padding: '1px 5px',
                      borderRadius: 4,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <Icon name="volume_up" size={10} color="#059669" /> Chime
                  </span>
                )}
              </div>

              <p style={{ margin: '2px 0 6px', fontSize: '0.74rem', color: '#475569', lineHeight: 1.35 }}>
                {toast.message}
              </p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                {toast.unique_id ? (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      backgroundColor: '#f1f5f9',
                      color: '#1e293b',
                      padding: '1px 6px',
                      borderRadius: 4,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    {toast.unique_id}
                  </span>
                ) : (
                  <span />
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {toast.record_id && (
                    <button
                      type="button"
                      onClick={() => handleToastClick(toast)}
                      style={{
                        backgroundColor: theme.color,
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '4px 10px',
                        cursor: 'pointer',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                      }}
                    >
                      View Task
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dismissToast(toast.id)}
                    style={{
                      backgroundColor: '#f1f5f9',
                      color: '#64748b',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      padding: '4px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>

            {/* Close cross */}
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
              }}
              title="Close"
            >
              <Icon name="close" size={14} color="#94a3b8" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
};
