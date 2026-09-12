#!/usr/bin/env bash
# ============================================================
# update.sh — Update aplikasi di VPS (jalankan dari /opt/presensiku)
#
#   bash update.sh
#
# Catatan: data absensi hari ini TIDAK dihapus otomatis saat update.
# Set CLEAR_TODAY_ATTENDANCE=true di .env untuk mengaktifkan pembersihan itu.
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

# Bersihkan data absensi hari ini — sekarang OPTSIONAL.
# Default TIDAK menghapus apa pun, agar update di jam sekolah tidak menghapus
# absensi yang sudah tercatat. Set CLEAR_TODAY_ATTENDANCE=true di .env bila
# ingin perilaku lama (mengosongkan data absensi hari ini).
CLEAR_TODAY="$(grep -E '^CLEAR_TODAY_ATTENDANCE=' .env | head -1 | cut -d= -f2- || true)"
CLEAR_TODAY="${CLEAR_TODAY:-false}"
if [[ "$CLEAR_TODAY" == "true" ]]; then
  echo "➜ Membersihkan data absensi hari ini..."
  WEB_PORT="$WEB_PORT" docker compose $COMPOSE_FILES exec -T postgres psql -U postgres -d presensiku -c "DELETE FROM \"Attendance\" WHERE DATE(\"date\") = CURRENT_DATE;" 2>/dev/null || true
  WEB_PORT="$WEB_PORT" docker compose $COMPOSE_FILES exec -T postgres psql -U postgres -d presensiku -c "DELETE FROM \"Notification\" WHERE DATE(\"createdAt\") = CURRENT_DATE;" 2>/dev/null || true
else
  echo "➜ Data absensi hari ini TIDAK dihapus (set CLEAR_TODAY_ATTENDANCE=true di .env untuk mengaktifkan)."
fi

# Reset hasil sinkronisasi SDMS
echo "➜ Reset hasil sinkronisasi SDMS..."
WEB_PORT="$WEB_PORT" docker compose $COMPOSE_FILES exec -T postgres psql -U postgres -d presensiku -c "DELETE FROM \"SchoolSetting\" WHERE key = 'sdms_last_sync';" 2>/dev/null || true

echo ""
echo "✅ Update selesai (data absensi hari ini dikosongkan)."
docker compose $COMPOSE_FILES ps
