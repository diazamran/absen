#!/usr/bin/env bash
# ============================================================
# PresensiKu — Setup VPS TANPA Docker (Node.js + PostgreSQL + Redis)
#
# Penggunaan:
#   bash deploy/vps-nodocker-setup.sh <url-repo-github> [domain]
#
# Contoh:
#   bash deploy/vps-nodocker-setup.sh https://github.com/diazamran/absen.git
#   bash deploy/vps-nodocker-setup.sh https://github.com/diazamran/absen.git absen.smkn1kras.sch.id
#
# RAM dibutuhkan: ~256MB (sangat hemat dibanding Docker ~800MB)
# Disk dibutuhkan: ~500MB (sangat hemat dibanding Docker ~3GB)
# ============================================================
set -euo pipefail

REPO_URL="${1:-}"
DOMAIN="${2:-}"
APP_DIR="/opt/presensiku"
DB_NAME="presensiku"
DB_USER="presensiku"
NODE_VERSION="20"

if [[ -z "$REPO_URL" ]]; then
  echo "❌ Gunakan: bash $0 <url-repo-github> [domain]"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "❌ Jalankan sebagai root: sudo bash $0 ..."
  exit 1
fi

echo "=============================================="
echo "  PresensiKu — Setup VPS Tanpa Docker"
echo "=============================================="

# ---------- 1. System packages ----------
echo "➜ Menginstal paket sistem..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget gnupg2 ca-certificates lsb-release \
  build-essential python3 git nginx redis-server

# ---------- 2. Node.js 20 LTS ----------
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1)" -lt "$NODE_VERSION" ]]; then
  echo "➜ Menginstal Node.js $NODE_VERSION..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y -qq nodejs
  echo "✔ Node.js $(node -v) terpasang"
else
  echo "✔ Node.js sudah terpasang: $(node -v)"
fi

# ---------- 3. PostgreSQL 16 ----------
if ! command -v psql &>/dev/null; then
  echo "➜ Menginstal PostgreSQL..."
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-client
  systemctl enable postgresql
  systemctl start postgresql
  echo "✔ PostgreSQL terpasang"
else
  echo "✔ PostgreSQL sudah terpasang"
  systemctl enable postgresql 2>/dev/null || true
  systemctl start postgresql 2>/dev/null || true
fi

# ---------- 4. Buat database & user ----------
echo "➜ Membuat database PostgreSQL..."
DB_PASS="${DB_PASSWORD:-presensiku123}"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || true
# PostgreSQL 15+ needs schema grant
sudo -u postgres psql -d $DB_NAME -c "GRANT ALL ON SCHEMA public TO $DB_USER;" 2>/dev/null || true
echo "✔ Database siap"

# ---------- 5. Redis ----------
echo "➜ Mengkonfigurasi Redis..."
if ! systemctl is-active --quiet redis-server 2>/dev/null; then
  systemctl enable redis-server
  systemctl start redis-server
fi
# Set maxmemory agar hemat RAM
sed -i 's/^# maxmemory.*/maxmemory 128mb/' /etc/redis/redis.conf 2>/dev/null || true
sed -i 's/^# maxmemory-policy.*/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf 2>/dev/null || true
systemctl restart redis-server 2>/dev/null || true
echo "✔ Redis berjalan (max 128MB RAM)"

# ---------- 6. Clone / Pull repo ----------
if [[ -d "$APP_DIR/.git" ]]; then
  echo "➜ Repo sudah ada — pull terbaru..."
  cd "$APP_DIR"
  git fetch origin
  git reset --hard origin/main
else
  echo "➜ Clone repository..."
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# ---------- 7. Environment ----------
if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "➜ Membuat file .env..."
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$DB_PASS
DB_HOST=localhost
APP_NAME=PresensiKu
SCHOOL_NAME=SMKN 1 Kras
APP_URL=${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$(hostname -I | awk '{print $1}')}
CORS_ORIGIN=${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$(hostname -I | awk '{print $1}')}
APP_PORT=4000
TIMEZONE=Asia/Jakarta
EOF
  echo "✔ .env dibuat"
else
  echo "✔ .env sudah ada"
fi

# Update DATABASE_URL di .env
DB_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?connection_limit=20&pool_timeout=10"
if grep -q "^DATABASE_URL=" "$APP_DIR/.env"; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DB_URL|" "$APP_DIR/.env"
else
  echo "DATABASE_URL=$DB_URL" >> "$APP_DIR/.env"
fi

# ---------- 8. Install dependencies & build ----------
echo "➜ Install backend dependencies..."
cd "$APP_DIR/apps/api"
npm ci --production=false

echo "➜ Generate Prisma client..."
npx prisma generate

echo "➜ Build backend (TypeScript)..."
npx tsc -p tsconfig.json

echo "➜ Install frontend dependencies..."
cd "$APP_DIR/apps/web"
npm ci

echo "➜ Build frontend (Vite)..."
npx vite build

# ---------- 9. Install PM2 ----------
if ! command -v pm2 &>/dev/null; then
  echo "➜ Menginstal PM2..."
  npm install -g pm2
fi
echo "✔ PM2 $(pm2 -v) terpasang"

# ---------- 10. Setup PM2 startup ----------
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# ---------- 11. Setup Nginx ----------
echo "➜ Mengkonfigurasi Nginx..."
cp "$APP_DIR/deploy/nginx-app.conf" /etc/nginx/sites-available/presensiku

# Ganti server_name jika pakai domain
if [[ -n "$DOMAIN" ]]; then
  sed -i "s/server_name _;/server_name $DOMAIN;/" /etc/nginx/sites-available/presensiku
  # Siapkan HTTPS dengan Certbot
  apt-get install -y -qq certbot python3-certbot-nginx
  echo "➜ HTTPS akan dikonfigurasi setelah deploy..."
fi

ln -sf /etc/nginx/sites-available/presensiku /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t && systemctl reload nginx
echo "✔ Nginx dikonfigurasi"

# ---------- 12. Migrate & Seed ----------
echo "➜ Menjalankan migrasi database..."
cd "$APP_DIR/apps/api"
npx prisma migrate deploy

# Seed hanya jika database kosong
USER_COUNT=$(node -e "
  const {PrismaClient} = require('@prisma/client');
  const p = new PrismaClient();
  p.user.count().then(c => { console.log(c); p.\$disconnect(); }).catch(() => { console.log(0); p.\$disconnect(); });
" 2>/dev/null || echo "0")

if [ "$USER_COUNT" = "0" ]; then
  echo "🌱 Database kosong — menjalankan seed..."
  npm run db:seed
else
  echo "✔ Database sudah berisi ($USER_COUNT user)"
fi

# ---------- 13. Start aplikasi ----------
cd "$APP_DIR"
pm2 start deploy/pm2.config.js
pm2 save

# ---------- 14. Firewall ----------
if command -v ufw &>/dev/null; then
  echo "➜ Mengatur firewall..."
  ufw allow OpenSSH
  ufw allow 80/tcp
  if [[ -n "$DOMAIN" ]]; then
    ufw allow 443/tcp
  fi
  ufw --force enable || true
fi

echo ""
echo "=============================================="
echo "  ✅ Setup Selesai — TANPA DOCKER!"
echo "=============================================="
echo ""
echo "  RAM digunakan : ~256MB (hemat!)"
echo "  Disk digunakan: ~500MB (hemat!)"
echo ""
if [[ -n "$DOMAIN" ]]; then
  echo "  Akses: https://$DOMAIN"
  echo ""
  echo "  HTTPS: sudo certbot --nginx -d $DOMAIN"
else
  echo "  Akses: http://$(hostname -I | awk '{print $1}')"
fi
echo ""
echo "  Perintah:"
echo "    pm2 status              # Cek status"
echo "    pm2 logs presensiku-api # Lihat log"
echo "    pm2 restart all         # Restart"
echo "    cd $APP_DIR && bash update.sh  # Update"
echo "=============================================="
