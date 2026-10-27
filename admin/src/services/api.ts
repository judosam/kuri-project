import axios from 'axios';
import type {
  User,
  CaptureRecord,
  AuditStatus,
  DashboardData,
  PaginatedResponse,
  LoginRequest,
  TokenResponse,
  LocationPoint,
  ActivityLog,
} from '../types';

const ENV_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
export const API_BASE = ENV_API_BASE || '/api';
// Base server URL (no /api suffix) — used for constructing image src URLs
export const SERVER_BASE = API_BASE.startsWith('http') ? API_BASE.replace(/\/api$/, '') : '';

const api = axios.create({ baseURL: API_BASE });

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Reset token and notify app on 401 — but never reload the browser window,
// avoiding recursive reload loops if the session is expired or unauthenticated.
api.interceptors.response.use(
  (res) => {
    if (res.headers['x-session-token']) localStorage.setItem('token', res.headers['x-session-token']);
    return res;
  },
  (error) => {
    const reqUrl: string = error.config?.url ?? '';
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      if (typeof window !== 'undefined' && !reqUrl.includes('/auth/')) {
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
    }
    // FastAPI validation errors return detail as an array of objects —
    // flatten to a readable string so no UI renders an object as a React child.
    const detail = error.response?.data?.detail;
    if (Array.isArray(detail)) {
      error.response.data.detail = detail
        .map((d: any) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`)
        .join('; ');
    } else if (detail && typeof detail === 'object') {
      error.response.data.detail = JSON.stringify(detail);
    }
    return Promise.reject(error);
  }
);

// ─── Auth ─────────────────────────────────────────────────────────────
export const authApi = {
  login: async (data: LoginRequest): Promise<TokenResponse> => {
    const res = await api.post('/auth/login', data);
    return res.data;
  },
  logout: async (): Promise<void> => {
    await api.post('/auth/logout').catch(() => {});
  },
  me: async (): Promise<User> => {
    const res = await api.get('/auth/me');
    return res.data;
  },
  updateProfile: async (data: {
    current_password: string;
    new_email?: string;
    new_password?: string;
    full_name?: string;
  }): Promise<{ user: User; access_token: string; message: string }> => {
    const res = await api.put('/auth/profile', data);
    return res.data;
  },
};

// ─── Dashboard ────────────────────────────────────────────────────────
export const dashboardApi = {
  get: async (params: {
    date_from?: string;
    date_to?: string;
    status?: string;
    preset?: string;
    custom_from?: string;
    custom_to?: string;
    district?: string;
  } = {}): Promise<DashboardData> => {
    const res = await api.get('/admin/dashboard', { params });
    return res.data;
  },
};

// ─── Users ────────────────────────────────────────────────────────────
export const usersApi = {
  delete: async (id: number): Promise<void> => {
    await api.delete(`/admin/users/${id}`);
  },
  list: async (params: {
    page?: number;
    page_size?: number;
    search?: string;
    is_active?: boolean;
  }): Promise<PaginatedResponse<User>> => {
    const res = await api.get('/admin/users', { params });
    return res.data;
  },
  get: async (id: number): Promise<User> => {
    const res = await api.get(`/admin/users/${id}`);
    return res.data;
  },
  create: async (data: {
    email: string;
    password?: string;
    full_name: string;
    role?: string;
  }): Promise<User> => {
    const res = await api.post('/admin/users', data);
    return res.data;
  },
  update: async (id: number, data: Partial<User>): Promise<User> => {
    const res = await api.put(`/admin/users/${id}`, data);
    return res.data;
  },
  activate: async (id: number): Promise<User> => {
    const res = await api.post(`/admin/users/${id}/activate`);
    return res.data;
  },
  deactivate: async (id: number): Promise<User> => {
    const res = await api.post(`/admin/users/${id}/deactivate`);
    return res.data;
  },
  resetPassword: async (id: number, newPassword?: string, mustChangePassword?: boolean): Promise<{ id: number; user_id: number; email: string; temporary_password: string; message: string; must_change_password: boolean }> => {
    const payload: { new_password?: string; must_change_password?: boolean } = {};
    if (newPassword) payload.new_password = newPassword;
    if (mustChangePassword !== undefined) payload.must_change_password = mustChangePassword;
    const res = await api.post(`/admin/users/${id}/reset-password`, Object.keys(payload).length > 0 ? payload : undefined);
    return res.data;
  },
  promoteSuperAdmin: async (id: number): Promise<User> => {
    const res = await api.post(`/admin/users/${id}/promote-superadmin`);
    return res.data;
  },
};

// ─── Records ──────────────────────────────────────────────────────────
export const recordsApi = {
  assignmentOperators: async (): Promise<User[]> => (await api.get('/admin/assignment-operators')).data,
  downloadRecord: async (recordId: number): Promise<void> => {
    const response = await api.get(`/admin/records/${recordId}/export`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a'); a.href = url; a.download = `Record_${recordId}_full.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  list: async (params: {
    page?: number;
    page_size?: number;
    status?: string;
    search?: string;
    user_id?: number;
    assigned_auditor_id?: number;
    unassigned_user?: boolean;
    unassigned_auditor?: boolean;
    date_from?: string;
    date_to?: string;
    sort_by?: string;
    sort_order?: string;
    date_field?: string;
    audit_status?: string;
    qc_status?: 'DONE' | 'PENDING';
    column_filters?: string;
  }): Promise<PaginatedResponse<CaptureRecord>> => {
    const res = await api.get('/admin/records', { params });
    return res.data;
  },
  filterOptions: async (field: string, params: Record<string, unknown> = {}, choice_search = ''): Promise<{ options: { value: string; label: string; count: number }[]; truncated: boolean }> => {
    const res = await api.get('/admin/records/filter-options', { params: { ...params, field, choice_search } });
    return res.data;
  },
  qaDashboard: async (params: Record<string, unknown> = {}): Promise<{ total: number; done: number; pending: number; completion_rate: number; categories: { label: string; count: number }[] }> => {
    const res = await api.get('/admin/qa-dashboard', { params }); return res.data;
  },
  saveQc: async (id: number, data: { qc_vhr_comment: string; qc_street_details: string; qc_builder_contact: string; qc_sqfeet?: string; assigned_auditor_id?: number | null }): Promise<CaptureRecord> => {
    const res = await api.patch(`/admin/records/${id}/qc`, data); return res.data;
  },
  uploadQcReferenceImage: async (id: number, file: File | Blob): Promise<CaptureRecord> => {
    const formData = new FormData();
    formData.append('file', file, file instanceof File ? file.name : 'qc_reference.jpg');
    const res = await api.post(`/admin/records/${id}/qc-reference-image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },
  deleteQcReferenceImage: async (id: number): Promise<CaptureRecord> => {
    const res = await api.delete(`/admin/records/${id}/qc-reference-image`);
    return res.data;
  },
  get: async (id: number): Promise<CaptureRecord> => {
    const res = await api.get(`/admin/records/${id}`);
    return res.data;
  },
  /** Resolve the Google Geocoding addresses from the captured GPS and the admin coordinates. */
  resolveAddress: async (
    id: number,
    force = false
  ): Promise<{
    resolved: boolean;
    address?: string;
    admin_address?: string;
    place_name?: string;
    error?: string;
  }> => {
    const res = await api.post(`/admin/records/${id}/resolve-address`, null, { params: { force } });
    return res.data;
  },
  update: async (
    id: number,
    data: Partial<
      Pick<
        CaptureRecord,
        | 'name'
        | 'description'
        | 'status'
        | 'unique_id'
        | 'coordinates'
        | 'street_address'
        | 'land_use'
        | 'survey_no'
        | 'subdivision_no'
        | 'owner_name_en'
        | 'site_address'
        | 'survey_number'
        | 'sub_division'
        | 'taluk'
        | 'village'
        | 'district'
        | 'date_of_visit'
        | 'construction_happening'
        | 'remarks'
        | 'type_of_construction'
        | 'relationship_with_building'
        | 'building_user_name'
        | 'contact_number'
        | 'stage_of_construction'
        | 'no_of_floors'
        | 'built_up_area'
        | 'expected_completion'
        | 'site_contractor_architect_name'
        | 'site_contractor_architect_number'
        | 'spoken_with'
        | 'audit_status'
        | 'audit_comment'
        | 'assigned_auditor_id'
        | 'qc_vhr_comment'
        | 'qc_street_details'
        | 'qc_builder_contact'
        | 'qc_sqfeet'
        | 'qc_reference_image_key'
        | 'qc_reference_image_url'
        | 'assigned_telecaller_id'
        | 'telecaller_status'
        | 'telecaller_comment'
        | 'follow_up_date'
      >
    >
  ): Promise<CaptureRecord> => {
    const res = await api.put(`/admin/records/${id}`, data);
    return res.data;
  },
  delete: async (id: number): Promise<void> => {
    await api.delete(`/admin/records/${id}`);
  },
  reassign: async (data: {
    record_ids: number[];
    target_user_id: number;
  }): Promise<{
    success: boolean;
    reassigned_count: number;
    skipped_completed_count: number;
    target_user_id: number;
    target_user_name: string;
    message: string;
  }> => {
    const res = await api.post('/admin/records/reassign', data);
    return res.data;
  },
  getImages: async (id: number) => {
    const res = await api.get(`/admin/records/${id}/images`);
    return res.data;
  },
  /** Auditor decision on a staged record (PATCH /admin/records/{id}/audit). */
  audit: async (
    id: number,
    audit_status: AuditStatus,
    audit_comment?: string | null,
    qc?: { qc_vhr_comment?: string | null; qc_street_details?: string | null; qc_builder_contact?: string | null; qc_sqfeet?: string | null; coordinates?: string | null; assigned_auditor_id?: number | null }
  ): Promise<CaptureRecord> => {
    // Back-compat: callers may still pass the decision as a 5th element object.
    const res = await api.patch(`/admin/records/${id}/audit`, {
      audit_status,
      audit_comment: audit_comment ?? null,
      ...(qc ? {
        qc_vhr_comment: qc.qc_vhr_comment ?? null,
        qc_street_details: qc.qc_street_details ?? null,
        qc_builder_contact: qc.qc_builder_contact ?? null,
        qc_sqfeet: qc.qc_sqfeet ?? null,
        coordinates: qc.coordinates ?? undefined,
        assigned_auditor_id: qc.assigned_auditor_id !== undefined ? qc.assigned_auditor_id : undefined,
      } : {}),
    });
    return res.data;
  },
  /** Bulk audit decision on selected records (POST /admin/records/bulk-audit). */
  bulkAudit: async (
    recordIds: number[],
    auditStatus: AuditStatus,
    auditComment?: string | null
  ): Promise<{ success: boolean; audited_count: number; skipped_count: number; audit_status: string; message: string }> => {
    const res = await api.post('/admin/records/bulk-audit', {
      record_ids: recordIds,
      audit_status: auditStatus,
      audit_comment: auditComment ?? null,
    });
    return res.data;
  },
  /** Bulk update verification status (POST /admin/records/bulk-status). */
  bulkUpdateStatus: async (
    recordIds: number[],
    status: string,
    remarks?: string | null
  ): Promise<{ success: boolean; updated_count: number; skipped_count: number; status: string; message: string }> => {
    const res = await api.post('/admin/records/bulk-status', {
      record_ids: recordIds,
      status,
      remarks: remarks ?? null,
    });
    return res.data;
  },
  /** Street View capture info (month/year photographed) for a coordinate. */
  streetViewMeta: async (latitude: number, longitude: number): Promise<{
    available: boolean;
    month_year?: string | null;
    captured_at?: string | null;
    copyright?: string | null;
    message?: string | null;
  }> => {
    const res = await api.get('/location/streetview-meta', { params: { latitude, longitude } });
    return res.data;
  },
  /** Directory of active auditors for the route-to-auditor bulk action. */
  auditors: async (): Promise<{ id: number; full_name: string; email: string; role: string }[]> => {
    const res = await api.get('/admin/auditors');
    return res.data;
  },
  /** Record Assigner: route staged records to an auditor for review. */
  assignAuditor: async (recordIds: number[], auditorId: number): Promise<{ success: boolean; reassigned_count: number; skipped_completed_count: number; target_user_name: string; message: string }> => {
    const res = await api.post('/admin/records/assign-auditor', { record_ids: recordIds, auditor_id: auditorId });
    return res.data;
  },
  /** Record Assigner: release auditor-approved records to a field verifier. */
  assignVerifier: async (recordIds: number[], verifierId: number): Promise<{ success: boolean; reassigned_count: number; skipped_completed_count: number; target_user_name: string; message: string }> => {
    const res = await api.post('/admin/records/assign-verifier', { record_ids: recordIds, verifier_id: verifierId });
    return res.data;
  },
  /** Bulk unassign field verifiers from records. */
  unassignVerifier: async (recordIds: number[]): Promise<{ success: boolean; unassigned_count: number; skipped_count: number; message: string }> => {
    const res = await api.post('/admin/records/unassign-verifier', { record_ids: recordIds });
    return res.data;
  },
  /** Bulk unassign auditors from records. */
  unassignAuditor: async (recordIds: number[]): Promise<{ success: boolean; unassigned_count: number; skipped_count: number; message: string }> => {
    const res = await api.post('/admin/records/unassign-auditor', { record_ids: recordIds });
    return res.data;
  },
  /** List active telecallers. */
  telecallers: async (): Promise<{ id: number; full_name: string; email: string; role: string }[]> => {
    const res = await api.get('/admin/telecallers');
    return res.data;
  },
  /** Assign records to a telecaller. */
  assignTelecaller: async (recordIds: number[], telecallerId: number): Promise<{ success: boolean; reassigned_count: number; skipped_completed_count: number; target_user_name: string; message: string }> => {
    const res = await api.post('/admin/records/assign-telecaller', { record_ids: recordIds, telecaller_id: telecallerId });
    return res.data;
  },
  /** Bulk unassign telecaller from records. */
  unassignTelecaller: async (recordIds: number[]): Promise<{ success: boolean; unassigned_count: number; skipped_count: number; message: string }> => {
    const res = await api.post('/admin/records/unassign-telecaller', { record_ids: recordIds });
    return res.data;
  },
  uploadSheet: async (
    file: File,
    mode: 'dispatch' | 'history' = 'dispatch'
  ): Promise<{
    success: boolean;
    total_rows: number;
    total_dispatched: number;
    failed_count: number;
    sheet_name: string;
    mode: string;
    errors: Array<{ row: number; column: string; message: string }>;
    dispatched_tasks?: Array<{
      record_id: number;
      unique_id: string;
      operator_email: string;
      operator_name: string;
      site_address: string;
    }>;
    record_coordinates?: Record<string, string>;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', mode);
    // Note: Do NOT set 'Content-Type': 'multipart/form-data' manually.
    // Axios will automatically attach the correct boundary string.
    const res = await api.post('/admin/records/upload-sheet', formData, {
      timeout: 180000,
    });
    return res.data;
  },
  /**
   * Upload task sheet with live NDJSON streaming progress updates.
   * Streams row-by-row progress and village resolution status in real time.
   */
  uploadSheetStream: async (
    file: File,
    mode = 'dispatch',
    onProgress?: (event: {
      type: 'init' | 'progress' | 'row_error' | 'done';
      row_index?: number;
      total_rows?: number;
      percent?: number;
      record_id?: number;
      unique_id?: string;
      name?: string;
      village?: string;
      taluk?: string;
      district?: string;
      auto_resolved?: boolean;
      resolution_method?: string | null;
      status?: string;
      sheet_name?: string;
      filename?: string;
      error?: { row: number; column: string; message: string };
      result?: any;
    }) => void
  ): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', mode);

    const token = localStorage.getItem('token') || '';
    const endpoint = `${API_BASE}/admin/records/upload-sheet-stream`;

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      let errDetail = 'Failed to upload sheet.';
      try {
        const errJson = await response.json();
        errDetail = errJson.detail || errDetail;
      } catch {
        // ignore
      }
      throw new Error(errDetail);
    }

    if (!response.body) {
      throw new Error('Streaming response body is not readable.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (onProgress) {
            onProgress(event);
          }
          if (event.type === 'done' && event.result) {
            finalResult = event.result;
          }
        } catch {
          // ignore unparseable chunk
        }
      }
    }

    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        if (onProgress) onProgress(event);
        if (event.type === 'done' && event.result) finalResult = event.result;
      } catch {
        // ignore
      }
    }

    if (!finalResult) {
      throw new Error('Import stream ended without receiving completion confirmation.');
    }

    return finalResult;
  },
  /**
   * Attach admin-uploaded photos to an imported (old) record. The backend runs
   * each photo through the same watermark engine the field app uses and appends
   * the new frames after any existing ones.
   */
  uploadImportedPhotos: async (recordId: number, files: File[]): Promise<CaptureRecord> => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    const res = await api.post(`/admin/records/${recordId}/photos`, formData, { timeout: 300000 });
    return res.data;
  },
  /** Upload photos for an existing record (watermarked server-side, names like Record_12_Photo_1.jpg). */
  uploadRecordPhotos: async (
    recordId: number,
    files: File[],
    coords?: string
  ): Promise<{ success: boolean; errors?: string[] }> => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    if (coords && coords.trim()) {
      const [lat, lng] = coords.split(',').map((s) => s.trim());
      if (lat && lng) {
        formData.append('latitudes', lat);
        formData.append('longitudes', lng);
      }
    }
    formData.append('sources', files.map(() => 'uploaded').join(','));
    await api.post(`/records/${recordId}/upload`, formData, { timeout: 300000 });
    return { success: true };
  },
  downloadTemplate: async (): Promise<void> => {
    const token = localStorage.getItem('token');
    const url = `${SERVER_BASE}/api/admin/records/template`;
    const resp = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) throw new Error('Failed to download template');
    const blob = await resp.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'task_dispatch_template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(blobUrl);
  },
  downloadTemplateUrl: (): string => `${SERVER_BASE}/api/admin/records/template`,
  downloadExport: async (params?: {
    status?: string;
    user_id?: number;
    assigned_auditor_id?: number;
    unassigned_user?: boolean;
    unassigned_auditor?: boolean;
    search?: string;
    date_from?: string;
    date_to?: string;
    date_field?: string;
    audit_status?: string;
    qc_status?: string;
    column_filters?: string;
    include_images?: boolean;
    sections?: string;
  }): Promise<void> => {
    const token = localStorage.getItem('token');
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.user_id) sp.set('user_id', String(params.user_id));
    if (params?.assigned_auditor_id) sp.set('assigned_auditor_id', String(params.assigned_auditor_id));
    if (params?.unassigned_user) sp.set('unassigned_user', 'true');
    if (params?.unassigned_auditor) sp.set('unassigned_auditor', 'true');
    if (params?.search) sp.set('search', params.search);
    if (params?.date_from) sp.set('date_from', params.date_from);
    if (params?.date_to) sp.set('date_to', params.date_to);
    if (params?.date_field) sp.set('date_field', params.date_field);
    if (params?.audit_status) sp.set('audit_status', params.audit_status);
    if (params?.qc_status) sp.set('qc_status', params.qc_status);
    if (params?.column_filters) sp.set('column_filters', params.column_filters);
    if (params?.include_images !== undefined) sp.set('include_images', String(params.include_images));
    if (params?.sections) sp.set('sections', params.sections);
    const url = `${SERVER_BASE}/api/admin/records/export${sp.toString() ? `?${sp.toString()}` : ''}`;
    const resp = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) {
      let detail = 'Failed to export report';
      try {
        const errJson = await resp.json();
        detail = errJson.detail || detail;
      } catch {}
      throw new Error(detail);
    }
    const blob = await resp.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    let filename = `field_inspections_report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const disposition = resp.headers.get('content-disposition');
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename=["']?([^"';]+)["']?/);
      if (match && match[1]) filename = match[1];
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(blobUrl);
  },
  /** Full URL to serve an image through the admin endpoint (auth-protected). */
  imageUrl: (recordId: number, imageId: number): string =>
    `${SERVER_BASE}/api/admin/records/${recordId}/image/${imageId}`,
  logDownload: async (recordId: number, imageId: number): Promise<void> => {
    await api.post(`/admin/records/${recordId}/image/${imageId}/log-download`);
  },
};

// ─── Import Previous Records (old field work, backfilled by an admin) ──
export interface PreviousRecordPreviewRow {
  row: number;
  valid: boolean;
  operator_email: string;
  operator_name: string;
  unique_id: string;
  visit_order?: number | null;
  site_address: string;
  street_address: string;
  survey_no: string;
  subdivision_no: string;
  owner_name_en: string;
  taluk: string;
  village: string;
  district: string;
  land_use: string;
  coordinates: string;
  date_of_visit: string;
  construction_happening: string;
  remarks: string;
  errors: Array<{ column: string; message: string }>;
}

export interface PreviousRecordsPreview {
  success: boolean;
  sheet_name: string;
  total_rows: number;
  valid_count: number;
  invalid_count: number;
  preview_truncated: boolean;
  rows: PreviousRecordPreviewRow[];
  errors: Array<{ row: number; column: string; message: string }>;
}

export interface PreviousRecordsImportReport {
  success: boolean;
  imported_count: number;
  skipped_count: number;
  total_rows: number;
  sheet_name: string;
  records: Array<{
    record_id: number;
    row: number;
    unique_id: string;
    operator_email: string;
    operator_name: string;
    site_address: string;
    coordinates: string;
  }>;
  errors: Array<{ row: number; column: string; message: string }>;
}

export const previousRecordsApi = {
  downloadTemplate: async (): Promise<void> => {
    const response = await api.get('/admin/records/import-previous/template', { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a'); a.href = url; a.download = 'previous_records_template.xlsx'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  /** Validate the sheet row-by-row without writing anything. */
  preview: async (file: File): Promise<PreviousRecordsPreview> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post('/admin/records/import-previous/preview', formData, {
      timeout: 180000,
    });
    return res.data;
  },
  /** Import the valid rows into the existing records table. */
  commit: async (file: File): Promise<PreviousRecordsImportReport> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post('/admin/records/import-previous/commit', formData, {
      timeout: 300000,
    });
    return res.data;
  },
};

// ─── Locations ────────────────────────────────────────────────────────
export interface LocationFilterParams {
  date_from?: string;
  date_to?: string;
  record_search?: string;
  location_search?: string;
  user_id?: number;
}

export const locationsApi = {
  list: async (params: LocationFilterParams = {}): Promise<LocationPoint[]> => {
    const res = await api.get('/admin/locations', { params });
    return res.data;
  },
};

// ─── Activity logs ───────────────────────────────────────────────────
export const logsApi = {
  list: async (params: {
    entry_type?: string;
    user_id?: number;
    limit?: number;
  } = {}): Promise<ActivityLog> => {
    const res = await api.get('/admin/logs', { params });
    return res.data;
  },
};

// ─── Telecaller ───────────────────────────────────────────────────────
export interface TelecallerDashboardData {
  metrics: {
    total_eligible: number;
    total_assigned: number;
    pending_calls: number;
    construction_confirmed: number;
    connected_follow_up: number;
    not_reachable: number;
    wrong_number: number;
    called_today: number;
  };
  recent_calls: CaptureRecord[];
}

export const telecallerApi = {
  getRecords: async (params: {
    page?: number;
    page_size?: number;
    search?: string;
    telecaller_status?: string;
    filter_assigned?: string;
  } = {}): Promise<{ records: CaptureRecord[]; total: number; page: number; page_size: number }> => {
    const res = await api.get('/telecaller/records', { params });
    return res.data;
  },
  getRecord: async (id: number): Promise<CaptureRecord> => {
    const res = await api.get(`/telecaller/records/${id}`);
    return res.data;
  },
  saveFeedback: async (id: number, data: {
    telecaller_status: string;
    telecaller_comment?: string;
    no_of_floors?: string;
    expected_completion?: string;
    built_up_area?: string;
    stage_of_construction?: string;
    follow_up_date?: string;
    overwrite_comment?: boolean;
  }): Promise<CaptureRecord> => {
    const res = await api.post(`/telecaller/records/${id}/feedback`, data);
    return res.data;
  },
  getDashboard: async (): Promise<TelecallerDashboardData> => {
    const res = await api.get('/telecaller/dashboard');
    return res.data;
  },
};

export default api;
