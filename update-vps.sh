#!/usr/bin/env bash
# ============================================================
# update-vps.sh — Update aplikasi di VPS tanpa Docker (PM2)
#
# Jalankan dari /opt/presensiku:
#   bash update-vps.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "➜ Menarik pembaruan dari GitHub..."
git pull --ff-only

echo "➜ Build API (TypeScript)..."
npm --prefix apps/api run build

echo "➜ Build Web (React/Vite)..."
npm --prefix apps/web run build

echo "➜ Reload API tanpa downtime..."
pm2 reload presensiku-api --update-env

echo ""
echo "✅ Update selesai."
pm2 status
