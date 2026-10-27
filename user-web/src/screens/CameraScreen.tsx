import React, { useEffect, useRef, useState } from 'react';
import type { CapturedPhoto } from '../types';
import Icon from '../components/common/Icon';
import { preparePhotoForUpload } from '../utils/image';

interface CameraScreenProps {
  onPhotoCaptured: (photo: CapturedPhoto) => void;
  photoCount: number;
  onDone: () => void;
  onBack: () => void;
  taskContext?: {
    unique_id?: string;
    site_address?: string;
  } | null;
}

export default function CameraScreen({
  onPhotoCaptured,
  photoCount,
  onDone,
  onBack,
  taskContext,
}: CameraScreenProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // GPS Geolocation state
  const [gpsLocation, setGpsLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
  } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'acquiring' | 'ready' | 'denied' | 'error'>('acquiring');
  const [gpsRetryCount, setGpsRetryCount] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const isGpsLocked = gpsStatus === 'ready' && !!gpsLocation && gpsLocation.latitude !== 0 && gpsLocation.longitude !== 0;

  // Initialize GPS Geolocation Watcher
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGpsStatus('error');
      return;
    }

    setGpsStatus('acquiring');
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGpsStatus('ready');
      },
      (err) => {
        console.warn('GPS location error:', err);
        if (err.code === err.PERMISSION_DENIED) {
          setGpsStatus('denied');
        } else {
          setGpsStatus('error');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [gpsRetryCount]);

  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize WebRTC Camera Stream
  const startCamera = async () => {
    stopCamera();
    setCameraError(null);

    // Guard against insecure contexts (e.g. http://192.168.x.x) where navigator.mediaDevices is undefined
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      const isHttpIp = window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
      setHasCameraPermission(false);
      setCameraError(
        isHttpIp
          ? 'Live WebRTC viewfinder requires HTTPS on mobile. Tap "Take Photo with Camera" below to capture directly with your phone camera.'
          : 'Live camera is not supported in this browser. You can capture photos with the camera button below.'
      );
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setHasCameraPermission(true);
    } catch (err: any) {
      console.warn('Camera access error:', err);
      setHasCameraPermission(false);
      setCameraError(err?.message || 'Unable to access live camera stream. You can capture photos directly using your phone camera.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setTorchOn(false);
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;
    const nextTorch = !torchOn;
    try {
      await (videoTrack as any).applyConstraints({
        advanced: [{ torch: nextTorch }],
      });
      setTorchOn(nextTorch);
    } catch (err) {
      console.warn('Hardware torch not supported on this track:', err);
      // Still toggle state for feedback
      setTorchOn(nextTorch);
    }
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [facingMode]);

  // Re-attach the live stream once the video element exists — a first-time grant
  // (and StrictMode's double mount in dev) used to leave the viewfinder black.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (hasCameraPermission !== true || !video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => {});
  }, [hasCameraPermission]);

  // Capture Photo from live Video Stream or Native Camera Fallback
  const handleSnap = async () => {
    // Only allow photo capture when GPS current location is locked
    if (!isGpsLocked) {
      alert(
        gpsStatus === 'denied'
          ? 'Location permission is denied. GPS current location must be locked to capture photos. Please enable location permissions in browser settings.'
          : gpsStatus === 'acquiring'
          ? 'Acquiring GPS location... Photo capture is locked until device GPS fix is acquired. Please wait a moment.'
          : 'GPS current location must be locked to capture photos. Please enable GPS on your device and retry.'
      );
      return;
    }

    // If WebRTC is not active (e.g. on HTTP IP), open native phone camera
    if (!videoRef.current || !hasCameraPermission || !streamRef.current) {
      nativeCameraInputRef.current?.click();
      return;
    }

    if (capturing) return;

    // Use verified GPS location
    const effectiveGps = gpsLocation!;

    setCapturing(true);
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 200);

    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported');

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

      const photoObj: CapturedPhoto = {
        uri: dataUrl,
        latitude: effectiveGps.latitude,
        longitude: effectiveGps.longitude,
        accuracy: effectiveGps.accuracy,
        capturedAt: Date.now(),
        address: taskContext?.site_address,
      };

      // Asynchronous background pre-processing: resize in background while user proceeds
      photoObj.blobPromise = preparePhotoForUpload(dataUrl).then(({ blob }) => {
        photoObj.blob = blob;
        return blob;
      });

      // 0ms hand-off to UI!
      onPhotoCaptured(photoObj);
    } catch (err: any) {
      alert(err?.message || 'Failed to capture photo');
    } finally {
      setCapturing(false);
    }
  };

  // Native camera fallback (opens device camera when WebRTC is unavailable)
  const handleNativeCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Only allow photo capture when GPS current location is locked
    if (!isGpsLocked) {
      alert(
        gpsStatus === 'denied'
          ? 'Location permission is denied. GPS current location must be locked to capture photos. Please enable location permissions in browser settings.'
          : gpsStatus === 'acquiring'
          ? 'Acquiring GPS location... Photo capture is locked until device GPS fix is acquired. Please wait a moment.'
          : 'GPS current location must be locked to capture photos. Please enable GPS on your device and retry.'
      );
      e.target.value = '';
      return;
    }

    setCapturing(true);
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 200);

    try {
      const defaultCoords = gpsLocation!;

      const dataUrl = URL.createObjectURL(file);
      const photoObj: CapturedPhoto = {
        uri: dataUrl,
        latitude: defaultCoords.latitude,
        longitude: defaultCoords.longitude,
        accuracy: defaultCoords.accuracy,
        capturedAt: Date.now(),
        address: taskContext?.site_address,
      };

      photoObj.blobPromise = preparePhotoForUpload(file).then(({ blob }) => {
        photoObj.blob = blob;
        return blob;
      });

      onPhotoCaptured(photoObj);
    } catch (err: any) {
      alert(err?.message || 'Failed to process camera capture');
    } finally {
      setCapturing(false);
      e.target.value = '';
    }
  };

  return (
    <div
      className="camera-screen"
      style={{
        width: '100%',
        maxWidth: 800,
        margin: '0 auto',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '12px',
        position: 'relative',
        backgroundColor: '#000000',
        borderRadius: 0,
        height: '100%',
        minHeight: '100dvh',
        boxSizing: 'border-box',
      }}
    >
      {/* Viewfinder Container */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          /* Fills whatever height is left after the control bar — minHeight: 0
             so a short phone shrinks the viewfinder instead of overflowing. */
          flex: 1,
          minHeight: 0,
          backgroundColor: '#000000',
          borderRadius: 16,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'none',
        }}
      >
        {/* Live Video View — always mounted so the stream can attach on the very
            first permission grant (the ref must exist before getUserMedia resolves). */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: hasCameraPermission ? 'block' : 'none',
          }}
        />

        {/* Shutter flash effect */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#ffffff',
            pointerEvents: 'none',
            opacity: shutterFlash ? 0.85 : 0,
            transition: 'opacity 0.15s ease-out',
            zIndex: 40,
          }}
        />

        {hasCameraPermission !== true && (
          <div style={{ textAlign: 'center', padding: '30px 20px', color: '#ffffff', maxWidth: 420 }}>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px auto',
              }}
            >
              {hasCameraPermission === null ? (
                <span className="spinner" style={{ width: 26, height: 26, borderWidth: 3 }} />
              ) : (
                <Icon name="photo_camera" size={32} color="#FF6467" />
              )}
            </div>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1.15rem', fontWeight: 800 }}>
              {hasCameraPermission === null ? 'Requesting Camera Access…' : 'Device Camera Ready'}
            </h3>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: '0 auto 18px auto', lineHeight: 1.5 }}>
              {hasCameraPermission === null
                ? 'Allow camera access when your browser asks — the live viewfinder starts right after.'
                : cameraError || 'Tap the shutter button or the button below to take high-resolution geotagged photos with your phone camera.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!isGpsLocked) {
                    alert(
                      gpsStatus === 'denied'
                        ? 'Location permission is denied. GPS location must be locked to capture photos. Please enable location permissions.'
                        : 'Waiting for GPS location lock... Photo capture is locked until device GPS fix is acquired.'
                    );
                    return;
                  }
                  nativeCameraInputRef.current?.click();
                }}
                disabled={!isGpsLocked}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 24px',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  borderRadius: 14,
                  backgroundColor: isGpsLocked ? '#FF6467' : '#94a3b8',
                  boxShadow: isGpsLocked ? '0 4px 14px rgba(255, 100, 103, 0.4)' : 'none',
                  cursor: isGpsLocked ? 'pointer' : 'not-allowed',
                  opacity: isGpsLocked ? 1 : 0.7,
                }}
              >
                <Icon name={isGpsLocked ? "photo_camera" : "gps_not_fixed"} size={20} />
                <span>{isGpsLocked ? 'Open Phone Camera' : 'Waiting for GPS Lock…'}</span>
              </button>

              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={startCamera}
                  style={{ color: '#cbd5e1', fontSize: '0.75rem' }}
                >
                  <Icon name="refresh" size={14} />
                  <span>Retry Live View</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Hidden Native Camera Input */}
        <input
          ref={nativeCameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleNativeCapture}
          style={{ display: 'none' }}
        />

        {/* Top Floating Controls Bar — one slim status pill, no bulky HUD boxes */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            right: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 10,
            gap: 8,
          }}
        >
          {/* GPS Status Pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              backgroundColor: isGpsLocked ? 'rgba(6, 78, 59, 0.75)' : 'rgba(15, 23, 42, 0.75)',
              backdropFilter: 'blur(8px)',
              padding: '5px 11px',
              borderRadius: 9999,
              color: '#ffffff',
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '0.03em',
              border: `1px solid ${isGpsLocked ? 'rgba(52, 211, 153, 0.4)' : 'rgba(255, 255, 255, 0.15)'}`,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                backgroundColor:
                  isGpsLocked
                    ? '#34d399'
                    : gpsStatus === 'acquiring'
                    ? '#fbbf24'
                    : '#f87171',
                boxShadow:
                  isGpsLocked ? '0 0 6px #34d399' : 'none',
              }}
            />
            <span>
              {isGpsLocked && gpsLocation
                ? `GPS LOCKED · ±${Math.round(gpsLocation.accuracy)}m`
                : gpsStatus === 'acquiring'
                ? 'GPS · acquiring lock…'
                : gpsStatus === 'denied'
                ? 'GPS · access denied'
                : 'GPS · offline'}
            </span>
            {gpsStatus === 'error' && (
              <button
                type="button"
                onClick={() => setGpsRetryCount((c) => c + 1)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#93c5fd',
                  fontSize: '0.68rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                  marginLeft: 4,
                }}
              >
                Retry
              </button>
            )}
          </div>

          {/* Top Right Controls: Torch & Camera Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {hasCameraPermission && (
              <button
                type="button"
                onClick={toggleTorch}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  backgroundColor: torchOn ? '#f59e0b' : 'rgba(15, 23, 42, 0.65)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: torchOn ? '#0f172a' : '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: torchOn ? '0 0 12px rgba(245, 158, 11, 0.6)' : 'none',
                  transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
                }}
                title={torchOn ? 'Turn Flashlight Off' : 'Turn Flashlight On'}
              >
                <Icon name={torchOn ? 'flash_on' : 'flash_off'} size={18} />
              </button>
            )}

            {hasCameraPermission && (
              <button
                type="button"
                onClick={() => setFacingMode(facingMode === 'environment' ? 'user' : 'environment')}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(15, 23, 42, 0.65)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title="Switch Camera (Front/Rear)"
              >
                <Icon name="flip_camera_ios" size={17} />
              </button>
            )}
          </div>
        </div>

        {/* Stitch Corner Reticles (Precision Framers) */}
        <div style={{ position: 'absolute', top: 12, left: 12, width: 22, height: 22, borderTop: '3px solid #FF6467', borderLeft: '3px solid #FF6467', pointerEvents: 'none', zIndex: 6 }} />
        <div style={{ position: 'absolute', top: 12, right: 12, width: 22, height: 22, borderTop: '3px solid #FF6467', borderRight: '3px solid #FF6467', pointerEvents: 'none', zIndex: 6 }} />
        <div style={{ position: 'absolute', bottom: 48, left: 12, width: 22, height: 22, borderBottom: '3px solid #FF6467', borderLeft: '3px solid #FF6467', pointerEvents: 'none', zIndex: 6 }} />
        <div style={{ position: 'absolute', bottom: 48, right: 12, width: 22, height: 22, borderBottom: '3px solid #FF6467', borderRight: '3px solid #FF6467', pointerEvents: 'none', zIndex: 6 }} />

        {/* Stitch Artificial Horizon / Level Indicator in Center */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 110 }}>
            <div style={{ height: 2, width: 32, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 9999 }} />
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #30ab7c', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 4px' }}>
              <div style={{ width: 4, height: 4, backgroundColor: '#85f8c4', borderRadius: '50%' }} />
            </div>
            <div style={{ height: 2, width: 32, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 9999 }} />
          </div>
        </div>

        {/* Live GPS Coordinates or Lock Warning Readout pinned bottom of viewfinder */}
        {!isGpsLocked ? (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              right: 12,
              padding: '8px 12px',
              backgroundColor: gpsStatus === 'denied' ? 'rgba(127, 29, 29, 0.9)' : 'rgba(15, 23, 42, 0.88)',
              backdropFilter: 'blur(8px)',
              border: `1px solid ${gpsStatus === 'denied' ? '#ef4444' : '#f59e0b'}`,
              borderRadius: 10,
              color: '#ffffff',
              fontSize: '0.72rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              zIndex: 10,
              boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
              {gpsStatus === 'acquiring' ? (
                <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, borderColor: '#f59e0b', borderTopColor: 'transparent', flexShrink: 0 }} />
              ) : (
                <Icon name="location_off" size={16} color={gpsStatus === 'denied' ? '#f87171' : '#fbbf24'} />
              )}
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {gpsStatus === 'acquiring'
                  ? 'Waiting for GPS location lock to capture photo…'
                  : gpsStatus === 'denied'
                  ? 'GPS permission denied. Enable location to capture.'
                  : 'GPS unavailable. Turn on location services.'}
              </span>
            </div>
            {gpsStatus === 'error' && (
              <button
                type="button"
                onClick={() => setGpsRetryCount((c) => c + 1)}
                style={{
                  background: '#3b82f6',
                  border: 'none',
                  color: '#fff',
                  borderRadius: 6,
                  padding: '2px 8px',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              right: 12,
              padding: '6px 10px',
              backgroundColor: 'rgba(15, 23, 42, 0.75)',
              backdropFilter: 'blur(8px)',
              borderRadius: 8,
              color: '#e2e8f0',
              fontSize: '0.68rem',
              fontFamily: 'var(--font-mono)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              zIndex: 10,
              border: '1px solid rgba(52, 211, 153, 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
              <Icon name="verified" size={13} color="#34d399" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {gpsLocation.latitude.toFixed(5)}, {gpsLocation.longitude.toFixed(5)} · ±{Math.round(gpsLocation.accuracy)}m
              </span>
            </div>
            <span style={{ color: '#34d399', fontWeight: 800, fontSize: '0.65rem', flexShrink: 0 }}>✓ GPS LOCKED</span>
          </div>
        )}
      </div>

      {/* ─── Stitch Capture Checklist (3 Photo Mandate) ─── */}
      <div style={{ padding: '8px 12px', backgroundColor: '#ffffff', borderRadius: 14, border: '1px solid #e2e8f0', margin: '8px 0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0b1c30' }}>
            Capture Checklist ({photoCount}/3 complete)
          </span>
          <span style={{ fontSize: '0.7rem', color: '#006c4a', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {Math.min(100, Math.round((photoCount / 3) * 100))}% Verified
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[1, 2, 3].map((slot) => {
            const captured = slot <= photoCount;
            return (
              <div
                key={slot}
                style={{
                  height: 40,
                  borderRadius: 8,
                  backgroundColor: captured ? '#eff4ff' : '#f8fafc',
                  border: captured ? '1.5px solid #85f8c4' : '1px dashed #cbd5e1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: captured ? '#006c4a' : '#94a3b8',
                }}
              >
                <Icon name={captured ? 'check_circle' : 'add_a_photo'} size={14} color={captured ? '#006c4a' : '#94a3b8'} />
                <span>Photo {slot}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Modern Camera Shutter & Action Bar ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          gap: 16,
          padding: '12px 18px',
          borderRadius: 24,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* Modern Frosted Cancel Button */}
        <button
          type="button"
          onClick={onBack}
          style={{
            minWidth: 84,
            height: 44,
            borderRadius: 9999,
            border: '1px solid rgba(255, 255, 255, 0.18)',
            backgroundColor: 'rgba(255, 255, 255, 0.12)',
            color: '#f8fafc',
            fontFamily: 'inherit',
            fontSize: '0.85rem',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            cursor: 'pointer',
            transition: 'background-color 0.15s ease, transform 0.1s ease',
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.96)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <Icon name="close" size={16} />
          <span>Cancel</span>
        </button>

        {/* Center Authentic Real-Camera Concentric Shutter Button */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={handleSnap}
            disabled={capturing || !isGpsLocked}
            style={{
              width: 74,
              height: 74,
              borderRadius: '50%',
              border: `3.5px solid ${isGpsLocked ? '#ffffff' : 'rgba(255, 255, 255, 0.35)'}`,
              backgroundColor: 'transparent',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: (capturing || !isGpsLocked) ? 'not-allowed' : 'pointer',
              transition: 'transform 0.15s ease, opacity 0.2s ease',
              opacity: isGpsLocked ? 1 : 0.5,
              boxShadow: isGpsLocked ? '0 0 14px rgba(255, 255, 255, 0.25)' : 'none',
            }}
            onMouseDown={(e) => isGpsLocked && (e.currentTarget.style.transform = 'scale(0.92)')}
            onMouseUp={(e) => isGpsLocked && (e.currentTarget.style.transform = 'scale(1)')}
            title={
              !isGpsLocked
                ? 'Waiting for GPS location lock before photo can be captured'
                : hasCameraPermission
                ? 'Capture Photo'
                : 'Open phone camera to take photo'
            }
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                backgroundColor: !isGpsLocked ? '#64748b' : capturing ? '#EA4E51' : '#FF6467',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                boxShadow: isGpsLocked ? '0 4px 10px rgba(255, 100, 103, 0.45)' : 'none',
              }}
            >
              <Icon name={!isGpsLocked ? 'gps_not_fixed' : 'photo_camera'} size={26} />
            </div>
          </button>
        </div>

        {/* Stitch Review & Fill Form Button */}
        <button
          type="button"
          onClick={onDone}
          disabled={photoCount === 0}
          style={{
            minWidth: 90,
            height: 44,
            borderRadius: 9999,
            border: 'none',
            backgroundColor: photoCount === 0 ? 'rgba(255, 100, 103, 0.35)' : '#FF6467',
            color: '#ffffff',
            fontFamily: 'inherit',
            fontSize: '0.85rem',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            cursor: photoCount === 0 ? 'not-allowed' : 'pointer',
            boxShadow: photoCount === 0 ? 'none' : '0 4px 14px rgba(255, 100, 103, 0.4)',
            transition: 'background-color 0.15s ease, transform 0.1s ease',
          }}
          onMouseDown={(e) => photoCount > 0 && (e.currentTarget.style.transform = 'scale(0.96)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <span>Form</span>
          {photoCount > 0 && (
            <span
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.28)',
                borderRadius: 9999,
                fontSize: '0.72rem',
                fontWeight: 800,
                padding: '1px 7px',
              }}
            >
              {photoCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
