# PhotoCapture — Enterprise Field Intelligence & Geo-Verification System

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.76-61DAFB?logo=react&logoColor=black)](https://reactnative.dev)
[![Expo](https://img.shields.io/badge/Expo%20SDK-52-000020?logo=expo&logoColor=white)](https://expo.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![Tests](https://img.shields.io/badge/Automated%20Tests-120%20Passed%20(100%25)-success?logo=pytest&logoColor=white)](backend/tests/)
[![Security](https://img.shields.io/badge/Security-Data%20Leakage%20%26%20RBAC%20Hardened-blue)](#security--privacy-architecture)
[![License](https://img.shields.io/badge/License-Proprietary-red)](#license)

**PhotoCapture** is a production-ready, enterprise-grade field photo verification and geotagging platform. Engineered for site inspections, civil audits, utility surveys, and field operations, PhotoCapture couples sub-meter GPS telemetry with cryptographic timestamping, tamper-evident visual watermarking, strict 3-tier Role-Based Access Control (RBAC), and forensic-grade immutable audit logging.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Role-Based Access Control (3-Tier RBAC)](#role-based-access-control-3-tier-rbac)
3. [Technology Stack](#technology-stack)
4. [Key Capabilities & Enterprise Features](#key-capabilities--enterprise-features)
5. [Project Directory Structure](#project-directory-structure)
6. [Prerequisites](#prerequisites)
7. [Quick Start (VS Code 3-Terminal Setup)](#quick-start-vs-code-3-terminal-setup)
8. [Alternative NPM Root Scripts](#alternative-npm-root-scripts)
9. [First-Time Environment Setup](#first-time-environment-setup)
10. [Default Credentials & Auto-Seeding](#default-credentials--auto-seeding)
11. [Environment Variables Reference (`.env`)](#environment-variables-reference-env)
12. [Cloud Deployment & Server Host Configuration](#cloud-deployment--server-host-configuration)
13. [Connecting Physical Mobile Devices (LAN Setup)](#connecting-physical-mobile-devices-lan-setup)
14. [Standalone Mobile APK (v1.0.0)](#standalone-mobile-apk-v100)
15. [Automated Testing & Security Verification (120 Tests)](#automated-testing--security-verification-120-tests)
16. [Security & Privacy Architecture](#security--privacy-architecture)
17. [API Endpoints Overview](#api-endpoints-overview)
18. [Troubleshooting FAQ](#troubleshooting-faq)
19. [License](#license)

---

## System Architecture

```text
┌────────────────────────────────────────┐       ┌────────────────────────────────────────┐
│        Expo Mobile App (React Native)  │       │       Admin Web Portal (React 19)      │
│  - Field Camera & Geofence GPS Sensor  │       │  - Command Dashboard & Live Telemetry │
│  - Animated GPS Compass Dial Loader    │       │  - Single-Screen Record Inspections    │
│  - Discrete Server Icon Switcher       │       │  - Zero-Visibility User Password Reset │
│  - Self-Service Operator Password Reset│       │  - Leaflet GIS Mapping & Cluster View  │
│  - Offline Cache & Standalone APK      │       │  - Super Admin Audit Trail & Promotion │
└───────────────────┬────────────────────┘       └───────────────────┬────────────────────┘
                    │                                                │
                    │ HTTP REST (JWT Bearer Auth)                    │ HTTP REST (JWT Bearer Auth)
                    ▼                                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           FastAPI Backend (Python 3.12 / Uvicorn)                       │
│                                                                                         │
│  • RBAC Engine: 3-Tier Security (SUPERADMIN, ADMIN, USER) with strict route guards     │
│  • Auth Engine: OAuth2 Password Flow, Bcrypt Password Hashing, Signed JWT Tokens        │
│  • Audit Engine: Immutable security & operational activity logs (Logins, Edits, DLs)   │
│  • Watermark Engine: PIL High-Precision Visual Stamps (GPS, Altitude, Certified Time)  │
│  • Storage Engine: Hierarchical Local Disk Storage + Optional Google Drive Backup       │
│  • Database ORM: SQLAlchemy 2.0 Async/Sync Sessions + Pydantic v2 Validation Schemas   │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
                                            ▼
                    ┌─────────────────────────────────────────────────┐
                    │               Persistent Storage                │
                    │  - SQLite / PostgreSQL (`data/app.db`)         │
                    │  - Local Uploads (`data/uploads/<user>/<rec>/`) │
                    │  - Optional Google Drive Cloud Sync             │
                    └─────────────────────────────────────────────────┘
```

---

## Role-Based Access Control (3-Tier RBAC)

PhotoCapture enforces a strict three-tier authorization hierarchy across both the FastAPI backend and React Admin Portal:

```text
                    ┌──────────────────────────────────────┐
                    │      SUPERADMIN (System Admin)       │
                    │  - Exactly 1 Master Account          │
                    │  - Exclusive System Audit Logs       │
                    │  - "Promote to Super Admin" Transfer │
                    └──────────────────┬───────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────┐
                    │            ADMIN (Admin)             │
                    │  - Records, Photos & GIS Map         │
                    │  - User Management & Password Resets │
                    │  - Audit Logs strictly HIDDEN (403)  │
                    └──────────────────┬───────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────┐
                    │         USER (Field Operator)        │
                    │  - Mobile Camera App Only            │
                    │  - Photo Geotagging & Personal Cache │
                    │  - Admin Web Portal BLOCKED (403)    │
                    └──────────────────────────────────────┘
```

### Permissions Matrix

| Feature / Action | `SUPERADMIN` (System Admin) | `ADMIN` (Admin) | `USER` (Field Operator) |
| :--- | :---: | :---: | :---: |
| **Mobile Camera App** | Access Allowed | Access Allowed | Full Access (Primary) |
| **Admin Web Portal Login** | Allowed | Allowed | **Blocked (HTTP 403)** |
| **Dashboard Analytics & Telemetry** | Full Access | Full Access | No Access |
| **Record Moderation & Map View** | Full Access | Full Access | Personal Records Only |
| **Photo Viewing & Downloads** | Full Access (Logged) | Full Access (Logged) | Personal Photos Only |
| **User Creation & Password Resets** | Full Access | Full Access | Self-Service Reset Only |
| **Deactivate Users** | Any `USER` or `ADMIN` | `USER` only | No Access |
| **System Audit Logs (`/logs`)** | **Exclusive Access** | **Hidden & Blocked (HTTP 403)** | **Blocked (HTTP 403)** |
| **Promote to Super Admin** | **Exclusive Action** | No Access | No Access |
| **Deactivation Protection** | **Cannot be Deactivated** | Protected from fellow Admins | N/A |

### Key Security Guarantees:
1. **Strictly Single Super Admin:** There is exactly **one** `SUPERADMIN` in the system at any given moment. To change the System Admin, the current `SUPERADMIN` uses the **"Promote to Super Admin"** action on any `ADMIN`. This transfers master ownership to the target admin and automatically demotes the caller to `ADMIN`.
2. **Audit Log Isolation:** System Audit Logs (`GET /api/admin/logs`) capture sensitive forensic data (client IPs, user agent, event categories, failure telemetry). Only the `SUPERADMIN` can view or query this endpoint. Standard `ADMIN` users receive an immediate `HTTP 403 Forbidden` and do not see the navigation item in the web interface.
3. **Portal Rejection for Field Operators:** The `USER` role is reserved exclusively for the mobile app. Attempts by field operators to log into the Admin Web Portal are rejected with an explicit access denied error.

---

## Technology Stack

| Tier | Technologies | Highlights |
| :--- | :--- | :--- |
| **Backend API** | Python 3.12, FastAPI, Uvicorn, SQLAlchemy 2.0, Pydantic v2, Pillow (PIL), Pytest | High-throughput async endpoints, cryptographic watermark engine, 120 automated tests |
| **Admin Portal** | React 19, TypeScript 5.6, Vite, Tailwind CSS, Leaflet GIS, Lucide Icons | Live telemetry cards, GIS map with cluster markers, zero-visibility user password resets |
| **Mobile App** | React Native 0.76, Expo SDK 52, Expo Camera, Expo Location, AsyncStorage | Animated GPS compass dial loader, discrete server switcher icon, standalone release APK |
| **Security & RBAC** | JWT (HS256), Bcrypt salted hashing (`$2b$12$...`), 3-tier RBAC | Passwords one-way hashed, zero admin visibility into secrets, immutable audit trails |
| **Storage** | Local structured disk storage, optional Google Drive API v3 | Automatic sub-directory partitioning by user ID and record ID |

---

## Key Capabilities & Enterprise Features

### 1. High-Precision Visual Watermarking (PIL)
- **Automatic Field Overlay:** When an operator captures a photo, the backend Pillow engine calculates dynamic typography scaling and permanently renders a certified watermark banner into the image canvas.
- **Embedded Telemetry:** Includes Latitude & Longitude to 6 decimal places (`~0.1m` sub-meter precision), WGS84 Altitude, GPS accuracy radius in meters, ISO UTC timestamp, reverse geocoded human-readable location name, and operator identification badge.

### 2. Admin Photo Download Audit Logging
- **Forensic Download Tracking:** Every time an administrator downloads a record photo (via the photo HUD download button, the full-resolution lightbox viewer, or direct API access with `?download=true`), an immutable audit log entry is recorded with action `IMAGE_DOWNLOAD`, the image filename, record ID, admin ID, and client IP address.
- **Dedicated Photos Audit Tab:** The Super Admin audit log interface includes a dedicated **Photos** tab with download indicators and filtered query capabilities.

### 3. Animated GPS Compass Dial Loader
- Inspired by tactical aerospace instruments (adapted from Uiverse `ancient-yak-42`).
- Features a **3D faceted dual-pointer compass needle**, continuous **active scanning radar arc**, **radial cardinal dial ticks (N, E, S, W)**, and a **live satellite telemetry readout pill** with a pulsing GPS lock indicator.

### 4. Discrete Server Switcher via Dedicated Header Icon
- **Clean Mobile UI:** The sign-in screen contains no distracting text pills or URL banners. A clean, frosted circular button with a white server icon (`server-outline`) sits discreetly in the top-right corner of the brand header.
- **Interactive Configuration Modal:** Tapping the icon opens the **Backend Server URL Modal**, allowing operators to select the default Cloud Server (`http://34.93.182.141/api`), the 1-tap local PC preset (`http://192.168.21.27:8000`), or input any custom server IP with a live **"Test Connection"** health probe.

### 5. Zero-Visibility User Password Architecture & Resets
- **Zero Plaintext Password Exposure:** Passwords are cryptographically salted and hashed with bcrypt (`$2b$12$...`). Plaintext passwords are never stored in the database or server logs. Administrators can reset an operator's password but can **never view or decrypt their current password**.
- **Admin Password Generator:** The Admin Portal includes a 1-click **"Generate Strong Password"** button and an instant **"Copy Password"** tool so admins can safely dispatch replacement credentials.
- **Mobile Sign-In Reset:** Field users who forget their credentials can tap **"Reset Password?"** directly on the sign-in form and verify their registered email to set a new password.
- **In-App Dashboard Reset:** Logged-in operators can update their password at any time via the dedicated key icon in the mobile dashboard header.

### 6. Pinned Brand Header & Keyboard Avoidance
- In the mobile login screen, the brand hero header is firmly anchored to the top of the viewport and never jumps off-screen when the virtual keyboard opens.
- Only the input form glides smoothly using native keyboard avoidance.

### 7. Zero-Downtime Admin Credential Updates
- Administrators can change their email address, display name, and password **at any time directly from the live web UI** via the **Admin Account Settings** modal without restarting or interrupting backend processes.

---

## Project Directory Structure

```text
camara app/
├── backend/                      # FastAPI Python backend application
│   ├── app/                      # Application source code
│   │   ├── core/                 # Config (Pydantic Settings), security (Bcrypt, JWT, RBAC dependencies)
│   │   ├── database/             # SQLAlchemy connection & session factories
│   │   ├── models/               # ORM Models (User, Record, Photo, AuditLog)
│   │   ├── routers/              # REST Endpoints (auth, admin, records, uploads)
│   │   ├── schemas/              # Pydantic validation request/response schemas
│   │   └── services/             # Storage, activity logging, PIL watermark engine
│   ├── data/                     # Persistent SQLite DB (app.db) & image uploads
│   ├── tests/                    # Pytest test suite (120 automated tests)
│   │   ├── conftest.py           # Shared test fixtures & client mocks
│   │   ├── test_activity_logs.py # Audit logging tests (including image downloads)
│   │   ├── test_admin_reset_password.py # Password reset tests
│   │   ├── test_auth.py          # Authentication & token verification tests
│   │   ├── test_cyber_security.py# Security penetration & attack simulation tests
│   │   ├── test_data_leakage.py  # Credential exposure & cross-tenant leak tests
│   │   ├── test_location_cache.py# Reverse geocode caching tests
│   │   ├── test_photo_metadata.py# EXIF & watermark metadata tests
│   │   ├── test_records.py       # Record CRUD tests
│   │   ├── test_roles_and_permissions.py # 3-tier RBAC & Super Admin promotion tests
│   │   ├── test_security.py      # Token validation & route guard tests
│   │   ├── test_upload_flow.py   # Multi-photo multipart uploads, thumbnail generation, watermark stamping
│   │   ├── test_user_dashboard.py# User telemetry & summary tests
│   │   └── test_user_isolation.py# Cross-user record boundary tests
│   ├── .env                      # Local backend environment configuration
│   ├── pyproject.toml            # Python dependencies and packaging
│   ├── start_dev.py              # Windows-compatible dev server launcher (0.0.0.0:8000)
│   ├── allow-firewall.ps1        # PowerShell script to open inbound port 8000
│   └── show_lan_ip.py            # Utility script to display local Wi-Fi IP address
├── admin/                        # Admin Web Portal (React 19 + Vite + TypeScript)
│   ├── src/
│   │   ├── components/           # UI controls, PromoteSuperAdminModal, ResetPasswordModal, Leaflet GIS
│   │   ├── pages/                # Dashboard, Records, Users, Logs (Super Admin only), Login
│   │   ├── services/             # Axios/Fetch API clients with JWT interceptors
│   │   ├── types/                # TypeScript types (UserRole: 'SUPERADMIN' | 'ADMIN' | 'USER')
│   │   └── theme.css             # Brand styling, colors, and responsive layout
│   ├── package.json              # Web dependencies and build scripts
│   └── vite.config.ts            # Vite proxy and dev server configuration
├── mobile/                       # Field Mobile App (React Native / Expo SDK 52)
│   ├── src/
│   │   ├── components/ui/        # BottomTabBar, GpsCompassLoader, ServerConfigModal, Icons
│   │   ├── screens/              # Login, Dashboard, Records, Camera, Preview, Form, PasswordReset
│   │   └── services/             # Native API client, dynamic baseUrl, health probe
│   ├── assets/                   # Brand logo, adaptive icons, splash screens
│   ├── app.json                  # Expo project manifest & Android permissions
│   ├── eas.json                  # EAS Cloud build profiles (points to 34.93.182.141)
│   ├── .env                      # EXPO_PUBLIC_API_BASE_URL configuration
│   └── package.json              # Expo dependencies and scripts
├── PhotoCapture.apk              # Ready-to-install standalone Android APK (v1.0.0)
├── .env.example                  # Environment template for production deployments
├── docker-compose.prod.yml       # Production Docker deployment configuration
├── package.json                  # Root monorepo orchestration scripts
└── README.md                     # Comprehensive project documentation
```

---

## Prerequisites

Ensure your development workstation has the following installed:

- **Node.js:** v18.0+ or v20.0+ LTS ([Download Node.js](https://nodejs.org/))
- **npm:** v9.0+ or v10.0+
- **Python:** v3.10 to v3.12 ([Download Python](https://www.python.org/))
- **Android Device or Emulator:**
  - *Option A:* Physical Android device with [PhotoCapture.apk](PhotoCapture.apk) installed.
  - *Option B:* Physical phone with the [Expo Go app](https://play.google.com/store/apps/details?id=host.exp.exponent).
  - *Option C:* Android Studio Emulator or iOS Simulator (macOS only).

---

## Quick Start (VS Code 3-Terminal Setup)

For the most productive development workflow, open the workspace folder (`camara app/`) in **VS Code** and open **three terminal tabs** (`Terminal -> New Terminal` or `Ctrl+~`):

### Terminal 1: Backend API (FastAPI)

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python start_dev.py
```

- **Listening on:** `0.0.0.0:8000` (Accessible on localhost and your local Wi-Fi network)
- **Live Health Probe:** [http://localhost:8000/health](http://localhost:8000/health)
- **Interactive Swagger Documentation:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Redoc Documentation:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

### Terminal 2: Admin Web Portal (React 19 + Vite)

```powershell
cd admin
npm run dev -- --host 0.0.0.0
```

- **Local Web Access:** [http://localhost:5173](http://localhost:5173)
- **Network Web Access:** `http://<YOUR_PC_LAN_IP>:5173` (Accessible from other devices on the same Wi-Fi)

---

### Terminal 3: Mobile Application (React Native / Expo)

```powershell
cd mobile
npx expo start --lan
```

- **Physical Phone (Expo Go):** Open **Expo Go** on Android or iOS and scan the terminal QR code.
- **Android Emulator:** Press `a` in the terminal.
- **iOS Simulator:** Press `i` in the terminal (macOS).
- **Web Browser Preview:** Press `w` in the terminal.

---

## Alternative NPM Root Scripts

You can also orchestrate services directly from the root repository directory without changing folders:

| Command | Action |
| :--- | :--- |
| `npm run backend` | Starts the FastAPI backend on `0.0.0.0:8000` |
| `npm run admin` | Starts the Admin Portal Vite dev server |
| `npm run mobile` | Starts the Expo Metro bundler in LAN mode |
| `npm run mobile:web` | Launches the mobile application in a web browser |
| `npm run install:all` | Installs all dependencies across root, admin, and mobile |

---

## First-Time Environment Setup

If cloning this repository onto a fresh computer:

```powershell
# 1. Install Node dependencies across root, admin, and mobile
npm run install:all

# 2. Setup Python virtual environment
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
cd ..
```

---

## Default Credentials & Auto-Seeding

Upon initial startup, the backend automatically provisions a master administrator account if no users exist:

| Role | Position Name | Email | Default Password | Primary Privileges |
| :--- | :--- | :--- | :--- | :--- |
| **`SUPERADMIN`** | System Admin | `admin@photocapture.local` | `admin123` | Exclusive access to System Audit Logs, Promote to Super Admin, user moderation. |
| **`ADMIN`** | Admin | Created by Super Admin | Set by Super Admin | Operational Portal access (Records, Photos, Map, Users). Audit Logs hidden. |
| **`USER`** | Field Operator | Created via Admin Portal | Assigned by Admin | Mobile Camera App, photo geotagging, record submission. Admin Portal blocked. |

> [!NOTE]
> - Default administrator credentials can be customized via `.env` or updated at runtime via the Admin Web Portal.
> - On startup, `ensure_first_admin` checks the database. If an existing admin has role `ADMIN`, it is automatically upgraded to `SUPERADMIN` so the system always has its master owner.

---

## Environment Variables Reference (`.env`)

### Backend Environment (`.env`)

Create or edit `.env` (refer to [.env.example](.env.example)):

```env
# Server
PROJECT_NAME="Photo Capture API"
DEBUG=False

# Security (JWT & Password Salts)
SECRET_KEY="generate-a-strong-random-secret-key-for-production"
ACCESS_TOKEN_EXPIRE_MINUTES=60
ALGORITHM="HS256"

# Default System Administrator Seed Credentials
ADMIN_EMAIL="admin@photocapture.local"
ADMIN_PASSWORD="admin123"
ADMIN_NAME="System Admin"

# Database Configuration
DATABASE_URL="sqlite:///./data/app.db"
# For PostgreSQL in production:
# DATABASE_URL="postgresql://user:password@localhost:5432/photocapture"

# CORS Configuration (comma-separated allowed origins)
CORS_ORIGINS="http://localhost:3000,http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:8081,http://localhost:19006,http://34.93.182.141"

# Optional Cloud Storage (Google Drive)
GOOGLE_DRIVE_CREDENTIALS_PATH="./credentials/service-account.json"
GOOGLE_DRIVE_ROOT_FOLDER_ID=""

# Optional Reverse Geocoding
GOOGLE_GEOCODING_API_KEY=""

# Upload Limits & Quality
MAX_UPLOAD_SIZE_MB=20
MAX_IMAGE_DIMENSION=2560
JPEG_QUALITY=85
```

### Mobile Environment (`mobile/.env`)

```env
# Production Cloud Server default (automatically loaded by Expo)
EXPO_PUBLIC_API_BASE_URL="http://34.93.182.141/api"
```

---

## Cloud Deployment & Server Host Configuration

The mobile app is configured to **always open with `EXPO_PUBLIC_API_BASE_URL`** (default: `http://34.93.182.141/api`).

- **Production Cloud Server:** Configured in `mobile/.env` and `mobile/eas.json` as `http://34.93.182.141/api`.
- **Runtime Host Switcher:** If you want to switch servers or test on a local workstation:
  1. Tap the **Server Icon** at the top-right of the mobile sign-in header.
  2. Tap **"Cloud Server (34.93.182.141)"** or **"Local PC (192.168.21.27)"**, or enter a custom IP.
  3. Tap **Test Connection** to verify health status.
  4. Tap **Save & Apply**. The app persists the URL in `AsyncStorage` and routes all subsequent requests to the chosen endpoint.

---

## Connecting Physical Mobile Devices (LAN Setup)

If testing on a local machine without cloud deployment, ensure your phone can reach your computer:

1. **Verify Windows Network Profile:** In Windows Settings, set your Wi-Fi network profile to **Private** (Public networks block incoming traffic).
2. **Open Firewall Port 8000:** Open PowerShell as **Administrator** and run:
   ```powershell
   cd backend
   .\allow-firewall.ps1
   ```
3. **Check Your LAN IP Address:**
   ```powershell
   cd backend
   python show_lan_ip.py
   ```
4. **Verify Health in Phone Browser:** Open `http://<YOUR_PC_LAN_IP>:8000/health` in your mobile browser. You should receive `{"status":"ok"}`.
5. **Configure Mobile App:** Open the mobile app, tap the top-right server icon, select or type `http://<YOUR_PC_LAN_IP>:8000`, test the connection, and save.

---

## Standalone Mobile APK (v1.0.0)

A compiled, standalone Android release APK is ready for deployment in the root directory:

- **File Path:** [PhotoCapture.apk](PhotoCapture.apk)
- **Version:** `1.0.0`
- **Version Code:** `1`
- **Build ID:** `30de7690-8959-4c4f-8c68-c60c93ee595a`
- **Cloud Build Dashboard:** [Expo EAS Build 30de7690](https://expo.dev/accounts/gowtham.tj/projects/photo-capture/builds/30de7690-8959-4c4f-8c68-c60c93ee595a)

### Installation on Android Devices:
- **Via USB (ADB):**
  ```powershell
  adb install -r PhotoCapture.apk
  ```
- **Via Direct Transfer:** Copy `PhotoCapture.apk` to your phone via USB, Google Drive, or messaging apps, tap the file in your device's Files app, and select **Install**.

---

## Automated Testing & Security Verification (120 Tests)

PhotoCapture includes a comprehensive test suite of **120 automated tests** covering authentication, 3-tier RBAC, cybersecurity attack defense, and data leakage protection:

```powershell
# 1. Full Backend Automated Test Suite (120 Tests)
cd backend
.\.venv\Scripts\pytest.exe tests/ -v

# 2. Admin Web Portal Build Verification (Vite + TypeScript)
cd admin
npm run build

# 3. Mobile App Static Type Analysis (TypeScript compiler)
cd mobile
npx tsc --noEmit
```

### Test Suite Breakdown:

| Test Module | Tests | Focus Area |
| :--- | :---: | :--- |
| `test_roles_and_permissions.py` | 11 | Super Admin log exclusivity (403 for Admin), Promote to Super Admin role transfer, Admin deactivation protection |
| `test_data_leakage.py` | 25 | Password exposure defense, zero credential leakage in audit logs, user isolation, API secret shielding |
| `test_cyber_security.py` | 17 | SQL injection, path traversal, brute force resistance, malformed token injection, privilege escalation defense |
| `test_activity_logs.py` | 10 | Login, record edits, admin image download audit logging |
| `test_auth.py` | 11 | OAuth2 password flow, JWT issuance, expiration, public password resets |
| `test_admin_reset_password.py` | 3 | Admin password override with zero previous password knowledge |
| `test_location_cache.py` | 11 | Reverse geocoding caching and coordinate rounding |
| `test_photo_metadata.py` | 3 | Watermark metadata extraction and EXIF handling |
| `test_records.py` | 7 | Record creation, pagination, keyword and date filtering |
| `test_security.py` | 11 | Route guards, bearer token validation, password hashing |
| `test_upload_flow.py` | 7 | Multi-photo multipart uploads, thumbnail generation, watermark stamping |
| `test_user_dashboard.py` | 7 | Operator statistics, recent records, active telemetry |
| `test_user_isolation.py` | 4 | Cross-tenant data separation and unauthorized access guards |

### Verification Status:
- **Backend Tests:** **120 / 120 Passed (100%)**
- **Admin Portal Build:** **0 TypeScript errors, built in < 700ms**
- **Mobile TypeScript:** **0 errors (`npx tsc --noEmit` clean)**
- **Database Status:** **Clean production state (zero test data pollution)**

---

## Security & Privacy Architecture

- **Bcrypt One-Way Salted Hashing:** User passwords are never stored in plaintext. Passwords are salted and hashed using bcrypt (`$2b$12$...`).
- **Zero Admin Visibility:** Admins have full authority to reset passwords for locked-out users, but the system architecture guarantees that administrators cannot view or decrypt an existing user password.
- **Immutable Security Audit Trail:** Every authentication attempt, password change, user deactivation, record edit, and photo download generates a detailed entry in the `audit_logs` table containing the action type, category, timestamp, user ID, user name, and client IP address.
- **Public Reset Protection:** The public mobile password reset endpoint strictly rejects attempts to reset `ADMIN` and `SUPERADMIN` accounts, preventing administrative account compromise from the mobile interface.
- **Strict Role Boundaries:** Direct assignment of `SUPERADMIN` via standard user creation or update endpoints is prohibited; promotion is only possible via the dedicated transfer endpoint.

---

## API Endpoints Overview

### Public Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Server health and database liveness probe |
| `POST` | `/api/auth/login` | Authenticate user and return signed JWT token |
| `POST` | `/api/auth/reset-password` | Self-service password reset for field operators |

### Authenticated Endpoints (All Roles)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/auth/me` | Fetch profile for currently signed-in user |
| `PUT` | `/api/auth/profile` | Update own name, email, or password |
| `GET` | `/api/records` | Paginated records with date/keyword filters |
| `POST` | `/api/records` | Create record and trigger dynamic watermarking |
| `GET` | `/api/records/{id}` | Detailed record inspection with photo list & telemetry |

### Admin Endpoints (`ADMIN` & `SUPERADMIN`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/admin/dashboard` | Aggregated analytics & operational telemetry |
| `GET` | `/api/admin/users` | List all users with status and role filters |
| `POST` | `/api/admin/users` | Create new `ADMIN` or `USER` account |
| `PUT` | `/api/admin/users/{id}` | Update user details or toggle active status |
| `POST` | `/api/admin/users/{id}/reset-password` | Admin resets user password (zero old password needed) |
| `POST` | `/api/admin/records/{id}/image/{img_id}/log-download` | Explicitly log an admin photo download |

### Super Admin Exclusive Endpoints (`SUPERADMIN` Only)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/admin/logs` | Query forensic audit logs with search, category & date filters |
| `POST` | `/api/admin/users/{id}/promote-superadmin` | Transfer Super Admin ownership to an Admin (demotes caller to Admin) |

---

## Troubleshooting FAQ

### Motorcycle route sorting

In Field Audit Platform, open Pending and click **Route** after allowing location access.
The server requests Google Routes with `travelMode: "TWO_WHEELER"` and orders stops
by the nearest road distance from each preceding stop. Road distances and estimated
leg times are shown. This is a nearest-stop sequence, not a guaranteed shortest total tour.
The API key stays on the server; GPS updates do not trigger requests or reorder the route.
Click Route again to recalculate. Order No restores the assigned visit sequence.

Enable Google Routes API with billing, and set `GOOGLE_ROUTES_API_KEY` in `.env`
(or the server environment). An empty Routes key uses `GOOGLE_GEOCODING_API_KEY`, which
must also have Routes API access. Restart the backend after changing configuration.
Both Compute Routes and Compute Route Matrix are used; multi-stop requests are batched
to stay within 625 elements per matrix request. These Google calls incur billing.

Sorting applies to the currently loaded pending records, up to 100 stops per request.
The Records screen routes its current page. Missing coordinates or unreachable stops
appear last without invented distances. A provider error leaves the list in Order No
and displays an error; there is no silent straight-line fallback. Changing filters or
pages requires another Route click. Google two-wheeler routes are in beta; the app
displays Google's required caution alongside the route.

Reference: https://developers.google.com/maps/documentation/routes/route_two_wheel

#### Q1: Mobile app displays "Cannot reach server"
1. Verify the backend is running (`python start_dev.py`).
2. Run `backend/allow-firewall.ps1` as Administrator.
3. Check that your computer and phone are connected to the exact same Wi-Fi SSID.
4. Tap the **Server Icon** at the top right of the mobile sign-in screen, confirm the IP matches `python show_lan_ip.py`, and tap **Test Connection**.

#### Q2: Metro bundler hangs or fails to load JS bundle
Clear the Expo Metro cache and restart:
```powershell
cd mobile
npx expo start --lan -c
```

#### Q3: Admin sign-in fails with invalid credentials
Verify the email and password in `.env` under `ADMIN_EMAIL` and `ADMIN_PASSWORD`. By default:
- **Email:** `admin@photocapture.local`
- **Password:** `admin123`

#### Q4: Why can't an Admin see the "System Audit Logs" menu item?
System Audit Logs (`/logs`) are strictly restricted to the **System Admin (`SUPERADMIN`)**. Regular `ADMIN` accounts do not have access to forensic audit logs. To view audit logs, sign in as the `SUPERADMIN` or have the current `SUPERADMIN` promote your account using the **Promote to Super Admin** button in the User Management view.

---

## License

Proprietary enterprise software — internal field operations and audit use. All rights reserved.

### Single environment configuration
Use the project-root `.env` for backend and frontend settings. Both Vite projects load it; only `VITE_` values enter browser builds. Cloud Run runtime variables override file values. Docker Compose loads the same root file. Do not create another `.env` inside backend or admin.
