import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { NotificationItem } from '../types';
import { api } from '../services/api';
import { playNotificationSound, isNotificationSoundMuted, setNotificationSoundMuted } from '../utils/sound';

interface NotificationContextType {
  notifications: NotificationItem[];
  unreadCount: number;
  toasts: NotificationItem[];
  isMuted: boolean;
  toggleMute: () => void;
  browserPermission: NotificationPermission | 'unsupported';
  requestBrowserPermission: () => Promise<boolean>;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dismissToast: (id: number) => void;
  spawnToast: (toast: Partial<NotificationItem>) => void;
  refreshNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const TOAST_DURATION_MS = 6500;
const POLL_INTERVAL_MS = 3500;

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const [isMuted, setIsMuted] = useState<boolean>(isNotificationSoundMuted());
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'unsupported';
  });

  const lastIdRef = useRef<number>(0);
  const isInitialLoadRef = useRef<boolean>(true);
  const pollTimerRef = useRef<any>(null);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      setNotificationSoundMuted(next);
      return next;
    });
  }, []);

  const requestBrowserPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false;
    }
    try {
      const res = await Notification.requestPermission();
      setBrowserPermission(res);
      return res === 'granted';
    } catch {
      return false;
    }
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const spawnToast = useCallback((custom: Partial<NotificationItem>) => {
    const fakeId = custom.id || Date.now();
    const item: NotificationItem = {
      id: fakeId,
      recipient_id: custom.recipient_id || 0,
      type: custom.type || 'system_notice',
      title: custom.title || 'Notification',
      message: custom.message || '',
      record_id: custom.record_id,
      unique_id: custom.unique_id,
      with_sound: custom.with_sound ?? true,
      is_read: false,
      created_at: custom.created_at || new Date().toISOString(),
    };

    if (item.with_sound) {
      playNotificationSound();
    }

    // Trigger browser-level notification
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(item.title, {
          body: item.message,
          icon: '/app/kuri-icon.png',
          tag: `kuri-notif-${fakeId}`,
        });
      } catch {
        // Ignored if service worker or permission issue
      }
    }

    setToasts((prev) => [item, ...prev].slice(0, 3));
  }, []);

  const refreshNotifications = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await api.getNotifications(1, 20);
      setNotifications(res.notifications);
      setUnreadCount(res.unread_count);
      if (res.notifications.length > 0) {
        const maxId = Math.max(...res.notifications.map((n) => n.id));
        if (maxId > lastIdRef.current) {
          lastIdRef.current = maxId;
        }
      }
    } catch {
      // Quiet fail during background sync
    }
  }, []);

  const markAsRead = useCallback(async (id: number) => {
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      dismissToast(id);
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  }, [dismissToast]);

  const markAllAsRead = useCallback(async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      setToasts([]);
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  }, []);

  // Polling loop
  useEffect(() => {
    const poll = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      try {
        const lastId = lastIdRef.current;
        const res = await api.pollNotifications(lastId);

        setUnreadCount(res.unread_count);

        if (res.notifications && res.notifications.length > 0) {
          const maxId = Math.max(...res.notifications.map((n) => n.id));
          if (maxId > lastIdRef.current) {
            lastIdRef.current = maxId;
          }

          setNotifications((prev) => {
            const existingIds = new Set(prev.map((n) => n.id));
            const fresh = res.notifications.filter((n) => !existingIds.has(n.id));
            return [...fresh, ...prev].slice(0, 40);
          });

          // If new notifications arrived and not initial load
          if (!isInitialLoadRef.current) {
            // Audio Chime
            const shouldRing = res.notifications.some((n) => n.with_sound);
            if (shouldRing) {
              playNotificationSound();
            }

            // In-app Toasts
            setToasts((prev) => {
              const prevIds = new Set(prev.map((t) => t.id));
              const newToasts = res.notifications.filter((n) => !prevIds.has(n.id));
              return [...newToasts, ...prev].slice(0, 3);
            });

            // Browser-Level Native Notifications
            if (
              typeof window !== 'undefined' &&
              'Notification' in window &&
              Notification.permission === 'granted'
            ) {
              res.notifications.forEach((notif) => {
                try {
                  new Notification(notif.title, {
                    body: notif.message,
                    icon: '/app/kuri-icon.png',
                    tag: `kuri-notif-${notif.id}`,
                  });
                } catch {
                  // Fallback
                }
              });
            }
          }
        }

        if (isInitialLoadRef.current) {
          isInitialLoadRef.current = false;
        }
      } catch {
        // Silently tolerate network/wake hiccups
      }
    };

    refreshNotifications().then(() => {
      isInitialLoadRef.current = false;
    });

    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [refreshNotifications]);

  // Toast Auto-dismiss
  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = toasts[toasts.length - 1];
    const timer = setTimeout(() => {
      dismissToast(oldest.id);
    }, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toasts, dismissToast]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        toasts,
        isMuted,
        toggleMute,
        browserPermission,
        requestBrowserPermission,
        markAsRead,
        markAllAsRead,
        dismissToast,
        spawnToast,
        refreshNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
