#!/usr/bin/env bash
# ============================================================
# update.sh — Update aplikasi di VPS (jalankan dari /opt/presensiku)
#
#   bash update.sh
#
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "❌ .env tidak ditemukan. Jalankan deploy/vps-setup.sh dulu." >&2
  exit 1
fi

echo "➜ Menarik pembaruan dari GitHub..."
git pull --ff-only

# Port web & mode HTTPS dibaca dari .env (dibuat oleh vps-setup.sh)
WEB_PORT="$(grep -E '^WEB_PORT=' .env | head -1 | cut -d= -f2- || true)"
WEB_PORT="${WEB_PORT:-80}"

COMPOSE_FILES="-f docker-compose.yml"
if [[ -f docker-compose.https.yml ]]; then
  DOMAIN="$(grep -E '^DOMAIN=' .env | head -1 | cut -d= -f2- || true)"
  if [[ -n "$DOMAIN" ]]; then
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.https.yml"
    echo "➜ Mode HTTPS aktif (domain: $DOMAIN)"
  fi
fi

echo "➜ Build & restart container (port web: $WEB_PORT)..."
WEB_PORT="$WEB_PORT" docker compose $COMPOSE_FILES up -d --build

echo "➜ Pastikan data awal tersedia (aman diulang)..."
WEB_PORT="$WEB_PORT" docker compose $COMPOSE_FILES exec -T backend npm run db:seed || true

echo ""
echo "✅ Update selesai."
docker compose $COMPOSE_FILES ps
