import sqlite3
import os
import shutil
from datetime import datetime

DB_PATHS = ['backend/data/app.db', 'data/app.db']

for db_path in DB_PATHS:
    if not os.path.exists(db_path):
        print(f"Skipping {db_path} (does not exist)")
        continue
    
    # 1. Safety backup
    backup_path = f"{db_path}.bak_pre_migration_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(db_path, backup_path)
    print(f"Created safety backup: {backup_path}")

    con = sqlite3.connect(db_path)
    cur = con.cursor()

    # Check columns
    cur.execute("PRAGMA table_info(capture_records)")
    existing_cols = [r[1] for r in cur.fetchall()]
    print(f"Processing {db_path} with {len(existing_cols)} columns...")

    # Drop index if exists
    try:
        cur.execute("DROP INDEX IF EXISTS idx_rec_status_visit_order")
        print("Dropped index idx_rec_status_visit_order")
    except Exception as e:
        print(f"Index drop note: {e}")

    # Drop visit_order column if exists
    if "visit_order" in existing_cols:
        try:
            cur.execute("ALTER TABLE capture_records DROP COLUMN visit_order")
            print("Successfully dropped column 'visit_order' from capture_records")
        except Exception as e:
            print(f"Error dropping visit_order: {e}")
    else:
        print("'visit_order' column already absent")

    # Add updated_by_id, updated_by_name, updated_by_role
    cur.execute("PRAGMA table_info(capture_records)")
    current_cols = [r[1] for r in cur.fetchall()]
    
    if "updated_by_id" not in current_cols:
        cur.execute("ALTER TABLE capture_records ADD COLUMN updated_by_id INTEGER REFERENCES users(id)")
        print("Added column updated_by_id")
    if "updated_by_name" not in current_cols:
        cur.execute("ALTER TABLE capture_records ADD COLUMN updated_by_name VARCHAR(255)")
        print("Added column updated_by_name")
    if "updated_by_role" not in current_cols:
        cur.execute("ALTER TABLE capture_records ADD COLUMN updated_by_role VARCHAR(50)")
        print("Added column updated_by_role")

    # Correct Lead Location for CBE-110154-769878
    cur.execute("""
        UPDATE capture_records
        SET village = 'Pappanaickenpalayam',
            taluk = 'Coimbatore North',
            district = 'Coimbatore',
            updated_at = datetime('now')
        WHERE unique_id = 'CBE-110154-769878' OR id = 2927
    """)
    print(f"Updated lead CBE-110154-769878 location. Rows affected: {cur.rowcount}")

    con.commit()
    con.close()
    print(f"Migration completed successfully for {db_path}\n")
