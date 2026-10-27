# Self-Hosted OpenRouteService (ORS)

## Overview
OpenRouteService (ORS) is a high-performance open-source routing engine based on OpenStreetMap (OSM).
By self-hosting ORS on your own infrastructure or cloud server:
- **Cost**: **0 €** (Completely Free)
- **Rate limits**: **Unlimited** (No daily or per-minute quotas)
- **API Key**: **Not required** for self-hosted instances
- **Profiles**: Supports `driving-car`, `cycling-regular`, `foot-walking`

---

## Quick Start (Docker)

### 1. Download OpenStreetMap (.pbf) Data
Download the road network for your operating area from Geofabrik:
- **India (All Zones)**: [india-latest.osm.pbf](https://download.geofabrik.de/asia/india-latest.osm.pbf) (~1.2 GB)
- **Southern Zone (TN, KA, KL, AP, TS)**: [southern-zone-latest.osm.pbf](https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf) (~400 MB)

Rename the downloaded file to `osm_file.pbf` and save it to:
```
ors-server/data/osm_file.pbf
```

### 2. Start the ORS Server
Run the setup script:
```bash
ors-server\setup-ors.bat
```
Or run directly with Docker Compose:
```bash
cd ors-server
docker compose up -d
```

### 3. Verification
Verify that ORS is running and healthy:
```bash
curl http://localhost:8080/ors/v2/health
```
When graphs finish building (takes ~2-5 minutes on first run), the health status returns:
`{"status": "ready"}`.

---

## PhotoCapture Integration

### Configuration in `.env`
PhotoCapture automatically routes requests to your self-hosted instance:
```env
OPENROUTESERVICE_BASE_URL=http://localhost:8080/ors
OPENROUTESERVICE_API_KEY=
```

For a remote server or GCP VM, update `OPENROUTESERVICE_BASE_URL` with your server's IP/domain:
```env
OPENROUTESERVICE_BASE_URL=http://<YOUR_SERVER_IP>:8080/ors
```

### Proximity Caching (100-Meter Drift Threshold)
- When operators click **Route**, the system records their GPS origin.
- If the operator's location changes by **less than 100 meters**, clicking Route reuses the already calculated route plan instantly (**0 API calls**).
- If the operator moves **100 meters or more**, clicking Route refreshes the road route.
