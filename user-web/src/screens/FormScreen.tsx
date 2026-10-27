import React, { useState, useEffect, useRef } from 'react';
import type { CapturedPhoto, CaptureRecord, InspectionFormData } from '../types';
import { api } from '../services/api';
import { useGps } from '../hooks/useGps';
import Icon from '../components/common/Icon';
import Modal from '../components/common/Modal';
import Lightbox from '../components/common/Lightbox';
import { preparePhotoForUpload } from '../utils/image';
import { toISODate } from '../utils/format';
import { validatePhone, cleanPhoneNumber, validateDateOfVisit, validateText } from '../utils/validators';

export const STAGES_OF_CONSTRUCTION = [
  'Vacant Land',
  'Site Clearing',
  'Excavation',
  'Foundation Work (Piling)',
  'Ground Floor Construction',
  'Additional Floor Construction',
  'Electrical & Plumbing Work (MEP)',
  'Plastering & Waterproofing',
  'Flooring, Painting & Finishing',
  'External Development (Parking, Roads, Landscaping)',
  'Completed Building',
  'Renovation',
  'Other',
];

export const CONSTRUCTION_TYPES = [
  'Residential',
  'Commercial',
  'Industrial',
  'Institutional',
  'Infrastructure',
  'Other',
];

interface FormScreenProps {
  photos: CapturedPhoto[];
  onAddMore: () => void;
  onUploadPhotos: (photos: CapturedPhoto[]) => void;
  onSubmitSuccess: (record: CaptureRecord) => void;
  onCancel: () => void;
  onDeletePhoto: (index: number) => void;
  initialName?: string;
  initialDescription?: string;
  inspectingRecord?: CaptureRecord | null;
  /** Set when an already-submitted record is reopened for editing. */
  editingRecord?: CaptureRecord | null;
}

export default function FormScreen({
  photos,
  onAddMore,
  onUploadPhotos,
  onSubmitSuccess,
  onCancel,
  onDeletePhoto,
  initialName = '',
  initialDescription = '',
  inspectingRecord = null,
  editingRecord = null,
}: FormScreenProps) {
  const editing = !!editingRecord;
  // Live device GPS — the position of record for inspections completed
  // without photos (photos carry their own GPS on each capture).
  const gps = useGps();
  const isGpsLocked = gps.state === 'ready' && !!gps.fix && gps.fix.latitude !== 0 && gps.fix.longitude !== 0;
  /** The record this form is about — a dispatched task or one being edited. */
  const sourceRecord = editingRecord ?? inspectingRecord;
  const [name, setName] = useState(
    initialName || (sourceRecord ? sourceRecord.name || sourceRecord.unique_id || '' : '')
  );
  const [description, setDescription] = useState(
    initialDescription || (sourceRecord ? sourceRecord.description || '' : '')
  );
  const [nameError, setNameError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showRefImageModal, setShowRefImageModal] = useState(false);


  // Editing prefills the questionnaire with what was saved. A stored value the
  // dropdowns do not know about becomes "Other" plus that text.
  const savedStage = editingRecord?.stage_of_construction || '';
  const stageInList = !savedStage || STAGES_OF_CONSTRUCTION.includes(savedStage);
  const savedType = editingRecord?.type_of_construction || '';
  const typeInList = !savedType || CONSTRUCTION_TYPES.includes(savedType);

  // 9 Field Inspection states
  const [dateOfVisit, setDateOfVisit] = useState(
    () => editingRecord?.date_of_visit || toISODate()
  );
  const [constructionHappening, setConstructionHappening] = useState<'Yes' | 'No'>(
    editingRecord?.construction_happening === 'No' ? 'No' : 'Yes'
  );
  const [stageOfConstruction, setStageOfConstruction] = useState(
    stageInList ? savedStage : (savedStage ? 'Other' : '')
  );
  const [customStage, setCustomStage] = useState(stageInList ? '' : savedStage);
  const [noOfFloors, setNoOfFloors] = useState(
    editingRecord?.no_of_floors || inspectingRecord?.no_of_floors || ''
  );
  const [builtUpArea, setBuiltUpArea] = useState(
    editingRecord?.built_up_area || inspectingRecord?.built_up_area || ''
  );
  const [expectedCompletion, setExpectedCompletion] = useState(
    editingRecord?.expected_completion || inspectingRecord?.expected_completion || ''
  );
  const [typeOfConstruction, setTypeOfConstruction] = useState(
    typeInList ? savedType : (savedType ? 'Other' : '')
  );
  const [customTypeOfConstruction, setCustomTypeOfConstruction] = useState(typeInList ? '' : savedType);
  const [followUpDate, setFollowUpDate] = useState(
    editingRecord?.follow_up_date || inspectingRecord?.follow_up_date || ''
  );
  const [ownerName, setOwnerName] = useState(
    editingRecord?.owner_name_en || inspectingRecord?.owner_name_en || ''
  );
  const [relationshipWithBuilding, setRelationshipWithBuilding] = useState(editingRecord?.relationship_with_building || '');
  const [buildingUserName, setBuildingUserName] = useState(editingRecord?.building_user_name || '');
  const [spokenWith, setSpokenWith] = useState(editingRecord?.spoken_with || '');
  const [contactNumber, setContactNumber] = useState(editingRecord?.contact_number || '');
  const [contractorName, setContractorName] = useState(
    editingRecord?.site_contractor_architect_name || ''
  );
  const [contractorNumber, setContractorNumber] = useState(
    editingRecord?.site_contractor_architect_number || ''
  );
  const [remarks, setRemarks] = useState(editingRecord?.remarks || '');

  // UI states
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [photoToDelete, setPhotoToDelete] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [savedRecord, setSavedRecord] = useState<CaptureRecord | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [preparingUploads, setPreparingUploads] = useState(false);

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setPreparingUploads(true);
    setError(null);
    try {
      const added: CapturedPhoto[] = [];
      for (const file of Array.from(files)) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
          throw new Error('Choose JPEG, PNG or WebP images up to 20 MB each.');
        }
        const uri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Could not read this image.'));
          reader.readAsDataURL(file);
        });
        const { blob } = await preparePhotoForUpload(uri);
        added.push({ id: crypto.randomUUID(), uri, blob, source: 'uploaded', latitude: 0, longitude: 0, accuracy: 0, capturedAt: Date.now() });
      }
      onUploadPhotos(added);
    } catch (e: any) {
      setError(e.message || 'Could not prepare images.');
    } finally {
      setPreparingUploads(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  // Admin-dispatched tasks own their title and description; the operator only
  // fills in the inspection result. A field the admin left blank stays editable
  // so the operator is never blocked from submitting.
  const titleLocked = !!sourceRecord?.name;
  const descriptionLocked = !!sourceRecord?.description;
  // Same rule for the owner name: the operator's to fill in only when the
  // admin's dispatch sheet left it blank.
  const ownerNameLocked = !!sourceRecord?.owner_name_en?.trim();
  const lockedByAdmin = titleLocked || descriptionLocked;

  // The General Description grows and shrinks with its content, so the card is
  // never padded with empty rows or hiding the text behind a scrollbar.
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const autoGrowDescription = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Auto-fill from inspectingRecord if applicable
  useEffect(() => {
    if (inspectingRecord) {
      if (inspectingRecord.name && !name) setName(inspectingRecord.name);
      if (inspectingRecord.description && !description) setDescription(inspectingRecord.description);
    }
  }, [inspectingRecord]);

  useEffect(() => {
    if (photos.length > 0 && fieldErrors.photos) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.photos;
        return next;
      });
    }
  }, [photos.length, fieldErrors.photos]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // Guard: Only allow saving records when GPS current location is locked
    if (!isGpsLocked) {
      if (gps.state === 'denied') {
        setError('Location permission is denied. GPS current location must be locked to save records. Please enable location permissions in browser settings.');
      } else if (gps.state === 'locating') {
        setError('Acquiring GPS location... Current GPS location must be locked before saving records. Please wait for GPS lock.');
      } else {
        setError('Current GPS location must be locked to save records. Please enable device location services and tap Retry.');
      }
      return;
    }

    const newErrors: Record<string, string> = {};

    if (!editing && photos.length === 0) {
      newErrors.photos = 'Please capture at least one photo before submitting the inspection.';
    }

    const nameErr = validateText(name, 'Site / Record Title', 2, 255);
    if (nameErr) {
      newErrors.name = nameErr;
      setNameError(true);
    } else {
      setNameError(false);
    }

    const dateErr = validateDateOfVisit(dateOfVisit);
    if (dateErr) {
      newErrors.dateOfVisit = dateErr;
    }

    if (!stageOfConstruction) {
      newErrors.stageOfConstruction = 'Please select the stage of construction.';
    } else if (stageOfConstruction === 'Other' && (!customStage || customStage.trim().length < 3)) {
      newErrors.customStage = 'Please specify the stage of construction (at least 3 characters).';
    }

    if (!typeOfConstruction) {
      newErrors.typeOfConstruction = 'Please select the type of construction.';
    } else if (typeOfConstruction === 'Other' && (!customTypeOfConstruction || customTypeOfConstruction.trim().length < 3)) {
      newErrors.customTypeOfConstruction = 'Please specify the type of construction (at least 3 characters).';
    }

    if (followUpDate && followUpDate.trim()) {
      const today = toISODate();
      if (followUpDate < today) {
        newErrors.followUpDate = 'Follow-up date cannot be in the past.';
      }
    }

    if (contactNumber.trim()) {
      const contactErr = validatePhone(contactNumber);
      if (contactErr) {
        newErrors.contactNumber = contactErr;
      }
    }

    if (contractorNumber.trim()) {
      const contractorErr = validatePhone(contractorNumber);
      if (contractorErr) {
        newErrors.contractorNumber = contractorErr;
      }
    }

    if (constructionHappening === 'No' && (!remarks || !remarks.trim())) {
      newErrors.remarks = 'Remarks are mandatory when construction is not happening.';
    }

    if (Object.keys(newErrors).length > 0) {
      setFieldErrors(newErrors);
      if (newErrors.photos) {
        setError(newErrors.photos);
      } else {
        setError('Please review and resolve the errors highlighted below.');
      }
      return;
    }

    setFieldErrors({});
    setLoading(true);
    setError(null);
    setUploadProgress(null);
    setLoadingStage('Saving record details...');

    try {
      const resolvedStage =
        stageOfConstruction === 'Other'
          ? customStage.trim() || 'Other'
          : stageOfConstruction;

      const resolvedType =
        typeOfConstruction === 'Other'
          ? customTypeOfConstruction.trim() || 'Other'
          : typeOfConstruction.trim();

      const normalizedContact = contactNumber.trim() ? cleanPhoneNumber(contactNumber) : '';
      const normalizedContractorPhone = contractorNumber.trim() ? cleanPhoneNumber(contractorNumber) : '';

      const fullInspection: Partial<InspectionFormData> = {
        date_of_visit: dateOfVisit.trim(),
        construction_happening: constructionHappening,
        stage_of_construction: resolvedStage,
        no_of_floors: noOfFloors.trim() || undefined,
        built_up_area: builtUpArea.trim() || undefined,
        expected_completion: expectedCompletion.trim() || undefined,
        type_of_construction: resolvedType,
        relationship_with_building: relationshipWithBuilding.trim(),
        building_user_name: buildingUserName.trim(),
        spoken_with: spokenWith.trim(),
        contact_number: normalizedContact,
        site_contractor_architect_name: contractorName.trim(),
        site_contractor_architect_number: normalizedContractorPhone,
        remarks: remarks.trim(),
        follow_up_date: followUpDate.trim() || undefined,
      };

      // Edit of a completed record: send ONLY the fields the verifier
      // actually changed — untouched values stay exactly as stored instead
      // of being rewritten (and defaults never stomp saved data).
      const isRevisitRecord = Boolean(
        sourceRecord?.reassigned_to_id != null ||
        sourceRecord?.revisit_status === 'REASSIGNED' ||
        sourceRecord?.revisit_status === 'PENDING_REVISIT' ||
        sourceRecord?.revisit_status === 'Updated Revisited' ||
        sourceRecord?.status === 'COMPLETED' ||
        sourceRecord?.status === 'Updated Revisited'
      );
      const editingCompleted = editing && sourceRecord?.status === 'COMPLETED' && !isRevisitRecord;
      const inspectionPayload: Partial<InspectionFormData> = editingCompleted
        ? Object.fromEntries(
            Object.entries(fullInspection).filter(([field, value]) => {
              const original = (sourceRecord as unknown as Record<string, unknown>)[field];
              return value != null && String(value) !== String(original ?? '');
            })
          )
        : fullInspection;

      // 1. Save. With a task_id the API updates that row in place, which is
      //    exactly what an edit is (and the photo list is empty in edit mode).
      const record = await api.createRecord({
        name: name.trim(),
        description: description.trim(),

        taskId: sourceRecord?.id,
        ownerName: ownerNameLocked ? undefined : ownerName.trim(),
        photos: photos.map((p, idx) => ({
          latitude: (p.latitude && p.latitude !== 0) ? p.latitude : (gps.fix?.latitude ?? 0),
          longitude: (p.longitude && p.longitude !== 0) ? p.longitude : (gps.fix?.longitude ?? 0),
          location_accuracy: p.accuracy || gps.fix?.accuracy || 0,
          captured_at: p.capturedAt || Date.now(),
          file_name: `photo_${idx + 1}.jpg`,
        })),
        // Device GPS attaches on first completion or revisit
        ...(gps.fix
          ? {
              fieldGps: {
                latitude: gps.fix.latitude,
                longitude: gps.fix.longitude,
                location_accuracy: gps.fix.accuracy,
                captured_at: gps.updatedAt ?? Date.now(),
              },
            }
          : {}),
        inspectionData: inspectionPayload,
      });

      // 2. Upload photo files
      if (photos.length > 0) {
        // Ensure each photo has a Blob (already pre-processed in background while filling form)
        const photosWithBlobs = await Promise.all(
          photos.map(async (p) => {
            if (p.blob) {
              return p as { blob: Blob; latitude: number; longitude: number; accuracy: number; capturedAt: number; source?: 'camera' | 'uploaded' };
            }
            if (p.blobPromise) {
              const b = await p.blobPromise;
              return {
                source: p.source,
                blob: b,
                latitude: p.latitude,
                longitude: p.longitude,
                accuracy: p.accuracy,
                capturedAt: p.capturedAt,
              };
            }
            const res = await fetch(p.uri);
            const blob = await res.blob();
            return {
              source: p.source,
              blob,
              latitude: p.latitude,
              longitude: p.longitude,
              accuracy: p.accuracy,
              capturedAt: p.capturedAt,
            };
          })
        );

        const uploaded = await api.uploadRecordImages(record.id, photosWithBlobs, (pct) => {
          setUploadProgress(pct);
          setLoadingStage(`Uploading photos (${pct}%)...`);
        });
        if (uploaded.errors?.length) throw new Error(uploaded.errors.join('; '));
      }

      setSavedRecord(record);
    } catch (err: any) {
      console.error('Failed to submit inspection:', err);
      setError(err.message || 'Submission failed. Please check your network and try again.');
    } finally {
      setLoading(false);
      setLoadingStage('');
      setUploadProgress(null);
    }
  };

  const isFormDirty =
    Boolean(name.trim()) ||
    Boolean(description.trim()) ||
    Boolean(remarks.trim()) ||
    Boolean(buildingUserName.trim()) ||
    Boolean(spokenWith.trim()) ||
    Boolean(contractorName.trim()) ||
    photos.length > 0;

  const handleBack = () => {
    if (isFormDirty) {
      setShowDiscardModal(true);
    } else {
      onCancel();
    }
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '5rem' }}>
      {/* The task this form belongs to — dispatched pending, or being edited */}
      {sourceRecord && (
        <div
          style={{
            backgroundColor: 'var(--color-primary-light)',
            border: '1px solid var(--color-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '0.875rem 1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <Icon name={editing ? 'edit_note' : 'assignment'} size={22} color="var(--color-primary)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-primary-dark)' }}>
              {editing ? 'Editing Record' : 'Fulfilling Assigned Task'} #{sourceRecord.id}
              {sourceRecord.unique_id ? ` · ${sourceRecord.unique_id}` : ''}
            </div>
            {sourceRecord.site_address && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                {sourceRecord.site_address}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: 'var(--radius-md)',
            padding: '0.875rem 1rem',
            marginBottom: '1.25rem',
            color: '#991b1b',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
          }}
        >
          <Icon name="error" size={20} color="#b91c1c" />
          <span>{error}</span>
        </div>
      )}

      {/* Live capture location — where this inspection is being filed from.
          The backend reverse-geocodes this fix into the record's address. */}
      {!editing && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.625rem',
            padding: '0.75rem 1rem',
            marginBottom: '1.25rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid #a7f3d0',
            backgroundColor: '#f0fdf4',
          }}
        >
          <Icon name={gps.fix ? 'location_on' : 'location_off'} size={20} color={gps.fix ? '#059669' : '#94a3b8'} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#065f46' }}>
              Capture location{gps.fix ? ` · ±${Math.round(gps.fix.accuracy)}m accuracy` : ''}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#047857', overflowWrap: 'anywhere' }}>
              {gps.fix
                ? gps.place || `${gps.fix.latitude.toFixed(6)}, ${gps.fix.longitude.toFixed(6)}`
                : gps.state === 'locating'
                ? 'Locating your position…'
                : 'Location unavailable — the record will be saved without coordinates.'}
            </div>
          </div>
          {!gps.fix && gps.state !== 'locating' && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={gps.retry}>
              Retry
            </button>
          )}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          gap: '1.25rem',
          alignItems: 'start',
        }}
      >
        {/* Left Column: Photos Gallery & Basic Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Photo Gallery Card — hidden while editing, where the record keeps
              the photos it was saved with and only details change. */}
          {!editing && (
          <div className="card" style={{ padding: '1.25rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Icon name="photo_library" size={20} color="var(--color-primary)" />
                <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                  Inspection Photos ({photos.length}) {!editing && <span style={{ color: '#ef4444' }}>*</span>}
                </h2>
              </div>
            </div>

            {fieldErrors.photos && (
              <div style={{ marginBottom: '0.75rem', padding: '8px 12px', borderRadius: 8, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }} role="alert">
                <Icon name="error" size={16} color="#ef4444" />
                <span style={{ fontWeight: 600 }}>{fieldErrors.photos}</span>
              </div>
            )}

            <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => uploadPhotos(e.target.files)} />

            {/* Action buttons: Capture Photo and Upload Images */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: photos.length > 0 ? '1rem' : 0 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onAddMore}
                disabled={loading || preparingUploads}
                style={{ justifyContent: 'center', gap: '6px', padding: '10px 12px', fontSize: '0.84rem' }}
              >
                <Icon name="add_a_photo" size={17} />
                <span>Capture Photo</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || preparingUploads}
                onClick={() => uploadRef.current?.click()}
                style={{ justifyContent: 'center', gap: '6px', padding: '10px 12px', fontSize: '0.84rem' }}
              >
                <Icon name="upload_file" size={17} />
                <span>{preparingUploads ? 'Preparing…' : 'Upload Images'}</span>
              </button>
            </div>

            {photos.some(photo => photo.source === 'uploaded') && !gps.fix && (
              <div role="status" style={{ marginTop: 10, color: '#92400e', fontSize: 13 }}>
                Inspection location is unavailable. Allow location access to save the field address and coordinates.
                <button type="button" className="btn btn-secondary btn-sm" onClick={gps.retry} style={{ marginLeft: 6 }}>Retry location</button>
              </div>
            )}

            {/* Photo thumbnails grid */}
            {photos.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {photos.map((photo, idx) => (
                  <div
                    key={photo.id || idx}
                    style={{
                      position: 'relative',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                      backgroundColor: 'var(--color-bg-subtle)',
                      aspectRatio: '4 / 3',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <img
                      src={photo.uri}
                      alt={`Photo ${idx + 1}`}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        cursor: 'pointer',
                        display: 'block',
                      }}
                      onClick={() => setLightboxIndex(idx)}
                    />
                    {/* Index badge */}
                    <span
                      style={{
                        position: 'absolute',
                        top: '4px',
                        left: '4px',
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        color: '#fff',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      #{idx + 1}
                    </span>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPhotoToDelete(idx);
                      }}
                      style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        backgroundColor: 'rgba(239, 68, 68, 0.85)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                      title="Remove photo"
                    >
                      <Icon name="close" size={14} />
                    </button>

                    {/* Accuracy label */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.65)',
                        color: '#fff',
                        fontSize: '0.625rem',
                        padding: '2px 4px',
                        textAlign: 'center',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {photo.source === 'uploaded' ? 'Uploaded image' : `±${Math.round(photo.accuracy)}m lock`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Record Title & Notes */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Icon name="edit_note" size={20} color="var(--color-primary)" />
              <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                Record Information
              </h2>
            </div>

            {lockedByAdmin && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '1rem',
                  padding: '0.625rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-subtle)',
                  border: '1px solid var(--border-line)',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                }}
              >
                <Icon name="lock" size={16} color="var(--text-muted)" />
                <span>
                  The title and description were set by the admin for this task and are read-only.
                </span>
              </div>
            )}

            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label" htmlFor="record-name">
                Site / Record Title <span style={{ color: 'var(--color-danger)' }}>*</span>
              </label>
              <input
                id="record-name"
                type="text"
                className={`form-input ${nameError ? 'input-error' : ''}`}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError && e.target.value.trim()) setNameError(false);
                }}
                placeholder="e.g. Survey Plot 42 - North Tower"
                readOnly={titleLocked}
                required
              />
              {nameError && (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)', marginTop: '0.25rem', display: 'block' }}>
                  Site or record title is required.
                </span>
              )}
            </div>

            <div className="form-group" style={{ marginTop: '0.5rem' }}>
              <label className="form-label" htmlFor="owner-name">
                Owner Name
              </label>
              <input
                id="owner-name"
                type="text"
                className="form-input"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Name of the land / building owner"
                readOnly={ownerNameLocked}
              />
            </div>

            {(sourceRecord?.qc_vhr_comment || sourceRecord?.qc_street_details || sourceRecord?.qc_sqfeet || sourceRecord?.qc_reference_image_url) && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.625rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  fontSize: '0.8rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#0369a1', fontSize: '0.78rem' }}>
                  <Icon name="fact_check" size={15} color="#0284c7" />
                  <span>QC Desk Review Information</span>
                </div>
                {sourceRecord.qc_vhr_comment && (
                  <div style={{ fontSize: '0.78rem', color: '#334155' }}>
                    <strong style={{ color: '#0f172a' }}>QC Comments (VHR Imagery): </strong>
                    <span>{sourceRecord.qc_vhr_comment}</span>
                  </div>
                )}
                {sourceRecord.qc_street_details && (
                  <div style={{ fontSize: '0.78rem', color: '#334155' }}>
                    <strong style={{ color: '#0f172a' }}>QC Additional Details (Street View): </strong>
                    <span>{sourceRecord.qc_street_details}</span>
                  </div>
                )}
                {sourceRecord.qc_sqfeet && (
                  <div style={{ fontSize: '0.78rem', color: '#334155' }}>
                    <strong style={{ color: '#0f172a' }}>Sq.ft: </strong>
                    <span>{sourceRecord.qc_sqfeet}</span>
                  </div>
                )}
                {sourceRecord.qc_reference_image_url && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #cbd5e1' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#0369a1' }}>QC Reference Image:</span>
                      <span style={{ fontSize: '0.68rem', color: '#16a34a', fontWeight: 600 }}>GDrive Synced</span>
                    </div>
                    <div
                      onClick={() => setShowRefImageModal(true)}
                      style={{
                        position: 'relative',
                        borderRadius: 6,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        maxHeight: 140,
                        background: '#0f172a',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      <img
                        src={api.getAuthenticatedImageUrl(sourceRecord.qc_reference_image_url)}
                        alt="QC Reference"
                        style={{ width: '100%', height: '100%', maxHeight: 140, objectFit: 'contain' }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 4,
                          right: 4,
                          background: 'rgba(15, 23, 42, 0.8)',
                          color: '#fff',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: '0.68rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Icon name="zoom_in" size={12} /> Tap to expand
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: 9 Field Inspection Details */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1rem',
              paddingBottom: '0.75rem',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <Icon name="fact_check" size={22} color="var(--color-primary)" />
            <h2 style={{ fontSize: '1.0625rem', fontWeight: 600, margin: 0 }}>
              Field Operator Inspection
            </h2>
          </div>

          <form id="inspection-answers" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* 1. Date of Visit */}
            <div className="form-group">
              <label className="form-label" htmlFor="date-visit">
                1. Date of Visit <span style={{ color: 'var(--color-danger)' }}>*</span>
              </label>
              <input
                id="date-visit"
                type="date"
                className={`form-input ${fieldErrors.dateOfVisit ? 'input-error' : ''}`}
                style={fieldErrors.dateOfVisit ? { borderColor: '#ef4444' } : undefined}
                value={dateOfVisit}
                onChange={(e) => {
                  setDateOfVisit(e.target.value);
                  if (fieldErrors.dateOfVisit) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.dateOfVisit;
                      return next;
                    });
                  }
                }}
                aria-invalid={!!fieldErrors.dateOfVisit}
                required
              />
              {fieldErrors.dateOfVisit && (
                <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={13} color="#ef4444" />
                  <span>{fieldErrors.dateOfVisit}</span>
                </span>
              )}
            </div>

            {/* 2. Construction Happening */}
            <div className="form-group">
              <label className="form-label">
                2. Is Construction Actively Happening?
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className={`btn ${constructionHappening === 'Yes' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setConstructionHappening('Yes')}
                  style={{ justifyContent: 'center' }}
                >
                  <Icon name="check_circle" size={18} />
                  <span>Yes (Active)</span>
                </button>
                <button
                  type="button"
                  className={`btn ${constructionHappening === 'No' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setConstructionHappening('No')}
                  style={{ justifyContent: 'center' }}
                >
                  <Icon name="cancel" size={18} />
                  <span>No (Inactive)</span>
                </button>
              </div>
            </div>

            {/* 3. Stage of Construction */}
            <div className="form-group">
              <label className="form-label" htmlFor="stage-construction">
                3. Stage of Construction <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                id="stage-construction"
                className={`form-input ${fieldErrors.stageOfConstruction ? 'input-error' : ''}`}
                style={fieldErrors.stageOfConstruction ? { borderColor: '#ef4444' } : undefined}
                value={stageOfConstruction}
                onChange={(e) => {
                  setStageOfConstruction(e.target.value);
                  if (fieldErrors.stageOfConstruction || fieldErrors.customStage) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.stageOfConstruction;
                      delete next.customStage;
                      return next;
                    });
                  }
                }}
              >
                <option value="">Select Stage of Construction</option>
                {STAGES_OF_CONSTRUCTION.map((stg) => (
                  <option key={stg} value={stg}>
                    {stg}
                  </option>
                ))}
              </select>
              {fieldErrors.stageOfConstruction && (
                <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={13} color="#ef4444" />
                  <span>{fieldErrors.stageOfConstruction}</span>
                </span>
              )}

              {stageOfConstruction === 'Other' && (
                <>
                  <input
                    type="text"
                    className={`form-input ${fieldErrors.customStage ? 'input-error' : ''}`}
                    style={{ marginTop: '0.5rem', ...(fieldErrors.customStage ? { borderColor: '#ef4444' } : {}) }}
                    value={customStage}
                    onChange={(e) => {
                      setCustomStage(e.target.value);
                      if (fieldErrors.customStage) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next.customStage;
                          return next;
                        });
                      }
                    }}
                    placeholder="Specify other construction stage details..."
                    aria-invalid={!!fieldErrors.customStage}
                    autoFocus
                  />
                  {fieldErrors.customStage && (
                    <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                      <Icon name="error" size={13} color="#ef4444" />
                      <span>{fieldErrors.customStage}</span>
                    </span>
                  )}
                </>
              )}
            </div>

            {/* 4. Type of Construction */}
            <div className="form-group">
              <label className="form-label" htmlFor="type-construction">
                4. Type of Construction <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                id="type-construction"
                className={`form-input ${fieldErrors.typeOfConstruction ? 'input-error' : ''}`}
                style={fieldErrors.typeOfConstruction ? { borderColor: '#ef4444' } : undefined}
                value={typeOfConstruction}
                onChange={(e) => {
                  setTypeOfConstruction(e.target.value);
                  if (fieldErrors.typeOfConstruction || fieldErrors.customTypeOfConstruction) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.typeOfConstruction;
                      delete next.customTypeOfConstruction;
                      return next;
                    });
                  }
                }}
              >
                <option value="">Select Type of Construction</option>
                {CONSTRUCTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              {fieldErrors.typeOfConstruction && (
                <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={13} color="#ef4444" />
                  <span>{fieldErrors.typeOfConstruction}</span>
                </span>
              )}

              {typeOfConstruction === 'Other' && (
                <>
                  <input
                    type="text"
                    className={`form-input ${fieldErrors.customTypeOfConstruction ? 'input-error' : ''}`}
                    style={{ marginTop: '0.5rem', ...(fieldErrors.customTypeOfConstruction ? { borderColor: '#ef4444' } : {}) }}
                    value={customTypeOfConstruction}
                    onChange={(e) => {
                      setCustomTypeOfConstruction(e.target.value);
                      if (fieldErrors.customTypeOfConstruction) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next.customTypeOfConstruction;
                          return next;
                        });
                      }
                    }}
                    placeholder="Specify other construction type..."
                    aria-invalid={!!fieldErrors.customTypeOfConstruction}
                    autoFocus
                  />
                  {fieldErrors.customTypeOfConstruction && (
                    <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                      <Icon name="error" size={13} color="#ef4444" />
                      <span>{fieldErrors.customTypeOfConstruction}</span>
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Construction Specs: Floors, Area, Expected Completion */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="no-of-floors">
                  No. of Floors
                </label>
                <input
                  id="no-of-floors"
                  type="text"
                  className="form-input"
                  value={noOfFloors}
                  onChange={(e) => setNoOfFloors(e.target.value)}
                  placeholder="e.g. G+1, 2 Floors"
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="built-up-area">
                  Built-up Area
                </label>
                <input
                  id="built-up-area"
                  type="text"
                  className="form-input"
                  value={builtUpArea}
                  onChange={(e) => setBuiltUpArea(e.target.value)}
                  placeholder="e.g. 1,800 sq.ft"
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="expected-completion">
                  Expected Completion
                </label>
                <input
                  id="expected-completion"
                  type="text"
                  className="form-input"
                  value={expectedCompletion}
                  onChange={(e) => setExpectedCompletion(e.target.value)}
                  placeholder="e.g. Dec 2026 / Q1 2027"
                />
              </div>
            </div>

            {/* 5. Building User / Occupant Name */}
            <div className="form-group">
              <label className="form-label" htmlFor="user-name">
                5. Building User / Occupant Name
              </label>
              <input
                id="user-name"
                type="text"
                className="form-input"
                value={buildingUserName}
                onChange={(e) => setBuildingUserName(e.target.value)}
                placeholder="e.g. John Doe / Green Valley Apts"
              />
            </div>

            {/* 6. Contact Number */}
            <div className="form-group">
              <label className="form-label" htmlFor="contact-num">
                6. Contact Number
              </label>
              <input
                id="contact-num"
                type="tel"
                className={`form-input ${fieldErrors.contactNumber ? 'input-error' : ''}`}
                style={fieldErrors.contactNumber ? { borderColor: '#ef4444' } : undefined}
                value={contactNumber}
                onChange={(e) => {
                  setContactNumber(e.target.value);
                  if (fieldErrors.contactNumber) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.contactNumber;
                      return next;
                    });
                  }
                }}
                onBlur={() => {
                  if (contactNumber.trim()) {
                    const err = validatePhone(contactNumber);
                    if (err) setFieldErrors((prev) => ({ ...prev, contactNumber: err }));
                  }
                }}
                placeholder="10-digit mobile number (e.g. 9876543210)"
                aria-invalid={!!fieldErrors.contactNumber}
              />
              {fieldErrors.contactNumber && (
                <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={13} color="#ef4444" />
                  <span>{fieldErrors.contactNumber}</span>
                </span>
              )}
            </div>

            {/* 7. Site Contractor / Architect Name */}
            <div className="form-group">
              <label className="form-label" htmlFor="contractor-name">
                7. Site Contractor / Architect Name
              </label>
              <input
                id="contractor-name"
                type="text"
                className="form-input"
                value={contractorName}
                onChange={(e) => setContractorName(e.target.value)}
                placeholder="e.g. BuildCorp Ltd. / Arch. Sharma"
              />
            </div>

            {/* 8. Site Contractor / Architect Phone */}
            <div className="form-group">
              <label className="form-label" htmlFor="contractor-phone">
                8. Site Contractor / Architect Phone
              </label>
              <input
                id="contractor-phone"
                type="tel"
                className={`form-input ${fieldErrors.contractorNumber ? 'input-error' : ''}`}
                style={fieldErrors.contractorNumber ? { borderColor: '#ef4444' } : undefined}
                value={contractorNumber}
                onChange={(e) => {
                  setContractorNumber(e.target.value);
                  if (fieldErrors.contractorNumber) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.contractorNumber;
                      return next;
                    });
                  }
                }}
                onBlur={() => {
                  if (contractorNumber.trim()) {
                    const err = validatePhone(contractorNumber);
                    if (err) setFieldErrors((prev) => ({ ...prev, contractorNumber: err }));
                  }
                }}
                placeholder="10-digit mobile number of contractor / architect"
                aria-invalid={!!fieldErrors.contractorNumber}
              />
              {fieldErrors.contractorNumber && (
                <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={13} color="#ef4444" />
                  <span>{fieldErrors.contractorNumber}</span>
                </span>
              )}
            </div>


            <div className="form-group">
              <label className="form-label" htmlFor="relationship-building">Relationship with Building</label>
              <input id="relationship-building" className="form-input" value={relationshipWithBuilding} onChange={(e) => setRelationshipWithBuilding(e.target.value)} placeholder="Owner, tenant, contractor, caretaker…" />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="spoken-with">Spoken With</label>
              <input
                id="spoken-with"
                type="text"
                className="form-input"
                value={spokenWith}
                onChange={(e) => setSpokenWith(e.target.value)}
                placeholder="Name or role of person spoken with on site"
              />
            </div>
            {/* 9. Field Remarks / Notes */}
            <div className="form-group">
              <label className="form-label" htmlFor="field-remarks">
                9. Field Remarks & Observations {constructionHappening === 'No' && <span style={{ color: '#ef4444' }}>* (Mandatory when construction is No)</span>}
              </label>
              <textarea
                id="field-remarks"
                className={`form-input ${fieldErrors.remarks ? 'input-error' : ''}`}
                style={fieldErrors.remarks ? { borderColor: '#ef4444' } : undefined}
                rows={3}
                value={remarks}
                onChange={(e) => {
                  setRemarks(e.target.value);
                  if (fieldErrors.remarks) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.remarks;
                      return next;
                    });
                  }
                }}
                placeholder={constructionHappening === 'No' ? 'Please explain why construction is not happening (Mandatory)...' : 'Observations regarding progress, weather, site access, deviations...'}
              />
              {fieldErrors.remarks && (
                <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem', display: 'block' }}>
                  {fieldErrors.remarks}
                </span>
              )}
            </div>

            {/* 10. Follow-up Date (Next Revisit) */}
            <div className="form-group">
              <label className="form-label" htmlFor="follow-up-date" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>10. Follow-up Date (Next Revisit)</span>
                <span style={{ fontSize: '0.72rem', color: '#0284c7', backgroundColor: '#e0f2fe', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>Auto Reassign</span>
              </label>
              <input
                id="follow-up-date"
                type="date"
                className={`form-input ${fieldErrors.followUpDate ? 'input-error' : ''}`}
                style={fieldErrors.followUpDate ? { borderColor: '#ef4444' } : undefined}
                value={followUpDate}
                min={toISODate()}
                onChange={(e) => {
                  setFollowUpDate(e.target.value);
                  if (fieldErrors.followUpDate) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.followUpDate;
                      return next;
                    });
                  }
                }}
              />
              <span style={{ fontSize: '0.73rem', color: '#64748b', marginTop: '0.25rem', display: 'block' }}>
                Select a target date for the next follow-up inspection / auto reassign.
              </span>
              {fieldErrors.followUpDate && (
                <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: 4 }} role="alert">
                  <Icon name="error" size={13} color="#ef4444" />
                  <span>{fieldErrors.followUpDate}</span>
                </span>
              )}
            </div>

            {/* Real-time upload progress indicator */}
            {loading && uploadProgress !== null && (
              <div style={{ marginTop: '1.25rem', padding: '10px 14px', backgroundColor: '#fff5f5', borderRadius: 12, border: '1px solid #fed7d7' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a' }}>
                    {loadingStage}
                  </span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#FF6467' }}>
                    {uploadProgress}%
                  </span>
                </div>
                <div style={{ width: '100%', height: 6, backgroundColor: '#fed7d7', borderRadius: 999, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${uploadProgress}%`,
                      backgroundColor: '#FF6467',
                      borderRadius: 999,
                      transition: 'width 0.15s ease',
                    }}
                  />
                </div>
              </div>
            )}

            {/* GPS Lock Status Card for Field Verifier Portal */}
            <div
              style={{
                marginTop: '1.25rem',
                width: '100%',
                padding: '10px 14px',
                borderRadius: '12px',
                backgroundColor: isGpsLocked ? '#f0fdf4' : gps.state === 'denied' ? '#fef2f2' : '#fffbeb',
                border: `1.5px solid ${isGpsLocked ? '#86efac' : gps.state === 'denied' ? '#fca5a5' : '#fde047'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                boxSizing: 'border-box',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {isGpsLocked ? (
                  <Icon name="verified" size={20} color="#16a34a" />
                ) : gps.state === 'locating' ? (
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: '#d97706', borderTopColor: 'transparent', flexShrink: 0 }} />
                ) : (
                  <Icon name="location_off" size={20} color="#dc2626" />
                )}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      color: isGpsLocked ? '#15803d' : gps.state === 'denied' ? '#b91c1c' : '#92400e',
                    }}
                  >
                    {isGpsLocked
                      ? 'GPS Location Locked'
                      : gps.state === 'locating'
                      ? 'Acquiring GPS Current Location…'
                      : gps.state === 'denied'
                      ? 'GPS Location Denied'
                      : 'GPS Location Unavailable'}
                  </div>
                  <div
                    style={{
                      fontSize: '0.72rem',
                      color: isGpsLocked ? '#166534' : gps.state === 'denied' ? '#991b1b' : '#78350f',
                      fontFamily: isGpsLocked ? 'var(--font-mono)' : 'inherit',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isGpsLocked
                      ? `${gps.fix?.latitude.toFixed(5)}, ${gps.fix?.longitude.toFixed(5)} (±${Math.round(gps.fix?.accuracy ?? 0)}m)`
                      : 'Saving records requires current GPS lock'}
                  </div>
                </div>
              </div>
              {!isGpsLocked && gps.state !== 'locating' && (
                <button
                  type="button"
                  onClick={gps.retry}
                  className="btn btn-outline btn-sm"
                  style={{
                    fontSize: '0.72rem',
                    padding: '4px 10px',
                    borderColor: '#cbd5e1',
                    color: '#334155',
                    borderRadius: 8,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  <Icon name="refresh" size={13} />
                  <span>Retry</span>
                </button>
              )}
            </div>

            {/* Submit Record Action Bar at the Bottom */}
            <div
              style={{
                marginTop: '1rem',
                paddingTop: '1rem',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column-reverse',
                gap: '0.75rem',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleBack}
                disabled={loading || preparingUploads}
                style={{
                  width: '100%',
                  height: '44px',
                  borderRadius: '12px',
                  fontWeight: 600,
                  justifyContent: 'center',
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || preparingUploads || !isGpsLocked}
                style={{
                  width: '100%',
                  minHeight: '50px',
                  padding: '10px 14px',
                  fontSize: '0.92rem',
                  fontWeight: 800,
                  borderRadius: '12px',
                  backgroundColor: !isGpsLocked ? '#94a3b8' : '#FF6467',
                  color: '#ffffff',
                  boxShadow: !isGpsLocked ? 'none' : '0 4px 16px rgba(255, 100, 103, 0.35)',
                  cursor: (loading || preparingUploads || !isGpsLocked) ? 'not-allowed' : 'pointer',
                  opacity: !isGpsLocked ? 0.75 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '3px',
                  boxSizing: 'border-box',
                  transition: 'background-color 0.2s ease, opacity 0.2s ease',
                }}
              >
                {loading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
                    <span>{loadingStage || (editing ? 'Saving changes…' : 'Submitting Audit…')}</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                      <Icon name={isGpsLocked ? "verified_user" : "lock"} size={19} color="#ffffff" />
                      <span>
                        {!isGpsLocked
                          ? (gps.state === 'locating' ? 'Waiting for GPS Lock to Save…' : 'GPS Lock Required to Save')
                          : (editing ? 'Save Changes' : 'Submit Geo-Verified Audit')}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 500, opacity: 0.9, textAlign: 'center', lineHeight: 1.2 }}>
                      {isGpsLocked
                        ? 'Tamper-proof EXIF & GPS hash will be recorded'
                        : 'Record cannot be saved without device GPS lock'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Discard Modal */}
      <Modal
        isOpen={showDiscardModal}
        title="Discard Inspection Record?"
        onClose={() => setShowDiscardModal(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowDiscardModal(false)}
            >
              Keep Editing
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setShowDiscardModal(false);
                onCancel();
              }}
            >
              Discard & Exit
            </button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
          You have unsaved changes and {photos.length} captured photo{photos.length === 1 ? '' : 's'}. If you exit now, this draft will be lost.
        </p>
      </Modal>

      {/* Remove Photo Modal */}
      <Modal
        isOpen={photoToDelete !== null}
        title="Remove Photo?"
        onClose={() => setPhotoToDelete(null)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setPhotoToDelete(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (photoToDelete !== null) {
                  onDeletePhoto(photoToDelete);
                  setPhotoToDelete(null);
                }
              }}
            >
              Delete Photo
            </button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
          Are you sure you want to remove Photo #{photoToDelete !== null ? photoToDelete + 1 : ''}?
        </p>
      </Modal>

      {/* Success Modal */}
      <Modal
        isOpen={savedRecord !== null}
        title="Inspection Saved Successfully!"
        onClose={() => {
          if (savedRecord) onSubmitSuccess(savedRecord);
        }}
        footer={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (savedRecord) onSubmitSuccess(savedRecord);
            }}
          >
            <Icon name="check" size={18} />
            <span>View Saved Record</span>
          </button>
        }
      >
        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: 'var(--color-primary-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem auto',
            }}
          >
            <Icon name="verified" size={32} color="var(--color-primary)" />
          </div>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>
            Record #{savedRecord?.id} Submitted
          </h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            Inspection responses{photos.length ? ` and ${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''} were saved successfully.
          </p>
        </div>
      </Modal>

      {/* Lightbox photo inspector */}
      {lightboxIndex !== null && (
        <Lightbox
          images={photos.map((p, i) => ({
            id: i,
            file_name: `Photo #${i + 1}`,
            photo_order: i + 1,
            latitude: p.latitude,
            longitude: p.longitude,
            location_accuracy: p.accuracy,
            captured_at: new Date(p.capturedAt).toISOString(),
            image_url: p.uri,
          }))}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onSelectIndex={(idx) => setLightboxIndex(idx)}
          imageUrls={photos.reduce<Record<number, string>>((acc, p, i) => {
            acc[i] = p.uri;
            return acc;
          }, {})}
        />
      )}

      {showRefImageModal && sourceRecord?.qc_reference_image_url && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(10, 15, 29, 0.95)',
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={() => setShowRefImageModal(false)}
        >
          <div
            style={{
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: '#fff',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <div>
              <strong style={{ fontSize: '0.9rem', display: 'block' }}>QC Reference Image</strong>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                {sourceRecord.unique_id || `Record #${sourceRecord.id}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowRefImageModal(false)}
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: 'none',
                color: '#fff',
                borderRadius: '50%',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              overflow: 'auto',
            }}
          >
            <img
              src={api.getAuthenticatedImageUrl(sourceRecord.qc_reference_image_url)}
              alt="QC Reference full view"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
