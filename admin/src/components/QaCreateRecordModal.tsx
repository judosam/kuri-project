import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CoordinateMap } from './CoordinateMap';
import { Icon } from './ui';
import { recordsApi } from '../services/api';
import type { CaptureRecord, ResolveCoordsResponse, QaCreateRecordPayload } from '../types';
import { QC_VHR_OPTIONS, QC_STREET_OPTIONS } from '../utils/qcOptions';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newRecord: CaptureRecord) => void;
}

const DEFAULT_COIMBATORE_LAT = 11.016844;
const DEFAULT_COIMBATORE_LNG = 76.955833;

export default function QaCreateRecordModal({ isOpen, onClose, onSuccess }: Props) {
  const [coordsInput, setCoordsInput] = useState('');
  const [currentLat, setCurrentLat] = useState(DEFAULT_COIMBATORE_LAT);
  const [currentLng, setCurrentLng] = useState(DEFAULT_COIMBATORE_LNG);
  const [hasLocationSelected, setHasLocationSelected] = useState(false);

  // Auto-resolved form fields
  const [siteId, setSiteId] = useState('');
  const [area, setArea] = useState('');
  const [village, setVillage] = useState('');
  const [taluk, setTaluk] = useState('');
  const [district, setDistrict] = useState('Coimbatore');
  const [address, setAddress] = useState('');

  // Additional QA details
  const [priorityTier, setPriorityTier] = useState('High');
  const [propertyType, setPropertyType] = useState('Residential');
  const [auditStatus, setAuditStatus] = useState('PENDING');
  const [qcVhrComment, setQcVhrComment] = useState('');
  const [qcStreetDetails, setQcStreetDetails] = useState('');
  const [qcSqfeet, setQcSqfeet] = useState('');
  const [auditComment, setAuditComment] = useState('');

  // Optional legal/survey details
  const [showExtraDetails, setShowExtraDetails] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [surveyNo, setSurveyNo] = useState('');
  const [subdivisionNo, setSubdivisionNo] = useState('');
  const [dtcpAppNo, setDtcpAppNo] = useState('');
  const [dtcpDate, setDtcpDate] = useState('');

  // Status & feedback
  const [resolving, setResolving] = useState(false);
  const [resolveSuccess, setResolveSuccess] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCoordsInput('');
      setCurrentLat(DEFAULT_COIMBATORE_LAT);
      setCurrentLng(DEFAULT_COIMBATORE_LNG);
      setHasLocationSelected(false);
      setSiteId('');
      setArea('');
      setVillage('');
      setTaluk('');
      setDistrict('Coimbatore');
      setAddress('');
      setPriorityTier('High');
      setPropertyType('Residential');
      setAuditStatus('PENDING');
      setQcVhrComment('');
      setQcSqfeet('');
      setAuditComment('');
      setShowExtraDetails(false);
      setOwnerName('');
      setSurveyNo('');
      setSubdivisionNo('');
      setDtcpAppNo('');
      setDtcpDate('');
      setResolveError(null);
      setResolveSuccess(null);
      setSaveError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const parseCoords = (text: string): { lat: number; lng: number } | null => {
    const clean = text.trim();
    const m = clean.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[3]);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  };

  const executeResolve = async (coordinatesToResolve: string) => {
    const parsed = parseCoords(coordinatesToResolve);
    if (!parsed) {
      setResolveError('Invalid format. Please enter coordinates as "latitude, longitude" (e.g. 11.0825, 76.9950).');
      setResolveSuccess(null);
      return;
    }

    setResolving(true);
    setResolveError(null);
    setResolveSuccess(null);
    try {
      const res: ResolveCoordsResponse = await recordsApi.resolveCoords(coordinatesToResolve);
      setCurrentLat(res.latitude);
      setCurrentLng(res.longitude);
      setCoordsInput(res.coordinates);
      setHasLocationSelected(true);

      if (res.site_id) setSiteId(res.site_id);
      if (res.area) setArea(res.area);
      if (res.village) setVillage(res.village);
      if (res.taluk) setTaluk(res.taluk);
      if (res.district) setDistrict(res.district);
      if (res.address) setAddress(res.address);

      setResolveSuccess(`Resolved: ${res.area || res.village || 'Location'}, ${res.taluk || ''} (${res.site_id})`);
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Failed to resolve location from coordinates';
      setResolveError(msg);
    } finally {
      setResolving(false);
    }
  };

  // Called when user clicks map or drags pin
  const handleMapCoordinatesChange = (newCoords: string) => {
    setCoordsInput(newCoords);
    const parsed = parseCoords(newCoords);
    if (parsed) {
      setCurrentLat(parsed.lat);
      setCurrentLng(parsed.lng);
      setHasLocationSelected(true);
    }
    executeResolve(newCoords);
  };

  // Called when typing in coordinates input with auto-debounce
  const handleCoordsInputChange = (val: string) => {
    setCoordsInput(val);
    setResolveError(null);
    setResolveSuccess(null);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const parsed = parseCoords(val);
    if (parsed) {
      debounceTimerRef.current = setTimeout(() => {
        executeResolve(val);
      }, 700);
    }
  };

  // Quick paste handler
  const handlePasteCoords = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (pasted) {
      const parsed = parseCoords(pasted);
      if (parsed) {
        setCoordsInput(pasted.trim());
        executeResolve(pasted.trim());
      }
    }
  };

  const handleManualResolveClick = () => {
    if (coordsInput.trim()) {
      executeResolve(coordsInput.trim());
    } else {
      setResolveError('Please enter coordinates or click on the map pin.');
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coordsInput.trim()) {
      setSaveError('Coordinates are required. Click on the map or paste coordinates.');
      return;
    }
    const parsed = parseCoords(coordsInput);
    if (!parsed) {
      setSaveError('Invalid coordinates format. Expected "latitude, longitude".');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const payload: QaCreateRecordPayload = {
        coordinates: coordsInput.trim(),
        unique_id: siteId.trim() || undefined,
        area: area.trim() || undefined,
        village: village.trim() || undefined,
        taluk: taluk.trim() || undefined,
        district: district.trim() || undefined,
        street_address: address.trim() || undefined,
        site_address: address.trim() || undefined,
        priority_tier: priorityTier,
        property_type: propertyType,
        audit_status: auditStatus,
        audit_comment: auditComment.trim() || undefined,
        qc_vhr_comment: qcVhrComment.trim() || undefined,
        qc_street_details: qcStreetDetails.trim() || undefined,
        qc_sqfeet: qcSqfeet.trim() || undefined,
        owner_name_en: ownerName.trim() || undefined,
        survey_no: surveyNo.trim() || undefined,
        subdivision_no: subdivisionNo.trim() || undefined,
        dtcp_application_no: dtcpAppNo.trim() || undefined,
        dtcp_permit_date: dtcpDate.trim() || undefined,
      };

      const newRecord = await recordsApi.qaCreate(payload);
      onSuccess(newRecord);
      onClose();
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Failed to create record';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: 16,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fos-modal-card"
        style={{
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          maxWidth: 820,
          width: '100%',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '1px solid #e2e8f0',
            background: '#faf5ff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                display: 'flex',
                padding: 8,
                borderRadius: 8,
                background: '#f3e8ff',
                color: '#7c3aed',
              }}
            >
              <Icon name="pin_drop" size={20} />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1e1b4b' }}>
                Create Record (QA Portal)
              </h3>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                Select a point on the map or paste coordinates to auto-generate Site ID, Area, Village, Taluk, and Address
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            title="Close"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 4 }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <form onSubmit={handleCreateSubmit} style={{ padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Alerts */}
          {resolveError && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="error" size={16} />
              <span>{resolveError}</span>
            </div>
          )}

          {resolveSuccess && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="check_circle" size={16} />
              <span>{resolveSuccess}</span>
            </div>
          )}

          {saveError && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="warning" size={16} />
              <span>{saveError}</span>
            </div>
          )}

          {/* Top Section: Coordinates Input & Actions */}
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>
              Target Coordinates (Latitude, Longitude) *
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="text"
                  className="fld"
                  style={{ width: '100%', paddingLeft: 32, fontSize: 13, fontFamily: 'monospace' }}
                  placeholder="Paste or type coordinates e.g. 11.0825, 76.9950"
                  value={coordsInput}
                  onChange={(e) => handleCoordsInputChange(e.target.value)}
                  onPaste={handlePasteCoords}
                />
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                  <Icon name="pin_drop" size={16} />
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleManualResolveClick}
                disabled={resolving || !coordsInput.trim()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 36, whiteSpace: 'nowrap' }}
              >
                <Icon name={resolving ? 'refresh' : 'search'} size={15} className={resolving ? 'spin' : ''} />
                {resolving ? 'Resolving…' : 'Resolve'}
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
              <span>Click anywhere on the map below or drag the marker to pick coordinates</span>
              {hasLocationSelected && (
                <span style={{ color: '#059669', fontWeight: 600 }}>✓ Position set ({currentLat.toFixed(5)}, {currentLng.toFixed(5)})</span>
              )}
            </div>
          </div>

          {/* Interactive Leaflet Map */}
          <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #cbd5e1' }}>
            <CoordinateMap
              latitude={currentLat}
              longitude={currentLng}
              height={260}
              editable={true}
              onCoordinatesChange={handleMapCoordinatesChange}
            />
          </div>

          {/* Section: Auto-Generated Location Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Auto-Generated Location & Lead Details
              </span>
              {resolving && (
                <span style={{ fontSize: 11, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="refresh" size={12} className="spin" /> Fetching location components…
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {/* Site ID */}
              <div>
                <label className="sub-field-label" htmlFor="qa-create-site-id">
                  Unique ID (Site ID) *
                </label>
                <input
                  id="qa-create-site-id"
                  type="text"
                  className="fld"
                  style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}
                  placeholder="Auto-generated (e.g. QANEW-CBE-110825-769950)"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  required
                />
              </div>

              {/* Area */}
              <div>
                <label className="sub-field-label" htmlFor="qa-create-area">
                  Area *
                </label>
                <input
                  id="qa-create-area"
                  type="text"
                  className="fld"
                  placeholder="e.g. Saravanampatti, Tatabad, Peelamedu"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  required
                />
              </div>

              {/* Village */}
              <div>
                <label className="sub-field-label" htmlFor="qa-create-village">
                  Revenue Village *
                </label>
                <input
                  id="qa-create-village"
                  type="text"
                  className="fld"
                  placeholder="Revenue village from Master"
                  value={village}
                  onChange={(e) => setVillage(e.target.value)}
                  required
                />
              </div>

              {/* Taluk */}
              <div>
                <label className="sub-field-label" htmlFor="qa-create-taluk">
                  Taluk *
                </label>
                <input
                  id="qa-create-taluk"
                  type="text"
                  className="fld"
                  placeholder="e.g. Coimbatore North, Coimbatore South"
                  value={taluk}
                  onChange={(e) => setTaluk(e.target.value)}
                  required
                />
              </div>

              {/* District */}
              <div>
                <label className="sub-field-label" htmlFor="qa-create-district">
                  District *
                </label>
                <input
                  id="qa-create-district"
                  type="text"
                  className="fld"
                  placeholder="e.g. Coimbatore"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  required
                />
              </div>

              {/* Priority Tier */}
              <div>
                <label className="sub-field-label" htmlFor="qa-create-priority">
                  Priority Tier
                </label>
                <select
                  id="qa-create-priority"
                  className="fld"
                  value={priorityTier}
                  onChange={(e) => setPriorityTier(e.target.value)}
                >
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="sub-field-label" htmlFor="qa-create-address">
                Full Address / Site Address
              </label>
              <textarea
                id="qa-create-address"
                className="fld"
                rows={2}
                placeholder="Auto-populated Google formatted address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
          </div>

          {/* Section: QA Assessment Attributes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: '#fbfbfe', padding: 12, borderRadius: 10, border: '1px solid #f1f0fb' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              QA Assessment & Staging
            </span>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {/* Audit Status */}
              <div>
                <label className="sub-field-label" htmlFor="qa-create-audit-status">
                  Initial Audit Status
                </label>
                <select
                  id="qa-create-audit-status"
                  className="fld"
                  value={auditStatus}
                  onChange={(e) => setAuditStatus(e.target.value)}
                >
                  <option value="PENDING">PENDING (Staged for Review)</option>
                  <option value="APPROVAL">APPROVAL (Approved for Field)</option>
                  <option value="COMMERCIAL_PROPERTY">COMMERCIAL PROPERTY</option>
                  <option value="DISAPPROVAL">DISAPPROVAL</option>
                </select>
              </div>

              {/* QC VHR Imagery Comment */}
              <div>
                <label className="sub-field-label" htmlFor="qa-create-vhr">
                  QC Comments (VHR Imagery)
                </label>
                <select
                  id="qa-create-vhr"
                  className="fld"
                  value={qcVhrComment}
                  onChange={(e) => setQcVhrComment(e.target.value)}
                >
                  <option value="">Select QC Assessment…</option>
                  {QC_VHR_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Street View Comments */}
              <div>
                <label className="sub-field-label" htmlFor="qa-create-street">
                  Street View Comments
                </label>
                <select
                  id="qa-create-street"
                  className="fld"
                  value={qcStreetDetails}
                  onChange={(e) => setQcStreetDetails(e.target.value)}
                >
                  <option value="">Select Street View Assessment…</option>
                  {QC_STREET_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sq.ft */}
              <div>
                <label className="sub-field-label" htmlFor="qa-create-sqft">
                  Sq.ft
                </label>
                <input
                  id="qa-create-sqft"
                  type="text"
                  className="fld"
                  placeholder="e.g. 1500, 2400 sq.ft"
                  value={qcSqfeet}
                  onChange={(e) => setQcSqfeet(e.target.value)}
                />
              </div>

              {/* Property Type */}
              <div>
                <label className="sub-field-label" htmlFor="qa-create-prop-type">
                  Property Type
                </label>
                <select
                  id="qa-create-prop-type"
                  className="fld"
                  value={propertyType}
                  onChange={(e) => setPropertyType(e.target.value)}
                >
                  <option value="Residential">Residential</option>
                  <option value="Commercial">Commercial</option>
                  <option value="Industrial">Industrial</option>
                  <option value="Villa / Layout">Villa / Layout</option>
                </select>
              </div>
            </div>

            {/* Audit Comment */}
            <div>
              <label className="sub-field-label" htmlFor="qa-create-audit-comment">
                Audit Remarks / Comments
              </label>
              <textarea
                id="qa-create-audit-comment"
                className="fld"
                rows={2}
                placeholder="Optional auditor notes or observations"
                value={auditComment}
                onChange={(e) => setAuditComment(e.target.value)}
              />
            </div>
          </div>

          {/* Expandable Extra Details */}
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowExtraDetails(!showExtraDetails)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#6366f1', fontSize: 12, padding: 0 }}
            >
              <Icon name={showExtraDetails ? 'expand_less' : 'expand_more'} size={16} />
              {showExtraDetails ? 'Hide Additional Information' : '+ Add Survey No, Owner or DTCP Info (Optional)'}
            </button>

            {showExtraDetails && (
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div>
                  <label className="sub-field-label">Owner Name</label>
                  <input type="text" className="fld" placeholder="Applicant / Owner name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
                </div>
                <div>
                  <label className="sub-field-label">Survey No</label>
                  <input type="text" className="fld" placeholder="Survey No" value={surveyNo} onChange={(e) => setSurveyNo(e.target.value)} />
                </div>
                <div>
                  <label className="sub-field-label">Sub Division</label>
                  <input type="text" className="fld" placeholder="Sub Division" value={subdivisionNo} onChange={(e) => setSubdivisionNo(e.target.value)} />
                </div>
                <div>
                  <label className="sub-field-label">DTCP Application No</label>
                  <input type="text" className="fld" placeholder="DTCP Application No" value={dtcpAppNo} onChange={(e) => setDtcpAppNo(e.target.value)} />
                </div>
                <div>
                  <label className="sub-field-label">DTCP Permit Date</label>
                  <input type="text" className="fld" placeholder="DD/MM/YYYY" value={dtcpDate} onChange={(e) => setDtcpDate(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !coordsInput.trim() || !siteId.trim()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: '#7c3aed',
                borderColor: '#7c3aed',
                minWidth: 140,
                justifyContent: 'center',
              }}
            >
              <Icon name={saving ? 'refresh' : 'add'} size={16} className={saving ? 'spin' : ''} />
              {saving ? 'Creating Record…' : 'Create Record'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
