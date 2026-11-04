import React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import { Icon, type IconName } from './ui';
import type { NotificationItem } from '../types';

export const NotificationToastContainer: React.FC = () => {
  const { toasts, dismissToast, markAsRead } = useNotifications();
  const navigate = useNavigate();

  if (toasts.length === 0) return null;

  const handleToastClick = (toast: NotificationItem) => {
    markAsRead(toast.id);
    dismissToast(toast.id);

    if (toast.record_id) {
      navigate(`/records/${toast.record_id}`);
    } else if (toast.type === 'telecaller_assigned') {
      navigate('/telecaller');
    } else if (toast.type === 'qa_assigned' || toast.type === 'qa_done') {
      navigate('/records');
    } else if (toast.type === 'verifier_assigned' || toast.type === 'verifier_activity') {
      navigate('/records');
    }
  };

  const getToastColors = (type: string): { border: string; icon: IconName; color: string; bg: string } => {
    switch (type) {
      case 'qa_assigned':
      case 'qa_done':
        return { border: '#8b5cf6', icon: 'assignment_turned_in', color: '#7c3aed', bg: '#f5f3ff' };
      case 'verifier_assigned':
      case 'verifier_activity':
        return { border: '#38bdf8', icon: 'camera_alt', color: '#0284c7', bg: '#f0f9ff' };
      case 'telecaller_assigned':
        return { border: '#34d399', icon: 'phone_in_talk', color: '#059669', bg: '#ecfdf5' };
      default:
        return { border: '#818cf8', icon: 'notifications', color: '#6366f1', bg: '#eef2ff' };
    }
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 76,
        right: 24,
        zIndex: 99999999,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 400,
        width: 'calc(100vw - 32px)',
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
              background: '#ffffff',
              borderRadius: 14,
              boxShadow: '0 16px 36px rgba(15, 23, 42, 0.22), 0 6px 14px rgba(15, 23, 42, 0.1)',
              border: `1.5px solid ${theme.border}`,
              borderLeft: `6px solid ${theme.color}`,
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              animation: 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Icon */}
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: theme.bg,
                color: theme.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              <Icon name={theme.icon} size={20} />
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>
                  {toast.title}
                </span>
                {toast.with_sound && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#059669',
                      background: '#ecfdf5',
                      padding: '1px 6px',
                      borderRadius: 4,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <Icon name="volume_up" size={11} /> Chime
                  </span>
                )}
              </div>

              <p style={{ margin: '4px 0 8px', fontSize: 12, color: '#475569', lineHeight: 1.4 }}>
                {toast.message}
              </p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                {toast.unique_id ? (
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      fontWeight: 700,
                      background: '#f1f5f9',
                      color: '#1e293b',
                      padding: '2px 7px',
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
                  <button
                    type="button"
                    onClick={() => handleToastClick(toast)}
                    style={{
                      background: theme.color,
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '5px 12px',
                      cursor: 'pointer',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    }}
                  >
                    View Record
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissToast(toast.id)}
                    style={{
                      background: '#f1f5f9',
                      color: '#64748b',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '5px 9px',
                      cursor: 'pointer',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>

            {/* Close Cross */}
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: 4,
                margin: '-4px -4px 0 0',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Close"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
};
