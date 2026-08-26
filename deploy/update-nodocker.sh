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
npx prisma generate --silent
npx tsc -p tsconfig.json
npx prisma migrate deploy 2>/dev/null || true

# Build frontend
echo "➜ Build frontend..."
cd ../apps/web
npm ci --silent
npx vite build 2>/dev/null || echo "⚠ Frontend build gagal, skip..."

# Restart backend via PM2
echo "➜ Restart backend..."
cd ../..
pm2 restart presensiku-api --silent

# Bersihkan data absensi hari ini
echo "➜ Membersihkan data absensi hari ini..."
source .env
DB_PASS="${DB_PASSWORD:-presensiku123}"
sudo -u postgres psql -d presensiku -c "DELETE FROM \"Attendance\" WHERE DATE(\"date\") = CURRENT_DATE;" 2>/dev/null || true
sudo -u postgres psql -d presensiku -c "DELETE FROM \"Notification\" WHERE DATE(\"createdAt\") = CURRENT_DATE;" 2>/dev/null || true

echo ""
echo "✅ Update selesai!"
pm2 status
