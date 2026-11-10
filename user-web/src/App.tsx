import { useState, useEffect } from 'react';
import type { ScreenName, User, CaptureRecord, CapturedPhoto } from './types';
import { api } from './services/api';

import AppShell from './components/layout/AppShell';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';
import RecordsScreen from './screens/RecordsScreen';
import RecordDetailScreen from './screens/RecordDetailScreen';
import CameraScreen from './screens/CameraScreen';
import PreviewScreen from './screens/PreviewScreen';
import FormScreen from './screens/FormScreen';
import ProfileModal from './screens/ProfileModal';
import PermissionModal from './components/common/PermissionModal';
import { NotificationProvider } from './context/NotificationContext';
import { NotificationToastContainer } from './components/NotificationToastContainer';
import DuplicateProximityAlertModal from './components/DuplicateProximityAlertModal';


export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState(false);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [activeScreen, setActiveScreen] = useState<ScreenName>(() => {
    try {
      const saved = localStorage.getItem('pc_active_screen') as ScreenName | null;
      if (saved === 'detail' && localStorage.getItem('pc_selected_record_id')) {
        return 'detail';
      }
      return saved === 'records' || saved === 'dashboard' ? saved : 'dashboard';
    } catch {
      return 'dashboard';
    }
  });
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(() => {
    try {
      const savedId = localStorage.getItem('pc_selected_record_id');
      return savedId && !isNaN(Number(savedId)) ? Number(savedId) : null;
    } catch {
      return null;
    }
  });
  const [recordHistory, setRecordHistory] = useState<number[]>([]);
  const [inspectingRecord, setInspectingRecord] = useState<CaptureRecord | null>(null);
  // A submitted record reopened in the form to correct its inspection details.
  const [editingRecord, setEditingRecord] = useState<CaptureRecord | null>(null);

  // Photo capture workflow states
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [pendingPhoto, setPendingPhoto] = useState<CapturedPhoto | null>(null);

  // Modals
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [acknowledgedDuplicates, setAcknowledgedDuplicates] = useState<Set<number>>(() => new Set());
  const [duplicateAlertTarget, setDuplicateAlertTarget] = useState<{
    record?: CaptureRecord;
    onProceed: () => void;
    matchedSiteId?: string;
    matchedRecordId?: number;
    distanceMeters?: number;
    warningText?: string;
    isVisited?: boolean;
  } | null>(null);

  // Dashboard matrix filter to records
  const [recordsInitialFilter, setRecordsInitialFilter] = useState<{
    datePreset?: 'ALL' | 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';
    status?: 'ALL' | 'NOT_COMPLETED' | 'COMPLETED';
    hasPhotosOnly?: boolean;
    viewMode?: 'records' | 'gallery';
  } | null>(null);

  const handleSelectMatrixFilter = (filter: {
    datePreset?: 'ALL' | 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';
    status?: 'ALL' | 'NOT_COMPLETED' | 'COMPLETED';
    hasPhotosOnly?: boolean;
    viewMode?: 'records' | 'gallery';
  }) => {
    setRecordsInitialFilter(filter);
    setActiveScreen('records');
  };

  // Check initial authentication on boot
  useEffect(() => {
    const initAuth = async () => {
      const token = api.getToken();
      if (token) {
        try {
          const me = await api.getMe();
          setCurrentUser(me);
          if (me.must_change_password) {
            setMustChangePassword(true);
            setShowProfileModal(true);
          }
        } catch {
          if (api.getToken()) { setAuthError(true); return; }
          setCurrentUser(null);
        }
      }
      setAuthChecked(true);
    };

    setAuthError(false);
    initAuth();

    const handleExpired = () => {
      setCurrentUser(null);
      setActiveScreen('dashboard');
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, [authAttempt]);

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    if (user.must_change_password) {
      setMustChangePassword(true);
      setShowProfileModal(true);
    } else {
      try {
        if (!localStorage.getItem('pc_permissions_setup_completed')) {
          setShowPermissionModal(true);
        }
      } catch {
        // ignore
      }
    }
    setActiveScreen('dashboard');
  };

  const handleCloseProfileModal = () => {
    setShowProfileModal(false);
    setMustChangePassword(false);
  };

  const handlePasswordUpdated = async () => {
    setMustChangePassword(false);
    setCurrentUser((prev) => (prev ? { ...prev, must_change_password: false } : null));
    try {
      const me = await api.getMe();
      setCurrentUser(me);
    } catch {
      // ignore
    }
    try {
      if (!localStorage.getItem('pc_permissions_setup_completed')) {
        setShowPermissionModal(true);
      }
    } catch {
      // ignore
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setCurrentUser(null);
    setShowProfileModal(false);
    setCapturedPhotos([]);
    setPendingPhoto(null);
    setInspectingRecord(null);
    setEditingRecord(null);
    setSelectedRecordId(null);
    setActiveScreen('dashboard');
    try {
      localStorage.removeItem('pc_active_screen');
      localStorage.removeItem('pc_selected_record_id');
      localStorage.removeItem('pc_detail_return_to');
    } catch {
      // ignore
    }
  };

  // Navigation handlers
  const actuallyStartInspection = (record: CaptureRecord) => {
    setInspectingRecord(record);
    setEditingRecord(null);
    setCapturedPhotos([]);
    setPendingPhoto(null);
    setActiveScreen('form');
  };

  const handleMarkDuplicateFromModal = async (record: CaptureRecord) => {
    try {
      await api.markRecordStatus(record.id, {
        status: 'DUPLICATE',
        remarks: 'Marked as duplicate from pre-camera proximity alert',
      });
      setDuplicateAlertTarget(null);
      setActiveScreen('records');
    } catch (err: any) {
      alert(err?.message || 'Failed to update record status to duplicate');
    }
  };

  const handleStartInspection = (record: CaptureRecord, nearbyMatch?: any) => {
    const isDuplicate =
      Boolean(record.is_duplicate) ||
      (record.status || '').toUpperCase() === 'DUPLICATE' ||
      Boolean(record.duplicate_site_id) ||
      Boolean(record.duplicate_warning) ||
      (record.duplicate_distance_m != null && record.duplicate_distance_m <= 50) ||
      Boolean(nearbyMatch);

    if (isDuplicate && !acknowledgedDuplicates.has(record.id)) {
      const matchedSiteId =
        record.duplicate_site_id ||
        nearbyMatch?.record?.unique_id ||
        (nearbyMatch?.record?.id ? `#${nearbyMatch.record.id}` : undefined);
      const matchedRecordId =
        record.duplicate_record_id ||
        nearbyMatch?.record?.id ||
        undefined;
      const distM = record.duplicate_distance_m ?? nearbyMatch?.distanceMeters;
      const warn =
        record.duplicate_warning ||
        (nearbyMatch
          ? `Site is within ${Math.round(nearbyMatch.distanceMeters)}m of existing site ${matchedSiteId || ''}.`
          : 'Site may be already visited or is within 40m/50m of an existing site.');
      const isVisited =
        record.duplicate_is_visited ??
        (nearbyMatch ? (nearbyMatch.record?.status === 'COMPLETED' || nearbyMatch.record?.date_of_visit != null) : true);

      setDuplicateAlertTarget({
        record,
        onProceed: () => {
          setAcknowledgedDuplicates((prev) => new Set(prev).add(record.id));
          setDuplicateAlertTarget(null);
          actuallyStartInspection(record);
        },
        matchedSiteId,
        matchedRecordId,
        distanceMeters: distM,
        warningText: warn,
        isVisited,
      });
      return;
    }
    actuallyStartInspection(record);
  };

  const handleOpenCameraFromForm = () => {
    if (
      inspectingRecord &&
      !acknowledgedDuplicates.has(inspectingRecord.id) &&
      (inspectingRecord.is_duplicate ||
        (inspectingRecord.status || '').toUpperCase() === 'DUPLICATE' ||
        inspectingRecord.duplicate_site_id ||
        inspectingRecord.duplicate_warning ||
        (inspectingRecord.duplicate_distance_m != null && inspectingRecord.duplicate_distance_m <= 50))
    ) {
      setDuplicateAlertTarget({
        record: inspectingRecord,
        onProceed: () => {
          setAcknowledgedDuplicates((prev) => new Set(prev).add(inspectingRecord.id));
          setDuplicateAlertTarget(null);
          setActiveScreen('camera');
        },
        matchedSiteId: inspectingRecord.duplicate_site_id || undefined,
        matchedRecordId: inspectingRecord.duplicate_record_id || undefined,
        distanceMeters: inspectingRecord.duplicate_distance_m || undefined,
        warningText: inspectingRecord.duplicate_warning || 'Site may be already visited or is within 40m/50m of an existing site.',
        isVisited: inspectingRecord.duplicate_is_visited ?? true,
      });
      return;
    }
    setActiveScreen('camera');
  };

  /** Reopen a saved record's form — no camera step, the photos stay as they are. */
  const handleEditRecord = (record: CaptureRecord) => {
    setEditingRecord(record);
    setInspectingRecord(null);
    setCapturedPhotos([]);
    setPendingPhoto(null);
    setActiveScreen('form');
  };

  /** Manually add a record on site: straight to the camera, no dispatched task. */
  const handleStartManualCapture = () => {
    setInspectingRecord(null);
    setEditingRecord(null);
    setCapturedPhotos([]);
    setPendingPhoto(null);
    setActiveScreen('manual-capture');
    try { localStorage.setItem('pc_active_screen', 'manual-capture'); } catch { /* ignore */ }
  };

  const handleOpenRecord = (id: number, pushHistory = false) => {
    if (pushHistory && selectedRecordId !== null && selectedRecordId !== id) {
      setRecordHistory((prev) => [...prev, selectedRecordId]);
    } else if (!pushHistory) {
      setRecordHistory([]);
    }
    setSelectedRecordId(id);
    setActiveScreen('detail');
    try {
      localStorage.setItem('pc_selected_record_id', id.toString());
      localStorage.setItem('pc_active_screen', 'detail');
    } catch {
      // ignore
    }
  };

  const handleBackFromDetail = () => {
    if (recordHistory.length > 0) {
      const prevId = recordHistory[recordHistory.length - 1];
      setRecordHistory((prev) => prev.slice(0, -1));
      setSelectedRecordId(prevId);
      try {
        localStorage.setItem('pc_selected_record_id', prevId.toString());
      } catch {
        // ignore
      }
      return;
    }
    const returnTo = (localStorage.getItem('pc_detail_return_to') as ScreenName) || 'records';
    setActiveScreen(returnTo);
    try {
      localStorage.setItem('pc_active_screen', returnTo);
      localStorage.removeItem('pc_detail_return_to');
      localStorage.removeItem('pc_selected_record_id');
    } catch {
      // ignore
    }
  };

  // Camera -> Preview -> Form transitions
  const handlePhotoCaptured = (photo: CapturedPhoto) => {
    setPendingPhoto(photo);
    setActiveScreen('preview');
  };

  const handleKeepPhoto = () => {
    if (pendingPhoto) {
      setCapturedPhotos((prev) => [...prev, pendingPhoto]);
      setPendingPhoto(null);
    }
    setActiveScreen('form');
  };

  const handleRetakePhoto = () => {
    setPendingPhoto(null);
    setActiveScreen('camera');
  };

  const handleDeletePhoto = (index: number) => {
    setCapturedPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  // Show splash spinner while validating token
  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--color-bg)',
          gap: '1rem',
        }}
      >
        <span className="spinner" style={{ width: '36px', height: '36px', borderWidth: '3px' }} />
        <span style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
          {authError ? 'Could not connect. Your login is saved.' : 'Connecting to Kuri...'}
        </span>
        {authError && <button className="btn btn-secondary" onClick={() => setAuthAttempt((n) => n + 1)}>Retry connection</button>}
      </div>
    );
  }

  // Not logged in -> Show LoginScreen
  if (!currentUser) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  if (currentUser.role === 'MANAGER') {
    return <main style={{ maxWidth: 480, margin: '15vh auto', padding: 24 }}>
      <h1>Manager workspace</h1>
      <p>View inspection records and assign pending work from the Records page.</p>
      <a href="/records">Open Records</a>
    </main>;
  }

  // Office-only roles without a mobile workspace get a pointer to the portal.
  if (currentUser.role === 'AUDITOR') {
    return <main style={{ maxWidth: 480, margin: '15vh auto', padding: 24 }}>
      <h1>Auditor workspace</h1>
      <p>This mobile app is for field work. Use the Admin Portal to manage records.</p>
    </main>;
  }

  // Camera screen is rendered full-screen without app shell wrapper for max viewfinder space
  if (activeScreen === 'camera' || activeScreen === 'manual-capture') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          backgroundColor: '#000000',
          zIndex: 9999,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <CameraScreen
          photoCount={capturedPhotos.length}
          onPhotoCaptured={handlePhotoCaptured}
          onDone={() => {
            if (capturedPhotos.length > 0 || inspectingRecord || activeScreen === 'manual-capture') {
              setActiveScreen('form');
            } else {
              setActiveScreen('dashboard');
            }
          }}
          onBack={() => {
            if (activeScreen === 'manual-capture') {
              // Either photo(s) taken or the operator wants a photo-less record:
              // both continue in the inspection form (its Skip Photos path).
              setActiveScreen('form');
            } else if (capturedPhotos.length > 0 || inspectingRecord) {
              setActiveScreen('form');
            } else if (inspectingRecord) {
              setActiveScreen('detail');
            } else {
              setActiveScreen('dashboard');
            }
          }}
          taskContext={
            inspectingRecord
              ? {
                  unique_id: inspectingRecord.unique_id,
                  site_address: inspectingRecord.site_address || inspectingRecord.formatted_address,
                }
              : null
          }
        />

        {/* ⚠️ Pre-Camera Proximity / Duplicate Alert Modal */}
        <DuplicateProximityAlertModal
          isOpen={!!duplicateAlertTarget}
          onClose={() => setDuplicateAlertTarget(null)}
          onProceed={() => {
            if (duplicateAlertTarget) {
              const proceedFn = duplicateAlertTarget.onProceed;
              setDuplicateAlertTarget(null);
              proceedFn();
            }
          }}
          onViewMatched={(recordId) => {
            setDuplicateAlertTarget(null);
            handleOpenRecord(recordId);
          }}
          onMarkDuplicate={handleMarkDuplicateFromModal}
          currentRecord={duplicateAlertTarget?.record}
          matchedSiteId={duplicateAlertTarget?.matchedSiteId}
          matchedRecordId={duplicateAlertTarget?.matchedRecordId}
          distanceMeters={duplicateAlertTarget?.distanceMeters}
          warningText={duplicateAlertTarget?.warningText}
          isVisited={duplicateAlertTarget?.isVisited}
        />
      </div>
    );
  }

  // Preview screen is rendered with focused controls
  if (activeScreen === 'preview') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg)', padding: '1rem' }}>
        <PreviewScreen
          photo={pendingPhoto}
          photoCount={capturedPhotos.length + (pendingPhoto ? 1 : 0)}
          onRetake={handleRetakePhoto}
          onKeep={handleKeepPhoto}
        />
      </div>
    );
  }

  // Compute title & subtitle for AppShell
  let shellTitle = 'Dashboard';
  let shellSubtitle = 'Field operations overview';
  let showBack = false;
  let onBack: (() => void) | undefined;

  if (activeScreen === 'records') {
    shellTitle = 'Records';
    shellSubtitle = 'Browse and filter inspections';
  } else if (activeScreen === 'detail') {
    shellTitle = selectedRecordId ? `Record #${selectedRecordId}` : 'Record Details';
    shellSubtitle = 'Inspection parameters';
    showBack = true;
    onBack = handleBackFromDetail;
  } else if (activeScreen === 'form') {
    shellTitle = editingRecord
      ? `Edit Record #${editingRecord.id}`
      : inspectingRecord
      ? `Task #${inspectingRecord.id}`
      : 'New Inspection';
    shellSubtitle = editingRecord ? 'Change inspection details' : 'Capture & upload';
    showBack = true;
    onBack = () => setActiveScreen(editingRecord ? 'detail' : 'dashboard');
  }

  return (
    <NotificationProvider>
      <AppShell
        activeScreen={activeScreen}
        onSelectRecord={handleOpenRecord}
        onNavigate={(screen) => {
          if (screen === 'records') {
            setRecordsInitialFilter(null);
          }
          setActiveScreen(screen);
          try {
            localStorage.setItem('pc_active_screen', screen);
            if (screen !== 'detail') {
              localStorage.removeItem('pc_selected_record_id');
              localStorage.removeItem('pc_detail_return_to');
            }
          } catch {
            // ignore
          }
        }}
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenProfile={() => setShowProfileModal(true)}
        title={shellTitle}
        subtitle={shellSubtitle}
        showBack={showBack}
        onBack={onBack}
        onAddRecord={handleStartManualCapture}
      >
        {activeScreen === 'dashboard' && (
          <DashboardScreen
            currentUser={currentUser}
            onOpenRecord={handleOpenRecord}
            onStartInspection={handleStartInspection}
            onSelectMatrixFilter={handleSelectMatrixFilter}
          />
        )}

        {activeScreen === 'records' && (
          <RecordsScreen
            onOpenRecord={handleOpenRecord}
            onStartInspection={handleStartInspection}
            initialFilter={recordsInitialFilter}
            storageKey={`pc_field_records_${currentUser.id}`}
            onInitialFilterApplied={() => setRecordsInitialFilter(null)}
          />
        )}

        {activeScreen === 'detail' && selectedRecordId !== null && (
          <RecordDetailScreen
            recordId={selectedRecordId}
            onBack={handleBackFromDetail}
            onStartInspection={handleStartInspection}
            onEditRecord={handleEditRecord}
            onOpenRecord={(id) => handleOpenRecord(id, true)}
            currentUser={currentUser}
          />
        )}

        {activeScreen === 'form' && (
          <FormScreen
            photos={capturedPhotos}
            onAddMore={handleOpenCameraFromForm}
            onSubmitSuccess={(record) => {
              setCapturedPhotos([]);
              setPendingPhoto(null);
              setInspectingRecord(null);
              setEditingRecord(null);
              // Whether it was just captured or just edited, show the record.
              setSelectedRecordId(record.id);
              setActiveScreen('detail');
            }}
            onCancel={() => {
              const wasEditing = !!editingRecord;
              setCapturedPhotos([]);
              setPendingPhoto(null);
              setInspectingRecord(null);
              setEditingRecord(null);
              setActiveScreen(wasEditing ? 'detail' : 'dashboard');
            }}
            onDeletePhoto={handleDeletePhoto}
            onUploadPhotos={(photos) => setCapturedPhotos((prev) => [...prev, ...photos])}
            inspectingRecord={inspectingRecord}
            editingRecord={editingRecord}
          />
        )}
      </AppShell>

      {/* User profile & password change modal */}
      <ProfileModal
        isOpen={showProfileModal}
        user={currentUser}
        onClose={handleCloseProfileModal}
        onSuccess={handlePasswordUpdated}
        onLogout={handleLogout}
        isForced={mustChangePassword}
      />

      {/* Post-login device permissions modal */}
      <PermissionModal
        isOpen={showPermissionModal}
        onClose={() => setShowPermissionModal(false)}
      />

      {/* ⚠️ Proximity Match / Duplicate Site Alert Modal */}
      <DuplicateProximityAlertModal
        isOpen={!!duplicateAlertTarget}
        onClose={() => setDuplicateAlertTarget(null)}
        onProceed={() => {
          if (duplicateAlertTarget) {
            const proceedFn = duplicateAlertTarget.onProceed;
            setDuplicateAlertTarget(null);
            proceedFn();
          }
        }}
        onViewMatched={(recordId) => {
          setDuplicateAlertTarget(null);
          handleOpenRecord(recordId);
        }}
        onMarkDuplicate={handleMarkDuplicateFromModal}
        currentRecord={duplicateAlertTarget?.record}
        matchedSiteId={duplicateAlertTarget?.matchedSiteId}
        matchedRecordId={duplicateAlertTarget?.matchedRecordId}
        distanceMeters={duplicateAlertTarget?.distanceMeters}
        warningText={duplicateAlertTarget?.warningText}
        isVisited={duplicateAlertTarget?.isVisited}
      />

      {/* Floating Real-Time Toast Notifications */}
      <NotificationToastContainer onSelectRecord={handleOpenRecord} />
    </NotificationProvider>
  );
}
