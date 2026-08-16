#!/usr/bin/env bash
# ============================================================
# build-apk.sh — Build aplikasi Android PresensiKu (TWA/APK)
#
#   bash deploy/android/build-apk.sh
#
# Syarat (sekali saja di komputer Anda):
#   1. Java JDK 17+  → cek: java -version
#   2. Android SDK    → cek: echo $ANDROID_HOME
#      (bisa install gratis via Android Studio → "SDK Manager")
#
# Hasil:
#   - APK release   : deploy/android/PresensiKu-v1.0.0.apk
#   - Keystore      : deploy/android/twa/app/presensiku-release.keystore (JANGAN dibagikan!)
#   - Fingerprint   : dicetak di akhir → tempel ke apps/web/public/.well-known/assetlinks.json
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/twa"

APP_VERSION="1.0.0"
KEYSTORE="app/presensiku-release.keystore"
KEY_ALIAS="presensiku"
KEYSTORE_PROPS="keystore.properties"

echo "➜ Cek Java..."
if ! command -v java >/dev/null 2>&1 && [ -z "${JAVA_HOME:-}" ]; then
  echo "❌ Java tidak ditemukan. Install JDK 17+ (mis. dari Android Studio) lalu coba lagi."
  echo "   Cek dengan: java -version"
  exit 1
fi
if [ -n "${JAVA_HOME:-}" ]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi
java -version 2>&1 | head -1

echo "➜ Cek Android SDK..."
ANDROID_HOME="${ANDROID_HOME:-}"
if [ -z "$ANDROID_HOME" ]; then
  for candidate in "$LOCALAPPDATA/Android/Sdk" "/c/Android/Sdk" "/c/Program Files/Android/Sdk" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk" "/usr/lib/android-sdk" "/opt/android-sdk"; do
    if [ -d "$candidate" ]; then ANDROID_HOME="$candidate"; break; fi
  done
fi
if [ -z "$ANDROID_HOME" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo "❌ Android SDK tidak ditemukan. Set ANDROID_HOME, mis:"
  echo "   export ANDROID_HOME=\"\$LOCALAPPDATA/Android/Sdk\"   (Windows)"
  echo "   export ANDROID_HOME=\"\$HOME/Android/Sdk\"            (Linux)"
  echo "   Cara paling mudah: install Android Studio → buka SDK Manager → centang Android SDK."
  exit 1
fi
echo "   ANDROID_HOME = $ANDROID_HOME"

# Beri tahu Gradle lokasi SDK (forward slash agar aman di semua OS)
SDK_DIR_FOR_GRADLE="$(cygpath -m "$ANDROID_HOME" 2>/dev/null || echo "$ANDROID_HOME")"
echo "sdk.dir=$SDK_DIR_FOR_GRADLE" > local.properties
echo "   local.properties dibuat (sdk.dir=$SDK_DIR_FOR_GRADLE)"

# ===== Keystore (tanda tangan APK) =====
if [ ! -f "$KEYSTORE" ]; then
  echo "➜ Membuat keystore baru (sekali saja)..."
  PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 20)"
  [ -z "$PW" ] && PW="PresensiKu2026!"   # fallback bila urandom tidak tersedia
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PW" -keypass "$PW" \
    -dname "CN=SMKN 1 Kras, OU=PresensiKu, O=SMKN 1 Kras, L=Kediri, ST=Jawa Timur, C=ID" 2>/dev/null
  cat > "$KEYSTORE_PROPS" <<EOF
storeFile=$KEYSTORE
storePassword=$PW
keyAlias=$KEY_ALIAS
keyPassword=$PW
EOF
  echo "   Keystore dibuat: $KEYSTORE"
  echo "   Kredensial disimpan di $KEYSTORE_PROPS (JANGAN di-commit ke git!)"
else
  echo "➜ Keystore sudah ada, dipakai untuk menandatangani."
fi

# ===== Build APK release =====
echo "➜ Build APK (pertama kali butuh waktu, mengunduh Gradle & dependensi)..."
if [ -f ./gradlew ]; then
  ./gradlew --no-daemon assembleRelease
else
  cmd //c gradlew.bat assembleRelease
fi

APK="app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK" ]; then
  echo "❌ Build gagal — APK tidak ditemukan. Periksa pesan error di atas."
  exit 1
fi

OUT="PresensiKu-v${APP_VERSION}.apk"
cp "$APK" "../$OUT"
echo ""
echo "✅ Selesai! APK siap dibagikan:"
echo "   deploy/android/$OUT"
echo ""

# ===== Fingerprint untuk Digital Asset Links (fullscreen TWA) =====
echo "➜ SHA256 fingerprint (untuk /.well-known/assetlinks.json):"
PW="$(grep -E '^storePassword=' "$KEYSTORE_PROPS" | cut -d= -f2-)"
keytool -list -v -keystore "$KEYSTORE" -storepass "$PW" -alias "$KEY_ALIAS" 2>/dev/null | grep -A1 "SHA256:" | grep -oE '[0-9A-F]{2}(:[0-9A-F]{2}){31}'
echo ""
echo "Cara mengaktifkan mode fullscreen (tanpa bar browser):"
echo "  1. Salin fingerprint di atas ke apps/web/public/.well-known/assetlinks.json"
echo "     (ganti GANTI_DENGAN_SHA256_FINGERPRINT_ANDA)"
echo "  2. Di VPS: cd /opt/presensiku && bash update.sh"
echo "  3. Cek: https://absen.smkn1kras.sch.id/.well-known/assetlinks.json"
echo "  4. Buka ulang aplikasi di HP."
echo ""
echo "⚠️  Simpan baik-baik $KEYSTORE dan $KEYSTORE_PROPS — keystore hilang = tidak bisa update APK versi berikutnya!"
