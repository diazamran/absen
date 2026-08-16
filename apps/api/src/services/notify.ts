/**
 * LAYANAN NOTIFIKASI
 * - In-app (tersimpan di DB, muncul realtime via WebSocket)
 * - WhatsApp/email/push: abstraction provider — implementasi default "none"
 *   (log saja). Provider nyata (WhatsApp Business API, SMTP, Web Push)
 *   dapat dipasang tanpa mengubah pemanggil.
 */
import { prisma } from '../lib/prisma.js';
import type { NotificationChannel } from '@prisma/client';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';

export interface NotificationInput {
  userId: string;
  title: string;
  body: string;
  channel?: NotificationChannel;
  data?: unknown;
}

/** Buat notifikasi in-app + kirim via provider eksternal bila dikonfigurasi. */
export async function sendNotification(input: NotificationInput): Promise<void> {
  const channel = input.channel ?? 'IN_APP';
  await prisma.notification.create({
    data: {
      userId: input.userId,
      title: input.title,
      body: input.body,
      channel,
      data: input.data === undefined ? undefined : (input.data as object),
    },
  });

  if (channel !== 'IN_APP') {
    await sendExternal(input);
  }
}

async function sendExternal(input: NotificationInput): Promise<void> {
  const settings = await getNotificationSettings();
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { phone: true, email: true } });

  if (input.channel === 'WHATSAPP' && settings.whatsappEnabled && user?.phone) {
    // TODO: integrasi WhatsApp Business API / provider (config.whatsappApiKey)
    // eslint-disable-next-line no-console
    console.log(`[whatsapp] ke ${user.phone}: ${input.title} — ${input.body}`);
  }
  if (input.channel === 'EMAIL' && settings.emailEnabled && user?.email) {
    // TODO: integrasi SMTP (config.smtp)
    // eslint-disable-next-line no-console
    console.log(`[email] ke ${user.email}: ${input.title} — ${input.body}`);
  }
}

export async function getNotificationSettings(): Promise<{
  whatsappEnabled: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
}> {
  const row = await prisma.schoolSetting.findUnique({ where: { key: 'notifications' } });
  const v = (row?.value as Record<string, unknown>) || {};
  return {
    whatsappEnabled: Boolean(v.whatsappEnabled),
    pushEnabled: Boolean(v.pushEnabled),
    emailEnabled: Boolean(v.emailEnabled),
  };
}

/** Kirim notifikasi ke semua orang tua dari seorang siswa. */
export async function notifyParentsOfStudent(studentId: string, title: string, body: string, data?: unknown): Promise<void> {
  try {
    const links = await prisma.studentParent.findMany({
      where: { studentId },
      include: { parent: { include: { user: true } } },
    });
    for (const link of links) {
      if (link.parent.user) {
        await sendNotification({
          userId: link.parent.user.id,
          title,
          body,
          data: { ...(data as object), studentId },
        });
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[notify] gagal mengirim ke orang tua:', e);
  }
}

/** Kirim notifikasi WhatsApp ke orang tua bila diaktifkan. */
export async function notifyParentsWhatsApp(studentId: string, body: string): Promise<void> {
  try {
    const settings = await getNotificationSettings();
    if (!settings.whatsappEnabled || config.whatsappProvider === 'none') return;
    const links = await prisma.studentParent.findMany({
      where: { studentId },
      include: { parent: true },
    });
    for (const link of links) {
      // eslint-disable-next-line no-console
      console.log(`[whatsapp] ke ${link.parent.phone}: ${body}`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[notify] wa gagal:', e);
  }
}

/** Catat aksi kirim notifikasi ke audit. */
export async function auditNotify(userId: string | null, title: string, body: string): Promise<void> {
  await audit({ userId, action: 'NOTIFICATION_SENT', entity: 'Notification', newValue: { title, body } });
}
