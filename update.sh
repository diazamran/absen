#!/usr/bin/env bash
# ============================================================
# update.sh — Update aplikasi di VPS (jalankan dari /opt/presensiku)
#
#   bash update.sh
#
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "➜ Menarik pembaruan dari GitHub..."
git pull --ff-only

# Deteksi mode HTTPS (jika deploy dengan domain + Caddy)
COMPOSE_FILES="-f docker-compose.yml"
if [[ -f docker-compose.https.yml ]]; then
  DOMAIN="$(grep -E '^DOMAIN=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
  if [[ -n "$DOMAIN" ]]; then
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.https.yml"
    echo "➜ Mode HTTPS aktif (domain: $DOMAIN)"
  fi
fi

echo "➜ Build & restart container..."
WEB_PORT=8080 docker compose $COMPOSE_FILES up -d --build

echo "➜ Pastikan data awal tersedia (aman diulang)..."
WEB_PORT=8080 docker compose $COMPOSE_FILES exec -T backend npm run db:seed || true

echo ""
echo "✅ Update selesai."
docker compose $COMPOSE_FILES ps
