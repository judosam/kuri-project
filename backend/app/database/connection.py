import os
from typing import Generator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.pool import NullPool
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.database.base import Base

settings = get_settings()

# Ensure data directory exists for SQLite
db_path = settings.DATABASE_URL.replace("sqlite:///", "")
db_dir = os.path.dirname(db_path)
if db_dir:
    os.makedirs(db_dir, exist_ok=True)

is_sqlite = settings.DATABASE_URL.startswith("sqlite")
engine_kwargs = {"echo": settings.DEBUG}
if is_sqlite:
    engine_kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30.0}
    engine_kwargs["poolclass"] = NullPool

engine = create_engine(
    settings.DATABASE_URL,
    **engine_kwargs,
)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=DELETE")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=-64000")
    cursor.execute("PRAGMA temp_store=MEMORY")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Schema for the audit-workflow era of capture_records: user_id became
# nullable (task sheets are staged unassigned until an auditor approves them)
# and six audit columns were added. Hand-written so the rebuild below is
# explicit and reviewable — it mirrors app/models/capture_record.py.
_CAPTURE_RECORDS_AUDIT_DDL = """
CREATE TABLE capture_records_new (
    id INTEGER NOT NULL PRIMARY KEY,
    user_id INTEGER REFERENCES users (id),
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    location_name VARCHAR(255),
    formatted_address TEXT,
    place_id VARCHAR(255),
    admin_formatted_address TEXT,
    created_at TIMESTAMP,
    assigned_at TIMESTAMP,
    status VARCHAR(50) NOT NULL,
    source VARCHAR(20) NOT NULL,
    field_latitude FLOAT,
    field_longitude FLOAT,
    field_location_accuracy FLOAT,
    field_captured_at TIMESTAMP,
    unique_id VARCHAR(100),
    coordinates VARCHAR(100),
    street_address TEXT,
    land_use VARCHAR(100),
    survey_no VARCHAR(100),
    subdivision_no VARCHAR(100),
    owner_name_en VARCHAR(255),
    site_address TEXT,
    survey_number VARCHAR(100),
    sub_division VARCHAR(100),
    taluk VARCHAR(100),
    village VARCHAR(100),
    district VARCHAR(100),
    date_of_visit VARCHAR(50),
    construction_happening VARCHAR(10),
    remarks TEXT,
    type_of_construction VARCHAR(100),
    relationship_with_building VARCHAR(255),
    building_user_name VARCHAR(255),
    contact_number VARCHAR(50),
    stage_of_construction VARCHAR(255),
    no_of_floors VARCHAR(50),
    expected_completion VARCHAR(100),
    built_up_area VARCHAR(100),
    site_contractor_architect_name VARCHAR(255),
    site_contractor_architect_number VARCHAR(50),
    spoken_with VARCHAR(255),
    follow_up_date VARCHAR(50),
    audit_status VARCHAR(30) NOT NULL DEFAULT 'APPROVAL',
    audit_comment TEXT,
    audited_by_id INTEGER REFERENCES users (id),
    audited_at TIMESTAMP,
    uploaded_by_id INTEGER REFERENCES users (id),
    staged_operator_id INTEGER REFERENCES users (id),
    assigned_auditor_id INTEGER REFERENCES users (id),
    qc_vhr_comment VARCHAR(120),
    qc_street_details TEXT,
    qc_builder_contact TEXT,
    qc_sqfeet VARCHAR(50),
    qc_completed_at TIMESTAMP,
    qc_edited_at TIMESTAMP,
    qc_by_id INTEGER REFERENCES users (id)
)
"""

# Indices exactly as declared on the model (column flags + __table_args__).
_CAPTURE_RECORDS_AUDIT_INDEX_DDL = [
    "CREATE INDEX IF NOT EXISTS ix_capture_records_id ON capture_records (id)",
    "CREATE INDEX IF NOT EXISTS ix_capture_records_user_id ON capture_records (user_id)",
    "CREATE INDEX IF NOT EXISTS ix_capture_records_assigned_at ON capture_records (assigned_at)",
    "CREATE INDEX IF NOT EXISTS ix_capture_records_status ON capture_records (status)",
    "CREATE INDEX IF NOT EXISTS ix_capture_records_source ON capture_records (source)",
    "CREATE INDEX IF NOT EXISTS ix_capture_records_unique_id ON capture_records (unique_id)",
    "CREATE INDEX IF NOT EXISTS ix_capture_records_audit_status ON capture_records (audit_status)",
    "CREATE INDEX IF NOT EXISTS idx_rec_user_status_created ON capture_records (user_id, status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_rec_status_created ON capture_records (status, created_at)",
]


def _migrate_capture_records_for_audit(engine) -> None:
    """Non-destructive rebuild of legacy capture_records (user_id NOT NULL).

    SQLite cannot relax a column constraint in place. The official safe
    procedure is: create the new-schema table, copy every legacy row over
    (additive evolution, so every legacy column exists in the new table),
    drop the old table, rename the new one into place — all inside ONE
    transaction so a crash leaves the original table untouched. A file
    backup is taken beforehand as a belt-and-braces safeguard.

    Idempotent: skipped whenever user_id is already nullable (i.e. the
    audit-era table, created fresh by Base.metadata.create_all).
    """
    import shutil
    import logging

    logger = logging.getLogger(__name__)
    inspector = inspect(engine)
    if "capture_records" not in inspector.get_table_names():
        return  # Fresh database — create_all builds the new schema directly.

    cols_info = inspector.get_columns("capture_records")
    user_id_info = next((c for c in cols_info if c["name"] == "user_id"), None)
    if user_id_info is None or user_id_info.get("nullable", True):
        return  # Already audit-era; nothing to do.

    if not is_sqlite:
        # Postgres can relax the constraint in place.
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE capture_records ALTER COLUMN user_id DROP NOT NULL"))
            for stmt in _CAPTURE_RECORDS_AUDIT_INDEX_DDL:
                conn.execute(text(stmt.replace("capture_records (", "capture_records ").replace("IF NOT EXISTS ", "")))
        return

    logger.info("capture_records: legacy NOT NULL user_id detected — starting non-destructive audit rebuild")

    # Safeguard: byte-for-byte backup before touching the live table.
    try:
        db_file = db_path if db_path.endswith(".db") else db_path + ".db"
        backup_file = db_file + ".pre-audit-rebuild.bak"
        if os.path.exists(db_file):
            shutil.copy2(db_file, backup_file)
            logger.info("capture_records: backup written to %s", backup_file)
    except Exception as backup_exc:  # pragma: no cover - backup is best-effort
        logger.warning("capture_records: pre-rebuild backup failed (%s) — continuing", backup_exc)

    legacy_columns = [c["name"] for c in cols_info]
    col_list = ", ".join(f'"{c}"' for c in legacy_columns)

    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("PRAGMA foreign_keys=OFF")
        cur.execute("BEGIN")

        # Free the index names first: they move to the new table below.
        for ix in inspector.get_indexes("capture_records"):
            cur.execute(f'DROP INDEX IF EXISTS "{ix["name"]}"')

        cur.execute(_CAPTURE_RECORDS_AUDIT_DDL)
        # Copy every legacy row. New columns absent from the legacy table
        # take their defaults — audit_status lands on 'APPROVAL' because a
        # legacy row always carries a user: it was dispatched under the old
        # flow and must stay visible to its operator (grandfathered).
        cur.execute(
            f'INSERT INTO capture_records_new ({col_list}) '
            f'SELECT {col_list} FROM capture_records'
        )
        cur.execute("DROP TABLE capture_records")
        # Renaming also re-points other tables' FK references
        # (captured_images.record_id) at the restored table name.
        cur.execute("ALTER TABLE capture_records_new RENAME TO capture_records")
        for stmt in _CAPTURE_RECORDS_AUDIT_INDEX_DDL:
            cur.execute(stmt)

        raw.commit()
        logger.info("capture_records: audit rebuild complete — %s legacy rows preserved", cur.rowcount)
    except Exception:
        raw.rollback()
        logger.exception("capture_records: audit rebuild FAILED — original table preserved via rollback")
        raise
    finally:
        try:
            cur.execute("PRAGMA foreign_keys=ON")
        except Exception:
            pass
        raw.close()


def _add_assigned_auditor_column(engine) -> None:
    """Add the assigned_auditor_id column to an existing audit-era table.

    The audit rebuild already ran on live databases, so its idempotence skip
    (user_id already nullable) would never re-create the table with the new
    column. A simple ADD COLUMN is safe: SQLite allows it, and the value is
    NULL for every pre-existing row (nothing was routed yet).
    """
    import logging

    logger = logging.getLogger(__name__)
    try:
        inspector = inspect(engine)
        if "capture_records" not in inspector.get_table_names():
            return
        cols = {c["name"] for c in inspector.get_columns("capture_records")}
        if "audit_status" not in cols:
            return  # Pre-audit legacy table; the rebuild below handles it.
        # Idempotent per-column guarantee — each ADD COLUMN runs only when
        # that column is still missing, so new columns can be appended here
        # without breaking databases that already have the earlier ones.
        with engine.begin() as conn:
            if "assigned_auditor_id" not in cols:
                conn.execute(text(
                    "ALTER TABLE capture_records ADD COLUMN assigned_auditor_id INTEGER REFERENCES users (id)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_capture_records_assigned_auditor_id "
                    "ON capture_records (assigned_auditor_id)"
                ))
                logger.info("capture_records: added assigned_auditor_id column for auditor routing")
            # Auditor QC assessment columns (VHR imagery / street view review).
            for stmt, name in (
                ("ALTER TABLE capture_records ADD COLUMN qc_vhr_comment VARCHAR(120)", "qc_vhr_comment"),
                ("ALTER TABLE capture_records ADD COLUMN qc_street_details TEXT", "qc_street_details"),
                ("ALTER TABLE capture_records ADD COLUMN qc_builder_contact TEXT", "qc_builder_contact"),
                ("ALTER TABLE capture_records ADD COLUMN qc_sqfeet VARCHAR(50)", "qc_sqfeet"),
                ("ALTER TABLE capture_records ADD COLUMN qc_completed_at TIMESTAMP", "qc_completed_at"),
                ("ALTER TABLE capture_records ADD COLUMN qc_edited_at TIMESTAMP", "qc_edited_at"),
                ("ALTER TABLE capture_records ADD COLUMN qc_by_id INTEGER REFERENCES users (id)", "qc_by_id"),
                ("ALTER TABLE capture_records ADD COLUMN reassigned_to_id INTEGER REFERENCES users (id)", "reassigned_to_id"),
                ("ALTER TABLE capture_records ADD COLUMN reassigned_at TIMESTAMP", "reassigned_at"),
                ("ALTER TABLE capture_records ADD COLUMN revisit_status VARCHAR(50)", "revisit_status"),
                ("ALTER TABLE capture_records ADD COLUMN updated_coordinates VARCHAR(100)", "updated_coordinates"),
                ("ALTER TABLE capture_records ADD COLUMN updated_information TEXT", "updated_information"),
                ("ALTER TABLE capture_records ADD COLUMN spoken_with VARCHAR(255)", "spoken_with"),
                ("ALTER TABLE capture_records ADD COLUMN follow_up_date VARCHAR(50)", "follow_up_date"),
                ("ALTER TABLE capture_records ADD COLUMN updated_at TIMESTAMP", "updated_at"),
                ("ALTER TABLE capture_records ADD COLUMN no_of_floors VARCHAR(50)", "no_of_floors"),
                ("ALTER TABLE capture_records ADD COLUMN expected_completion VARCHAR(100)", "expected_completion"),
                ("ALTER TABLE capture_records ADD COLUMN built_up_area VARCHAR(100)", "built_up_area"),
                ("ALTER TABLE capture_records ADD COLUMN telecaller_no_of_floors VARCHAR(50)", "telecaller_no_of_floors"),
                ("ALTER TABLE capture_records ADD COLUMN telecaller_expected_completion VARCHAR(100)", "telecaller_expected_completion"),
                ("ALTER TABLE capture_records ADD COLUMN telecaller_built_up_area VARCHAR(100)", "telecaller_built_up_area"),
                ("ALTER TABLE capture_records ADD COLUMN telecaller_stage_of_construction VARCHAR(255)", "telecaller_stage_of_construction"),
            ):
                if name not in cols:
                    conn.execute(text(stmt))
                    logger.info("capture_records: added %s column", name)
                    if name == "qc_completed_at":
                        # Backfill rows that already carry a QC assessment: prefer
                        # the audit timestamp, else the import time.
                        conn.execute(text(
                            "UPDATE capture_records SET qc_completed_at = COALESCE(audited_at, CURRENT_TIMESTAMP) "
                            "WHERE qc_completed_at IS NULL AND (qc_vhr_comment IS NOT NULL "
                            "OR qc_street_details IS NOT NULL OR qc_builder_contact IS NOT NULL)"
                        ))
                    elif name == "updated_at":
                        conn.execute(text(
                            "UPDATE capture_records SET updated_at = MAX("
                            "COALESCE(qc_edited_at, '1970-01-01'), "
                            "COALESCE(qc_completed_at, '1970-01-01'), "
                            "COALESCE(audited_at, '1970-01-01'), "
                            "COALESCE(field_captured_at, '1970-01-01'), "
                            "COALESCE(telecaller_called_at, '1970-01-01'), "
                            "COALESCE(reassigned_at, '1970-01-01'), "
                            "COALESCE(assigned_at, '1970-01-01'), "
                            "COALESCE(created_at, '1970-01-01'))"
                        ))
    except Exception:  # pragma: no cover - never block startup
        logger.exception("capture_records: assigned_auditor_id migration failed — continuing")


def _sync_assigned_auditor_from_audited_by(engine) -> None:
    """Backfill missing legacy QA assignments without replacing explicit assignments."""
    import logging
    logger = logging.getLogger(__name__)
    try:
        if "capture_records" not in inspect(engine).get_table_names():
            return
        with engine.begin() as conn:
            cols = {c["name"] for c in inspect(engine).get_columns("capture_records")}
            if "assigned_auditor_id" in cols and "audited_by_id" in cols:
                res = conn.execute(text(
                    "UPDATE capture_records SET assigned_auditor_id = audited_by_id "
                    "WHERE assigned_auditor_id IS NULL AND audited_by_id IN (SELECT id FROM users WHERE role = 'AUDITOR')"
                ))
                if res.rowcount:
                    logger.info("capture_records: synced %s assigned_auditor_id from audited_by_id", res.rowcount)
    except Exception:
        logger.exception("capture_records: sync assigned_auditor_id from audited_by_id failed — continuing")


def _retire_task_importer_role(engine) -> None:
    """One-time data repair: the TASK_IMPORTER (Record Assigner) role was
    retired — importing task sheets and routing them to an auditor is now an
    admin action. Any surviving user row still carrying the role would fail
    enum deserialisation once it is gone from UserRole, so promote those
    accounts to ADMIN. Idempotent: repairs nothing once none remain.
    """
    import logging

    logger = logging.getLogger(__name__)
    try:
        if "users" not in inspect(engine).get_table_names():
            return
        with engine.begin() as conn:
            res = conn.execute(text("UPDATE users SET role = 'ADMIN' WHERE role = 'TASK_IMPORTER'"))
            if res.rowcount:
                logger.info(
                    "users: promoted %s retired TASK_IMPORTER account(s) to ADMIN",
                    res.rowcount,
                )
    except Exception:  # pragma: no cover - never block startup on the promotion
        logger.exception("users: TASK_IMPORTER retirement migration failed — continuing")


def _grandfather_legacy_audit_rows(engine) -> None:
    """One-time data repair: a row that carries a user was dispatched under
    the legacy flow and must stay visible to its operator.

    Rebuilds made before the copy default moved to 'APPROVAL' stamped every
    legacy row PENDING, which hid existing records from their field
    operators (operator queries filter audit_status == 'APPROVAL').
    auditors can never intentionally leave a user on a PENDING row —
    audit_record() unassigns (user_id = NULL) on every non-APPROVAL
    decision — so user_id IS NOT NULL AND audit_status = 'PENDING' can only
    be a migration artifact. Idempotent: repairs nothing once none remain.
    """
    import logging

    logger = logging.getLogger(__name__)
    try:
        if "capture_records" not in inspect(engine).get_table_names():
            return
        with engine.begin() as conn:
            cols = {c["name"] for c in inspect(engine).get_columns("capture_records")}
            if "audit_status" not in cols or "user_id" not in cols:
                return
            res = conn.execute(text(
                "UPDATE capture_records SET audit_status = 'APPROVAL' "
                "WHERE user_id IS NOT NULL AND audit_status = 'PENDING'"
            ))
            if res.rowcount:
                logger.info(
                    "capture_records: grandfathered %s legacy assigned rows to APPROVAL",
                    res.rowcount,
                )
    except Exception:  # pragma: no cover - never block startup on the backfill
        logger.exception("capture_records: legacy audit-status backfill failed — continuing")


def create_tables():
    _migrate_capture_records_for_audit(engine)
    Base.metadata.create_all(bind=engine)
    _add_assigned_auditor_column(engine)
    _sync_assigned_auditor_from_audited_by(engine)
    _grandfather_legacy_audit_rows(engine)
    _retire_task_importer_role(engine)
    try:
        inspector = inspect(engine)
        if "captured_images" in inspector.get_table_names():
            image_columns = {col["name"] for col in inspector.get_columns("captured_images")}
            if "source" not in image_columns:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE captured_images ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'camera'"))
        if "users" in inspector.get_table_names():
            columns = {col["name"] for col in inspector.get_columns("users")}
            with engine.connect() as conn:
                if "must_change_password" not in columns:
                    conn.execute(text("ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT 0"))
                    conn.commit()
                if "last_login_at" not in columns:
                    conn.execute(text("ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP"))
                    conn.commit()
        if "capture_records" in inspector.get_table_names():
            record_columns = {col["name"] for col in inspector.get_columns("capture_records")}
            if "relationship_with_building" not in record_columns:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE capture_records ADD COLUMN relationship_with_building VARCHAR(255)"))
            if "assigned_at" not in record_columns:
                with engine.connect() as conn:
                    conn.execute(text("ALTER TABLE capture_records ADD COLUMN assigned_at TIMESTAMP"))
                    conn.execute(text("UPDATE capture_records SET assigned_at = created_at WHERE assigned_at IS NULL"))
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_capture_records_assigned_at ON capture_records (assigned_at)"))
                    conn.commit()
            if "admin_formatted_address" not in record_columns:
                with engine.connect() as conn:
                    conn.execute(text("ALTER TABLE capture_records ADD COLUMN admin_formatted_address TEXT"))
                    conn.commit()
            if "source" not in record_columns:
                # Every pre-existing row was captured on location by a field
                # operator, so that is the correct backfill value.
                with engine.connect() as conn:
                    conn.execute(
                        text(
                            "ALTER TABLE capture_records ADD COLUMN source VARCHAR(20) "
                            "NOT NULL DEFAULT 'captured'"
                        )
                    )
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_capture_records_source "
                            "ON capture_records (source)"
                        )
                    )
                    conn.commit()
            if "field_latitude" not in record_columns:
                # GPS fix + capture time for inspections completed without photos.
                with engine.connect() as conn:
                    conn.execute(text("ALTER TABLE capture_records ADD COLUMN field_latitude FLOAT"))
                    conn.execute(text("ALTER TABLE capture_records ADD COLUMN field_longitude FLOAT"))
                    conn.execute(text("ALTER TABLE capture_records ADD COLUMN field_location_accuracy FLOAT"))
                    conn.execute(text("ALTER TABLE capture_records ADD COLUMN field_captured_at TIMESTAMP"))
                    conn.commit()
            if "gmap_image_key" not in record_columns:
                # Google Maps satellite snapshot stored next to the record's photos.
                with engine.connect() as conn:
                    conn.execute(text("ALTER TABLE capture_records ADD COLUMN gmap_image_key VARCHAR(255)"))
                    conn.execute(text("ALTER TABLE capture_records ADD COLUMN gmap_zoom INTEGER"))
                    conn.execute(text("ALTER TABLE capture_records ADD COLUMN gmap_captured_at TIMESTAMP"))
                    conn.commit()

            # Ensure audit columns exist even if user_id was already nullable
            audit_cols_to_check = [
                ("audit_status", "VARCHAR(30) NOT NULL DEFAULT 'APPROVAL'"),
                ("audit_comment", "TEXT"),
                ("audited_by_id", "INTEGER REFERENCES users (id)"),
                ("audited_at", "TIMESTAMP"),
                ("uploaded_by_id", "INTEGER REFERENCES users (id)"),
                ("staged_operator_id", "INTEGER REFERENCES users (id)"),
                ("qc_vhr_comment", "VARCHAR(120)"),
                ("qc_street_details", "TEXT"),
                ("qc_builder_contact", "TEXT"),
                ("qc_completed_at", "TIMESTAMP"),
                ("qc_edited_at", "TIMESTAMP"),
                ("qc_sqfeet", "VARCHAR(50)"),
                ("qc_reference_image_key", "VARCHAR(500)"),
                ("assigned_telecaller_id", "INTEGER REFERENCES users (id)"),
                ("telecaller_status", "VARCHAR(50)"),
                ("telecaller_comment", "TEXT"),
                ("telecaller_called_at", "TIMESTAMP"),
                ("telecaller_by_id", "INTEGER REFERENCES users (id)"),
                ("property_type", "VARCHAR(50)"),
                ("updated_by_id", "INTEGER REFERENCES users (id)"),
                ("updated_by_name", "VARCHAR(255)"),
                ("updated_by_role", "VARCHAR(50)"),
                ("priority_tier", "VARCHAR(100)"),
                ("govt_dtcp_permit", "BOOLEAN DEFAULT 0"),
                ("dtcp_permit_date", "VARCHAR(50)"),
                ("dtcp_application_no", "VARCHAR(100)"),
                ("area", "VARCHAR(100)"),
            ]
            for col_n, col_d in audit_cols_to_check:
                if col_n not in record_columns:
                    with engine.begin() as conn:
                        conn.execute(text(f"ALTER TABLE capture_records ADD COLUMN {col_n} {col_d}"))
            with engine.connect() as conn:
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_capture_records_assigned_telecaller_id ON capture_records (assigned_telecaller_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_capture_records_telecaller_status ON capture_records (telecaller_status)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_capture_records_property_type ON capture_records (property_type)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_capture_records_priority_tier ON capture_records (priority_tier)"))
                conn.commit()
            # Tasks dispatched before the two addresses were split copied the
            # admin's sheet address into formatted_address, so the field
            # inspection address was just a duplicate of the admin one. Clear it
            # wherever it is byte-identical to the admin text. Idempotent: once
            # cleared nothing matches again.
            with engine.connect() as conn:
                conn.execute(
                    text(
                        "UPDATE capture_records SET formatted_address = NULL "
                        "WHERE formatted_address IS NOT NULL "
                        "AND (formatted_address = site_address OR formatted_address = street_address)"
                    )
                )
                conn.commit()

            # Sanitize any legacy DD/MM/YYYY dates stored in TIMESTAMP columns
            for dt_col in ("audited_at", "qc_completed_at", "qc_edited_at"):
                if dt_col in record_columns:
                    with engine.connect() as conn:
                        conn.execute(
                            text(
                                f"UPDATE capture_records SET {dt_col} = "
                                f"substr({dt_col}, 7, 4) || '-' || substr({dt_col}, 4, 2) || '-' || substr({dt_col}, 1, 2) || ' 00:00:00' "
                                f"WHERE {dt_col} LIKE '__/__/____'"
                            )
                        )
                        conn.commit()
    except Exception:
        pass
