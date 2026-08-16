# PresensiKu — Sistem Informasi Absensi Sekolah

Platform absensi sekolah modern, mobile-first, realtime, dan siap di-install sebagai **PWA** di HP.
Nama aplikasi, sekolah, warna, logo, dan aturan absensi **sepenuhnya dapat dikonfigurasi** tanpa mengubah kode.

> Nama default: **PresensiKu** · Sekolah contoh: **SMA Negeri 1 Nusantara** · Warna: teal `#0d9488`

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
| **Admin** | CRUD siswa/guru/kelas/jadwal, import CSV dengan preview + error per baris, export CSV, laporan, perangkat, audit log, pengaturan branding |
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
| Siswa | `siswa_121212` | `siswa123` |
| Orang Tua | WhatsApp `081234567890` | OTP (kode ditampilkan di log server saat development) |

> ⚠️ Password di atas HANYA untuk development — wajib diganti di production.

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

Cakupan tes: autentikasi, rotasi refresh token, RBAC (forbidden untuk role lain), absensi QR + pencegahan duplikat, check-out tanpa check-in, validasi QR (kedaluwarsa/rusak), validasi kartu, persetujuan/penolakan izin, laporan + export CSV, layanan pengenalan wajah (mock).

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

POST /api/face/register · DELETE /api/face/:userId
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
- **Wajah**: embedding perceptual-hash disimpan; foto mentah tidak disimpan; data biometrik tidak pernah diekspos API; tersedia "Reset Face Data".
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

Dibangun dengan Fastify, Prisma, PostgreSQL, Socket.IO, React, Vite, Tailwind CSS, dan PWA.
