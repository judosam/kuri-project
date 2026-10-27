import type { CaptureRecord, DashboardStats, InspectionFormData, User } from '../types';

const TOKEN_KEY = 'photocapture_user_token';

export interface RoadRoutePlan {
  travel_mode: 'TWO_WHEELER' | 'DRIVE';
  ordering: 'nearest_from_origin';
  provider?: 'ors' | 'gmap';
  provider_label?: string;
  stops: Array<{
    record_id: number;
    stop_order: number;
    leg_distance_meters: number | null;
    leg_duration_seconds: number | null;
    distance_from_origin_meters: number | null;
    duration_from_origin_seconds: number | null;
  }>;
  unrouted: Array<{ record_id: number; reason: string }>;
}

export const DEFAULT_API_BASE = '/api';

class ApiService {
  private baseUrl: string = DEFAULT_API_BASE;

  constructor() {
    // Clean up any stale custom server URL override from previous sessions
    try {
      localStorage.removeItem('photocapture_user_server');
    } catch {
      // ignore
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  }

  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        cache: 'no-store',
        headers,
      });
    } catch (err: any) {
      throw new Error(`Network error: Could not reach server. ${err?.message || ''}`);
    }

    const sessionToken = response.headers.get('X-Session-Token');
    if (response.ok && sessionToken) this.setToken(sessionToken);
    if (response.status === 401) {
      if (path === '/auth/login') {
        const err = await response.json().catch(() => ({ detail: 'Invalid email or password' }));
        throw new Error(err.detail || 'Invalid email or password');
      }
      this.clearToken();
      window.dispatchEvent(new CustomEvent('auth:expired'));
      throw new Error('Session expired. Please sign in again.');
    }

    if (response.status === 204) {
      return {} as T;
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
      let detailMsg = `Request failed with status ${response.status}`;
      if (typeof err.detail === 'string') {
        detailMsg = err.detail;
      } else if (Array.isArray(err.detail)) {
        detailMsg = err.detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ');
      }
      throw new Error(detailMsg);
    }

    return response.json();
  }

  // Auth
  async login(email: string, password: string): Promise<{ access_token: string; must_change_password?: boolean }> {
    const res = await this.request<{ access_token: string; must_change_password?: boolean }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    this.setToken(res.access_token);
    return res;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network failures on logout
    } finally {
      this.clearToken();
    }
  }

  async getMe(): Promise<User> {
    return this.request<User>('/auth/me');
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
    return this.request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  }

  async updateProfilePassword(currentPassword: string, newPassword: string): Promise<any> {
    return this.request<any>('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  }

  // Records & Dashboard
  async planRoadRoute(
    origin: { latitude: number; longitude: number },
    recordIds: number[],
    provider: 'ors' | 'gmap' = 'ors',
  ): Promise<RoadRoutePlan> {
    return this.request<RoadRoutePlan>('/location/route', {
      method: 'POST',
      body: JSON.stringify({ origin, record_ids: recordIds, provider }),
    });
  }

  async getDashboard(params: { dateFrom?: string; dateTo?: string; status?: string } = {}): Promise<DashboardStats> {
    const sp = new URLSearchParams();
    if (params.dateFrom) sp.set('date_from', params.dateFrom);
    if (params.dateTo) sp.set('date_to', params.dateTo);
    if (params.status && params.status !== 'ALL') sp.set('status', params.status);
    return this.request<DashboardStats>(`/records/dashboard?${sp}`);
  }

  async listRecords(params: {
    page?: number;
    pageSize?: number;
    status?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    dateField?: string;
    district?: string;
    taluk?: string;
    village?: string | string[];
    sortBy?: string;
    sortOrder?: string;
  }): Promise<{ records: CaptureRecord[]; total: number; page: number; page_size: number }> {
    const sp = new URLSearchParams();
    if (params.page) sp.set('page', String(params.page));
    if (params.pageSize) sp.set('page_size', String(params.pageSize));
    if (params.status && params.status !== 'ALL') sp.set('status', params.status);
    if (params.search) sp.set('search', params.search);
    if (params.dateFrom) sp.set('date_from', params.dateFrom);
    if (params.dateTo) sp.set('date_to', params.dateTo);
    if (params.dateField) sp.set('date_field', params.dateField);
    if (params.district) sp.set('district', params.district);
    if (params.taluk) sp.set('taluk', params.taluk);
    if (params.village) sp.set('village', Array.isArray(params.village) ? params.village.join(',') : params.village);
    if (params.sortBy) sp.set('sort_by', params.sortBy);
    if (params.sortOrder) sp.set('sort_order', params.sortOrder);

    return this.request<{ records: CaptureRecord[]; total: number; page: number; page_size: number }>(
      `/records?${sp.toString()}`
    );
  }

  async recordLocationOptions(district = '', taluk = '', status = ''): Promise<{ district: string[]; taluk: string[]; village: string[]; village_counts?: { name: string; count: number }[] }> {
    const params = new URLSearchParams();
    if (district) params.set('district', district);
    if (taluk) params.set('taluk', taluk);
    if (status && status !== 'ALL') params.set('status', status);
    return this.request(`/records/filter-options?${params}`);
  }

  async getRecord(id: number): Promise<CaptureRecord> {
    return this.request<CaptureRecord>(`/records/${id}`);
  }

  /** Load the entire filtered pending set before ranking, including later pages. */
  async listPendingForRoute(filters: { search?: string; dateFrom?: string; dateTo?: string; district?: string; taluk?: string; village?: string | string[] } = {}): Promise<CaptureRecord[]> {
    const collected = new Map<number, CaptureRecord>();
    let expectedTotal: number | undefined;
    for (let page = 1; ; page++) {
      const response = await this.listRecords({ ...filters, page, pageSize: 100,
        status: 'NOT_COMPLETED', dateField: 'assigned_at', sortBy: 'id', sortOrder: 'asc' });
      if (response.total > 1000) {
        throw new Error('Route supports up to 1,000 pending records. Narrow the date or search filters and try again.');
      }
      if (expectedTotal !== undefined && expectedTotal !== response.total) {
        throw new Error('Your pending records changed while loading. Click Route again.');
      }
      expectedTotal = response.total;
      const previousSize = collected.size;
      response.records.forEach(record => collected.set(record.id, record));
      if (collected.size === expectedTotal) return [...collected.values()];
      if (collected.size <= previousSize || collected.size > expectedTotal || page >= 10) {
        throw new Error('Could not load all pending records. Click Route to retry.');
      }
    }
  }

  /** Resolve the Google Geocoding addresses from the captured GPS and the admin coordinates. */
  async resolveRecordAddress(id: number): Promise<{
    resolved: boolean;
    address?: string;
    admin_address?: string;
    place_name?: string;
    error?: string;
  }> {
    return this.request<{
      resolved: boolean;
      address?: string;
      admin_address?: string;
      place_name?: string;
      error?: string;
    }>(`/records/${id}/resolve-address`, { method: 'POST' });
  }

  async markRecordStatus(
    id: number,
    data: {
      status: string;
      remarks?: string;
      field_latitude?: number;
      field_longitude?: number;
      field_location_accuracy?: number;
    }
  ): Promise<CaptureRecord> {
    return this.request<CaptureRecord>(`/records/${id}/mark-status`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** Resolve a live device GPS fix to a place name (dashboard GNSS bar). */
  async reverseGeocode(
    latitude: number,
    longitude: number
  ): Promise<{ resolved: boolean; place_name?: string; address?: string; error?: string }> {
    return this.request<{ resolved: boolean; place_name?: string; address?: string; error?: string }>(
      `/location/reverse-geocode?latitude=${latitude}&longitude=${longitude}`
    );
  }

  async createRecord(payload: {
    name: string;
    description: string;
    photos: Array<{
      latitude: number;
      longitude: number;
      location_accuracy: number;
      captured_at: number;
      file_name: string;
    }>;
    /** Device GPS fix sent when completing WITHOUT photos. */
    fieldGps?: { latitude: number; longitude: number; location_accuracy: number; captured_at: number };
    inspectionData?: Partial<InspectionFormData>;
    taskId?: number;
    /** Only sent when the admin left the owner name blank on the task. */
    ownerName?: string;
  }): Promise<CaptureRecord> {
    return this.request<CaptureRecord>('/records', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        description: payload.description,
        status: 'COMPLETED',
        task_id: payload.taskId,
        ...(payload.ownerName ? { owner_name_en: payload.ownerName } : {}),
        photos: payload.photos.map((p) => ({
          ...p,
          captured_at: new Date(p.captured_at).toISOString(),
        })),
        ...(payload.fieldGps
          ? {
              field_gps: {
                latitude: payload.fieldGps.latitude,
                longitude: payload.fieldGps.longitude,
                location_accuracy: payload.fieldGps.location_accuracy,
                captured_at: new Date(payload.fieldGps.captured_at).toISOString(),
              },
            }
          : {}),
        ...(payload.inspectionData || {}),
      }),
    });
  }

  async uploadRecordImages(
    recordId: number,
    photos: Array<{
      blob: Blob;
      latitude: number;
      longitude: number;
      accuracy: number;
      capturedAt: number;
      source?: 'camera' | 'uploaded';
    }>,
    onProgress?: (percent: number) => void
  ): Promise<any> {
    if (!photos.length) return {};
    const token = this.getToken();
    const formData = new FormData();

    photos.forEach((photo, idx) => {
      formData.append('files', photo.blob, `photo_${idx + 1}.jpg`);
    });

    formData.append('sources', photos.map((p) => p.source || 'camera').join(','));
    formData.append('latitudes', photos.map((p) => p.latitude).join(','));
    formData.append('longitudes', photos.map((p) => p.longitude).join(','));
    formData.append('accuracies', photos.map((p) => p.accuracy).join(','));
    formData.append(
      'captured_ats',
      photos.map((p) => new Date(p.capturedAt).toISOString()).join(',')
    );

    const url = `${this.baseUrl}/records/${recordId}/upload`;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);

      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            const pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
            onProgress(pct);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const json = JSON.parse(xhr.responseText);
            resolve(json);
          } catch {
            resolve({});
          }
        } else {
          let errorMsg = `Upload failed (HTTP ${xhr.status})`;
          try {
            const errJson = JSON.parse(xhr.responseText);
            if (errJson.detail) {
              errorMsg = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
            }
          } catch {
            // fallback
          }
          reject(new Error(errorMsg));
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error: Could not reach server during upload.'));
      };

      xhr.send(formData);
    });
  }

  async downloadRecord(recordId: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/records/${recordId}/download`, { headers: { Authorization: `Bearer ${this.getToken()}` } });
    if (!response.ok) throw new Error('Could not download the record. Please retry.');
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a'); a.href = url; a.download = `Record_${recordId}_full.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async fetchImageAsDataUri(imageUrl: string): Promise<string> {
    const token = this.getToken();
    const url = imageUrl.startsWith('http')
      ? imageUrl
      : `${this.baseUrl.replace(/\/api$/, '')}${imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`}`;

    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`Could not load image (HTTP ${resp.status})`);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  }

  getAuthenticatedImageUrl(imageUrl?: string | null, thumb: boolean = false): string | undefined {
    if (!imageUrl) return undefined;
    const token = this.getToken();
    let cleanUrl = imageUrl;
    if (!cleanUrl.startsWith('http') && !cleanUrl.startsWith('/api')) {
      cleanUrl = cleanUrl.startsWith('/') ? `/api${cleanUrl}` : `/api/${cleanUrl}`;
    }
    if (thumb) {
      cleanUrl += cleanUrl.includes('?') ? '&thumb=true' : '?thumb=true';
    }
    if (!token) return cleanUrl;
    const sep = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${sep}token=${encodeURIComponent(token)}`;
  }

  async checkHealth(): Promise<boolean> {
    try {
      // 1. Try /api/health
      const res1 = await fetch(`${this.baseUrl}/health`, { method: 'GET' }).catch(() => null);
      if (res1 && res1.ok) return true;

      // 2. Try root /health
      const target = this.baseUrl.replace(/\/api\/?$/, '');
      const url = target ? `${target}/health` : '/health';
      const res2 = await fetch(url, { method: 'GET' }).catch(() => null);
      return Boolean(res2 && res2.ok);
    } catch {
      return false;
    }
  }
}

export const api = new ApiService();
