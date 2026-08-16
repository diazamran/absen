#!/usr/bin/env bash
# ============================================================
# push.sh — Commit & push semua perubahan ke GitHub (jalankan dari Git Bash)
#
# Penggunaan:
#   bash push.sh                 # pesan commit otomatis (tanggal+jam)
#   bash push.sh "pesan commit"  # pesan commit sendiri
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-update $(date '+%Y-%m-%d %H:%M')}"

if git diff --quiet && git diff --cached --quiet && [[ -z "$(git status --porcelain)" ]]; then
  echo "✔ Tidak ada perubahan baru — hanya push."
else
  echo "➜ Commit: $MSG"
  git add -A
  git commit -m "$MSG"
fi

echo "➜ Push ke origin main..."
git push origin main
echo "✅ Selesai — perubahan sudah di GitHub."
