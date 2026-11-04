import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import { Icon, type IconName } from './ui';
import type { NotificationItem } from '../types';

export const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, isMuted, toggleMute, browserPermission, requestBrowserPermission } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number }>({ top: 62, right: 20 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const updatePosition = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopoverPos({
        top: rect.bottom + 8,
        right: Math.max(16, window.innerWidth - rect.right),
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      const handleResize = () => updatePosition();
      window.addEventListener('resize', handleResize);
      window.addEventListener('scroll', handleResize, true);
      return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('scroll', handleResize, true);
      };
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleNotificationClick = (item: NotificationItem) => {
    markAsRead(item.id);
    setIsOpen(false);

    if (item.record_id) {
      navigate(`/records/${item.record_id}`);
    } else if (item.type === 'telecaller_assigned') {
      navigate('/telecaller');
    } else if (item.type === 'qa_assigned' || item.type === 'qa_done') {
      navigate('/records');
    } else if (item.type === 'verifier_assigned' || item.type === 'verifier_activity' || item.type === 'verifier_due_reminder' || item.type === 'admin_due_reminder') {
      navigate('/records');
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
          roleLabel: 'QC Audit',
          icon: 'fact_check' as IconName,
          primaryColor: '#7c3aed',
          bg: '#faf5ff',
          border: '#ddd6fe',
          pillBg: '#f3e8ff',
        };
      case 'verifier_assigned':
      case 'verifier_activity':
        return {
          roleLabel: 'Field Verifier',
          icon: 'photo_camera' as IconName,
          primaryColor: '#ea580c',
          bg: '#fff7ed',
          border: '#fed7aa',
          pillBg: '#ffedd5',
        };
      case 'telecaller_assigned':
        return {
          roleLabel: 'Telecaller',
          icon: 'phone_in_talk' as IconName,
          primaryColor: '#0284c7',
          bg: '#f0f9ff',
          border: '#bae6fd',
          pillBg: '#e0f2fe',
        };
      case 'verifier_due_reminder':
      case 'admin_due_reminder':
        return {
          roleLabel: 'Due Reminder',
          icon: 'warning' as IconName,
          primaryColor: '#dc2626',
          bg: '#fef2f2',
          border: '#fecaca',
          pillBg: '#fee2e2',
        };
      default:
        return {
          roleLabel: 'System',
          icon: 'notifications' as IconName,
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
      {/* Bell Trigger Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!isOpen) updatePosition();
          setIsOpen(!isOpen);
        }}
        title={unreadCount > 0 ? `${unreadCount} unread notification(s)` : 'Notifications'}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '1px solid #e2e8f0',
          background: isOpen ? '#f1f5f9' : '#ffffff',
          color: unreadCount > 0 ? '#1e293b' : '#64748b',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
      >
        <Icon name="notifications" size={19} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              background: '#ef4444',
              color: '#ffffff',
              fontSize: 10,
              fontWeight: 700,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              border: '2px solid #ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              animation: 'pulse 2s infinite',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown Portal (escapes all topbar overflow and stacking contexts) */}
      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: popoverPos.top,
              right: popoverPos.right,
              width: 380,
              maxWidth: 'calc(100vw - 24px)',
              background: '#ffffff',
              borderRadius: 14,
              boxShadow: '0 20px 45px -10px rgba(15, 23, 42, 0.28), 0 10px 20px -5px rgba(15, 23, 42, 0.12)',
              border: '1.5px solid #cbd5e1',
              zIndex: 99999999,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Popover Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid #f1f5f9',
                background: '#fafafa',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <span
                    style={{
                      background: '#fee2e2',
                      color: '#dc2626',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 10,
                    }}
                  >
                    {unreadCount} new
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Sound Mute Toggle */}
                <button
                  type="button"
                  onClick={toggleMute}
                  title={isMuted ? 'Unmute notification sound' : 'Mute notification sound'}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 4,
                    cursor: 'pointer',
                    color: isMuted ? '#94a3b8' : '#059669',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Icon name={isMuted ? 'volume_off' : 'volume_up'} size={17} />
                </button>

                {/* Mark All Read */}
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => markAllAsRead()}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '2px 6px',
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: '#6366f1',
                      cursor: 'pointer',
                    }}
                  >
                    Mark all read
                  </button>
                )}

                {/* Close Button */}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  style={{
                    background: '#f1f5f9',
                    border: 'none',
                    color: '#64748b',
                    cursor: 'pointer',
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                  }}
                  title="Close"
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            </div>

            {/* Browser OS Notification Banner Prompt */}
            {browserPermission !== 'granted' && browserPermission !== 'unsupported' && (
              <div
                style={{
                  padding: '7px 14px',
                  backgroundColor: '#f0fdf4',
                  borderBottom: '1px solid #dcfce7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>
                  Enable desktop / OS push alerts for live tasks
                </span>
                <button
                  type="button"
                  onClick={() => requestBrowserPermission()}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 5,
                    border: 'none',
                    backgroundColor: '#16a34a',
                    color: '#ffffff',
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Enable
                </button>
              </div>
            )}

            {/* Notification List - Grouped by Unique ID with Role Color Themes */}
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {groupedNotifications.length === 0 ? (
                <div style={{ padding: '36px 16px', textAlign: 'center', color: '#94a3b8' }}>
                  <Icon name="notifications_none" size={32} style={{ marginBottom: 6, opacity: 0.6 }} />
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>No notifications yet</p>
                  <span style={{ fontSize: 11 }}>Task assignments and updates will appear here</span>
                </div>
              ) : (
                groupedNotifications.map((group) => (
                  <div key={group.key} style={{ borderBottom: '1.5px solid #e2e8f0' }}>
                    {/* Unique ID / Section Header */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '7px 12px',
                        background: group.hasUnread ? '#f1f5f9' : '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: 11.5,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {group.uniqueId ? (
                          <>
                            <span style={{ display: 'flex', alignItems: 'center', color: '#6366f1' }}>
                              <Icon name="pin_drop" size={14} style={{ color: '#6366f1' }} />
                            </span>
                            <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#1e293b' }}>
                              {group.uniqueId}
                            </span>
                            {group.recordId && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIsOpen(false);
                                  navigate(`/records/${group.recordId}`);
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: '0 2px',
                                  color: '#2563eb',
                                  fontSize: 10.5,
                                  fontWeight: 650,
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                }}
                              >
                                View Site
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <Icon name="notifications" size={14} style={{ color: '#64748b' }} />
                            <span style={{ fontWeight: 700, color: '#475569' }}>
                              General & Reminders
                            </span>
                          </>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            color: '#475569',
                          }}
                        >
                          {group.items.length} {group.items.length === 1 ? 'update' : 'updates'}
                        </span>
                        <span style={{ fontSize: 9.5, color: '#94a3b8' }}>
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
                              padding: '9px 12px',
                              borderBottom: '1px solid #f8fafc',
                              background: item.is_read ? '#ffffff' : cfg.bg,
                              borderLeft: `3.5px solid ${cfg.primaryColor}`,
                              cursor: 'pointer',
                              transition: 'background 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#f1f5f9';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = item.is_read ? '#ffffff' : cfg.bg;
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
                              <Icon name={cfg.icon} size={15} style={{ color: cfg.primaryColor }} />
                            </div>

                            {/* Content */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                  {/* Distinct Role Badge */}
                                  <span
                                    style={{
                                      fontSize: 9.5,
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
                                  <span style={{ fontSize: 12, fontWeight: item.is_read ? 600 : 750, color: '#0f172a' }}>
                                    {item.title}
                                  </span>
                                </div>
                                <span style={{ fontSize: 9.5, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                                  {formatRelativeTime(item.created_at)}
                                </span>
                              </div>

                              <p style={{ margin: '2px 0 3px', fontSize: 11.5, color: '#475569', lineHeight: 1.35 }}>
                                {item.message}
                              </p>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {item.with_sound && (
                                  <span
                                    title="Chime played"
                                    style={{ fontSize: 9.5, color: '#059669', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                                  >
                                    <Icon name="volume_up" size={11} style={{ color: '#059669' }} /> chime
                                  </span>
                                )}
                                {!item.is_read && (
                                  <span
                                    style={{
                                      marginLeft: 'auto',
                                      width: 6,
                                      height: 6,
                                      borderRadius: '50%',
                                      background: cfg.primaryColor,
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
          </div>,
          document.body
        )}
    </>
  );
};
