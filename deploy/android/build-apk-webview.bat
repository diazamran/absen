@echo off
REM ============================================================
REM build-apk-webview.bat — Build APK WebView sederhana PresensiKu
REM
REM   build-apk-webview.bat
REM
REM APK ini hanya menampilkan website absensi di dalam WebView.
REM Jalan di SEMUA Android 5.0+ tanpa butuh Chrome/assetlinks.
REM
REM Syarat: Java JDK 17+ dan Android SDK (Android Studio).
REM Hasil : deploy\android\PresensiKu-WebView-v1.0.0.apk
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0webview"

set "APP_VERSION=1.0.0"
set "KEYSTORE=presensiku-release.keystore"
set "KEY_ALIAS=presensiku"
set "KEYSTORE_PROPS=keystore.properties"

echo Cek Java...
where java >nul 2>nul
if errorlevel 1 (
  if "%JAVA_HOME%"=="" (
    echo [ERROR] Java tidak ditemukan. Install JDK 17+ lalu coba lagi.
    exit /b 1
  )
  set "PATH=%JAVA_HOME%\bin;%PATH%"
)
java -version 2>&1 | findstr /b "openjdk java version" 

echo Cek Android SDK...
if "%ANDROID_HOME%"=="" (
  if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
)
if "%ANDROID_HOME%"=="" (
  echo [ERROR] Android SDK tidak ditemukan. Set ANDROID_HOME atau install Android Studio.
  exit /b 1
)
echo    ANDROID_HOME = %ANDROID_HOME%

REM Beri tahu Gradle lokasi SDK
> local.properties echo sdk.dir=%ANDROID_HOME:\=/%

REM ===== Keystore =====
if not exist "%KEYSTORE%" (
  echo Membuat keystore baru (sekali saja^)...
  set "PW=PresensiKu2026!"
  keytool -genkeypair -v -keystore "%KEYSTORE%" -alias "%KEY_ALIAS%" ^
    -keyalg RSA -keysize 2048 -validity 10000 ^
    -storepass "%PW%" -keypass "%PW%" ^
    -dname "CN=SMKN 1 Kras, OU=PresensiKu, O=SMKN 1 Kras, L=Kediri, ST=Jawa Timur, C=ID" 2>nul
  if errorlevel 1 (
    echo [ERROR] Gagal membuat keystore. Pastikan Java JDK terinstall dan keytool tersedia.
    exit /b 1
  )
  (
    echo storeFile=%KEYSTORE%
    echo storePassword=%PW%
    echo keyAlias=%KEY_ALIAS%
    echo keyPassword=%PW%
  ) > "%KEYSTORE_PROPS%"
  echo    Keystore dibuat: %KEYSTORE%
) else (
  echo Keystore sudah ada, dipakai untuk menandatangani.
)

REM ===== Build APK release =====
echo Build APK (pertama kali butuh waktu, mengunduh Gradle & dependensi^)...
if exist gradlew.bat (
  call gradlew.bat --no-daemon assembleRelease
) else (
  gradle assembleRelease
)
if errorlevel 1 (
  echo [ERROR] Build gagal. Periksa pesan error di atas.
  exit /b 1
)

set "APK=app\build\outputs\apk\release\app-release.apk"
if not exist "%APK%" (
  echo [ERROR] Build gagal — APK tidak ditemukan.
  exit /b 1
)

set "OUT=PresensiKu-WebView-v%APP_VERSION%.apk"
copy /y "%APK%" "..\%OUT%" >nul

REM ===== Salin ke folder publik website =====
set "APK_WEB_DIR=..\..\apps\web\public\apk"
if not exist "%APK_WEB_DIR%" mkdir "%APK_WEB_DIR%"
copy /y "%APK%" "%APK_WEB_DIR%\PresensiKu.apk" >nul
echo.
echo [SELESAI] APK siap dibagikan:
echo    deploy\android\%OUT%
echo    (juga disalin ke %APK_WEB_DIR%\PresensiKu.apk untuk diunduh dari website)
echo.
echo Supaya bisa diunduh dari https://absen.smkn1kras.sch.id/apk/PresensiKu.apk:
echo    git add apps/web/public/apk/PresensiKu.apk ^&^& git commit -m "update APK" ^&^& git push origin main
echo    lalu di VPS: cd /opt/presensiku ^&^& bash update.sh
echo.
echo [PENTING] Simpan baik-baik %KEYSTORE% dan %KEYSTORE_PROPS% — keystore hilang = tidak bisa update APK!

endlocal
