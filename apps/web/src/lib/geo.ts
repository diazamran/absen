/**
 * Modul GPS tahan banting untuk absensi.
 *
 * Masalah klasik absensi GPS di HP:
 *  - Fix GPS pertama butuh waktu lama (cold start) → scan pertama sering timeout.
 *  - Di dalam ruang kelas sinyal GPS lemah → POSITION_UNAVAILABLE / TIMEOUT.
 *  - Izin lokasi ditolak → gagal diam-diam tanpa pesan yang bisa ditindaklanjuti.
 *
 * Solusi:
 *  - warmUpGps(): ambil fix GPS lebih awal (dipanggil saat halaman absen dibuka)
 *    dan simpan di cache — scan pertama tidak lagi menunggu cold start.
 *  - getBestEffortPosition(): usahakan fix presisi tinggi → jatuh ke fix kasar
 *    (WiFi/seluler) → jatuh ke cache → HANYA izin ditolak yang gagal total.
 *  - Pesan galat berbahasa Indonesia yang menjelaskan LANGKAH perbaikannya.
 */

export interface GeoPosition {
  latitude: number;
  longitude: number;
  /** Akurasi dalam meter (semakin kecil semakin akurat). */
  accuracy: number;
  /** Waktu fix (epoch ms). */
  timestamp: number;
}

export type GeoFailureCode =
  | 'UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface GeoResult {
  position: GeoPosition | null;
  code: GeoFailureCode | null;
  /** Pesan Indonesia yang bisa ditindaklanjuti siswa. */
  message: string;
}

/** Cache fix GPS terakhir supaya scan berikutnya instan. */
let cached: GeoPosition | null = null;
let warmingPromise: Promise<boolean> | null = null;

/**
 * Umur cache yang masih dianggap "segar" untuk langsung dipakai.
 * Dinaikkan ke 3 menit: siswa biasanya tidak berpindah lokasi selama sesi absen,
 * dan meminta fix baru setiap 60 detik menyebabkan browser meminta lokasi berulang
 * yang hasilnya justru lebih tidak akurat (GPS cold start ulang).
 */
const CACHE_FRESH_MS = 3 * 60_000;
/** Umur maksimum cache boleh dipakai sebagai jaring pengaman. */
const CACHE_MAX_MS = 10 * 60_000;

export function isGeoSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.geolocation;
}

function toFailureCode(err: GeolocationPositionError): GeoFailureCode {
  if (err.code === err.PERMISSION_DENIED) return 'PERMISSION_DENIED';
  if (err.code === err.POSITION_UNAVAILABLE) return 'POSITION_UNAVAILABLE';
  if (err.code === err.TIMEOUT) return 'TIMEOUT';
  return 'UNKNOWN';
}

function failureMessage(code: GeoFailureCode): string {
  switch (code) {
    case 'PERMISSION_DENIED':
      return 'Izin lokasi ditolak. Buka Pengaturan HP → Lokasi → izinkan aplikasi/browser ini, lalu coba lagi.';
    case 'POSITION_UNAVAILABLE':
      return 'Sinyal GPS lemah. Aktifkan Lokasi di HP, dekat jendela atau keluar ruangan, lalu coba lagi.';
    case 'TIMEOUT':
      return 'GPS lambat merespons. Pastikan Lokasi aktif di HP, tunggu beberapa detik, lalu coba lagi.';
    case 'UNSUPPORTED':
      return 'Perangkat/browser tidak mendukung GPS. Pastikan situs dibuka lewat HTTPS di browser modern.';
    default:
      return 'Gagal mengambil lokasi. Coba lagi.';
  }
}

function acquire(opts: PositionOptions): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        }),
      (err) => reject(toFailureCode(err)),
      opts,
    );
  });
}

/**
 * Minta fix GPS lebih awal + simpan di cache. Dipanggil saat halaman absen dibuka
 * supaya scan pertama tidak menunggu cold start GPS.
 * Resolve `true` bila fix siap, `false` bila gagal (best-effort, tidak melempar error).
 */
export function warmUpGps(): Promise<boolean> {
  if (!isGeoSupported()) return Promise.resolve(false);
  if (cached && Date.now() - cached.timestamp < CACHE_FRESH_MS) return Promise.resolve(true);
  if (warmingPromise) return warmingPromise;
  // maximumAge dinaikkan ke 3 menit agar browser boleh memakai fix yang sudah ada di cache
  // sistem operasi — ini justru lebih akurat daripada memaksa fresh fix yang butuh cold start.
  warmingPromise = acquire({ enableHighAccuracy: true, timeout: 20_000, maximumAge: CACHE_FRESH_MS })
    .then((p) => {
      cached = p;
      return true;
    })
    .catch(() => {
      // Warm-up bersifat best-effort — kegagalan ditangani saat absen sesungguhnya.
      return false;
    })
    .finally(() => {
      warmingPromise = null;
    });
  return warmingPromise;
}

/** Baca fix GPS terakhir dari cache (tanpa memicu fix baru). */
export function getCachedPosition(): GeoPosition | null {
  return cached;
}

/** Buang cache (mis. setelah server menolak lokasi) supaya fix berikutnya segar. */
export function invalidateGpsCache(): void {
  cached = null;
}

function cacheStillUsable(maxAgeMs: number): GeoPosition | null {
  if (cached && Date.now() - cached.timestamp < maxAgeMs) return cached;
  return null;
}

/**
 * Ambil posisi terbaik yang mungkin — TIDAK gagal total kecuali izin ditolak.
 * Strategi: cache segar → fix presisi tinggi → fix kasar (WiFi/seluler) → cache lama.
 *
 * @param forceRefresh  Bila true, lewati cache segar dan minta fix baru dari perangkat.
 *                      Dipakai setelah server menolak lokasi (OUTSIDE_LOCATION / INACCURATE).
 */
export async function getBestEffortPosition(forceRefresh = false): Promise<GeoResult> {
  if (!isGeoSupported()) {
    return { position: null, code: 'UNSUPPORTED', message: failureMessage('UNSUPPORTED') };
  }
  // Scan berulang: pakai cache segar supaya absen tidak menunggu GPS lagi.
  // Bila forceRefresh=true (setelah server tolak), cache segar diabaikan agar kita
  // benar-benar meminta fix baru dari sistem operasi/perangkat.
  if (!forceRefresh) {
    const fresh = cacheStillUsable(CACHE_FRESH_MS);
    if (fresh) return { position: fresh, code: null, message: '' };
  }

  // 1) Fix presisi tinggi (GPS satelit).
  // maximumAge disesuaikan dengan CACHE_FRESH_MS supaya OS boleh memberi fix dari
  // cache internalnya — hasil ini umumnya lebih akurat daripada cold-start baru.
  try {
    const p = await acquire({ enableHighAccuracy: true, timeout: 15_000, maximumAge: CACHE_FRESH_MS });
    cached = p;
    return { position: p, code: null, message: '' };
  } catch (e) {
    const code = e as GeoFailureCode;
    // Izin ditolak = gagal total; mencoba lagi tanpa izin tidak akan pernah berhasil.
    if (code === 'PERMISSION_DENIED') {
      return { position: null, code, message: failureMessage(code) };
    }
    // 2) Fallback: fix kasar via WiFi/seluler — cepat walau akurasi rendah.
    try {
      const p = await acquire({ enableHighAccuracy: false, timeout: 10_000, maximumAge: CACHE_FRESH_MS });
      cached = p;
      return { position: p, code: null, message: '' };
    } catch {
      // 3) Jaring pengaman: cache lama (≤10 menit) masih jauh lebih baik daripada tanpa lokasi.
      const old = cacheStillUsable(CACHE_MAX_MS);
      if (old) return { position: old, code: null, message: '' };
      return { position: null, code, message: failureMessage(code) };
    }
  }
}
