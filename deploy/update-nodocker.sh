#!/usr/bin/env bash
# ============================================================
# update-nodocker.sh — Update aplikasi di VPS (tanpa Docker)
#
#   bash deploy/update-nodocker.sh
#
# RAM: ~256MB  |  Disk: ~500MB
# ============================================================
set -euo pipefail

# Jalur absolut — kebal terhadap cwd aneh / pemanggilan dari folder mana pun
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "❌ .env tidak ditemukan di $ROOT/.env — jalankan deploy/vps-nodocker-setup.sh dulu." >&2
  exit 1
fi

# Export isi .env ke semua proses anak (prisma CLI, npm, pm2 membutuhkannya,
# terutama DATABASE_URL untuk prisma migrate deploy)
set -a
source .env
set +a

echo "➜ Menarik pembaruan dari GitHub..."
git fetch origin
git reset --hard origin/main

# Pastikan struktur repo lengkap sebelum mulai build
for d in apps/api apps/web; do
  if [[ ! -d "$ROOT/$d" ]]; then
    echo "❌ Folder $d tidak ditemukan di repo VPS — working tree tidak lengkap." >&2
    echo "   Coba: cd $ROOT && git checkout main && git reset --hard origin/main" >&2
    echo "   Jika masih hilang, laporkan output: ls -la $ROOT/apps" >&2
    exit 1
  fi
done

echo "➜ Build backend..."
cd "$ROOT/apps/api"
npm ci --no-audit --no-fund --loglevel=error
npx prisma generate
npx tsc -p tsconfig.json
if ! npx prisma migrate deploy; then
  echo "⚠ Migrate deploy gagal (periksa DATABASE_URL di .env) — dilanjutkan, bukan dihentikan." >&2
fi

echo "➜ Build frontend..."
cd "$ROOT/apps/web"
npm ci --no-audit --no-fund --loglevel=error
npx vite build || { echo "❌ Frontend build gagal — update dihentikan. Perbaiki error di atas lalu jalankan ulang." >&2; exit 1; }

# Restart backend via PM2 (mulai baru bila belum terdaftar)
echo "➜ Restart backend via PM2..."
cd "$ROOT"
pm2 restart presensiku-api || (cd "$ROOT/apps/api" && pm2 start dist/server.js --name presensiku-api)

# Bersihkan data absensi hari ini — OPTSIONAL (CLEAR_TODAY_ATTENDANCE=true di .env).
# Default TIDAK menghapus, agar update di jam sekolah aman.
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
