#!/bin/bash
set -e

PORT="${PORT:-8080}"
echo "========================================================"
echo " Starting PhotoCapture Container on Cloud Run (Port $PORT)"
echo "========================================================"

# 1. Substitute PORT into Nginx configuration
sed -i "s/PORT_PLACEHOLDER/$PORT/g" /etc/nginx/conf.d/photocapture.conf

# 2. Ensure data and upload directories exist on persistent storage and local container disk
DATA_DIR="${DATA_DIR:-/mnt/data}"
mkdir -p "$DATA_DIR/data" "$DATA_DIR/uploads"
mkdir -p "/app/data"

# SQLite MUST run on a local POSIX filesystem (/app/data/app.db).
# Running SQLite directly on Google Cloud Storage FUSE (/mnt/data) causes
# "sqlite3.OperationalError: disk I/O error" because GCS does not support POSIX locks or atomic updates.

TRIGGER_MARKER="$DATA_DIR/data/.last_trigger"
CURRENT_TRIGGER="${DB_RELOAD_TRIGGER:-none}"
RELOAD_FORCED=0

if [ "$CURRENT_TRIGGER" != "none" ] && [ -f "/app/seed/app.db" ]; then
    LAST_TRIGGER=""
    [ -f "$TRIGGER_MARKER" ] && LAST_TRIGGER=$(cat "$TRIGGER_MARKER" 2>/dev/null || true)
    if [ "$CURRENT_TRIGGER" != "$LAST_TRIGGER" ]; then
        echo "DB_RELOAD_TRIGGER changed ($LAST_TRIGGER -> $CURRENT_TRIGGER): restoring database from bundled seed..."
        cp "/app/seed/app.db" /app/data/app.db
        cp "/app/seed/app.db" "$DATA_DIR/data/app.db"
        echo "$CURRENT_TRIGGER" > "$TRIGGER_MARKER"
        RELOAD_FORCED=1
    fi
fi

if [ "$RELOAD_FORCED" -ne 1 ]; then
    if [ -f "$DATA_DIR/data/app.db" ]; then
        echo "Loading database from GCS persistent storage ($DATA_DIR/data/app.db)..."
        cp "$DATA_DIR/data/app.db" /app/data/app.db
    elif [ -f "/app/seed/app.db" ]; then
        echo "Initializing database from bundled seed (/app/seed/app.db)..."
        cp "/app/seed/app.db" /app/data/app.db
    else
        echo "No database found on GCS or seed — creating fresh local database."
    fi
fi

# Ensure initial sync to GCS if GCS copy does not exist yet
if [ ! -f "$DATA_DIR/data/app.db" ] && [ -f "/app/data/app.db" ]; then
    cp /app/data/app.db "$DATA_DIR/data/app.db" || true
fi

export DATABASE_URL="sqlite:////app/data/app.db"
export LOCAL_STORAGE_DIR="$DATA_DIR/uploads"
export SECRET_KEY="${SECRET_KEY:-dev-secret-key-change-in-production}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@system.local}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
export ADMIN_NAME="${ADMIN_NAME:-System Admin}"
export ACCESS_TOKEN_EXPIRE_MINUTES="${ACCESS_TOKEN_EXPIRE_MINUTES:-1440}"
export CORS_ORIGINS="${CORS_ORIGINS:-*}"
export DEBUG="${DEBUG:-false}"

if [ -f "/app/credentials/credentials.json" ]; then
    export GOOGLE_DRIVE_CREDENTIALS_PATH="/app/credentials/credentials.json"
fi
export GOOGLE_DRIVE_ROOT_FOLDER_ID="${GOOGLE_DRIVE_ROOT_FOLDER_ID:-1nDHmQQE-0dYsymZr73pnF_5E6KwZFL2G}"
# Google API keys come from Cloud Run environment variables or /app/.env (copied from the project root)
if [ -n "$GOOGLE_GEOCODING_API_KEY" ]; then
    export GOOGLE_GEOCODING_API_KEY="$GOOGLE_GEOCODING_API_KEY"
fi
if [ -n "$GOOGLE_ROUTES_API_KEY" ]; then
    export GOOGLE_ROUTES_API_KEY="$GOOGLE_ROUTES_API_KEY"
fi
if [ -n "$OPENROUTESERVICE_BASE_URL" ]; then
    export OPENROUTESERVICE_BASE_URL="$OPENROUTESERVICE_BASE_URL"
fi
if [ -n "$OPENROUTESERVICE_API_KEY" ]; then
    export OPENROUTESERVICE_API_KEY="$OPENROUTESERVICE_API_KEY"
fi

echo "Database URL: $DATABASE_URL"
echo "Local Storage Dir: $LOCAL_STORAGE_DIR"

# 3. Start FastAPI Backend in Background
echo "Starting FastAPI / Uvicorn on 127.0.0.1:8000..."
python3 -m uvicorn app.main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --workers 1 \
    --proxy-headers \
    --forwarded-allow-ips "*" &
BACKEND_PID=$!

# Background sync daemon: periodically snapshot local DB to GCS persistent storage when modified
db_sync_daemon() {
    LAST_MTIME=$(stat -c %Y /app/data/app.db 2>/dev/null || echo 0)
    while true; do
        sleep 15
        if [ -f "/app/data/app.db" ]; then
            CURRENT_MTIME=$(stat -c %Y /app/data/app.db 2>/dev/null || echo 0)
            if [ "$CURRENT_MTIME" != "$LAST_MTIME" ]; then
                cp /app/data/app.db "$DATA_DIR/data/app.db" 2>/dev/null && LAST_MTIME="$CURRENT_MTIME" || true
            fi
        fi
    done
}
db_sync_daemon &
SYNC_PID=$!

# Trap signals for graceful shutdown
cleanup() {
    echo "Received termination signal. Shutting down..."
    kill -TERM "$SYNC_PID" 2>/dev/null || true
    kill -TERM "$BACKEND_PID" 2>/dev/null || true
    nginx -s quit 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

# 4. Wait briefly for backend to initialize
BACKEND_OK=0
for i in {1..30}; do
    if curl -s http://127.0.0.1:8000/health >/dev/null 2>&1; then
        echo "Backend is ready and healthy!"
        BACKEND_OK=1
        break
    fi
    echo "Waiting for backend ($i/30)..."
    sleep 1
done

if [ "$BACKEND_OK" -ne 1 ]; then
    echo "FATAL: Backend failed to start. Exiting container so Cloud Run captures the error."
    exit 1
fi

# 5. Start Nginx in Foreground
echo "Starting Nginx listening on port $PORT..."
nginx -g "daemon off;"
