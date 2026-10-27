from datetime import datetime, timezone
import re
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator


def _utc_iso(dt_val: datetime) -> str:
    """Format datetime as UTC ISO 8601 string ending with Z."""
    if dt_val.tzinfo is None:
        dt_val = dt_val.replace(tzinfo=timezone.utc)
    return dt_val.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class PhotoMetadata(BaseModel):
    latitude: float
    longitude: float
    location_accuracy: float
    captured_at: datetime
    file_name: str


class FieldGpsFix(BaseModel):
    """Device GPS fix sent when an inspection is completed WITHOUT photos,
    so the record still carries a field position and capture time."""

    latitude: float
    longitude: float
    location_accuracy: float = 0
    captured_at: Optional[datetime] = None


class RecordCreateRequest(BaseModel):
    name: str
    description: str = ""
    photos: List[PhotoMetadata] = []
    # GPS fix of the operator's device when no photo was taken.
    field_gps: Optional[FieldGpsFix] = None
    status: Optional[str] = "COMPLETED"
    task_id: Optional[int] = None  # If set, completes this pre-dispatched task

    # Site detail the operator fills in when the admin left it blank.
    owner_name_en: Optional[str] = None

    # 9 Field Inspection Result Fields
    date_of_visit: Optional[str] = None
    construction_happening: Optional[str] = None
    remarks: Optional[str] = None
    type_of_construction: Optional[str] = None
    relationship_with_building: Optional[str] = None
    building_user_name: Optional[str] = None
    contact_number: Optional[str] = None
    stage_of_construction: Optional[str] = None
    site_contractor_architect_name: Optional[str] = None
    site_contractor_architect_number: Optional[str] = None
    spoken_with: Optional[str] = None
    follow_up_date: Optional[str] = None
    no_of_floors: Optional[str] = None
    expected_completion: Optional[str] = None
    built_up_area: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Record name cannot be empty")
        if len(trimmed) > 255:
            raise ValueError("Record name cannot exceed 255 characters")
        return trimmed

    @field_validator("contact_number", "site_contractor_architect_number")
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            return None
        cleaned = re.sub(r"[\s\-\(\)]", "", trimmed)
        if cleaned.startswith("+91"):
            cleaned = cleaned[3:]
        elif cleaned.startswith("91") and len(cleaned) == 12:
            cleaned = cleaned[2:]
        elif cleaned.startswith("0") and len(cleaned) == 11:
            cleaned = cleaned[1:]
        if not re.match(r"^[6-9]\d{9}$", cleaned):
            raise ValueError("Must be a valid 10-digit mobile number")
        return cleaned

    @field_validator("date_of_visit")
    @classmethod
    def validate_date_of_visit(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            return None
        try:
            visit_date = datetime.strptime(trimmed, "%Y-%m-%d").date()
        except ValueError:
            raise ValueError("Date of visit must be in YYYY-MM-DD format")
        if visit_date > datetime.now(timezone.utc).date():
            raise ValueError("Date of visit cannot be in the future")
        return trimmed

    @field_validator("construction_happening")
    @classmethod
    def validate_construction_happening(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            return None
        if trimmed not in ("Yes", "No"):
            raise ValueError("Construction happening must be 'Yes' or 'No'")
        return trimmed



class TaskDispatchItem(BaseModel):
    user_id: int
    unique_id: Optional[str] = None
    coordinates: Optional[str] = None
    street_address: Optional[str] = None
    land_use: Optional[str] = None
    survey_no: Optional[str] = None
    subdivision_no: Optional[str] = None
    owner_name_en: Optional[str] = None
    site_address: Optional[str] = None
    survey_number: Optional[str] = None
    sub_division: Optional[str] = None
    taluk: Optional[str] = None
    village: Optional[str] = None
    district: Optional[str] = None


class TaskDispatchBatchRequest(BaseModel):
    tasks: List[TaskDispatchItem]


class ImageDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    google_drive_file_id: str
    file_name: str
    source: str = "camera"
    photo_order: int
    latitude: float
    longitude: float
    location_accuracy: float
    captured_at: datetime
    created_at: datetime
    image_url: Optional[str] = None

    @field_serializer("captured_at", "created_at", when_used="json")
    def serialize_dt(self, dt_val: datetime) -> str:
        return _utc_iso(dt_val)


class RecordDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # Nullable under the audit workflow: staged task sheets have no operator
    # assigned until an auditor approves them.
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    name: str
    description: str
    location_name: Optional[str] = None
    formatted_address: Optional[str] = None
    place_id: Optional[str] = None
    # Address resolved from the admin-given coordinates (see resolve-address).
    admin_formatted_address: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    last_modified_at: Optional[datetime] = None
    assigned_at: Optional[datetime] = None
    assigned_date: Optional[str] = None
    # Field GPS fix for inspections completed WITHOUT photos (photos carry
    # their GPS on the CapturedImage rows instead).
    field_latitude: Optional[float] = None
    field_longitude: Optional[float] = None
    field_location_accuracy: Optional[float] = None
    field_captured_at: Optional[datetime] = None
    images: List[ImageDetail] = []
    errors: Optional[List[str]] = None  # upload warnings returned to client

    # Google Maps Distance / Deviation between admin coordinates and field operator coordinates
    deviation_meters: Optional[int] = None
    deviation_formatted: Optional[str] = None
    deviation_status: Optional[str] = None

    # Status tracking
    status: str = "NOT_COMPLETED"

    # Origin of the record: "captured" (field operator, on location) or
    # "imported" (old field work uploaded by an admin from Excel).
    source: str = "captured"
    is_manually_added: bool = False

    # 15 Task Dispatch Planning Fields (Admin Google Sheet)
    unique_id: Optional[str] = None
    coordinates: Optional[str] = None
    street_address: Optional[str] = None
    land_use: Optional[str] = None
    survey_no: Optional[str] = None
    subdivision_no: Optional[str] = None
    owner_name_en: Optional[str] = None
    site_address: Optional[str] = None
    survey_number: Optional[str] = None
    sub_division: Optional[str] = None
    taluk: Optional[str] = None
    village: Optional[str] = None
    district: Optional[str] = None

    # 9 Field Inspection Result Fields
    date_of_visit: Optional[str] = None
    construction_happening: Optional[str] = None
    remarks: Optional[str] = None
    type_of_construction: Optional[str] = None
    relationship_with_building: Optional[str] = None
    building_user_name: Optional[str] = None
    contact_number: Optional[str] = None
    stage_of_construction: Optional[str] = None
    no_of_floors: Optional[str] = None
    expected_completion: Optional[str] = None
    built_up_area: Optional[str] = None
    site_contractor_architect_name: Optional[str] = None
    site_contractor_architect_number: Optional[str] = None
    spoken_with: Optional[str] = None

    # Audit workflow: staging/decision trail shown in admin + auditor views.
    audit_status: str = "PENDING"  # PENDING | APPROVAL | DISAPPROVAL | COMMERCIAL_PROPERTY
    audit_comment: Optional[str] = None
    audited_by_id: Optional[int] = None
    audited_by_name: Optional[str] = None
    audited_at: Optional[datetime] = None
    uploaded_by_id: Optional[int] = None
    uploaded_by_name: Optional[str] = None
    staged_operator_id: Optional[int] = None
    staged_operator_name: Optional[str] = None
    assigned_auditor_id: Optional[int] = None
    assigned_auditor_name: Optional[str] = None
    # Auditor QC assessment (VHR imagery / street view desk review).
    qc_by_id: Optional[int] = None
    qc_by_name: Optional[str] = None
    qc_vhr_comment: Optional[str] = None
    qc_street_details: Optional[str] = None
    qc_builder_contact: Optional[str] = None
    qc_sqfeet: Optional[str] = None
    qc_reference_image_key: Optional[str] = None
    qc_reference_image_url: Optional[str] = None
    # When the QC assessment was first recorded.
    qc_status: Optional[str] = None
    qc_completed_at: Optional[datetime] = None
    qc_edited_at: Optional[datetime] = None

    # Telecalling workflow: phone desk verification
    assigned_telecaller_id: Optional[int] = None
    assigned_telecaller_name: Optional[str] = None
    telecaller_status: Optional[str] = None
    telecaller_comment: Optional[str] = None
    telecaller_called_at: Optional[datetime] = None
    telecaller_by_id: Optional[int] = None
    telecaller_by_name: Optional[str] = None

    # Reassignment & Revisit workflow
    reassigned_to_id: Optional[int] = None
    reassigned_to_name: Optional[str] = None
    reassigned_at: Optional[datetime] = None
    revisit_status: Optional[str] = None
    updated_coordinates: Optional[str] = None
    updated_information: Optional[str] = None
    updated_by_id: Optional[int] = None
    updated_by_name: Optional[str] = None
    updated_by_role: Optional[str] = None
    follow_up_date: Optional[str] = None

    # Google Maps satellite snapshot: the cached mosaic served to every panel
    # (importer, auditor, field verifier) plus the tile zoom it was built at.
    gmap_image_url: Optional[str] = None
    gmap_zoom: Optional[int] = None
    gmap_captured_at: Optional[datetime] = None

    @field_serializer("created_at", "updated_at", "last_modified_at", "assigned_at", "reassigned_at", "audited_at", "qc_completed_at", "qc_edited_at", "telecaller_called_at", "gmap_captured_at", when_used="json")
    def serialize_dt(self, dt_val: Optional[datetime]) -> Optional[str]:
        return _utc_iso(dt_val) if dt_val is not None else None

    @field_serializer("field_captured_at", when_used="json")
    def serialize_field_dt(self, dt_val: Optional[datetime]) -> Optional[str]:
        return _utc_iso(dt_val) if dt_val is not None else None


class TelecallerFeedbackRequest(BaseModel):
    """Feedback submitted by telecaller for a record."""
    telecaller_status: Optional[str] = Field(None, max_length=50)
    telecaller_comment: Optional[str] = Field(None, max_length=5000)
    status: Optional[str] = Field(None, max_length=50)
    comment: Optional[str] = Field(None, max_length=5000)
    no_of_floors: Optional[str] = Field(None, max_length=50)
    expected_completion: Optional[str] = Field(None, max_length=100)
    built_up_area: Optional[str] = Field(None, max_length=100)
    stage_of_construction: Optional[str] = Field(None, max_length=255)
    follow_up_date: Optional[str] = Field(None, max_length=50)
    overwrite_comment: bool = False

    @model_validator(mode="after")
    def populate_defaults(self):
        if not self.telecaller_status and self.status:
            self.telecaller_status = self.status
        if not self.telecaller_comment and self.comment:
            self.telecaller_comment = self.comment
        if not self.telecaller_status:
            raise ValueError("telecaller_status or status is required")
        return self


class TelecallerAssignRequest(BaseModel):
    """Admin assigning records to a telecaller."""
    record_ids: List[int]
    telecaller_id: int


class TelecallerDashboardMetrics(BaseModel):
    total_eligible: int
    total_assigned: int
    pending_calls: int
    construction_confirmed: int
    connected_follow_up: int
    not_reachable: int
    wrong_number: int
    called_today: int


class AuditDecisionRequest(BaseModel):
    """Auditor decision on a staged record (PATCH /admin/records/{id}/audit)."""

    audit_status: str = Field(pattern="^(PENDING|APPROVAL|DISAPPROVAL|COMMERCIAL_PROPERTY|RE_AUDITED)$")
    audit_comment: Optional[str] = Field(None, max_length=2000)
    # Auditor QC assessment from VHR imagery / street view.
    qc_vhr_comment: Optional[str] = Field(None, max_length=120)
    qc_street_details: Optional[str] = Field(None, max_length=2000)
    qc_builder_contact: Optional[str] = Field(None, max_length=2000)
    qc_sqfeet: Optional[str] = Field(None, max_length=50)
    qc_completed_at: Optional[datetime] = None
    qc_edited_at: Optional[datetime] = None
    coordinates: Optional[str] = Field(None, max_length=100)
    assigned_auditor_id: Optional[int] = None

    # Field Verification attributes
    type_of_construction: Optional[str] = Field(None, max_length=100)
    stage_of_construction: Optional[str] = Field(None, max_length=100)
    construction_happening: Optional[str] = Field(None, max_length=50)
    date_of_visit: Optional[str] = Field(None, max_length=50)
    relationship_with_building: Optional[str] = Field(None, max_length=100)
    building_user_name: Optional[str] = Field(None, max_length=255)
    spoken_with: Optional[str] = Field(None, max_length=100)
    contact_number: Optional[str] = Field(None, max_length=50)
    site_contractor_architect_name: Optional[str] = Field(None, max_length=255)
    site_contractor_architect_number: Optional[str] = Field(None, max_length=50)
    remarks: Optional[str] = Field(None, max_length=3000)
    follow_up_date: Optional[str] = Field(None, max_length=50)


class RecordBulkAuditRequest(BaseModel):
    """Bulk auditor decision on staged records (POST /admin/records/bulk-audit)."""

    record_ids: List[int] = Field(min_length=1, max_length=10000)
    audit_status: str = Field(pattern="^(PENDING|APPROVAL|DISAPPROVAL|COMMERCIAL_PROPERTY|RE_AUDITED)$")
    audit_comment: Optional[str] = Field(None, max_length=2000)


class RecordBulkAuditResponse(BaseModel):
    success: bool
    audited_count: int
    skipped_count: int
    audit_status: str
    message: str


class RecordBulkStatusRequest(BaseModel):
    """Bulk verification status update on records (POST /admin/records/bulk-status)."""

    record_ids: List[int] = Field(min_length=1, max_length=10000)
    status: str = Field(pattern="^(COMPLETED|NOT_COMPLETED|PENDING|NOT_INTERESTED|DUPLICATE|CONSTRUCTION_FINISHED|Not Interested|Duplicate|Construction Finished)$")
    remarks: Optional[str] = Field(None, max_length=2000)


class RecordBulkStatusResponse(BaseModel):
    success: bool
    updated_count: int
    skipped_count: int
    status: str
    message: str


class RecordAssignAuditorRequest(BaseModel):
    """Record Assigner routes staged records to an auditor for review."""

    record_ids: List[int] = Field(min_length=1, max_length=10000)
    auditor_id: int = Field(gt=0)


class RecordAssignVerifierRequest(BaseModel):
    """Record Assigner releases auditor-approved records to a field verifier."""

    record_ids: List[int] = Field(min_length=1, max_length=10000)
    verifier_id: int = Field(gt=0)


class RecordUnassignRequest(BaseModel):
    """Bulk unassign auditor or field verifier from records."""

    record_ids: List[int] = Field(min_length=1, max_length=10000)


class RecordUnassignResponse(BaseModel):
    success: bool
    unassigned_count: int
    skipped_count: int
    message: str


class RecordListResponse(BaseModel):
    records: List[RecordDetail]
    total: int
    page: int
    page_size: int


class RecordUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None

    # 15 Task Dispatch Planning Fields — editable so imported (backfilled)
    # records can be corrected from the admin portal.
    unique_id: Optional[str] = None
    coordinates: Optional[str] = None
    street_address: Optional[str] = None
    land_use: Optional[str] = None
    survey_no: Optional[str] = None
    subdivision_no: Optional[str] = None
    owner_name_en: Optional[str] = None
    site_address: Optional[str] = None
    survey_number: Optional[str] = None
    sub_division: Optional[str] = None
    taluk: Optional[str] = None
    village: Optional[str] = None
    district: Optional[str] = None

    # 9 Field Inspection Result Fields
    date_of_visit: Optional[str] = None
    construction_happening: Optional[str] = None
    remarks: Optional[str] = None
    type_of_construction: Optional[str] = None
    relationship_with_building: Optional[str] = None
    building_user_name: Optional[str] = None
    contact_number: Optional[str] = None
    stage_of_construction: Optional[str] = None
    site_contractor_architect_name: Optional[str] = None
    site_contractor_architect_number: Optional[str] = None
    spoken_with: Optional[str] = None
    follow_up_date: Optional[str] = None

    # Audit Details fields
    audit_status: Optional[str] = None
    audit_comment: Optional[str] = None
    assigned_auditor_id: Optional[int] = None
    qc_vhr_comment: Optional[str] = None
    qc_street_details: Optional[str] = None
    qc_builder_contact: Optional[str] = None
    qc_sqfeet: Optional[str] = None
    qc_reference_image_key: Optional[str] = None
    qc_reference_image_url: Optional[str] = None

    # Telecaller Verification fields
    assigned_telecaller_id: Optional[int] = None
    telecaller_status: Optional[str] = None
    telecaller_comment: Optional[str] = None
    telecaller_called_at: Optional[datetime] = None

    # Revisit / Updated Verification fields
    updated_coordinates: Optional[str] = None
    revisit_status: Optional[str] = None
    updated_information: Optional[str] = None
    updated_by_id: Optional[int] = None
    updated_by_name: Optional[str] = None
    updated_by_role: Optional[str] = None


class MarkStatusRequest(BaseModel):
    status: str = Field(..., pattern="^(NOT_INTERESTED|DUPLICATE|CONSTRUCTION_FINISHED|Not Interested|Duplicate|Construction Finished|PENDING|NOT_COMPLETED)$")
    remarks: Optional[str] = Field(None, max_length=2000)
    field_latitude: Optional[float] = None
    field_longitude: Optional[float] = None
    field_location_accuracy: Optional[float] = None


class CompleteInspectionRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    photos: List[PhotoMetadata] = []

    # 9 Field Inspection Result Fields
    date_of_visit: Optional[str] = None
    construction_happening: Optional[str] = None
    remarks: Optional[str] = None
    type_of_construction: Optional[str] = None
    relationship_with_building: Optional[str] = None
    building_user_name: Optional[str] = None
    contact_number: Optional[str] = None
    stage_of_construction: Optional[str] = None
    site_contractor_architect_name: Optional[str] = None
    site_contractor_architect_number: Optional[str] = None
    spoken_with: Optional[str] = None
    follow_up_date: Optional[str] = None


class LocationPoint(BaseModel):
    record_id: int
    record_name: str
    latitude: float
    longitude: float
    location_name: Optional[str] = None
    formatted_address: Optional[str] = None
    captured_at: datetime
    user_name: Optional[str] = None

    @field_serializer("captured_at", when_used="json")
    def serialize_dt(self, dt_val: datetime) -> str:
        return _utc_iso(dt_val)



class AddressResolveResponse(BaseModel):
    """Result of an on-demand Google Geocoding lookup for a record."""

    resolved: bool
    # Resolved from the operator's captured GPS.
    address: Optional[str] = None
    # Resolved from the admin-given coordinates.
    admin_address: Optional[str] = None
    place_name: Optional[str] = None
    deviation_meters: Optional[int] = None
    deviation_formatted: Optional[str] = None
    deviation_status: Optional[str] = None
    error: Optional[str] = None


class DistanceResponse(BaseModel):
    """Result of a Google Maps Distance calculation between two points."""

    distance_meters: int
    formatted: str
    status: str  # 'exact' | 'close' | 'far'
    source: str  # 'google_maps' | 'geodesic'


class InspectorStat(BaseModel):
    user_id: int
    user_name: str
    email: str
    role: str
    total_assigned: int
    completed: int
    pending: int
    today_completed: int
    completion_rate: float


class DailyActivity(BaseModel):
    date: str
    completed: int = 0
    pending: int = 0
    construction_yes: int = 0


class DashboardPeriodInfo(BaseModel):
    preset: str = "allTime"
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    label: str = "All Time"


class DashboardOverview(BaseModel):
    total_records: int = 0
    total_commercial_properties: int = 0
    eligible_for_field: int = 0
    sent_to_field: int = 0
    unassigned_properties: int = 0
    completed_verifications: int = 0
    closed_verifications: int = 0
    disapproved_verifications: int = 0
    pending_verifications: int = 0
    completion_rate: float = 0.0
    confirmed_construction: int = 0
    phone_numbers_obtained: int = 0
    manually_added: int = 0
    period_created: int = 0
    period_assigned: int = 0
    period_completed: int = 0


class DashboardFunnel(BaseModel):
    identified_sites: int = 0
    sent_for_verification: int = 0
    false_positives_qc: int = 0
    commercial_property_qc: int = 0
    field_verification_completed: int = 0
    pending_for_field_verification: int = 0
    confirmed_construction: int = 0
    phone_numbers_obtained: int = 0
    manually_added: int = 0


class DashboardTelecalling(BaseModel):
    total_leads: int = 0
    calls_completed: int = 0
    calls_pending: int = 0
    construction_confirmed: int = 0
    follow_up_needed: int = 0
    not_reachable: int = 0
    other_outcomes: int = 0


class DashboardTrendPoint(BaseModel):
    date: str
    label: str
    completed: int = 0
    assigned: int = 0
    confirmed: int = 0
    total_sends: int = 0


class DashboardDistributionItem(BaseModel):
    label: str
    count: int = 0
    completed: int = 0
    pending: int = 0


class DashboardDistribution(BaseModel):
    by_district: List[DashboardDistributionItem] = Field(default_factory=list)
    by_taluk: List[DashboardDistributionItem] = Field(default_factory=list)
    by_type: List[DashboardDistributionItem] = Field(default_factory=list)
    by_stage: List[DashboardDistributionItem] = Field(default_factory=list)


class DashboardActivityItem(BaseModel):
    id: int
    type: str
    title: str
    detail: Optional[str] = None
    timestamp: str
    user_name: Optional[str] = None
    status: str = "success"


class DashboardResponse(BaseModel):
    daily_activity: List[DailyActivity] = Field(default_factory=list)
    construction_yes_records: int = 0
    mobile_numbers_collected: int = 0
    manually_added_records: int = 0
    total_records: int
    today_records: int
    month_records: int
    total_users: int
    today_completed_records: int = 0
    total_completed_records: int = 0
    pending_records: int = 0
    total_photos: int = 0
    completion_rate: float = 0.0
    inspector_stats: List[InspectorStat] = []
    recent_records: List[RecordDetail]

    # Command Center Analytics extensions
    total_commercial_properties: int = 0
    eligible_for_field: int = 0
    unassigned_properties: int = 0
    period_info: Optional[DashboardPeriodInfo] = None
    overview: Optional[DashboardOverview] = None
    funnel: Optional[DashboardFunnel] = None
    telecalling: Optional[DashboardTelecalling] = None
    trends: Optional[List[DashboardTrendPoint]] = None
    distribution: Optional[DashboardDistribution] = None
    recent_activities: Optional[List[DashboardActivityItem]] = None


class UserDashboardResponse(BaseModel):
    """Per-user dashboard metrics (a user only sees their own data)."""

    daily_activity: List[DailyActivity] = Field(default_factory=list)
    total_completed_records: int = 0
    completion_rate: float = 0.0
    construction_yes_records: int = 0
    mobile_numbers_collected: int = 0
    manually_added_records: int = 0
    total_records: int
    today_records: int
    month_records: int
    total_photos: int
    pending_records: int = 0
    today_completed_records: int = 0
    recent_records: List[RecordDetail]


class RecordReassignRequest(BaseModel):
    record_ids: List[int] = Field(min_length=1, max_length=10000)
    target_user_id: int = Field(gt=0)


class RecordReassignResponse(BaseModel):
    success: bool
    reassigned_count: int
    skipped_completed_count: int
    target_user_id: int
    target_user_name: str
    message: str


