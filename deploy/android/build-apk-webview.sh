#!/usr/bin/env bash
# ============================================================
# build-apk-webview.sh — Build APK WebView sederhana PresensiKu
#
#   bash deploy/android/build-apk-webview.sh
#
# APK ini hanya menampilkan website absensi (https://absen.smkn1kras.sch.id)
# di dalam WebView Android. Kelebihan:
#   - Jalan di SEMUA Android 5.0+ (tanpa butuh Chrome / assetlinks)
#   - Kamera, lokasi, dan upload file sudah diaktifkan
#   - Update server langsung tampil — tidak perlu build APK ulang
#
# Syarat (sekali saja di komputer Anda):
#   1. Java JDK 17+  → cek: java -version
#   2. Android SDK    → cek: echo $ANDROID_HOME
#      (bisa install gratis via Android Studio → "SDK Manager")
#
# Hasil:
#   - APK release : deploy/android/PresensiKu-WebView-v1.0.0.apk
#   - Keystore    : deploy/android/webview/presensiku-release.keystore (JANGAN dibagikan!)
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/webview"

APP_VERSION="1.0.0"
KEYSTORE="presensiku-release.keystore"
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

OUT="PresensiKu-WebView-v${APP_VERSION}.apk"
cp "$APK" "../$OUT"

# ===== Salin ke folder publik website (agar bisa diunduh dari web) =====
APK_WEB_DIR="../../apps/web/public/apk"
mkdir -p "$APK_WEB_DIR"
cp "$APK" "$APK_WEB_DIR/PresensiKu.apk"
echo ""
echo "✅ Selesai! APK siap dibagikan:"
echo "   deploy/android/$OUT"
echo "   (juga disalin ke $APK_WEB_DIR/PresensiKu.apk untuk diunduh dari website)"
echo ""
echo "➜ Supaya bisa diunduh dari https://absen.smkn1kras.sch.id/apk/PresensiKu.apk:"
echo "   git add apps/web/public/apk/PresensiKu.apk && git commit -m 'update APK' && git push origin main"
echo "   lalu di VPS: cd /opt/presensiku && bash update.sh"
echo ""
echo "⚠️  Simpan baik-baik $KEYSTORE dan $KEYSTORE_PROPS — keystore hilang = tidak bisa update APK versi berikutnya!"
