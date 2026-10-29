export type UserRole = 'USER' | 'ADMIN' | 'MANAGER' | 'AUDITOR' | 'FIELD_VERIFIER' | 'TELECALLER';

/** Roles allowed into the Admin Web Portal. Field workers (USER,
 * FIELD_VERIFIER) belong to the mobile app instead. Single source of truth
 * shared by App.tsx's route gate and the login screen's role check. */
export const PORTAL_ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'AUDITOR', 'TELECALLER'];

export type AuditStatus = 'PENDING' | 'APPROVAL' | 'DISAPPROVAL' | 'COMMERCIAL_PROPERTY' | 'RE_AUDITED';

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  must_change_password?: boolean;
  last_login_at?: string;
  temporary_password?: string;
  created_at: string;
}

export interface CapturedImage {
  id: number;
  google_drive_file_id: string;
  file_name: string;
  photo_order: number;
  source?: 'camera' | 'uploaded';
  latitude: number;
  longitude: number;
  location_accuracy: number;
  captured_at: string;
  created_at: string;
  image_url?: string; // API-relative path, e.g. /api/admin/records/:id/image/:imgId
  thumbnail_url?: string;
}

export interface CaptureRecord {
  is_manually_added?: boolean;
  id: number;
  user_id: number | null;
  user_name?: string;
  name: string;
  description: string;
  location_name?: string;
  formatted_address?: string;
  /** Address resolved from the admin-given coordinates. */
  admin_formatted_address?: string;
  place_id?: string;
  created_at: string;
  updated_at?: string;
  last_modified_at?: string;
  assigned_at?: string;
  assigned_date?: string;
  /** GPS fix stored for inspections completed WITHOUT photos. */
  field_latitude?: number | null;
  field_longitude?: number | null;
  field_location_accuracy?: number | null;
  field_captured_at?: string | null;
  images: CapturedImage[];
  errors?: string[]; // upload warnings returned by the server

  updated_by_id?: number | null;
  updated_by_name?: string | null;
  updated_by_role?: string | null;

  // Status tracking
  status: 'NOT_COMPLETED' | 'COMPLETED' | string;

  /** 'captured' = collected on location by a field operator, 'imported' = old
   *  field work uploaded by an admin. */
  source?: 'captured' | 'imported' | string;

  // 15 Task Dispatch Planning Fields
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
  area?: string | null;
  priority_tier?: string | null;
  govt_dtcp_permit?: boolean | null;
  dtcp_permit_date?: string | null;
  dtcp_application_no?: string | null;

  // 9 Field Inspection Result Fields
  date_of_visit?: string;
  construction_happening?: string;
  remarks?: string;
  type_of_construction?: string;
  relationship_with_building?: string;
  building_user_name?: string;
  contact_number?: string;
  stage_of_construction?: string;
  no_of_floors?: string;
  expected_completion?: string;
  built_up_area?: string;
  site_contractor_architect_name?: string;
  site_contractor_architect_number?: string;
  spoken_with?: string | null;

  // Deviation metrics
  deviation_meters?: number | null;
  deviation_formatted?: string | null;
  deviation_status?: string | null;

  // Audit workflow: staged task sheets await an auditor decision.
  audit_status?: AuditStatus;
  audit_comment?: string | null;
  property_type?: string | null;
  audited_by_id?: number | null;
  audited_by_name?: string | null;
  audited_at?: string | null;
  uploaded_by_id?: number | null;
  uploaded_by_name?: string | null;
  staged_operator_id?: number | null;
  staged_operator_name?: string | null;
  assigned_auditor_id?: number | null;
  assigned_auditor_name?: string | null;
  // Auditor QC assessment (VHR imagery / street view desk review).
  qc_by_id?: number | null;
  qc_by_name?: string | null;
  qc_vhr_comment?: string | null;
  qc_street_details?: string | null;
  qc_builder_contact?: string | null;
  qc_sqfeet?: string | null;
  /** When the QC assessment was first recorded. */
  qc_completed_at?: string | null;
  /** When the QC decision was re-edited. */
  qc_edited_at?: string | null;
  qc_status?: 'DONE' | 'PENDING' | string;

  // Telecaller verification fields
  assigned_telecaller_id?: number | null;
  assigned_telecaller_name?: string | null;
  telecaller_status?: string | null;
  telecaller_comment?: string | null;
  telecaller_called_at?: string | null;
  telecaller_by_id?: number | null;
  telecaller_by_name?: string | null;
  telecaller_no_of_floors?: string | null;
  telecaller_expected_completion?: string | null;
  telecaller_built_up_area?: string | null;
  telecaller_stage_of_construction?: string | null;

  // Reassign & Revisit fields
  reassigned_to_id?: number | null;
  reassigned_to_name?: string | null;
  reassigned_at?: string | null;
  revisit_status?: string | null;
  updated_coordinates?: string | null;
  updated_information?: string | null;
  follow_up_date?: string | null;

  /** Saved Google Maps satellite snapshot (downloaded at import, then cached). */
  gmap_image_url?: string | null;
  gmap_zoom?: number | null;
  gmap_captured_at?: string | null;

  /** QC reference image attached by QA reviewer (synced to GDrive and local storage). */
  qc_reference_image_key?: string | null;
  qc_reference_image_url?: string | null;
}

export interface QaUserStat {
  user_id: number;
  user_name: string;
  email: string;
  role: string;
  total_assigned: number;
  qc_done: number;
  approved: number;
  disapproved: number;
  commercial: number;
  pending: number;
  qa_created: number;
  today_done: number;
  completion_rate: number;
}

export interface InspectorStat {
  user_id: number;
  user_name: string;
  email: string;
  role: string;
  total_assigned: number;
  completed: number;
  closed?: number;
  pending: number;
  today_completed: number;
  completion_rate: number;
  confirmed_construction?: number;
  phones_obtained?: number;
}

export interface DashboardPeriodInfo {
  preset: string;
  date_from?: string | null;
  date_to?: string | null;
  label: string;
}

export interface DashboardOverview {
  total_records: number;
  total_commercial_properties: number;
  eligible_for_field: number;
  sent_to_field: number;
  unassigned_properties: number;
  completed_verifications: number;
  pending_verifications: number;
  completion_rate: number;
  confirmed_construction: number;
  phone_numbers_obtained: number;
  manually_added: number;
  qa_new_records?: number;
  period_created: number;
  period_assigned: number;
  period_completed: number;
}

export interface DashboardFunnel {
  identified_sites: number;
  sent_for_verification: number;
  false_positives_qc: number;
  commercial_property_qc: number;
  field_verification_completed: number;
  pending_for_field_verification: number;
  confirmed_construction: number;
  phone_numbers_obtained: number;
  manually_added: number;
  qa_new_records?: number;
}

export interface DashboardTelecalling {
  total_leads: number;
  calls_completed: number;
  calls_pending: number;
  construction_confirmed: number;
  follow_up_needed: number;
  not_reachable: number;
  other_outcomes: number;
}

export interface DashboardTrendPoint {
  date: string;
  label: string;
  completed: number;
  assigned: number;
  confirmed?: number;
  total_sends?: number;
}

export interface DashboardDistributionItem {
  label: string;
  count: number;
  completed?: number;
  pending?: number;
}

export interface DashboardDistribution {
  by_district: DashboardDistributionItem[];
  by_taluk: DashboardDistributionItem[];
  by_type: DashboardDistributionItem[];
  by_stage: DashboardDistributionItem[];
}

export interface DashboardActivityItem {
  id: number;
  type: string;
  title: string;
  detail?: string;
  timestamp: string;
  user_name?: string;
  status: string;
}

export interface DashboardData {
  daily_activity?: { date: string; completed: number; pending: number; construction_yes: number }[];
  construction_yes_records?: number;
  mobile_numbers_collected?: number;
  manually_added_records?: number;
  total_records: number;
  today_records: number;
  month_records: number;
  total_users: number;
  today_completed_records?: number;
  total_completed_records?: number;
  pending_records?: number;
  total_photos?: number;
  completion_rate?: number;
  inspector_stats?: InspectorStat[];
  qa_user_stats?: QaUserStat[];
  recent_records: CaptureRecord[];

  // Analytics Command Center extensions
  total_commercial_properties?: number;
  eligible_for_field?: number;
  unassigned_properties?: number;
  qa_new_records?: number;
  period_info?: DashboardPeriodInfo;
  overview?: DashboardOverview;
  funnel?: DashboardFunnel;
  telecalling?: DashboardTelecalling;
  trends?: DashboardTrendPoint[];
  distribution?: DashboardDistribution;
  recent_activities?: DashboardActivityItem[];
}

export interface PaginatedResponse<T> {
  total: number;
  page: number;
  page_size: number;
  records?: T[];
  users?: T[];
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface LocationPoint {
  record_id: number;
  record_name: string;
  image_id?: number;
  latitude: number;
  longitude: number;
  location_name?: string;
  formatted_address?: string;
  captured_at: string;
  user_id: number;
  user_name?: string;
  status?: string;
  unique_id?: string;
  site_address?: string;
  survey_no?: string;
  district?: string;
  priority_tier?: string | null;
  govt_dtcp_permit?: boolean | null;
  dtcp_permit_date?: string | null;
  dtcp_application_no?: string | null;
  taluk?: string;
  village?: string;
}

export interface ActivityEntry {
  id: string;
  ts: string;
  type: 'record' | 'photo' | 'user' | 'auth' | 'security';
  title: string;
  detail?: string;
  user_id?: number;
  user_name?: string;
  record_id?: number;
  record_name?: string;
}

export interface ActivitySummary {
  today: number;
  week: number;
  month: number;
}

export interface ActivityLog {
  items: ActivityEntry[];
  total: number;
  summary: ActivitySummary;
}

export type RecordDetail = CaptureRecord;

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
  success: boolean;
  message?: string | null;
}

export interface QaCreateRecordPayload {
  coordinates: string;
  unique_id?: string;
  area?: string;
  village?: string;
  taluk?: string;
  district?: string;
  street_address?: string;
  site_address?: string;
  priority_tier?: string;
  property_type?: string;
  owner_name_en?: string;
  survey_no?: string;
  subdivision_no?: string;
  dtcp_permit_date?: string;
  dtcp_application_no?: string;
  govt_dtcp_permit?: boolean;
  audit_status?: string;
  audit_comment?: string;
  qc_vhr_comment?: string;
  qc_street_details?: string;
  qc_builder_contact?: string;
  qc_sqfeet?: string;
}
