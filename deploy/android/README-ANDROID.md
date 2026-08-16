# 📱 PresensiKu untuk Android

Aplikasi Android PresensiKu dibuat dengan teknik **TWA (Trusted Web Activity)** — APK tipis
(±1–2 MB) yang membuka aplikasi web langsung dari server Anda. Keuntungannya:

- **Update instan** — setiap `bash update.sh` di VPS, HP otomatis memakai versi terbaru.
  **Tidak perlu build APK ulang** setiap ada pembaruan.
- **Kompatibel semua Android** — Android 5.0 (API 21) ke atas, termasuk HP lama & RAM kecil.
- **Fullscreen** seperti aplikasi native (tanpa bar browser) setelah Digital Asset Links diaktifkan.

---

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

---

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

---

## 3. Pasang di HP

1. Kirim file `PresensiKu-v1.0.0.apk` ke HP siswa/guru (WhatsApp, Google Drive, dsb).
2. Di HP: buka file tersebut → izinkan **"Instal dari sumber tidak dikenal"**.
3. Buka aplikasi **PresensiKu** → langsung tampil halaman login aplikasi.

> Cara lain tanpa APK: buka `https://absen.smkn1kras.sch.id` di Chrome →
> menu ⋮ → **"Install aplikasi / Tambahkan ke layar utama"**. Hasilnya sama
> (instalasi PWA), tanpa perlu file APK.

---

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

---

## 5. Mengubah nama / ikon / versi

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

## 6. Publikasi ke Play Store (opsional)

- Buat akun developer Google Play (biaya sekali ±US$25).
- Ikuti [dokumentasi TWA Google](https://developer.chrome.com/docs/android/trusted-web-activity/)
  untuk upload; sertakan `deploy/android/twa/store_icon.png` sebagai ikon toko.
- Fingerprint di assetlinks.json memakai keystore yang sama → fullscreen tetap aktif.

---

## Catatan teknis

| Komponen | Nilai |
|---|---|
| Package ID | `id.sch.smkn1kras.presensiku` |
| Min SDK | 21 (Android 5.0) |
| Target SDK | 36 |
| Domain | `absen.smkn1kras.sch.id` |
| Mode tampilan | `standalone`, portrait |
| Izin | Kamera (wajah), Lokasi (geolokasi), Storage (bukti izin) |
