# Kuri Project — Enterprise Field Verification, Telecaller & Quality Audit System

[![GitHub Repository](https://img.shields.io/badge/GitHub-judosam%2Fkuri--project-181717?logo=github&logoColor=white)](https://github.com/judosam/kuri-project)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![Vite](https://img.shields.io/badge/Vite-6.0+-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![Automated Tests](https://img.shields.io/badge/Automated%20Tests-356%20Collected-success?logo=pytest&logoColor=white)](backend/tests/)
[![Security](https://img.shields.io/badge/Security-PBKDF2--SHA256%20%26%206--Tier%20RBAC-blue)](#security--privacy-architecture)
[![License](https://img.shields.io/badge/License-Proprietary-red)](#license)

**Kuri Project** is a production-grade, enterprise field intelligence, telecalling, and quality verification platform. Engineered for site inspections, civil audits, utility verifications, and customer outreach, Kuri Project pairs sub-meter GPS telemetry with cryptographic timestamping, tamper-evident visual watermarking, automated Excel dispatch with Tamil Nadu Village Master matching, multi-role workflow pipelines (Telecaller, Field Verifier, Manager, QA/Auditor, Admin), and immutable forensic audit trails.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Role-Based Access Control (6-Tier RBAC)](#role-based-access-control-6-tier-rbac)
3. [Technology Stack](#technology-stack)
4. [Key Capabilities & Enterprise Features](#key-capabilities--enterprise-features)
5. [Project Directory Structure](#project-directory-structure)
6. [Prerequisites](#prerequisites)
7. [Quick Start (1-Click Windows Launch)](#quick-start-1-click-windows-launch)
8. [Manual Development Setup](#manual-development-setup)
9. [Git Branch Strategy](#git-branch-strategy)
10. [Environment Variables Reference (`.env`)](#environment-variables-reference-env)
11. [Default Credentials & Auto-Seeding](#default-credentials--auto-seeding)
12. [Two-Wheeler Road Routing (ORS & Google Routes)](#two-wheeler-road-routing-ors--google-routes)
13. [Automated Testing & Quality Verification](#automated-testing--quality-verification)
14. [Security & Privacy Architecture](#security--privacy-architecture)
15. [API Endpoints Overview](#api-endpoints-overview)
16. [License](#license)

---

## System Architecture

```text
┌─────────────────────────────────────────┐       ┌─────────────────────────────────────────┐
│     Field Verifier App (`user-web`)     │       │       Admin Web Portal (`admin`)        │
│          (React 19 Mobile PWA)          │       │         (React 19 + TypeScript)         │
│  • Fullscreen Camera & Sensor Capture   │       │  • Admin Command Dashboard & Analytics  │
│  • Mandatory GPS Lock & Accuracy Guard  │       │  • QA / Auditor Review & Moderation     │
│  • Motorcycle Road Route Navigation     │       │  • Telecaller Calling & Leads Tracking  │
│  • Revisit & Re-inspection Submissions  │       │  • Manager Task Dispatch & Assignment   │
│  • Daily Activity Charts & Local Cache  │       │  • GIS Map (Leaflet + Satellite Tiles)  │
│  • Works on Port 5174 / LAN / PWA       │       │  • Excel Batch Importers & Audit Logs   │
└────────────────────┬────────────────────┘       └────────────────────┬────────────────────┘
                     │                                                 │
                     │ HTTP REST (JWT Bearer Auth)                     │ HTTP REST (JWT Bearer Auth)
                     ▼                                                 ▼
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                           FastAPI Backend (Python 3.12 / Uvicorn)                         │
│                                                                                           │
│  • 6-Tier RBAC Engine: SUPERADMIN, ADMIN, MANAGER, AUDITOR, TELECALLER, FIELD_VERIFIER     │
│  • Security Engine: PBKDF2-HMAC-SHA256 (200k rounds), Signed JWTs, Timing Attack Defense  │
│  • Watermark Engine: PIL High-Precision Visual Stamps (GPS, Altitude, Certified Date/Time)│
│  • GIS Snapshot Engine: 3x3 Stitched Google Satellite Tile Mosaic (Zoom 18)               │
│  • Village Master Resolver: 16k+ Village Dataset with Tamil Phonetic & Spatial Stemmer    │
│  • Routing Engine: OpenRouteService (ORS) & Google Routes Matrix (Two-Wheeler / Driving)   │
│  • Audit Engine: Immutable Security & Operational Activity Logs (Logins, Edits, Downloads)│
│  • Database ORM: SQLAlchemy 2.0 Async/Sync Sessions + Alembic Schema Migrations           │
└─────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
┌───────────────────────────────────────────┐   ┌───────────────────────────────────────────┐
│            Persistent Storage             │   │             External Services             │
│  • SQLite (`data/app.db`) or PostgreSQL   │   │  • Self-Hosted ORS (Port 8080)            │
│  • Uploaded Photos (`data/uploads/...`)   │   │  • Google Maps Geocoding & Routes API     │
│  • Satellite Mosaics (`data/gmap_cache`)  │   │  • Optional Google Drive Cloud Backup     │
└───────────────────────────────────────────┘   └───────────────────────────────────────────┘
```

---

## Role-Based Access Control (6-Tier RBAC)

Kuri Project implements strict, role-specific separation of responsibilities across both the FastAPI backend and web portals:

```text
                    ┌──────────────────────────────────────────┐
                    │        SUPERADMIN (System Admin)         │
                    │  • Exactly 1 Master Account              │
                    │  • Exclusive Forensic Audit Logs (`/logs)│
                    │  • "Promote to Super Admin" Transfer     │
                    └────────────────────┬─────────────────────┘
                                         │
                    ┌────────────────────┴─────────────────────┐
                    │              ADMIN (Admin)               │
                    │  • Full Records, Photos & GIS Mapping    │
                    │  • User Management & Password Resets     │
                    │  • Excel Task Ingestion & Lead Dispatch  │
                    └────────────────────┬─────────────────────┘
                                         │
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
┌─────────────────┐             ┌─────────────────┐             ┌─────────────────┐
│ MANAGER (Office)│             │  AUDITOR / QA   │             │   TELECALLER    │
│ • Overview KPIs │             │ • QA Dashboard  │             │ • Leads Call Hub│
│ • Lead Dispatch │             │ • Audit Reviews │             │ • Call Status   │
│ • Reassignments │             │ • Approve/Reject│             │ • Stage Tracking│
└─────────────────┘             └─────────────────┘             └─────────────────┘
                                         │
                                         ▼
                                ┌─────────────────┐
                                │ FIELD_VERIFIER  │
                                │ • PWA Mobile    │
                                │ • GPS Photo HUD │
                                │ • Road Routing  │
                                └─────────────────┘
```

### Permissions Matrix

| Feature / Module | `SUPERADMIN` | `ADMIN` | `MANAGER` | `AUDITOR` (QA) | `TELECALLER` | `FIELD_VERIFIER` / `USER` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Field Verifier PWA (`user-web`)** | Accessible | Accessible | Accessible | Accessible | Accessible | **Primary Interface** |
| **Admin Web Portal (`admin`)** | Full Access | Full Access | Full Access | Restricted | Restricted | **Blocked (HTTP 403)** |
| **Telecaller Dashboard & Records** | Full Access | Full Access | Full Access | Read-Only | **Primary Interface** | No Access |
| **QA Dashboard & Audit Review** | Full Access | Full Access | Read-Only | **Primary Interface** | No Access | No Access |
| **GIS Satellite Map View** | Full Access | Full Access | Full Access | Full Access | No Access | Route View Only |
| **Excel Sheet Task Ingestion** | Full Access | Full Access | Restricted | No Access | No Access | No Access |
| **Village Master Geocoding** | Full Access | Full Access | Full Access | View Only | View Only | Automatic |
| **User Management & Resets** | Full Access | Full Access | No Access | No Access | No Access | Self-Reset Only |
| **System Audit Logs (`/logs`)** | **Exclusive** | **Blocked** | **Blocked** | **Blocked** | **Blocked** | **Blocked** |
| **Promote Super Admin** | **Exclusive** | No Access | No Access | No Access | No Access | No Access |

---

## Technology Stack

| Component | Technology | Description & Highlights |
| :--- | :--- | :--- |
| **Backend API** | Python 3.12, FastAPI, Uvicorn | High-throughput asynchronous REST API, 356 automated tests |
| **Database & ORM** | SQLAlchemy 2.0, Alembic, SQLite / PostgreSQL | Robust migrations, ACID relational transactions, connection pooling |
| **Admin Web Portal** | React 19, TypeScript 5.7+, Vite, Tailwind CSS | Modular dashboards: Admin, QA, Manager, Telecaller, GIS Map |
| **Field Verifier App** | React 19, Vite PWA, Lucide Icons | Mobile-first camera interface, mandatory GPS locking, offline caching |
| **Security & Auth** | PBKDF2-HMAC-SHA256, JWT, Bcrypt | 200,000 hash iterations, timing-attack mitigation, zero plaintext secrets |
| **GIS & Satellite Imagery** | Leaflet, Google Satellite Tiles (Z18) | 3x3 stitched high-resolution tile mosaics, tile coordinate caching |
| **Routing Engines** | OpenRouteService (ORS) + Google Routes | Two-wheeler motorcycle pathing, road distance, and ETA matrix |
| **Geocoding & Reference Data**| Openpyxl, SQLite, Google Geocoding API | 16,000+ Tamil Nadu Village Master dataset with phonetics matching |

---

## Key Capabilities & Enterprise Features

### 1. Mandatory GPS Lock & Accuracy Telemetry
Field Verifiers cannot capture or submit records on spoofed or unverified positions. The PWA actively queries hardware GPS sensors, displaying a live accuracy radius, altitude, and heading dial. Camera capture is enabled only once satellite lock is acquired.

### 2. Forensic Visual Watermarking Engine (PIL)
Every captured image is permanently stamped at full resolution with an unalterable forensic banner:
- Latitude & Longitude to 6 decimal places (`~0.1m` precision)
- WGS84 Altitude & GPS accuracy radius in meters
- Certified ISO UTC timestamp & local date/time
- Reverse-geocoded Village, Taluk, and District
- Verified Operator badge & Record ID

### 3. Automated Excel Lead Ingestion & Dispatch
Administrators can upload bulk task spreadsheets. The ingestion pipeline:
- Validates headers and prevents duplicate records.
- Automatically normalizes phone numbers, contractor names, and stages of construction.
- Resolves missing Village, Taluk, and District entries against the local **Tamil Nadu Village Master** reference table.
- Generates 3x3 Google Satellite tile mosaics for immediate auditor inspection.
- Assigns records directly to Field Verifiers or stages them for QA review.

### 4. Telecaller Operations Hub
A dedicated interface for calling teams to:
- Follow up on prospective leads and contact contractors.
- Update Call Status (Connected, Ringing, Wrong Number, Callback Requested).
- Advance or reset the **Stage of Construction** (Basement, Lintel, Roof, Finishing, etc.).
- Maintain call notes and historical logs without altering verified field capture timestamps.

### 5. Quality Assurance (QA) & Audit Review
Auditors review captured field records with side-by-side photo lightboxes, satellite snapshots, and field metadata:
- **Approve**: Releases records to final reporting.
- **Reject**: Archives records with detailed rejection reasoning.
- **Revisit**: Flags records for a re-inspection by the Field Verifier, preserving prior photo history while clearing coordinates for a verified new capture.

### 6. Motorcycle Road Route Navigation
Field Verifiers can sequence their daily visits with **two-wheeler road routing**:
- Uses self-hosted **OpenRouteService (ORS)** or **Google Routes API** (`travelMode: TWO_WHEELER`).
- Calculates actual road distance and estimated travel time instead of straight-line distances.
- Displays turn-by-turn road routes on an interactive satellite map.

### 7. Immutable Forensic Audit Trail
Every login, password reset, user promotion, record edit, stage modification, and photo download is recorded in the `audit_logs` table with timestamp, IP address, user agent, and action category. System Audit Logs are strictly restricted to the `SUPERADMIN`.

---

## Project Directory Structure

```text
kuri-project/
├── admin/                        # Admin, QA, Manager & Telecaller Web Portal
│   ├── src/
│   │   ├── components/           # TelecallerModal, GIS Map, DecisionPanels, Charts
│   │   ├── pages/                # Dashboard, QaDashboard, TelecallerDashboard, Users, Logs
│   │   ├── services/             # Axios API client with JWT interceptor
│   │   └── types/                # TypeScript interfaces & UserRole enums
│   ├── package.json              # React 19, Leaflet, Tailwind CSS dependencies
│   └── vite.config.ts            # Vite build configuration (Port 5173)
├── user-web/                     # Field Verifier Progressive Web App (PWA)
│   ├── src/
│   │   ├── screens/              # CameraScreen, FormScreen, RecordsScreen, DashboardScreen
│   │   ├── hooks/                # useGps, useRoadRoute, usePwa, useForegroundRefresh
│   │   └── services/             # API client, dynamic server switcher, offline queue
│   ├── package.json              # React 19, basic-ssl, vite-plugin-pwa dependencies
│   └── vite.config.ts            # Vite PWA build configuration (Port 5174)
├── backend/                      # FastAPI Python Application
│   ├── app/
│   │   ├── core/                 # Config, PBKDF2 hashing, JWT security, RBAC guards
│   │   ├── database/             # SQLAlchemy engine & session factory
│   │   ├── models/               # User, CaptureRecord, CapturedImage, ActivityLog
│   │   ├── routers/              # auth, admin, records, quality, telecaller, location
│   │   ├── schemas/              # Pydantic v2 validation models
│   │   └── services/             # Watermarking, GIS Tile Mosaic, Village Master, Routing
│   ├── tests/                    # 356 automated test cases across 40 test suites
│   ├── alembic/                  # Database migration scripts
│   ├── start_dev.py              # Windows development server runner (Port 8005)
│   └── requirements.txt          # Python packages (FastAPI, SQLAlchemy, Pillow, etc.)
├── ors-server/                   # Self-Hosted OpenRouteService (Docker Compose)
│   ├── docker-compose.yml        # ORS container definition (Port 8080)
│   └── setup-ors.bat             # Batch script to setup OSM extracts and launch ORS
├── data/                         # Local database & file storage (Git ignored)
│   ├── app.db                    # Primary SQLite database
│   └── uploads/                  # Geotagged images & thumbnails partitioned by user
├── run.bat                       # 1-Click launcher: Backend (:8005), Admin (:5173), User-Web (:5174)
├── stop.bat                      # 1-Click script to terminate all active project processes
├── setup.bat                     # 1-Click dependencies installer (.venv + npm packages)
├── docker-compose.prod.yml       # Production multi-service Docker configuration
├── Dockerfile.cloudrun           # Cloud Run production container definition
├── package.json                  # Root monorepo orchestration scripts
└── README.md                     # Comprehensive project documentation
```

---

## Prerequisites

Ensure your development workstation has:

- **Operating System:** Windows 10/11 or Linux
- **Python:** v3.10 to v3.12 ([Download Python](https://www.python.org/))
- **Node.js:** v18.0+ or v20.0+ LTS ([Download Node.js](https://nodejs.org/))
- **Git:** Latest version ([Download Git](https://git-scm.com/))
- **Docker Desktop (Optional):** Required only if running self-hosted OpenRouteService (`ors-server`)

---

## Quick Start (1-Click Windows Launch)

The easiest way to get started on Windows:

### 1. Initial Setup
Double-click `setup.bat` (or run in PowerShell/CMD):
```powershell
.\setup.bat
```
*This automatically checks Python/Node, creates `backend\.venv`, installs all Python dependencies, installs node_modules in both `admin/` and `user-web/`, and generates default `.env` files.*

### 2. Start All Services
Double-click `run.bat` (or run in PowerShell/CMD):
```powershell
.\run.bat
```
This launches 3 background windows and opens your default browser:
- **Backend API:** [http://127.0.0.1:8005](http://127.0.0.1:8005) (API Docs: [http://127.0.0.1:8005/docs](http://127.0.0.1:8005/docs))
- **Admin & QA Portal:** [http://127.0.0.1:5173](http://127.0.0.1:5173)
- **Field Verifier PWA:** [http://127.0.0.1:5174](http://127.0.0.1:5174)

### 3. Stop All Services
Double-click `stop.bat` to gracefully terminate all running servers.

---

## Manual Development Setup

If running services in dedicated terminals:

### Terminal 1: Backend API (FastAPI)
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python start_dev.py
```

### Terminal 2: Admin Web Portal (React 19 + Vite)
```powershell
cd admin
npm run dev
```

### Terminal 3: Field Verifier PWA (React 19 + Vite)
```powershell
cd user-web
npm run dev
```

---

## Git Branch Strategy

This repository is maintained at: **[https://github.com/judosam/kuri-project.git](https://github.com/judosam/kuri-project.git)**

The repository follows a structured 4-branch workflow:

| Branch | Purpose | Deployment Target |
| :--- | :--- | :--- |
| **`production`** | Production-ready, verified releases | Production Cloud Server / VM |
| **`testing`** | QA, staging, and acceptance verification | Staging test environment |
| **`developer`** | Active feature development & integration | Local development & testing |
| **`main`** | Stable baseline root branch | Core repository default |

---

## Environment Variables Reference (`.env`)

The project uses a root `.env` configuration file that is automatically shared across the backend and frontend Vite builds:

```env
# Application Settings
PROJECT_NAME="Kuri Project API"
DEBUG=False

# Security (JWT & PBKDF2)
SECRET_KEY="generate-a-strong-random-secret-key-for-production"
ACCESS_TOKEN_EXPIRE_MINUTES=480
ALGORITHM="HS256"

# Default System Admin Provisioning
ADMIN_EMAIL="admin@photocapture.local"
ADMIN_PASSWORD="admin123"
ADMIN_NAME="System Admin"

# Database Configuration
DATABASE_URL="sqlite:///./data/app.db"
# For PostgreSQL in production:
# DATABASE_URL="postgresql://user:password@localhost:5432/kuri_db"

# CORS Configuration
CORS_ORIGINS="http://localhost:3000,http://localhost:5173,http://localhost:5174,http://localhost:8005"

# Google Maps Platform (Optional for Geocoding & Satellite)
GOOGLE_GEOCODING_API_KEY=""
GOOGLE_ROUTES_API_KEY=""
GOOGLE_STREETVIEW_API_KEY=""

# OpenRouteService (Self-Hosted Two-Wheeler Routing)
OPENROUTESERVICE_BASE_URL="http://localhost:8080/ors"
OPENROUTESERVICE_API_KEY=""

# Google Maps Satellite Tile Mosaic Snapshot
GMAP_SNAPSHOT_ENABLED=True
GMAP_SNAPSHOT_ZOOM=18
GMAP_SNAPSHOT_TILE_GRID=3
GMAP_SNAPSHOT_TIMEOUT_SECONDS=10.0
GMAP_SNAPSHOT_MAX_PER_IMPORT=400
```

---

## Default Credentials & Auto-Seeding

On initial backend startup, if no users exist, the system automatically creates a master administrator account:

| Role | Email | Password | Description |
| :--- | :--- | :--- | :--- |
| **`SUPERADMIN`** | `admin@photocapture.local` | `admin123` | Master System Admin with access to audit logs and user management. |
| **`ADMIN`** | Created by Super Admin | Set by Super Admin | Operational Admin with records, imports, and map management. |
| **`MANAGER`** | Created by Admin | Set by Admin | Management oversight and lead dispatch. |
| **`AUDITOR`** | Created by Admin | Set by Admin | QA reviewer for inspecting and approving/rejecting captures. |
| **`TELECALLER`** | Created by Admin | Set by Admin | Calling operator for customer outreach and stage tracking. |
| **`FIELD_VERIFIER`**| Created by Admin | Set by Admin | Field verifier for PWA mobile geotagged photo capture. |

> [!TIP]
> Administrators can update credentials at any time directly through the web UI via the **Account Settings** modal. Passwords can also be reset with the 1-click password generator.

---

## Two-Wheeler Road Routing (ORS & Google Routes)

Kuri Project supports two routing backends for optimizing motorcycle routes:

1. **Self-Hosted OpenRouteService (`ors-server/`):**
   - Completely free with zero external API billing.
   - Run `ors-server\setup-ors.bat` to download OpenStreetMap extracts and start the Docker container on port `8080`.
   - The backend automatically detects `OPENROUTESERVICE_BASE_URL=http://localhost:8080/ors`.

2. **Google Routes API:**
   - Set `GOOGLE_ROUTES_API_KEY` in `.env`.
   - Uses `travelMode: TWO_WHEELER` with the Google Route Matrix API for real-time traffic-aware motorcycle routing.

---

## Automated Testing & Quality Verification

Kuri Project includes an extensive test suite of **356 automated tests** in `backend/tests/`:

```powershell
# Run the complete test suite
cd backend
.\.venv\Scripts\pytest.exe tests/ -v

# Run specific test modules
.\.venv\Scripts\pytest.exe tests/test_security.py
.\.venv\Scripts\pytest.exe tests/test_audit_gateway.py
.\.venv\Scripts\pytest.exe tests/test_watermark.py
.\.venv\Scripts\pytest.exe tests/test_road_routes.py
```

### Key Test Categories:
- **`test_cyber_security.py`**: SQL injection, path traversal, brute force protection, timing attack mitigations.
- **`test_data_leakage.py`**: Ensures passwords, salts, and secret keys never leak in audit logs or API responses.
- **`test_audit_gateway.py`**: Staged task sheets, auditor review pipelines, and release workflows.
- **`test_road_routes.py`**: Two-wheeler routing, distance matrix calculations, and waypoint sequencing.
- **`test_watermark.py`**: Visual watermark layout, coordinate hemispheres, and dynamic canvas rendering.
- **`test_village_master_service.py`**: Tamil phonetic stemming and location auto-resolution.

---

## Security & Privacy Architecture

- **PBKDF2-HMAC-SHA256 Password Hashing:** Passwords are hashed with 200,000 rounds of PBKDF2 using a 16-byte cryptographically secure pseudorandom salt.
- **Timing-Attack Defense:** Failed authentication attempts perform dummy PBKDF2 computations to ensure constant-time response profiles.
- **Zero-Visibility Admin Resets:** Admins can reset user passwords using high-entropy generated keys, but can never view, decrypt, or export existing user passwords.
- **Mandatory GPS Geofencing:** Client coordinates are validated against hardware telemetry to prevent manual or mock coordinate submissions.
- **Immutable Security Logs:** Forensic audit records cannot be edited or deleted by standard administrators or database operations.

---

## API Endpoints Overview

Interactive OpenAPI / Swagger documentation is available at: **[http://localhost:8005/docs](http://localhost:8005/docs)**

### Public Endpoints
- `GET /health` — Health check and database liveness probe
- `POST /api/auth/login` — OAuth2 JWT token authentication
- `POST /api/auth/reset-password` — Field user self-service password reset

### Authenticated Core Endpoints
- `GET /api/auth/me` — Current user profile and permissions
- `PUT /api/auth/profile` — Self profile and password update
- `GET /api/records` — Filtered records list with pagination and search
- `POST /api/records` — Create inspection record and trigger dynamic watermarking
- `GET /api/records/{id}` — Inspection detail with photo gallery and telemetry

### Quality & Audit Review (`/api/admin/quality`)
- `GET /api/admin/qa-dashboard` — Quality assurance metrics and pending inspections
- `POST /api/admin/records/{id}/review` — Approve, reject, or mark revisit with audit reasons

### Telecaller Hub (`/api/admin/telecaller`)
- `GET /api/admin/telecaller/dashboard` — Calling statistics and pending leads
- `GET /api/admin/telecaller/records` — Assigned telecalling records list
- `PUT /api/admin/telecaller/records/{id}/status` — Update call status and stage of construction

### Management & User Administration (`/api/admin`)
- `GET /api/admin/dashboard` — Aggregated operational metrics and activity charts
- `GET /api/admin/users` — User management with role filtering
- `POST /api/admin/users` — Create user account with auto-generated strong password
- `POST /api/admin/users/{id}/reset-password` — Admin password override
- `GET /api/admin/logs` — Superadmin exclusive forensic audit logs

---

## License

Proprietary enterprise software — internal field operations and audit use. All rights reserved.
Maintainer: **Samuel P ([judosam](https://github.com/judosam))**.
