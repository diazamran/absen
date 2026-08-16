@echo off
REM ============================================================
REM build-apk.bat — Build aplikasi Android PresensiKu (TWA/APK)
REM   Jalankan: build-apk.bat
REM Syarat: Java JDK 17+ dan Android SDK (ANDROID_HOME)
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0twa"

echo [1/5] Cek Java...
java -version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Java tidak ditemukan. Install JDK 17+ lalu coba lagi.
  exit /b 1
)

echo [2/5] Cek Android SDK...
if "%ANDROID_HOME%"=="" (
  if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
)
if "%ANDROID_HOME%"=="" (
  echo ERROR: ANDROID_HOME belum diset. Contoh:
  echo   setx ANDROID_HOME "%%LOCALAPPDATA%%\Android\Sdk"
  echo Lalu tutup-buka terminal, atau install Android Studio.
  exit /b 1
)
echo   ANDROID_HOME=%ANDROID_HOME%

echo [3/5] Tulis local.properties...
echo sdk.dir=%ANDROID_HOME:\=/%> local.properties

echo [4/5] Buat keystore bila belum ada...
set "PW="
if not exist "app\presensiku-release.keystore" (
  set "PW=PresensiKu2026!%RANDOM%%RANDOM%"
  keytool -genkeypair -v -keystore app\presensiku-release.keystore -alias presensiku -keyalg RSA -keysize 2048 -validity 10000 -storepass "!PW!" -keypass "!PW!" -dname "CN=SMKN 1 Kras, OU=PresensiKu, O=SMKN 1 Kras, L=Kediri, ST=Jawa Timur, C=ID" 2>nul
  (
    echo storeFile=app/presensiku-release.keystore
    echo storePassword=!PW!
    echo keyAlias=presensiku
    echo keyPassword=!PW!
  ) > keystore.properties
  echo   Keystore baru dibuat. Kredensial di keystore.properties ^(jangan di-commit!^).
) else (
  echo   Keystore sudah ada, dipakai untuk menandatangani.
  for /f "usebackq tokens=2 delims==" %%a in ("keystore.properties") do set "PW=%%a"
)

echo [5/5] Build APK release (pertama kali butuh waktu, mengunduh Gradle)...
call gradlew.bat --no-daemon assembleRelease
if errorlevel 1 (
  echo ERROR: Build gagal. Lihat pesan di atas.
  exit /b 1
)

copy /y "app\build\outputs\apk\release\app-release.apk" "..\PresensiKu-v1.0.0.apk" >nul
echo.
echo ============================================================
echo  Selesai! APK siap dibagikan:
echo    deploy\android\PresensiKu-v1.0.0.apk
echo ============================================================
echo.
echo  SHA256 fingerprint ^(untuk assetlinks.json^):
if not "%PW%"=="" keytool -list -v -keystore app\presensiku-release.keystore -storepass "%PW%" -alias presensiku 2>nul | findstr /c:"SHA256:"
echo.
echo  Cara aktifkan mode fullscreen:
echo    1. Salin bagian setelah "SHA256: " ke apps\web\public\.well-known\assetlinks.json
echo    2. Di VPS: cd /opt/presensiku ^&^& bash update.sh
echo    3. Buka ulang aplikasi di HP.
echo.
echo  PENTING: simpan app\presensiku-release.keystore dan keystore.properties!
endlocal
