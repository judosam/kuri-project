import sqlite3
import json
import os

DB_PATH = os.environ.get("TARGET_DB", "/opt/photocapture/backend/data/app.db")
JSON_PATH = os.path.join(os.path.dirname(__file__), "district_unique_ids.json")

print(f"Opening database: {DB_PATH}")
con = sqlite3.connect(DB_PATH)
cur = con.cursor()

# 1. Ensure set_name column exists
cur.execute("PRAGMA table_info(capture_records)")
cols = [c[1] for c in cur.fetchall()]
if "set_name" not in cols:
    print("Adding set_name column...")
    cur.execute("ALTER TABLE capture_records ADD COLUMN set_name VARCHAR(100)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_capture_records_set_name ON capture_records (set_name)")
    con.commit()

# 2. Load district uids
with open(JSON_PATH, "r", encoding="utf-8") as f:
    district_uids = json.load(f)
print(f"Loaded {len(district_uids)} district UIDs from {JSON_PATH}")

# 3. Categorize
print("Categorizing records...")
cur.execute("BEGIN TRANSACTION")
cur.execute("UPDATE capture_records SET set_name = NULL")
cur.executemany("UPDATE capture_records SET set_name = ? WHERE UPPER(old_unique_id) = ?", [("CBE District", uid) for uid in district_uids])
cur.execute("UPDATE capture_records SET set_name = 'Manually Added by QA' WHERE set_name IS NULL AND source IN ('qa_portal', 'qa')")
cur.execute("UPDATE capture_records SET set_name = 'Manually Added by Field User' WHERE set_name IS NULL AND source = 'manual'")
cur.execute("UPDATE capture_records SET set_name = 'CBE Corporation' WHERE set_name IS NULL")
con.commit()

# 4. Verification
cur.execute("SELECT set_name, count(*) FROM capture_records GROUP BY set_name ORDER BY count(*) DESC")
rows = cur.fetchall()
print("Final Categorization Breakdown:")
for set_name, count in rows:
    print(f"  {set_name}: {count}")
con.close()
