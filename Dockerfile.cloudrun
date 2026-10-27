# ========================================================
# Stage 1: Build Admin Web Portal (React + Vite)
# ========================================================
FROM node:20-alpine AS admin-builder

WORKDIR /app/admin
COPY admin/package*.json ./
RUN npm install --no-audit

COPY admin/ ./
ENV VITE_API_BASE_URL=/api
RUN npm run build

# ========================================================
# Stage 2: Build User Web App (React + Vite PWA)
# ========================================================
FROM node:20-alpine AS user-web-builder

WORKDIR /app/user-web
COPY user-web/package*.json ./
RUN npm install --no-audit

COPY user-web/ ./
RUN npm run build

# ========================================================
# Stage 3: Production Runtime (Python 3.12 + Nginx)
# ========================================================
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

# Install Nginx and runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY backend/ ./
COPY .env /app/.env

# Copy credentials if present
COPY credentials/ /app/credentials/

# Ensure local container data directory exists
RUN mkdir -p /app/data


# Copy static frontend builds
RUN mkdir -p /var/www/admin /var/www/user-web /mnt/data/data /mnt/data/uploads
COPY --from=admin-builder /app/admin/dist/ /var/www/admin/
COPY --from=user-web-builder /app/user-web/dist/ /var/www/user-web/

# Configure Nginx
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf
COPY cloudrun-nginx.conf /etc/nginx/conf.d/photocapture.conf

# Setup Entrypoint
COPY cloudrun-entrypoint.sh /app/entrypoint.sh
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/bin/bash", "/app/entrypoint.sh"]
