#!/usr/bin/env bash
# ============================================================
# PresensiKu — Setup & Deploy di VPS Ubuntu 24.04
# Penggunaan:
#   bash deploy/vps-setup.sh <url-repo-github> [domain-opsional]
# Contoh:
#   bash deploy/vps-setup.sh https://github.com/USER/presensiku.git
#   bash deploy/vps-setup.sh https://github.com/USER/presensiku.git absen.sch.id
# ============================================================
set -euo pipefail

REPO_URL="${1:-}"
DOMAIN="${2:-}"
APP_DIR="${APP_DIR:-/opt/presensiku}"

if [[ -z "$REPO_URL" ]]; then
  echo "❌ Gunakan: bash $0 <url-repo-github> [domain-opsional]" >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "❌ Jalankan sebagai root: sudo bash $0 ..." >&2
  exit 1
fi

echo "=============================================="
echo "  PresensiKu — Deploy VPS Ubuntu 24.04"
echo "=============================================="

# ---------- 1. Docker ----------
if ! command -v docker &>/dev/null; then
  echo "➜ Menginstal Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  echo "✔ Docker sudah terpasang: $(docker --version)"
fi

if ! docker compose version &>/dev/null; then
  echo "➜ Menginstal plugin docker compose..."
  apt-get update -y
  apt-get install -y docker-compose-plugin
fi

# ---------- 2. Repo ----------
mkdir -p /opt
if [[ -d "$APP_DIR/.git" ]]; then
  echo "➜ Repo sudah ada — menarik pembaruan terbaru..."
  cd "$APP_DIR"
  git pull --ff-only || true
else
  echo "➜ Clone repository..."
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# ---------- 3. Environment ----------
if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "➜ Membuat file .env dengan secret acak..."
  cat > "$APP_DIR/.env" <<EOF
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)
APP_NAME=PresensiKu
SCHOOL_NAME=SMA Negeri 1 Nusantara
EOF
  echo "   .env dibuat (JWT secret acak)."
else
  echo "✔ .env sudah ada — tidak diubah."
fi

# Jika memakai domain: simpan DOMAIN + set URL aplikasi & CORS
if [[ -n "$DOMAIN" ]]; then
  for line in "DOMAIN=$DOMAIN" "APP_URL=https://$DOMAIN" "CORS_ORIGIN=https://$DOMAIN"; do
    k="${line%%=*}"
    if grep -q "^$k=" "$APP_DIR/.env"; then
      sed -i "s|^$k=.*|$line|" "$APP_DIR/.env"
    else
      echo "$line" >> "$APP_DIR/.env"
    fi
  done
  echo "   Domain: $DOMAIN (HTTPS aktif, APP_URL & CORS diset)"
fi

# ---------- 4. HTTPS (Caddy) ----------
COMPOSE_FILES="-f docker-compose.yml"
if [[ -n "$DOMAIN" ]]; then
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.https.yml"
  echo "➜ Mode HTTPS aktif untuk domain: $DOMAIN"
fi

# ---------- 5. Build & start ----------
echo "➜ Build & start container (mungkin butuh beberapa menit)..."
cd "$APP_DIR"
WEB_PORT=8080 DOMAIN="$DOMAIN" docker compose $COMPOSE_FILES up -d --build

# ---------- 6. Seed data (aman diulang — idempotent) ----------
echo "➜ Menyiapkan data awal..."
WEB_PORT=8080 DOMAIN="$DOMAIN" docker compose $COMPOSE_FILES exec -T backend npm run db:seed || true

# ---------- 7. Firewall ----------
if command -v ufw &>/dev/null; then
  echo "➜ Membuka port di firewall (22, 80, 443)..."
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable || true
fi

echo ""
echo "=============================================="
echo "  ✅ Deploy selesai!"
echo "=============================================="
if [[ -n "$DOMAIN" ]]; then
  echo "  Akses : https://$DOMAIN"
else
  echo "  Akses : http://$(hostname -I | awk '{print $1}')"
fi
echo "  API   : http://localhost:4000 (di dalam server)"
echo ""
echo "  Cek status : cd $APP_DIR && docker compose ps"
echo "  Lihat log  : cd $APP_DIR && docker compose logs -f backend"
echo "=============================================="
