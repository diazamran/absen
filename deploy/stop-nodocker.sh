#!/usr/bin/env bash
# Stop PresensiKu (non-Docker)
echo "➜ Menghentikan PresensiKu..."
pm2 stop all
pm2 save
echo "✅ PresensiKu dihentikan."
