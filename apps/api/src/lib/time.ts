import { config } from '../config.js';

/**
 * Seluruh timestamp disimpan dalam UTC di database.
 * "Hari ini" selalu dihitung berdasarkan timezone sekolah (default Asia/Jakarta).
 * Waktu client TIDAK pernah dipercaya untuk penentuan tanggal absensi.
 */

export const TZ = config.timezone; // e.g. Asia/Jakarta (UTC+7)

/** Offset UTC dalam jam untuk timezone statis yang didukung. */
function tzOffsetMs(): number {
  if (TZ === 'Asia/Jakarta' || TZ === 'Asia/Makassar') return TZ === 'Asia/Jakarta' ? 7 : 8;
  if (TZ === 'Asia/Pontianak') return 7;
  // default: Asia/Jakarta
  return 7;
}

/** Tanggal lokal (timezone sekolah) dalam format YYYY-MM-DD untuk suatu instant. */
export function dateKey(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const shifted = new Date(d.getTime() + tzOffsetMs() * 3600_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Instant UTC yang merepresentasikan pukul 00:00 waktu Jakarta pada tanggal tsb. */
export function startOfLocalDay(dateKeyStr: string): Date {
  return new Date(`${dateKeyStr}T00:00:00+07:00`);
}

/** Awal "hari ini" menurut timezone sekolah (untuk query range). */
export function todayStart(): Date {
  return startOfLocalDay(dateKey());
}

/** Akhir "hari ini" (24 jam berikutnya). */
export function todayEnd(): Date {
  return new Date(todayStart().getTime() + 24 * 3600_000);
}

/**
 * Prisma menyimpan kolom @db.Date sebagai tengah malam UTC dari tanggal hasil TRUNCATE
 * instant (mis. startOfLocalDay → selalu hari SEBELUMNYA untuk timezone +7/+8).
 * Untuk menampilkan/menghitung tanggal lokal yang benar dari nilai tersimpan, tambah 1 hari.
 */
export function localDateKeyOfStoredDate(storedDate: Date): string {
  return dateKey(new Date(storedDate.getTime() + 24 * 3600_000));
}

/** Format jam lokal WIB (HH:mm) untuk suatu instant. */
export function localTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const shifted = new Date(d.getTime() + tzOffsetMs() * 3600_000);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Menit sejak tengah malam waktu LOKAL (timezone sekolah) untuk suatu instant.
 * Penting: JANGAN pakai date.getHours() langsung — server bisa berjalan di UTC
 * sehingga jam 15:24 WIB terbaca 08:24 dan aturan "pulang awal" salah.
 */
export function localMinutesOf(date: Date | string = new Date()): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  const shifted = new Date(d.getTime() + tzOffsetMs() * 3600_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** Format tanggal lokal (dd MMM yyyy) mis. "16 Agu 2026". */
export function localDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('id-ID', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Parse "HH:mm" (waktu lokal) menjadi instant UTC pada tanggal tsb. */
export function localTimeToUtc(dateKeyStr: string, hhmm: string): Date {
  return new Date(`${dateKeyStr}T${hhmm}:00+07:00`);
}

/** Rentang bulan untuk query: [awal, akhir) dalam instant UTC. */
export function monthRange(monthKey: string): { start: Date; end: Date } {
  const [y, m] = monthKey.split('-').map(Number);
  const start = startOfLocalDay(`${y}-${String(m).padStart(2, '0')}-01`);
  const end = new Date(start.getTime() + 31 * 24 * 3600_000);
  return { start, end };
}

/** Tanggal key bulan ini (YYYY-MM) waktu Jakarta. */
export function currentMonthKey(): string {
  return dateKey().slice(0, 7);
}
