import { useState } from 'react';
import { usePwa } from '../../hooks/usePwa';
import Icon from './Icon';

export default function PwaInstallBanner() {
  const { isInstallable, isOffline, installApp } = usePwa();
  const [dismissed, setDismissed] = useState(false);

  if (isOffline) {
    return (
      <div
        style={{
          backgroundColor: '#0f172a',
          color: '#ffffff',
          padding: '8px 16px',
          fontSize: '0.78rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          zIndex: 999,
        }}
      >
        <Icon name="cloud_off" size={16} color="#fbbf24" />
        <span>You are currently working offline. Cached data and camera capture remain active.</span>
      </div>
    );
  }

  if (!isInstallable || dismissed) {
    return null;
  }

  return (
    <div
      style={{
        background: 'linear-gradient(90deg, #FFF1F2 0%, #FFFFFF 100%)',
        borderBottom: '1px solid #FECDD3',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        zIndex: 50,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            backgroundColor: '#FF6467',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon name="download" size={18} color="#ffffff" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 800, color: '#0f172a' }}>
            Install PhotoCapture App
          </div>
          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
            Fast access from your home screen with offline capability
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={installApp}
          style={{
            padding: '5px 12px',
            fontSize: '0.75rem',
            borderRadius: 8,
            boxShadow: '0 2px 6px rgba(255, 100, 103, 0.25)',
          }}
        >
          <Icon name="install_mobile" size={14} color="#ffffff" />
          <span>Install</span>
        </button>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
          }}
          title="Dismiss"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}
