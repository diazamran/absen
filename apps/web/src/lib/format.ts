export const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Hadir',
  LATE: 'Terlambat',
  EXCUSED: 'Izin',
  SICK: 'Sakit',
  OFFICIAL_DUTY: 'Dinas',
  ABSENT: 'Tidak Hadir',
  LEAVE: 'Cuti',
};

export const STATUS_COLORS: Record<string, string> = {
  PRESENT: '#22c55e',
  LATE: '#f59e0b',
  EXCUSED: '#3b82f6',
  SICK: '#a855f7',
  OFFICIAL_DUTY: '#06b6d4',
  ABSENT: '#ef4444',
  LEAVE: '#6366f1',
};

export const METHOD_LABELS: Record<string, string> = {
  FACE: 'Wajah',
  QR: 'QR Code',
  NFC: 'NFC',
  RFID: 'Kartu',
  MANUAL: 'Manual',
  GATE: 'Gerbang',
  IMPORT: 'Import',
};

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  SICK: 'Sakit',
  PERSONAL: 'Izin',
  LEAVE: 'Cuti',
  OFFICIAL_DUTY: 'Dinas Luar',
  OTHER: 'Lainnya',
};

export const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Menunggu',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
};

export function timeLabel(d: string | Date | null | undefined): string {
  if (!d) return '-';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false });
}

export function dateLabel(d: string | Date | null | undefined): string {
  if (!d) return '-';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

export function shortDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' });
}

export function greeting(): string {
  const h = new Date(new Date().getTime() + 7 * 3600_000).getUTCHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

export function todayJakartaKey(): string {
  return new Date(new Date().getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function currentMonthKey(): string {
  return todayJakartaKey().slice(0, 7);
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
