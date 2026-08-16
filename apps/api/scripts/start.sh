#!/bin/sh
# ============================================================
# start.sh — Bootstrap container backend PresensiKu
# 1. Jalankan migrasi database (aman diulang)
# 2. Seed otomatis HANYA jika database masih kosong (deploy pertama)
# 3. Mulai server
# ============================================================
set -e

echo "➜ Menjalankan migrasi database..."
npx prisma migrate deploy

# Cek apakah sudah ada user (tanpa perlu koneksi yang lama).
# Keluar 0 selalu; output berupa angka jumlah user.
HAS_USER="$(node -e 'const p=require("@prisma/client").PrismaClient;new p().user.count().then(c=>console.log(c)).catch(()=>console.log("0")).finally(()=>process.exit(0));')"

if [ "$HAS_USER" = "0" ]; then
  echo "🌱 Database kosong — menjalankan seed otomatis..."
  npm run db:seed
else
  echo "✔ Database sudah berisi data ($HAS_USER user) — seed dilewati."
fi

echo "➜ Menjalankan server..."
exec node dist/server.js
