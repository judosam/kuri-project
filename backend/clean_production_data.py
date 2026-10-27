"""
Production Data Cleanup Script for PhotoCapture
Purges all test data, resets auto-increment sequences, cleans uploaded test images,
and ensures admin credentials match the .env configuration.
"""

import os
import shutil
import sqlite3
import sys
from pathlib import Path

# Add backend directory to sys.path so app modules can be imported
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from app.core.config import get_settings
from app.core.security import hash_password

def clean_data():
    settings = get_settings()
    db_path = backend_dir / "data" / "app.db"
    uploads_dir = backend_dir / "data" / "uploads"
    root_scratch_dir = backend_dir.parent / "scratch"

    print(f"=== PhotoCapture Production Data Purge ===")
    print(f"Database: {db_path}")
    print(f"Uploads Directory: {uploads_dir}")

    if not db_path.exists():
        print(f"Database {db_path} does not exist. Nothing to purge.")
        return

    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    # 1. Purge capture data and logs
    print("\n1. Purging test records and logs...")
    cursor.execute("DELETE FROM captured_images;")
    deleted_images = cursor.rowcount
    print(f"   - Deleted {deleted_images} captured image rows")

    cursor.execute("DELETE FROM capture_records;")
    deleted_records = cursor.rowcount
    print(f"   - Deleted {deleted_records} capture record rows")

    cursor.execute("DELETE FROM activity_logs;")
    deleted_logs = cursor.rowcount
    print(f"   - Deleted {deleted_logs} activity log rows")

    # 2. Purge test non-admin users
    print("\n2. Purging test field users...")
    cursor.execute("DELETE FROM users WHERE role != 'ADMIN';")
    deleted_users = cursor.rowcount
    print(f"   - Deleted {deleted_users} test field users")

    # 3. Reset auto-increment sequences for cleaned tables
    print("\n3. Resetting auto-increment ID counters...")
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence';")
    if cursor.fetchone():
        cursor.execute("DELETE FROM sqlite_sequence WHERE name IN ('capture_records', 'captured_images', 'activity_logs');")
        print("   - Reset sqlite_sequence for capture_records, captured_images, activity_logs to 1")
    else:
        print("   - Standard SQLite ROWID table (resets automatically when empty)")

    # 4. Sync admin credentials from .env
    admin_email = (settings.ADMIN_EMAIL or "admin@photocapture.local").strip().lower()
    admin_password = settings.ADMIN_PASSWORD or "admin123"
    admin_name = settings.ADMIN_NAME or "System Admin"
    password_hash = hash_password(admin_password)

    print(f"\n4. Syncing admin credentials from environment...")
    print(f"   - Admin Email: {admin_email}")
    print(f"   - Admin Name:  {admin_name}")

    cursor.execute("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1;")
    admin_row = cursor.fetchone()
    if admin_row:
        admin_id = admin_row[0]
        cursor.execute(
            """
            UPDATE users
            SET email = ?, password_hash = ?, full_name = ?, is_active = 1
            WHERE id = ?
            """,
            (admin_email, password_hash, admin_name, admin_id),
        )
        print(f"   - Updated admin account (ID: {admin_id}) to match .env")
    else:
        cursor.execute(
            """
            INSERT INTO users (email, password_hash, full_name, role, is_active)
            VALUES (?, ?, ?, 'ADMIN', 1)
            """,
            (admin_email, password_hash, admin_name),
        )
        print("   - Created fresh admin account matching .env")

    conn.commit()

    # Verify counts after purge
    print("\nDatabase verification after purge:")
    for table in ["capture_records", "captured_images", "activity_logs", "users"]:
        cursor.execute(f"SELECT count(*) FROM {table}")
        count = cursor.fetchone()[0]
        print(f"   - {table}: {count} row(s)")

    conn.close()

    def on_rm_error(func, path, exc_info):
        import stat
        try:
            os.chmod(path, stat.S_IWRITE)
            func(path)
        except Exception:
            pass

    # 5. Clean uploads directory
    print("\n5. Cleaning physical upload files...")
    if uploads_dir.exists():
        for item in uploads_dir.iterdir():
            if item.is_dir():
                shutil.rmtree(item, onerror=on_rm_error)
                print(f"   - Removed upload directory: {item.name}")
            elif item.is_file() and item.name != ".gitkeep":
                try:
                    item.unlink()
                    print(f"   - Removed upload file: {item.name}")
                except Exception:
                    pass
    uploads_dir.mkdir(parents=True, exist_ok=True)
    print("   - Uploads folder is clean and ready for production.")

    # 6. Remove root scratch folder if present
    if root_scratch_dir.exists():
        print(f"\n6. Removing temporary build/debug scratch folder: {root_scratch_dir}")
        shutil.rmtree(root_scratch_dir, onerror=on_rm_error)
        print("   - Removed scratch directory successfully.")

    print("\n=== Cleanup Complete! System is production-ready. ===")

if __name__ == "__main__":
    clean_data()
