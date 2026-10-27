import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';

interface PermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PermissionModal({ isOpen, onClose }: PermissionModalProps) {
  const [gpsStatus, setGpsStatus] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [cameraStatus, setCameraStatus] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [requesting, setRequesting] = useState(false);

  const requestAllPermissions = async () => {
    setRequesting(true);

    // 1. Request GPS Geolocation
    if ('geolocation' in navigator) {
      try {
        await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 8000,
          });
        });
        setGpsStatus('granted');
      } catch (err: any) {
        setGpsStatus(err?.code === 1 ? 'denied' : 'granted');
      }
    } else {
      setGpsStatus('denied');
    }

    // 2. Request Camera Permission
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        setCameraStatus('granted');
        // Stop stream right away so camera indicator doesn't stay active
        stream.getTracks().forEach((track) => track.stop());
      } catch (err) {
        setCameraStatus('denied');
      }
    } else {
      // In non-secure contexts or fallback, native file input camera will work
      setCameraStatus('granted');
    }

    setRequesting(false);
  };

  const handleFinish = () => {
    try {
      localStorage.setItem('pc_permissions_setup_completed', 'true');
    } catch {
      // ignore
    }
    onClose();
  };

  const isBothAnswered = gpsStatus !== 'pending' || cameraStatus !== 'pending';

  return (
    <Modal
      isOpen={isOpen}
      title="Device Permissions"
      onClose={handleFinish}
      footer={
        <div style={{ display: 'flex', gap: 10, width: '100%', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleFinish}
          >
            Skip for now
          </button>
          {!isBothAnswered ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={requestAllPermissions}
              disabled={requesting}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {requesting ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  <span>Prompting…</span>
                </>
              ) : (
                <>
                  <Icon name="check_circle" size={16} />
                  <span>Enable All Permissions</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleFinish}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <span>Continue to App</span>
              <Icon name="arrow_forward" size={16} />
            </button>
          )}
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#475569', lineHeight: 1.5 }}>
          PhotoCapture needs access to your <strong>Location</strong> and <strong>Camera</strong> to record authoritative, geotagged inspection evidence.
        </p>

        {/* Permission Item: GPS */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: 14,
            backgroundColor: gpsStatus === 'granted' ? '#ecfdf5' : '#f8fafc',
            border: `1px solid ${gpsStatus === 'granted' ? '#a7f3d0' : '#e2e8f0'}`,
            transition: 'background-color 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: gpsStatus === 'granted' ? '#10b981' : '#FF6467',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="location_on" size={20} />
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
                Precise Location (GPS)
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                For site geotagging, route sorting & deviation checks
              </div>
            </div>
          </div>

          <div>
            {gpsStatus === 'granted' ? (
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#059669', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="check" size={16} color="#059669" /> Granted
              </span>
            ) : gpsStatus === 'denied' ? (
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#dc2626' }}>
                Blocked
              </span>
            ) : (
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8' }}>
                Required
              </span>
            )}
          </div>
        </div>

        {/* Permission Item: Camera */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: 14,
            backgroundColor: cameraStatus === 'granted' ? '#ecfdf5' : '#f8fafc',
            border: `1px solid ${cameraStatus === 'granted' ? '#a7f3d0' : '#e2e8f0'}`,
            transition: 'background-color 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: cameraStatus === 'granted' ? '#10b981' : '#FF6467',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="photo_camera" size={20} />
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
                Camera Viewfinder
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                For live on-site inspection photo capture
              </div>
            </div>
          </div>

          <div>
            {cameraStatus === 'granted' ? (
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#059669', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="check" size={16} color="#059669" /> Granted
              </span>
            ) : cameraStatus === 'denied' ? (
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#dc2626' }}>
                Blocked
              </span>
            ) : (
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8' }}>
                Required
              </span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
