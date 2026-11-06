/**
 * Cron job harian — sinkronisasi SDMS otomatis.
 *
 * Berjalan setiap hari jam 01:00 WIB (18:00 UTC hari sebelumnya).
 * Memanggil endpoint POST /api/sdms/sync via HTTP lokal menggunakan
 * access token admin yang dibuat langsung (tanpa refresh token di DB).
 *
 * Tidak menggunakan library eksternal — pakai setTimeout rekursif.
 */

import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/crypto.js';
import { config } from '../config.js';

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;

/**
 * Hitung milidetik sampai jam target berikutnya (WIB).
 * targetHourWIB: 1 = 01:00 WIB
 */
function msUntilNextSync(targetHourWIB = 1): number {
  const now = new Date();
  // WIB = UTC+7
  const wibOffset = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffset);

  const nextSync = new Date(nowWIB);
  nextSync.setUTCHours(targetHourWIB, 0, 0, 0);

  // Jika jam target sudah lewat hari ini, jadwalkan besok
  if (nextSync.getTime() <= nowWIB.getTime()) {
    nextSync.setUTCDate(nextSync.getUTCDate() + 1);
  }

  // Konversi balik ke UTC untuk selisih waktu
  const nextSyncUTC = nextSync.getTime() - wibOffset;
  return nextSyncUTC - now.getTime();
}

async function runSDMSSync(log: FastifyBaseLogger, appPort: number): Promise<void> {
  if (isSyncing) {
    log.info('[SDMS Cron] Sync sebelumnya masih berjalan, dilewati.');
    return;
  }
  isSyncing = true;
  log.info('[SDMS Cron] Memulai sinkronisasi otomatis harian...');

  try {
    // Ambil admin pertama untuk dijadikan actor pada audit log sync
    const adminUser = await prisma.user.findFirst({
      where: { role: { key: { in: ['SUPER_ADMIN', 'ADMIN'] } }, isActive: true },
      include: { role: true },
    });

    if (!adminUser) {
      log.warn('[SDMS Cron] Tidak ada admin aktif — sync dilewati.');
      return;
    }

    // Buat access token langsung (tanpa menyimpan refresh token di DB)
    // agar cron bisa memanggil endpoint sync via HTTP lokal.
    // TTL 1 jam cukup untuk proses sync.
    const accessToken = signToken(
      {
        sub: adminUser.id,
        roleKey: adminUser.role.key,
        roles: [adminUser.role.key, ...((adminUser.additionalRoles as string[]) || [])],
      },
      config.jwtSecret,
      3600,
    );

    // Panggil endpoint sync via HTTP lokal — logika sync (upsert + deaktivasi)
    // identik dengan saat admin klik manual, tidak ada duplikasi kode.
    const res = await fetch(`http://127.0.0.1:${appPort}/api/sdms/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Cron-Job': 'daily-sdms-sync',
      },
      signal: AbortSignal.timeout(300_000), // timeout 5 menit
    });

    if (res.ok) {
      const json = await res.json() as { data: Record<string, unknown> };
      const d = json.data;
      log.info(
        `[SDMS Cron] ✅ Selesai — Guru: ${d.teachers}, Siswa: ${d.students}, Kelas: ${d.classes}, ` +
        `Dinonaktifkan: ${d.deactivatedStudents ?? 0} siswa / ${d.deactivatedTeachers ?? 0} guru, ` +
        `Error: ${(d.errors as string[])?.length ?? 0}`,
      );
    } else {
      const text = await res.text().catch(() => '');
      log.warn(`[SDMS Cron] ⚠️ Sync gagal: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
  } catch (err) {
    log.error(`[SDMS Cron] ❌ Error: ${err instanceof Error ? err.message : err}`);
  } finally {
    isSyncing = false;
  }
}

/**
 * Mulai scheduler cron harian.
 * Dipanggil satu kali saat server startup dari server.ts.
 */
export function scheduleDailySDMSSync(log: FastifyBaseLogger, appPort: number): void {
  const scheduleNext = () => {
    const delay = msUntilNextSync(1); // 01:00 WIB
    const nextDate = new Date(Date.now() + delay);
    log.info(`[SDMS Cron] Sync berikutnya: ${nextDate.toISOString()} (${Math.round(delay / 60000)} menit lagi)`);

    syncTimer = setTimeout(async () => {
      await runSDMSSync(log, appPort);
      scheduleNext(); // jadwalkan lagi untuk besok
    }, delay);
  };

  scheduleNext();
}

/**
 * Hentikan scheduler (untuk graceful shutdown).
 */
export function stopSDMSSyncScheduler(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}
