import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNotifications } from '../context/NotificationContext';
import Icon from './common/Icon';
import type { NotificationItem } from '../types';

interface NotificationBellProps {
  onSelectRecord?: (recordId: number) => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ onSelectRecord }) => {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    isMuted,
    toggleMute,
    browserPermission,
    requestBrowserPermission,
  } = useNotifications();

  const [isOpen, setIsOpen] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const handleNotificationClick = (item: NotificationItem) => {
    markAsRead(item.id);
    setIsOpen(false);
    if (item.record_id && onSelectRecord) {
      onSelectRecord(item.record_id);
    }
  };

  const formatRelativeTime = (isoString: string): string => {
    try {
      const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
      if (diffSec < 45) return 'Just now';
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      return `${Math.floor(diffSec / 86400)}d ago`;
    } catch {
      return '';
    }
  };

  const getRoleStyle = (type: string) => {
    switch (type) {
      case 'qa_assigned':
      case 'qa_done':
        return {
          roleLabel: 'QC Review',
          icon: 'verified',
          primaryColor: '#7c3aed',
          bg: '#faf5ff',
          border: '#ddd6fe',
          pillBg: '#f3e8ff',
        };
      case 'verifier_assigned':
      case 'verifier_activity':
        return {
          roleLabel: 'Field Task',
          icon: 'photo_camera',
          primaryColor: '#ea580c',
          bg: '#fff7ed',
          border: '#fed7aa',
          pillBg: '#ffedd5',
        };
      case 'telecaller_assigned':
        return {
          roleLabel: 'Telecaller',
          icon: 'phone_in_talk',
          primaryColor: '#0284c7',
          bg: '#f0f9ff',
          border: '#bae6fd',
          pillBg: '#e0f2fe',
        };
      case 'verifier_due_reminder':
      case 'admin_due_reminder':
        return {
          roleLabel: 'Due Reminder',
          icon: 'warning',
          primaryColor: '#dc2626',
          bg: '#fef2f2',
          border: '#fecaca',
          pillBg: '#fee2e2',
        };
      default:
        return {
          roleLabel: 'System',
          icon: 'notifications',
          primaryColor: '#475569',
          bg: '#f8fafc',
          border: '#e2e8f0',
          pillBg: '#f1f5f9',
        };
    }
  };

  // Group notifications by unique_id (or "general")
  const groupedNotifications = useMemo(() => {
    const map = new Map<string, {
      key: string;
      uniqueId?: string;
      recordId?: number;
      items: NotificationItem[];
      latestTime: string;
      hasUnread: boolean;
    }>();

    for (const item of notifications) {
      const key = item.unique_id ? `uid-${item.unique_id}` : 'general';
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          uniqueId: item.unique_id || undefined,
          recordId: item.record_id || undefined,
          items: [item],
          latestTime: item.created_at,
          hasUnread: !item.is_read,
        });
      } else {
        existing.items.push(item);
        if (!item.is_read) existing.hasUnread = true;
        if (!existing.recordId && item.record_id) existing.recordId = item.record_id;
      }
    }

    return Array.from(map.values());
  }, [notifications]);

  return (
    <>
      {/* ── Bell Trigger Button ── */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="hdr-bell-btn"
        title={unreadCount > 0 ? `${unreadCount} unread alert(s)` : 'Notifications'}
        aria-label="Open notifications"
        style={{
          position: 'relative',
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: '1px solid #e2e8f0',
          background: isOpen ? '#f1f5f9' : '#ffffff',
          color: unreadCount > 0 ? '#0f172a' : '#64748b',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
          transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)',
        }}
      >
        <Icon name="notifications" size={18} color={unreadCount > 0 ? '#1e293b' : '#64748b'} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              backgroundColor: '#ef4444',
              color: '#ffffff',
              fontSize: 10,
              fontWeight: 800,
              minWidth: 17,
              height: 17,
              borderRadius: 9,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              border: '2px solid #ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              animation: 'pulse 2s infinite',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* ── Fullscreen/Sheet Portal Modal ── */}
      {isOpen &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999999,
              backgroundColor: 'rgba(15, 23, 42, 0.55)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              padding: '16px 12px',
              animation: 'fadeIn 0.18s ease-out',
            }}
            onClick={() => setIsOpen(false)}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 420,
                maxHeight: 'calc(100vh - 32px)',
                background: '#ffffff',
                borderRadius: 18,
                boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.35), 0 10px 20px -5px rgba(15, 23, 42, 0.15)',
                border: '1px solid #cbd5e1',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                animation: 'slideDownModal 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                  borderBottom: '1px solid #f1f5f9',
                  background: '#fafafa',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: '#fff1f2',
                      color: '#e11d48',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="notifications" size={16} color="#e11d48" />
                  </div>
                  <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>
                    Notifications
                  </span>
                  {unreadCount > 0 && (
                    <span
                      style={{
                        background: '#fee2e2',
                        color: '#dc2626',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        padding: '1px 7px',
                        borderRadius: 12,
                      }}
                    >
                      {unreadCount} new
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {/* Audio Mute Toggle */}
                  <button
                    type="button"
                    onClick={toggleMute}
                    title={isMuted ? 'Unmute chime' : 'Mute chime'}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 6,
                      borderRadius: 8,
                      cursor: 'pointer',
                      color: isMuted ? '#94a3b8' : '#059669',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Icon name={isMuted ? 'volume_off' : 'volume_up'} size={18} color={isMuted ? '#94a3b8' : '#059669'} />
                  </button>

                  {/* Mark All Read */}
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => markAllAsRead()}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: '#2563eb',
                        cursor: 'pointer',
                        borderRadius: 6,
                      }}
                    >
                      Mark all read
                    </button>
                  )}

                  {/* Close Cross */}
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    style={{
                      background: '#f1f5f9',
                      border: 'none',
                      color: '#64748b',
                      cursor: 'pointer',
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    <Icon name="close" size={14} color="#64748b" />
                  </button>
                </div>
              </div>

              {/* Browser Notification Banner Prompt */}
              {browserPermission !== 'granted' && browserPermission !== 'unsupported' && (
                <div
                  style={{
                    padding: '8px 14px',
                    backgroundColor: '#f0fdf4',
                    borderBottom: '1px solid #dcfce7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <Icon name="notifications_active" size={15} color="#16a34a" />
                    <span style={{ fontSize: '0.74rem', color: '#166534', fontWeight: 600 }}>
                      Enable phone & browser alerts for new tasks
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => requestBrowserPermission()}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 6,
                      border: 'none',
                      backgroundColor: '#16a34a',
                      color: '#ffffff',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Enable
                  </button>
                </div>
              )}

              {/* Notification List - Grouped by Unique ID with Role Themes */}
              <div style={{ maxHeight: '65vh', overflowY: 'auto', padding: '4px 0' }}>
                {groupedNotifications.length === 0 ? (
                  <div style={{ padding: '40px 16px', textAlign: 'center', color: '#94a3b8' }}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        background: '#f1f5f9',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 10,
                      }}
                    >
                      <Icon name="notifications" size={24} color="#94a3b8" />
                    </div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#334155' }}>
                      No notifications yet
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
                      Assigned site tasks and revisits will appear right here.
                    </p>
                  </div>
                ) : (
                  groupedNotifications.map((group) => (
                    <div key={group.key} style={{ borderBottom: '1.5px solid #e2e8f0' }}>
                      {/* Unique ID / Group Header */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '7px 12px',
                          background: group.hasUnread ? '#f1f5f9' : '#f8fafc',
                          borderBottom: '1px solid #e2e8f0',
                          fontSize: '0.75rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {group.uniqueId ? (
                            <>
                              <span style={{ display: 'flex', alignItems: 'center', color: '#ea580c' }}>
                                <Icon name="location_on" size={14} color="#ea580c" />
                              </span>
                              <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 800, color: '#1e293b' }}>
                                {group.uniqueId}
                              </span>
                              {group.recordId && onSelectRecord && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setIsOpen(false);
                                    onSelectRecord(group.recordId!);
                                  }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: '0 2px',
                                    color: '#2563eb',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    textDecoration: 'underline',
                                  }}
                                >
                                  Open
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              <Icon name="notifications" size={14} color="#64748b" />
                              <span style={{ fontWeight: 700, color: '#475569' }}>
                                General & Reminders
                              </span>
                            </>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            style={{
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: 4,
                              background: '#ffffff',
                              border: '1px solid #cbd5e1',
                              color: '#475569',
                            }}
                          >
                            {group.items.length} {group.items.length === 1 ? (group.uniqueId ? 'task' : 'update') : (group.uniqueId ? 'tasks' : 'updates')}
                          </span>
                          <span style={{ fontSize: '0.66rem', color: '#94a3b8' }}>
                            {formatRelativeTime(group.latestTime)}
                          </span>
                        </div>
                      </div>

                      {/* Group Items */}
                      <div>
                        {group.items.map((item) => {
                          const cfg = getRoleStyle(item.type);
                          return (
                            <div
                              key={item.id}
                              onClick={() => handleNotificationClick(item)}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 10,
                                padding: '10px 14px',
                                borderBottom: '1px solid #f8fafc',
                                background: item.is_read ? '#ffffff' : cfg.bg,
                                borderLeft: `3.5px solid ${cfg.primaryColor}`,
                                cursor: 'pointer',
                                transition: 'background 0.15s ease',
                              }}
                            >
                              {/* Role Icon Badge */}
                              <div
                                style={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: 6,
                                  background: cfg.pillBg,
                                  color: cfg.primaryColor,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                  marginTop: 1,
                                }}
                              >
                                <Icon name={cfg.icon} size={15} color={cfg.primaryColor} />
                              </div>

                              {/* Content */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                    {/* Role Pill */}
                                    <span
                                      style={{
                                        fontSize: '0.65rem',
                                        fontWeight: 800,
                                        color: cfg.primaryColor,
                                        background: cfg.pillBg,
                                        border: `1px solid ${cfg.border}`,
                                        padding: '1px 5px',
                                        borderRadius: 4,
                                      }}
                                    >
                                      {cfg.roleLabel}
                                    </span>
                                    <span style={{ fontSize: '0.8rem', fontWeight: item.is_read ? 600 : 800, color: '#0f172a' }}>
                                      {item.title}
                                    </span>
                                  </div>
                                  <span style={{ fontSize: '0.68rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                                    {formatRelativeTime(item.created_at)}
                                  </span>
                                </div>

                                <p style={{ margin: '3px 0 4px', fontSize: '0.74rem', color: '#475569', lineHeight: 1.35 }}>
                                  {item.message}
                                </p>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {item.with_sound && (
                                    <span style={{ fontSize: '0.66rem', color: '#059669', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                      <Icon name="volume_up" size={11} color="#059669" /> chime
                                    </span>
                                  )}
                                  {!item.is_read && (
                                    <span
                                      style={{
                                        marginLeft: 'auto',
                                        width: 6,
                                        height: 6,
                                        borderRadius: '50%',
                                        backgroundColor: cfg.primaryColor,
                                      }}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
