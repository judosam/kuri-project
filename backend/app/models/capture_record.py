from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, and_, or_, func
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.database.base import Base


class CaptureRecord(Base):
    __tablename__ = "capture_records"
    __table_args__ = (
        Index("idx_rec_user_status_created", "user_id", "status", "created_at"),
        Index("idx_rec_status_created", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # Nullable since the audit workflow: task-sheet imports are staged with no
    # assigned operator until an auditor approves them.
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    location_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    formatted_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    place_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Address resolved from the admin-given ``coordinates``, for comparison with
    # the address resolved from the operator's captured GPS.
    admin_formatted_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
    assigned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    # Status tracking
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="NOT_COMPLETED", index=True)

    # Where this record came from:
    #   "captured" — imported tasks and legacy field captures
    #   "manual" — new records added directly through the field app
    #   "imported" — old field work uploaded/imported by an admin from Excel
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="captured", index=True)

    # GPS fix and submission time for inspections completed WITHOUT photos.
    # Photo records carry this on their CapturedImage rows; a no-photo
    # inspection still deserves a capture time and field coordinates.
    field_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    field_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    field_location_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    field_captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # 15 Task Dispatch Planning Fields (Admin Google Sheet)
    unique_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    coordinates: Mapped[str | None] = mapped_column(String(100), nullable=True)
    street_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    land_use: Mapped[str | None] = mapped_column(String(100), nullable=True)
    survey_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    subdivision_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    owner_name_en: Mapped[str | None] = mapped_column(String(255), nullable=True)
    site_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    survey_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sub_division: Mapped[str | None] = mapped_column(String(100), nullable=True)
    taluk: Mapped[str | None] = mapped_column(String(100), nullable=True)
    village: Mapped[str | None] = mapped_column(String(100), nullable=True)
    district: Mapped[str | None] = mapped_column(String(100), nullable=True)
    area: Mapped[str | None] = mapped_column(String(100), nullable=True)
    priority_tier: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    govt_dtcp_permit: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)
    dtcp_permit_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    dtcp_application_no: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # 9 Field Inspection Result Fields
    date_of_visit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    construction_happening: Mapped[str | None] = mapped_column(String(10), nullable=True)  # "Yes" / "No"
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    type_of_construction: Mapped[str | None] = mapped_column(String(100), nullable=True)
    relationship_with_building: Mapped[str | None] = mapped_column(String(255), nullable=True)
    building_user_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    stage_of_construction: Mapped[str | None] = mapped_column(String(255), nullable=True)
    no_of_floors: Mapped[str | None] = mapped_column(String(50), nullable=True)
    expected_completion: Mapped[str | None] = mapped_column(String(100), nullable=True)
    built_up_area: Mapped[str | None] = mapped_column(String(100), nullable=True)
    site_contractor_architect_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    site_contractor_architect_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    spoken_with: Mapped[str | None] = mapped_column(String(255), nullable=True)
    property_type: Mapped[str | None] = mapped_column(String(50), nullable=True, default=None, index=True)

    # ---- Audit workflow (task-sheet staging) ----
    # Task sheets are staged unassigned (user_id NULL, audit_status PENDING).
    # An admin routes each row to an auditor (assigned_auditor_id); the
    # auditor's decision is recorded, and only then can a field verifier be
    # assigned (user_id) — APPROVAL rows only. DISAPPROVAL /
    # COMMERCIAL_PROPERTY rows stay unassigned and blocked from field
    # operators forever.
    audit_status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="PENDING",
        server_default="PENDING",
        index=True,
    )  # PENDING | APPROVAL | DISAPPROVAL | COMMERCIAL_PROPERTY
    audit_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    audited_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    audited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    staged_operator_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    # Auditor this row was routed to for review.
    assigned_auditor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Google Maps satellite snapshot (stitched tile mosaic). Written when the
    # record is imported and reused by every panel afterwards — the file is
    # cached per (lat, lng, zoom), so a shared location is fetched only once.
    gmap_image_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gmap_zoom: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gmap_captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Auditor QC assessment — desk verification from VHR imagery / street view.
    qc_vhr_comment: Mapped[str | None] = mapped_column(String(120), nullable=True)
    qc_street_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    qc_builder_contact: Mapped[str | None] = mapped_column(Text, nullable=True)
    qc_sqfeet: Mapped[str | None] = mapped_column(String(50), nullable=True)
    qc_reference_image_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # When the QC assessment was first recorded (drives the QC Done/Pending filter + sort).
    qc_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # When the QC decision was subsequent re-edited.
    qc_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    qc_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Telecalling workflow: phone desk verification
    assigned_telecaller_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    telecaller_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    telecaller_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    telecaller_called_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    telecaller_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    telecaller_no_of_floors: Mapped[str | None] = mapped_column(String(50), nullable=True)
    telecaller_expected_completion: Mapped[str | None] = mapped_column(String(100), nullable=True)
    telecaller_built_up_area: Mapped[str | None] = mapped_column(String(100), nullable=True)
    telecaller_stage_of_construction: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Reassign & Revisit workflow
    reassigned_to_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reassigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revisit_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    updated_coordinates: Mapped[str | None] = mapped_column(String(100), nullable=True)
    updated_information: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_by_role: Mapped[str | None] = mapped_column(String(50), nullable=True)
    follow_up_date: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Relationships
    user = relationship(
        "User", back_populates="capture_records", foreign_keys=[user_id]
    )
    # Audit-workflow actors (disambiguated by FK — several user FKs on this table).
    audited_by = relationship("User", foreign_keys=[audited_by_id])
    qc_by = relationship("User", foreign_keys=[qc_by_id])
    staged_operator = relationship("User", foreign_keys=[staged_operator_id])
    assigned_auditor = relationship("User", foreign_keys=[assigned_auditor_id])
    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])
    assigned_telecaller = relationship("User", foreign_keys=[assigned_telecaller_id])
    telecaller_by = relationship("User", foreign_keys=[telecaller_by_id])
    reassigned_to = relationship("User", foreign_keys=[reassigned_to_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])
    images = relationship(
        "CapturedImage",
        back_populates="record",
        cascade="all, delete-orphan",
        order_by="CapturedImage.photo_order",
    )

    def __repr__(self) -> str:
        return f"<CaptureRecord id={self.id} name={self.name}>"

    @hybrid_property
    def is_manually_added(self):
        if self.source == "manual":
            return True
        # Before explicit provenance, app captures carried no dispatch/import
        # metadata. Preserve that distinction for legacy records without
        # mistaking completed imported tasks for manually added inspections.
        # street_address is deliberately NOT a disqualifier: the satellite
        # snapshot service reverse-geocodes field captures and fills it, so a
        # populated street address says nothing about where the row came from.
        return self.source == "captured" and self.user_id is not None and all(
            getattr(self, key) in (None, "") for key in (
                "uploaded_by_id", "staged_operator_id", "assigned_auditor_id",
                "site_address", "land_use", "survey_no", "survey_number",
            )
        )

    @is_manually_added.expression
    def is_manually_added(cls):
        return or_(cls.source == "manual", and_(cls.source == "captured", cls.user_id.isnot(None),
            cls.uploaded_by_id.is_(None), cls.staged_operator_id.is_(None), cls.assigned_auditor_id.is_(None),
            *(func.coalesce(getattr(cls, key), '') == '' for key in
                ('site_address', 'land_use', 'survey_no', 'survey_number'))))

    @validates("user_id")
    def _default_audit_status(self, key: str, value):
        """A record born with (or later released to) an operator is born
        approved — only staged task sheets, created with user_id=None, stay
        PENDING until an auditor decides. Keeps legacy dispatch, history
        imports, and ad-hoc captures visible to their operators."""
        if value is not None and (self.audit_status is None or self.audit_status == "PENDING"):
            self.audit_status = "APPROVAL"
        return value

    @hybrid_property
    def last_modified_at(self) -> datetime:
        candidates = [
            getattr(self, "reassigned_at", None),
            getattr(self, "assigned_at", None),
            getattr(self, "created_at", None),
        ]
        def _to_utc_naive(dt_val):
            if dt_val is None:
                return None
            if not isinstance(dt_val, datetime):
                try:
                    dt_val = datetime.fromisoformat(str(dt_val).replace("Z", "+00:00"))
                except Exception:
                    return None
            if dt_val.tzinfo is not None:
                return dt_val.astimezone(timezone.utc).replace(tzinfo=None)
            return dt_val

        valid = []
        for c in candidates:
            norm = _to_utc_naive(c)
            if norm is not None:
                valid.append(norm)

        if valid:
            return max(valid).replace(tzinfo=timezone.utc)
        created = _to_utc_naive(self.created_at) if self.created_at else None
        if created:
            return created.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc)

    @last_modified_at.expression
    def last_modified_at(cls):
        return func.coalesce(cls.reassigned_at, cls.assigned_at, cls.created_at)

