# PresensiKu — Sistem Informasi Absensi Sekolah

Platform absensi sekolah modern, mobile-first, realtime, dan siap di-install sebagai **PWA** di HP.
Nama aplikasi, sekolah, warna, logo, dan aturan absensi **sepenuhnya dapat dikonfigurasi** tanpa mengubah kode.

> Nama default: **PresensiKu** · Sekolah contoh: **SMK Negeri 1 Kras** (jurusan: TKJ, TKR, TPTUP, KULINER) · Warna: teal `#0d9488`

---

## Fitur Utama

| Area | Fitur |
|---|---|
| **Absensi** | Wajah (liveness), QR dinamis & kartu, NFC/RFID, manual (fallback), mode **Gerbang** otomatis |
| **Realtime** | Dashboard admin/guru/gerbang update otomatis via WebSocket (Socket.IO), tanpa reload |
| **Roles** | Super Admin, Admin/TU, Kepala Sekolah, Wali Kelas, Guru, Staff, Siswa, Orang Tua — RBAC diterapkan di **backend** |
| **Orang Tua** | Login WhatsApp + OTP, pantau kehadiran anak, jam datang/pulang, keterlambatan, rekap bulanan |
| **Izin** | Pengajuan (sakit/izin/cuti/dinas), persetujuan/penolakan + alasan, notifikasi |
| **Guru** | Dashboard sesi mengajar, validasi kehadiran kelas (bottom sheet), jurnal mengajar |
| **Admin** | CRUD siswa/guru/kelas/jadwal, **registrasi wajah** (kamera + sampel + consent + reset/persetujuan), import CSV siswa **& guru/staff** + template, hapus massal siswa, **guru piket**, upload **bukti izin**, export CSV, laporan, perangkat, audit log, pengaturan branding |
| **Keamanan** | JWT + refresh rotation, OTP di-hash, password bcrypt, rate limiting, helment/CORS, Zod, audit log, anti-duplikat, waktu server, GPS opsional |
| **PWA** | Installable, offline cache, manifest, splash, service worker |

---

## Arsitektur

```
Frontend PWA (React + Vite + Tailwind + TanStack Query + Socket.IO)
   │
   ▼
REST API (Fastify + TypeScript)
   │
   ▼
Service Layer (attendance engine, face, qr, card, otp, notify, storage)
   │
   ▼
Prisma ORM → PostgreSQL
```

Realtime: `Attendance Created → emit attendance:new → dashboard/gerbang update tanpa reload`

Face recognition: `kamera → frame JPEG → deteksi → liveness (pergerakan antar frame) → embedding (perceptual hash) → verifikasi → absensi`
Provider di-abstraksi: `mock` berfungsi penuh untuk development; pasang provider eksternal (face-api.js, AWS Rekognition, dsb.) lewat interface `FaceRecognitionProvider`.

---

## Struktur Folder

```
├── apps/
│   ├── api/                    # Backend Fastify + Prisma
│   │   ├── prisma/             # schema.prisma + migrations + seed.ts
│   │   ├── src/
│   │   │   ├── routes/         # auth, attendance, face, qr, cards, students, users,
│   │   │   │                   # akademik, leave, journals, reports, notifications,
│   │   │   │                   # devices, audit, settings, upload, import
│   │   │   ├── services/       # attendance.ts (mesin absensi), face.ts, qr.ts, card.ts,
│   │   │   │                   # otp.ts, notify.ts, storage.ts, settings.ts, auth.ts
│   │   │   ├── plugins/        # auth (JWT) + rbac (permission)
│   │   │   ├── realtime/       # emitter Socket.IO
│   │   │   ├── rbac/           # daftar role → permission
│   │   │   └── lib/            # prisma, crypto, time (WIB), audit, csv
│   │   └── tests/              # 23 tes (auth, RBAC, attendance, QR, kartu, izin, laporan, wajah)
│   └── web/                    # Frontend React PWA
│       ├── public/icons/       # ikon PWA
│       ├── scripts/            # generate-icons.mjs
│       └── src/
│           ├── pages/          # login, admin/*, teacher/*, student/*, parent/*, shared/*, monitor
│           ├── components/     # AppShell (sidebar + bottom nav), dll
│           └── lib/            # api, auth, theme, toast, socket, camera, ui, format
├── deploy/nginx.conf
├── docker-compose.yml
└── .env.example
```

---

## Menjalankan (Development)

Prasyarat: Node.js 20+, PostgreSQL 16.

```bash
# 1. Konfigurasi
cp .env.example apps/api/.env   # sesuaikan DATABASE_URL

# 2. Backend
cd apps/api
npm install
npm run db:migrate              # buat skema
npm run db:seed                 # data contoh
npm run dev                     # API di http://localhost:4000

# 3. Frontend (terminal lain)
cd apps/web
npm install
npm run dev                     # http://localhost:5173
```

Atau dari root (butuh `concurrently`):
```bash
npm install
npm run dev
```

### Akun Login (development)

| Role | Username | Password |
|---|---|---|
| Super Admin | `superadmin` | `admin123` |
| Admin / TU | `admin` | `admin123` |
| Kepala Sekolah | `kepsek` | `kepsek123` |
| Wali Kelas | `wali` | `guru123` |
| Guru | `guru` | `guru123` |
| Staff | `staff` | `staff123` |
| Siswa | NISN `121212` + tanggal lahir `2009-01-15` | (tanpa password) |
| Orang Tua | WhatsApp `081234567890` | OTP (kode ditampilkan di log server saat development) |

> ⚠️ Password di atas HANYA untuk development — wajib diganti di production.

### Panduan Penggunaan (di mana fiturnya?)

**Siswa** (login NISN + password, mis. NISN `121212` + `smkn1kras` — di halaman login pilih tab **Siswa**; password default bisa di-reset massal oleh admin/TU)
- Beranda memiliki menu **Registrasi Wajah** (juga di halaman **Absen** lewat kartu "Wajah belum terdaftar" dan di drawer ☰) — daftar wajah sendiri → status *Menunggu Persetujuan* → disetujui admin.
- Bottom nav **Absen** → pilih metode: **Absen Wajah**, **QR Code**, **Kartu / NFC**, atau **Manual** (khusus guru/petugas).
- **Absen Wajah**: kamera depan + frame scan + liveness. Belum terdaftar? Kartu **"Daftar"** muncul otomatis di halaman Absen → siswa mendaftarkan wajahnya sendiri dari HP (sampel + persetujuan) → status *Menunggu Persetujuan* → setelah di-**Setujui** admin, wajah baru bisa dipakai absen.
- **QR Code**: mode **Pindai QR** (kamera belakang) atau **QR Saya** (tampilkan QR pribadi + tombol *Absen Sekarang* untuk tes tanpa HP kedua).
- Bottom nav **Riwayat** (riwayat absensi) dan **Izin** (ajukan izin).

**Guru / Staff / Wali Kelas** (login `guru` / `guru123`)
- **Petugas Piket** adalah **role tersendiri** (terpisah dari Guru): admin memilih role **Petugas Piket** saat membuat/import akun (atau ubah role lewat Edit). Hanya Petugas Piket & admin yang bisa scan absen siswa di gerbang.
- Login sebagai Petugas Piket → dashboard menampilkan kartu **"Kamu petugas piket hari ini"** → **Buka Gerbang** — kamera otomatis, scan wajah/QR/kartu untuk mencatat absen siswa di gerbang. Menu/bottom nav **Absen** membuka gerbang. Petugas Piket juga punya akses **Laporan & Cetak** (reports + export CSV) dan **Persetujuan Izin** (approve/tolak izin siswa) lewat drawer ☰.
- Guru/Staff/Wali Kelas absen **diri sendiri** lewat bottom nav **Absen** (wajah/QR/kartu) — tidak bisa scan siswa di gerbang.
- **Kelas** → pilih kelas → validasi kehadiran (bottom sheet ubah status siswa).
- **Jurnal Mengajar** & menu lain lewat drawer ☰ (kiri atas).

**Admin / Super Admin** (login `admin` / `admin123`)
- Sidebar (atau drawer ☰ di HP) → **Registrasi Wajah**:
  - **Menunggu Persetujuan** (bagian atas): daftar siswa yang mendaftar wajah dari HP-nya sendiri → tombol **Setujui** (wajah langsung aktif) atau **Reset** (tolak/hapus data).
  - **Daftarkan manual**: pilih siswa → kamera aktif → ambil 1–4 sampel → centang persetujuan → **Simpan Registrasi** (langsung aktif karena dilakukan admin).
  - Data wajah bisa di-**Reset** kapan saja (mis. ada masalah).
- **Siswa**: identitas memakai **NISN** + **Password** (default `smkn1kras`, login siswa memakai NISN + password), tambah/edit lengkap, hapus per siswa, **checkbox hapus massal**, **reset password massal** (ke `smkn1kras`) & per siswa, **Import & Export CSV + template** (format sama: NISN, Nama, Kelas, Jurusan, Jenis Kelamin, Tanggal Lahir, No HP, Orang Tua, Card UID).
- **Guru & Staff**: tambah/edit (termasuk ubah **username**) /hapus akun, **checkbox hapus massal**, **Import & Export CSV + template**, dan role **Petugas Piket** yang terpisah dari Guru.
- **Kelas & Jadwal** (menu **Kelas**): tab **Kelas** (tambah/edit/hapus + **checkbox hapus massal** + **Import/Export CSV** + template, kolom Nama Kelas/Tingkat/Jurusan/Ruang), tab **Jurusan** (TKJ/TKR/TPTUP/KULINER), tab **Mapel** (tambah/edit/hapus + **checkbox hapus massal** + **Import/Export CSV** + template), tab **Jadwal**.
- **Pengaturan → Aturan Absensi**: selain jam batas terlambat, kini ada **Jam Pulang Sekolah**. Siswa yang absen pulang **sebelum jam itu** otomatis ditandai **"Pulang Awal"** di riwayat absensi (badge kuning) — mis. izin lebih awal karena sakit/keperluan.
- **Perangkat**: daftar HP/komputer yang pernah login (terdaftar otomatis, 1000+ perangkat tidak memperlambat server). Tersedia **cari**, **filter status**, **blokir/aktifkan**, **hapus (reset)** per perangkat, dan **hapus massal** via checkbox.
- **Siswa** login sebagai siswa: beranda menampilkan menu **Registrasi Wajah** langsung (juga di halaman **Absen** dan drawer ☰) — daftar wajah sendiri → menunggu persetujuan admin.
- **Pengaturan → Aturan Absensi & Lokasi**: set **titik absensi GPS** (latitude/longitude + radius) dan aktifkan "Wajib GPS di area sekolah" — siswa hanya bisa absen di dalam radius itu (diverifikasi server).
- **Izin**: pengajuan bisa menyertakan **bukti/lampiran** (surat/dokter) — admin melihat tombol **Lihat Bukti**.
- **Absensi**: monitoring realtime hari ini + tombol **Absen Manual** (fallback, tercatat di audit log).
- **Skala & performa**: rate-limit dihitung **per user** (bukan per IP) — ratusan siswa di belakang 1 IP NAT sekolah tetap mendapat jatah sendiri saat jam ramai; duplikat absen dicegah di database (unique `userId+date+type`) dan race kondisi ditangani (bukan error 500). Foto wajah otomatis dikompresi di HP (maks ~480px JPEG) dan **tidak disimpan** (hanya embedding); bukti izin dikompresi otomatis di sisi klien (maks ~1280px JPEG) sebelum diunggah.
- **Pengaturan**: nama aplikasi/sekolah, warna tema, aturan absensi (jam terlambat, anti-duplikat, GPS).

**Orang Tua**
- Tab **Orang Tua** di halaman login → WhatsApp + OTP → lihat kehadiran anak, jam datang/pulang, keterlambatan, dan rekap bulanan.

### Menjalankan dengan Docker

```bash
docker compose up -d --build
# Frontend: http://localhost  ·  API: http://localhost:4000
```

Service: `postgres`, `redis`, `backend`, `frontend` (nginx di dalam image frontend menangani proxy `/api` & `/socket.io`).

---

## Deploy ke VPS Ubuntu 24.04

### 1. Upload ke GitHub (sekali)

```bash
# dari folder proyek (sudah di-commit)
git remote add origin https://github.com/USERNAME/presensiku.git
git branch -M main
git push -u origin main
```

> Buat repo dulu di github.com (tanpa README agar tidak bentrok), lalu jalankan perintah di atas.

### 2. Setup otomatis di VPS (sekali)

Masuk VPS via SSH, lalu jalankan script bawaan:

```bash
ssh user@IP_VPS
sudo apt update && sudo apt install -y curl git
curl -sL -o /tmp/vps-setup.sh https://raw.githubusercontent.com/USERNAME/presensiku/main/deploy/vps-setup.sh
sudo bash /tmp/vps-setup.sh https://github.com/USERNAME/presensiku.git absen.sch.id
```

- Tanpa domain: `sudo bash /tmp/vps-setup.sh https://github.com/USERNAME/presensiku.git` → akses via `http://IP_VPS`
- Dengan domain: tambahkan argumen kedua → HTTPS otomatis (Let's Encrypt via Caddy). Arahkan DNS A domain ke IP VPS terlebih dahulu, dan buka port 80/443 di firewall provider.

Script otomatis: install Docker, clone repo ke `/opt/presensiku`, buat `.env` dengan **secret acak**, build & start container, jalankan seed data, dan buka firewall.

### 3. Update aplikasi (setiap ada perubahan)

**Di komputer** — setelah mengubah kode:
```bash
git add -A && git commit -m "fitur baru" && git push
```

**Di VPS** — satu perintah:
```bash
cd /opt/presensiku && git pull && docker compose up -d --build
```

> Migrasi database (`prisma migrate deploy`) dan seed berjalan otomatis saat container backend start. Data tersimpan di volume Docker (`pgdata`), jadi aman saat rebuild.

### Berguna di VPS

```bash
cd /opt/presensiku
docker compose ps                          # status container
docker compose logs -f backend             # log API
docker compose logs -f frontend            # log web
docker compose exec backend npm run db:seed   # isi ulang data contoh
```

---

## Pengujian

```bash
cd apps/api
npm test        # vitest — butuh database test (dibuat otomatis di prisma migrate deploy)
npm run typecheck
cd ../web
npm run typecheck
npm run build   # build production + PWA service worker
```

Cakupan tes: autentikasi, rotasi refresh token, RBAC (forbidden untuk role lain), absensi QR + pencegahan duplikat, check-out tanpa check-in, validasi QR (kedaluwarsa/rusak), validasi kartu, persetujuan/penolakan izin, laporan + export CSV, layanan pengenalan wajah (facenet-web: enroll descriptor → verifikasi cocok/tidak cocok).

---

## Aplikasi Android (APK)

Aplikasi ini bisa dijadikan **aplikasi Android (APK)** — APK tipis yang menampilkan website
langsung dari server, jadi **update di VPS otomatis tampil di HP tanpa build APK ulang**.
Ada dua pilihan:

- **APK WebView (disarankan)** — hanya menampilkan website; jalan di semua Android 5.0+
tanpa butuh Chrome/assetlinks, kamera/lokasi/upload sudah aktif.
  Build: `bash deploy/android/build-apk-webview.sh` → `PresensiKu-WebView-v1.0.0.apk`.
- **APK TWA** — cangkang PWA (untuk notifikasi push), perlu Chrome + assetlinks untuk fullscreen.
  Build: `bash deploy/android/build-apk.sh` → `PresensiKu-v1.0.0.apk`.

- **Kompatibel semua Android** 5.0+ (API 21), termasuk HP lama/RAM kecil.
- Setelah build, APK otomatis tersedia untuk **diunduh langsung dari website**
  (`/apk/PresensiKu.apk`) — pengunjung HP Android melihat banner unduhan di atas halaman.
- Panduan lengkap: [`deploy/android/README-ANDROID.md`](deploy/android/README-ANDROID.md)
- Build butuh Java JDK 17+ & Android SDK (sekali install di komputer).

Tanpa APK pun siswa bisa install langsung dari Chrome: buka aplikasi → menu ⋮ → **Install aplikasi**.

---

## Environment Variables

Lihat `.env.example` untuk daftar lengkap. Yang utama:

| Variabel | Fungsi |
|---|---|
| `DATABASE_URL` | Koneksi PostgreSQL |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Rahasia token (wajib diganti) |
| `APP_NAME` / `SCHOOL_NAME` | Identitas aplikasi/sekolah (bisa diubah juga dari Pengaturan) |
| `TIMEZONE` | Default `Asia/Jakarta` |
| `LATE_AFTER_HOUR` / `LATE_AFTER_MINUTE` | Batas jam terlambat |
| `LOCATION_ENABLED` / `LOCATION_RADIUS_METERS` | Validasi GPS (opsional) |
| `STORAGE_DRIVER` | `local` (development) atau S3-compatible |
| `FACE_RECOGNITION_PROVIDER` | `mock` atau provider eksternal |
| `WHATSAPP_PROVIDER` / `SMTP_*` | Notifikasi WhatsApp/email |
| `OTP_DEV_PREVIEW` | Tampilkan kode OTP di log saat development |

---

## API Utama

```
POST /api/auth/login · POST /api/auth/refresh · POST /api/auth/logout
POST /api/auth/otp/request · POST /api/auth/otp/verify · POST /api/auth/change-password
GET  /api/dashboard · GET /api/auth/me

POST /api/attendance/check-in · /check-out
POST /api/attendance/face · /qr · /card · /gate · /manual
GET  /api/attendance/today · /student/:id · /class/:id

POST /api/face/register (self → PENDING, admin → aktif) · POST /api/face/:userId/approve · DELETE /api/face/:userId · GET /api/face/pending
GET  /api/qr/me · /qr/student/:id · POST /api/cards
POST /api/leave · GET /api/leave · POST /api/leave/:id/approve · /reject
GET  /api/reports/daily · /monthly · /class/:id · /export

GET  /api/students · POST /api/students · PUT/DELETE /api/students/:id
GET  /api/users · /classes · /majors · /subjects · /schedules · /teachers
GET  /api/devices · /audit · /notifications · /settings
POST /api/import/students/preview · /confirm · POST /api/upload
```

Format error standar: `{ success: false, message: "…", code: "ERROR_CODE" }` — kode seperti `FACE_NOT_RECOGNIZED`, `ALREADY_ATTENDANCE`, `EXPIRED_QR`, `OUTSIDE_LOCATION`, `FORBIDDEN`.

---

## Catatan Implementasi

- **Waktu** selalu dari **server** (timezone sekolah, WIB). Client timestamp tidak dipercaya.
- **Anti-duplikat**: satu absen datang + satu pulang per hari per user (`@@unique([userId, date, type])`), konfigurabel.
- **QR**: token JWT ditandatangani HMAC-SHA256 + nonce + expiry. QR dinamis 60 detik; QR kartu siswa (fallback) 1 tahun, nonce dirotasi.
- **Kartu**: UID disimpan sebagai SHA-256, tidak pernah plaintext.
- **Wajah**: hanya **descriptor FaceNet 128-d** (hasil deteksi di HP) yang dikirim & disimpan; foto mentah tidak pernah dikirim/disimpan; data biometrik tidak pernah diekspos API; registrasi siswa lewat HP berstatus **PENDING** dan baru aktif setelah **disetujui admin** (approve/reset); siswa bisa hapus datanya sendiri (privasi).
- **RBAC**: daftar role→permission di `src/rbac/permissions.ts`, di-mirror ke tabel DB, dan diterapkan di middleware + service layer (bukan hanya menu UI).
- **Audit log**: `ATTENDANCE_CREATED`, `ATTENDANCE_MANUAL_CHANGED`, `LEAVE_APPROVED`, `FACE_REGISTERED`, `EXPORT_REPORT`, dll.
- **Absensi manual** wajib lewat guru/admin dan masuk audit log.
- **Face provider mock** (perceptual hash) berfungsi nyata dengan kamera untuk demo; provider eksternal bisa dipasang lewat interface tanpa mengubah kode lain.

---

## Roadmap / Tahap Berikutnya

- [x] Phase 1 — Auth, RBAC, database, CRUD, dashboard, mobile UI
- [x] Phase 2 — QR, kartu, wajah, realtime, gerbang
- [x] Phase 3 — Dashboard orang tua, izin, notifikasi, jurnal
- [x] Phase 4 — Laporan, export, audit log, perangkat
- [x] Phase 5 — PWA, service worker, performa, keamanan dasar
- [ ] Integrasi provider wajah nyata (face-api.js / AWS Rekognition)
- [ ] Push notification (Web Push / FCM)
- [ ] WhatsApp Business API untuk notifikasi orang tua
- [ ] Mode offline penuh dengan sinkronisasi antrean
- [ ] Multi-sekolah (tenant) untuk SaaS

---

## Log Perubahan

- **Pengenalan wajah diganti total — jauh lebih akurat** 🔥 — sebelumnya sistem membandingkan *hash seluruh frame* (mock, sensitif terhadap cahaya/posisi) sehingga wajah yang sudah direkam sering ditolak saat absen. Sekarang deteksi wajah & ekstraksi ciri wajah (descriptor **FaceNet 128-dimensi**) dilakukan **langsung di HP** memakai face-api.js + TensorFlow.js (WebGL), dan server membandingkan descriptor dengan jarak euclidean + margin anti-salah-kenal. Model wajah (±5 MB) diunduh sekali lalu di-cache. Foto mentah tetap tidak pernah dikirim/disimpan.
  - ⚠️ **PENTING — siswa yang pernah mendaftar wajah sebelum update ini harus daftar ulang sekali** (data lama `ahash-v1` tidak kompatibel). Sistem otomatis mendeteksi dan menampilkan kartu **"Data wajah lama — perlu daftar ulang"** di menu Registrasi Wajah siswa & admin. Setelah daftar ulang + disetujui admin, absen wajah langsung akurat.
  - Penyetelan opsional di `.env`: `FACE_MATCH_THRESHOLD` (default 0.6) dan `FACE_MATCH_MARGIN` (default 0.15, cegah salah kenal saat banyak siswa).
- **Menu Wali Kelas disesuaikan** — menu "Absen" dihapus, "Ajukan Izin" diganti **"Persetujuan Izin"**, dan ditambahkan menu **"Laporan"** yang hanya menampilkan kelas walinya (data kelas lain disembunyikan). Wali kelas hanya bisa mencetak laporan murid kelasnya sendiri; piket/admin/superadmin tetap melihat semua kelas.
- **Riwayat bisa difilter kelas** — halaman Riwayat Absensi kini punya dropdown **"Semua Kelas / per Kelas"** untuk wali kelas, piket, dan admin, plus menampilkan nama & kelas siswa pada setiap baris.
- **Menu Guru disederhanakan** — menu "Ajukan Izin" dan "Absen" dihapus untuk role Guru (beranda, sidebar, drawer, dan bottom nav). Menu Guru kini: Beranda, Jurnal Mengajar, Kelas, Riwayat, Notifikasi, Profil.
- **Perbaikan Export Excel** — tombol Export Excel sebelumnya gagal karena nama file berakhiran `.excel` (seharusnya `.xlsx`) sehingga format tidak dikenali; kini berhasil mengunduh file `.xlsx` yang valid.
- **Rekap per Kelas di Laporan** — saat filter kelas "Semua Kelas", laporan kini menampilkan tabel **Rekap per Kelas** (total siswa, hadir, terlambat, izin/sakit, tidak hadir) di halaman maupun di file PDF/Excel yang diexport.
- **Laporan: Export PDF & Excel (bukan CSV lagi)** — tombol "Export PDF" dan "Export Excel" menggantikan CSV. PDF dicetak landscape dengan ringkasan, tabel rincian, dan **blok tanda tangan** (kota + tanggal, "Petugas Piket,", nama lengkap, dan NIP dari akun yang login — mengikuti format laporan resmi). Excel berisi sheet rapi yang siap diolah.
- **Dashboard guru piket dirapikan** — kartu "Kehadiran Saya" dihapus (guru tidak memerlukannya), banner menampilkan **jabatan** di bawah nama (Guru / Petugas Piket / Wali Kelas) tanpa baris tanggal, dan menu mobile "Ajukan Izin" diperbaiki menjadi **"Persetujuan Izin"** (mengarah ke daftar persetujuan).
- **Menu siswa disederhanakan** — siswa kini hanya melihat metode absen yang relevan: **Scan QR dihapus** (diganti **QR Saya** — QR pribadi untuk ditunjukkan ke petugas gerbang), **Kartu/NFC dihapus** untuk siswa. Beranda siswa menampilkan **nama + kelas** di banner atas.
- **Perbaikan menu "Ajukan Izin" untuk siswa** — sebelumnya menu mengarah ke halaman admin (persetujuan) yang ditolak (403). Kini siswa/guru/staff diarahkan ke **pengajuan milik sendiri** (`/app/leave/mine`); menu persetujuan hanya untuk admin/wali kelas/petugas piket.
- **Form Tambah/Edit Siswa** — kolom **Password Baru** di form Edit (kosongkan = tidak diubah, default `smkn1kras`); form Tambah sudah punya kolom Password Awal.
- **Perbaikan unduhan APK di website** — tombol "Unduh APK" sebelumnya mengunduh file rusak (halaman HTML 923 byte, bukan APK) karena file APK asli tidak ada di server dan nginx SPA fallback mengembalikan halaman dengan status 200. Banner kini hanya muncul jika file yang diunduh benar-benar APK (cek tipe & ukuran). Ditambah **workflow GitHub Actions "Build APK WebView"** untuk membangun APK asli otomatis (tanpa Java/SDK di komputer) lalu meng-commit-nya ke `apps/web/public/apk/` — cara pakai: GitHub → Actions → Run workflow → `bash update.sh` di VPS.
- **Logo baru** — ikon aplikasi didesain ulang terinspirasi emblem SMKN 1 Kras (perisai biru, bingkai emas, aksen magenta, bintang, tanda centang absen, buku terbuka). Berlaku untuk PWA (`apps/web/public/icons/`), favicon, dan semua ikon Android (TWA + WebView). Sumber SVG + script ada di `deploy/icon/` (regenerate: `cd deploy/icon && npm install && npm run render`).
- **Perbaikan halaman Riwayat** — error `Cannot read properties of undefined (reading 'slice')` saat guru/staff membuka Riwayat Absensi (data laporan bulanan tidak punya `dayKey`). Kini aman dengan fallback ke tanggal.

---

Dibangun dengan Fastify, Prisma, PostgreSQL, Socket.IO, React, Vite, Tailwind CSS, dan PWA.
