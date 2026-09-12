#!/usr/bin/env bash
# ============================================================
# update-nodocker.sh — Update aplikasi di VPS (tanpa Docker)
#
#   bash deploy/update-nodocker.sh
#
# RAM: ~256MB  |  Disk: ~500MB
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "❌ .env tidak ditemukan. Jalankan deploy/vps-nodocker-setup.sh dulu." >&2
  exit 1
fi

echo "➜ Menarik pembaruan dari GitHub..."
git fetch origin
git reset --hard origin/main

# Build backend
echo "➜ Build backend..."
cd apps/api
npm ci --silent
npx prisma generate
npx tsc -p tsconfig.json
npx prisma migrate deploy || true

# Build frontend — gagal build = hentikan update (jangan lanjut pakai frontend lama diam-diam)
echo "➜ Build frontend..."
cd ../apps/web
npm ci --silent
npx vite build || { echo "❌ Frontend build gagal — update dihentikan. Perbaiki error di atas lalu jalankan ulang." >&2; exit 1; }

# Restart backend via PM2 (mulai baru bila belum terdaftar)
echo "➜ Restart backend via PM2..."
cd ../..
pm2 restart presensiku-api || (cd apps/api && pm2 start dist/server.js --name presensiku-api)

# Bersihkan data absensi hari ini — OPTSIONAL (CLEAR_TODAY_ATTENDANCE=true di .env).
# Default TIDAK menghapus, agar update di jam sekolah aman.
source .env
DB_PASS="${DB_PASSWORD:-presensiku123}"
if [[ "${CLEAR_TODAY_ATTENDANCE:-false}" == "true" ]]; then
  echo "➜ Membersihkan data absensi hari ini..."
  sudo -u postgres psql -d presensiku -c "DELETE FROM \"Attendance\" WHERE DATE(\"date\") = CURRENT_DATE;" 2>/dev/null || true
  sudo -u postgres psql -d presensiku -c "DELETE FROM \"Notification\" WHERE DATE(\"createdAt\") = CURRENT_DATE;" 2>/dev/null || true
else
  echo "➜ Data absensi hari ini TIDAK dihapus (set CLEAR_TODAY_ATTENDANCE=true di .env untuk mengaktifkan)."
fi

echo ""
echo "✅ Update selesai!"
pm2 status
