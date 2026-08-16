# 📱 PresensiKu untuk Android

Ada **dua pilihan** untuk mengubah aplikasi ini menjadi aplikasi Android (APK).
Keduanya sama-sama APK tipis (±1–2 MB) yang **menampilkan website langsung dari server** —
jadi setiap `bash update.sh` di VPS, HP otomatis memakai versi terbaru. **Tidak perlu
build APK ulang** setiap ada pembaruan.

| | **Pilihan 1: WebView** ⭐ (disarankan) | Pilihan 2: TWA |
|---|---|---|
| Cara kerja | Browser mini bawaan Android yang membuka website | Cangkang PWA lewat Chrome |
| Butuh Chrome di HP? | ❌ Tidak | ✅ Ya |
| Butuh assetlinks/fullscreen? | ❌ Tidak (fullscreen selalu) | ✅ Perlu fingerprint |
| Kamera / lokasi / upload | ✅ Sudah diaktifkan | ✅ Via Chrome |
| Android 5.0+ (HP lama/RAM kecil) | ✅ | ✅ |
| Script build | `build-apk-webview.sh` | `build-apk.sh` |
| Hasil APK | `PresensiKu-WebView-v1.0.0.apk` | `PresensiKu-v1.0.0.apk` |

> **Rekomendasi:** pakai **WebView** — paling sederhana, jalan di semua HP tanpa
> ketergantungan apa pun, dan langsung fullscreen. TWA hanya perlu jika ingin
> **notifikasi push** dari PWA.

---

# Pilihan 1: APK WebView sederhana (disarankan)

## 1. Siapkan komputer build (sekali saja, ± 10 menit)

Install dua hal berikut di komputer Windows/Linux/macOS yang akan dipakai build:

### a. Java JDK 17+
Cek: `java -version` → harus menampilkan versi 17 atau lebih baru.
Kalau belum ada, pasang **Android Studio** (poin b) dan gunakan JDK bawaannya
(`C:\Program Files\Android\Android Studio\jbr`), atau unduh dari
[Adoptium](https://adoptium.net/).

### b. Android SDK (Command-Line Tools)
Cara termudah: install **Android Studio** → menu **More Actions → SDK Manager** →
centang **"Android SDK Platform 36"** dan **"Android SDK Build-Tools"** → Apply.
Setelah itu pastikan:

```bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"   # Windows (Git Bash)
export ANDROID_HOME="$HOME/Android/Sdk"           # Linux
# agar permanen: tambahkan ke ~/.bashrc atau setx ANDROID_HOME ...
```

## 2. Build APK

```bash
bash deploy/android/build-apk-webview.sh
```

atau di Windows tanpa Git Bash: klik dua kali **`deploy/android/build-apk-webview.bat`**.

Script ini otomatis:
1. Mengecek Java & Android SDK.
2. Membuat **keystore tanda tangan** (sekali saja) → `webview/presensiku-release.keystore`.
3. Build APK release (pertama kali ± 5–15 menit karena mengunduh Gradle).
4. Menghasilkan **`deploy/android/PresensiKu-WebView-v1.0.0.apk`**.

> ⚠️ **Simpan baik-baik** `webview/presensiku-release.keystore` dan
> `webview/keystore.properties` (sudah otomatis di-ignore git). Keystore hilang =
> tidak bisa membuat APK versi berikutnya yang dianggap "update" oleh HP.

## 3. Pasang di HP

1. Kirim file `PresensiKu-WebView-v1.0.0.apk` ke HP siswa/guru (WhatsApp, Google Drive, dsb).
2. Di HP: buka file tersebut → izinkan **"Instal dari sumber tidak dikenal"**.
3. Buka aplikasi **PresensiKu** → otomatis menampilkan halaman login.
4. Saat pertama dibuka, aplikasi meminta izin **kamera** & **lokasi** — izinkan agar
   daftar/scan wajah dan absensi geolokasi berfungsi.

## 4. Kalau domain berubah

Buka `deploy/android/webview/app/src/main/res/values/strings.xml`, ganti
`start_url` dan `start_host`, lalu build ulang APK.

---

# Pilihan 2: APK TWA (Trusted Web Activity)

## 1. Siapkan komputer build

Sama seperti Pilihan 1 (Java JDK 17+ & Android SDK — poin a & b di atas).

## 2. Build APK

```bash
bash deploy/android/build-apk.sh
```

atau di Windows tanpa Git Bash: klik dua kali **`deploy/android/build-apk.bat`**.

Script ini otomatis:
1. Mengecek Java & Android SDK.
2. Membuat **keystore tanda tangan** (sekali saja) → `twa/app/presensiku-release.keystore`.
3. Build APK release (pertama kali ± 5–15 menit karena mengunduh Gradle).
4. Menghasilkan **`deploy/android/PresensiKu-v1.0.0.apk`** dan mencetak SHA256 fingerprint.

> ⚠️ **Simpan baik-baik** `twa/app/presensiku-release.keystore` dan
> `twa/keystore.properties` (sudah otomatis di-ignore git). Keystore hilang =
> tidak bisa membuat APK versi berikutnya yang dianggap "update" oleh HP.

## 3. Pasang di HP

1. Kirim file `PresensiKu-v1.0.0.apk` ke HP siswa/guru (WhatsApp, Google Drive, dsb).
2. Di HP: buka file tersebut → izinkan **"Instal dari sumber tidak dikenal"**.
3. Buka aplikasi **PresensiKu** → langsung tampil halaman login aplikasi.

## 4. Aktifkan mode fullscreen (Digital Asset Links) — sekali saja

Tanpa langkah ini aplikasi tetap jalan, tetapi dibuka di tab browser. Agar tampil
fullscreen seperti aplikasi native:

1. Setelah build, salin **SHA256 fingerprint** yang dicetak script.
2. Buka `apps/web/public/.well-known/assetlinks.json` dan ganti
   `GANTI_DENGAN_SHA256_FINGERPRINT_ANDA` dengan fingerprint tersebut
   (boleh lebih dari satu fingerprint untuk banyak keystore).
3. Terapkan ke server:
   ```bash
   cd /opt/presensiku && bash update.sh
   ```
4. Verifikasi dari browser: buka `https://absen.smkn1kras.sch.id/.well-known/assetlinks.json`
   → harus berisi fingerprint Anda.
5. Hapus & pasang ulang APK di HP, lalu buka — sekarang fullscreen tanpa bar browser.

## 5. Mengubah nama / ikon / versi (TWA)

Semua pengaturan ada di **`deploy/android/twa-manifest.json`**:
- `name` / `launcherName` — nama aplikasi di layar utama
- `appVersion` + `appVersionCode` — naikkan setiap rilis APK baru
- `iconUrl` / `maskableIconUrl` — ikon (bisa URL di server atau file lokal)
- `host` / `startUrl` — domain & halaman awal (jangan diubah sembarangan)

Setelah diubah, regenerate proyek lalu build ulang:

```bash
node .tools/bubblewrap/node_modules/@bubblewrap/cli/bin/bubblewrap \
  --config .tools/bubblewrap/config.json update \
  --skipVersionUpgrade --directory deploy/android/twa \
  --manifest deploy/android/twa-manifest.json
bash deploy/android/build-apk.sh
```

---

# Tanpa APK sama sekali (jalan pintas)

Buka `https://absen.smkn1kras.sch.id` di **Chrome** → menu ⋮ →
**"Install aplikasi / Tambahkan ke layar utama"**. Hasilnya mirip aplikasi
(instalasi PWA), tanpa perlu build APK — cukup untuk uji coba dulu.

---

# Publikasi ke Play Store (opsional)

- Buat akun developer Google Play (biaya sekali ±US$25).
- Ikuti [dokumentasi TWA Google](https://developer.chrome.com/docs/android/trusted-web-activity/)
  untuk upload; sertakan `deploy/android/twa/store_icon.png` sebagai ikon toko.
- Fingerprint di assetlinks.json memakai keystore yang sama → fullscreen tetap aktif.
- Untuk versi WebView, upload `PresensiKu-WebView-v1.0.0.apk` dengan mengikuti
  [kebijakan WebView Google](https://support.google.com/googleplay/android-developer/answer/13317402)
  (isian form "pengungkapan aplikasi WebView").

---

## Catatan teknis

| Komponen | WebView | TWA |
|---|---|---|
| Package ID | `com.presensiku.app` | `id.sch.smkn1kras.presensiku` |
| Min SDK | 21 (Android 5.0) | 21 (Android 5.0) |
| Target SDK | 36 | 36 |
| Domain | `absen.smkn1kras.sch.id` | `absen.smkn1kras.sch.id` |
| Mode tampilan | Fullscreen WebView | `standalone`, portrait |
| Izin | Kamera, Lokasi, Storage | Kamera, Lokasi, Storage, Notifikasi |
