export interface User {
  id: number;
  email: string;
  full_name: string;
  role: 'USER' | 'ADMIN' | 'MANAGER' | 'FIELD_VERIFIER' | 'AUDITOR';
  must_change_password?: boolean;
  last_login_at?: string;
  created_at?: string;
}

export interface ImageData {
  id: number;
  file_name: string;
  photo_order: number;
  source?: 'camera' | 'uploaded';
  latitude: number;
  longitude: number;
  location_accuracy: number;
  captured_at: string;
  image_url?: string;
}

export interface CaptureRecord {
  is_manually_added?: boolean;
  source?: string;
  id: number;
  name: string;
  description: string;
  location_name?: string;
  formatted_address?: string;
  /** Address resolved from the admin-given coordinates. */
  admin_formatted_address?: string;
  place_id?: string;
  status: 'COMPLETED' | 'NOT_COMPLETED' | 'Updated Revisited' | 'UPDATED_REVISITED' | string;
  created_at: string;
  assigned_at?: string;
  assigned_date?: string;
  updated_at?: string;
  user_id: number;
  user_name?: string;
  /** GPS fix stored when the inspection was completed WITHOUT photos. */
  field_latitude?: number | null;
  field_longitude?: number | null;
  field_location_accuracy?: number | null;
  field_captured_at?: string | null;
  images: ImageData[];

  // 15 Planning fields
  visit_order?: number;
  unique_id?: string;
  coordinates?: string;
  street_address?: string;
  land_use?: string;
  survey_no?: string;
  subdivision_no?: string;
  owner_name_en?: string;
  site_address?: string;
  survey_number?: string;
  sub_division?: string;
  taluk?: string;
  village?: string;
  district?: string;

  // 9 Field Inspection fields
  date_of_visit?: string;
  construction_happening?: string; // "Yes" | "No"
  stage_of_construction?: string;
  no_of_floors?: string | null;
  expected_completion?: string | null;
  built_up_area?: string | null;
  type_of_construction?: string;
  relationship_with_building?: string;
  building_user_name?: string;
  contact_number?: string;
  site_contractor_architect_name?: string;
  site_contractor_architect_number?: string;
  spoken_with?: string | null;
  remarks?: string;

  // GIS & Deduplication Proximity fields
  latitude?: number | null;
  longitude?: number | null;
  is_duplicate?: boolean;
  duplicate_warning?: string | null;
  duplicate_site_id?: string | null;
  duplicate_record_id?: number | null;
  duplicate_distance_m?: number | null;
  duplicate_is_visited?: boolean;

  // Deviation metrics
  deviation_meters?: number | null;
  deviation_formatted?: string | null;
  deviation_status?: string | null;

  /** Saved Google Maps satellite snapshot (downloaded at import, then cached). */
  gmap_image_url?: string | null;
  gmap_zoom?: number | null;
  gmap_captured_at?: string | null;

  // QC Assessment fields (Desk Review / VHR imagery & Street View)
  qc_vhr_comment?: string | null;
  qc_street_details?: string | null;
  qc_builder_contact?: string | null;
  qc_sqfeet?: string | null;
  qc_reference_image_key?: string | null;
  qc_reference_image_url?: string | null;
  qc_by_id?: number | null;
  qc_by_name?: string | null;
  qc_completed_at?: string | null;
  qc_edited_at?: string | null;

  // Audit & QA fields
  audit_status?: 'PENDING' | 'APPROVAL' | 'DISAPPROVAL' | 'COMMERCIAL_PROPERTY' | 'RE_AUDITED';
  audit_comment?: string | null;
  audited_by_id?: number | null;
  audited_by_name?: string | null;
  audited_at?: string | null;
  assigned_auditor_id?: number | null;
  assigned_auditor_name?: string | null;

  // Reassign & Revisit fields
  reassigned_to_id?: number | null;
  reassigned_to_name?: string | null;
  reassigned_at?: string | null;
  revisit_status?: string | null;
  updated_coordinates?: string | null;
  updated_information?: string | null;
  follow_up_date?: string | null;
  qc_history?: any[];
  field_history?: any[];
  telecaller_history?: any[];
}

export interface InspectionFormData {
  date_of_visit: string;
  construction_happening: 'Yes' | 'No';
  stage_of_construction: string;
  custom_stage?: string;
  no_of_floors?: string;
  built_up_area?: string;
  expected_completion?: string;
  type_of_construction: string;
  relationship_with_building: string;
  building_user_name: string;
  spoken_with?: string;
  contact_number: string;
  site_contractor_architect_name: string;
  site_contractor_architect_number: string;
  remarks: string;
  follow_up_date?: string;
  survey_no?: string;
  subdivision_no?: string;
  village?: string;
  taluk?: string;
  district?: string;
}

export interface ResolveCoordsResponse {
  coordinates: string;
  latitude: number;
  longitude: number;
  site_id: string;
  area?: string | null;
  village?: string | null;
  taluk?: string | null;
  district?: string | null;
  address?: string | null;
  survey_no?: string | null;
  subdivision_no?: string | null;
  ulpin?: string | null;
  source?: string | null;
  success: boolean;
  message?: string | null;
  is_duplicate?: boolean;
  duplicate_warning?: string | null;
  duplicate_site_id?: string | null;
  duplicate_record_id?: number | null;
  duplicate_distance_m?: number | null;
  duplicate_is_visited?: boolean;
}

export interface CapturedPhoto {
  source?: 'camera' | 'uploaded';
  id?: string;
  uri: string;
  blob?: Blob;
  blobPromise?: Promise<Blob>;
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: number; // epoch ms
  address?: string;
}

export interface DashboardStats {
  daily_activity?: { date: string; completed: number; pending: number; construction_yes: number }[];
  total_completed_records?: number;
  construction_yes_records?: number;
  mobile_numbers_collected?: number;
  manually_added_records?: number;
  total_records: number;
  today_records: number;
  month_records: number;
  total_photos: number;
  pending_records?: number;
  today_completed_records?: number;
  recent_records: CaptureRecord[];
}

export type ScreenName =
  | 'dashboard'
  | 'records'
  | 'manual-capture'
  | 'detail'
  | 'camera'
  | 'preview'
  | 'form';


export interface NotificationItem {
  id: number;
  recipient_id?: number | null;
  recipient_role?: string | null;
  type: string;
  title: string;
  message: string;
  record_id?: number | null;
  unique_id?: string | null;
  with_sound: boolean;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListResponse {
  notifications: NotificationItem[];
  total: number;
  unread_count: number;
  page: number;
  page_size: number;
}

export interface NotificationPollResponse {
  notifications: NotificationItem[];
  unread_count: number;
  has_sound: boolean;
}
