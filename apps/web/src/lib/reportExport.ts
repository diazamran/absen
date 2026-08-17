import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { todayJakartaKey } from './format';

export interface ReportExportRow {
  name: string;
  nis?: string | null;
  className?: string | null;
  date?: string;
  time?: string | null;
  status: string;
  method: string;
  lateMinutes: number;
}

export interface ClassSummaryRow {
  className: string;
  total: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
}

export interface ReportExportOptions {
  title: string;
  schoolName: string;
  period: string;
  rows: ReportExportRow[];
  summary: Record<string, number | undefined>;
  classSummary?: ClassSummaryRow[];
  signatureName?: string | null;
  signatureNip?: string | null;
  filename: string;
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export function formatLongDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return `${d} ${MONTHS[m - 1] || m} ${y}`;
}

/** Kota untuk blok tanda tangan — diambil dari kata terakhir nama sekolah (mis. "SMK Negeri 1 Kras" → "Kras"). */
function cityFromSchool(schoolName: string): string {
  const words = schoolName.trim().split(/\s+/);
  const last = words[words.length - 1] || '';
  return /^[A-Za-zÀ-ž]+$/.test(last) ? last : 'Kras';
}

const STATUS_SHORT: Record<string, string> = {
  PRESENT: 'Hadir',
  LATE: 'Terlambat',
  EXCUSED: 'Izin',
  SICK: 'Sakit',
  OFFICIAL_DUTY: 'Dinas',
  ABSENT: 'Tidak Hadir',
  LEAVE: 'Cuti',
};

function statusLabel(s: string): string {
  return STATUS_SHORT[s] || s;
}

function summaryLine(summary: Record<string, number | undefined>): string {
  const parts = Object.entries(STATUS_SHORT).map(([k, label]) => `${label}: ${summary[k] || 0}`);
  return parts.join('   ');
}

function signatureRows(opts: ReportExportOptions): string[] {
  const city = cityFromSchool(opts.schoolName);
  const rows: string[] = [`${city}, ${formatLongDate(todayJakartaKey())}`, 'Petugas Piket,'];
  rows.push('', '', opts.signatureName?.toUpperCase() || '');
  if (opts.signatureNip) rows.push(`NIP. ${opts.signatureNip}`);
  return rows;
}

// ===== PDF =====
export function exportReportPdf(opts: ReportExportOptions): void {
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(opts.title, pageWidth / 2, 15, { align: 'center' });
  doc.setFontSize(11);
  doc.text(opts.schoolName, pageWidth / 2, 21, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(opts.period, pageWidth / 2, 27, { align: 'center' });

  doc.setFontSize(9);
  doc.text(summaryLine(opts.summary), pageWidth / 2, 33, { align: 'center' });

  autoTable(doc, {
    startY: 37,
    head: [['No', 'Nama', 'NIS', 'Kelas', 'Tanggal', 'Jam', 'Status', 'Metode']],
    body: opts.rows.map((r, i) => [
      String(i + 1),
      r.name,
      r.nis ?? '',
      r.className ?? '',
      r.date ?? '',
      r.time ?? '',
      r.status === 'LATE' && r.lateMinutes ? `Terlambat (${r.lateMinutes}m)` : statusLabel(r.status),
      r.method || '',
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [13, 148, 136], fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 250, 249] },
  });

  // Rekap per kelas (semua kelas)
  if (opts.classSummary?.length) {
    const after = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Rekap per Kelas', 14, after + 10);
    doc.setFont('helvetica', 'normal');
    autoTable(doc, {
      startY: after + 13,
      head: [['Kelas', 'Total Siswa', 'Hadir', 'Terlambat', 'Izin / Sakit', 'Tidak Hadir']],
      body: opts.classSummary.map((c) => [c.className, String(c.total), String(c.present), String(c.late), String(c.excused), String(c.absent)]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [13, 148, 136], fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 250, 249] },
    });
  }

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let y = finalY + 14;
  if (y > pageHeight - 58) {
    doc.addPage();
    y = 24;
  }

  const sig = signatureRows(opts);
  const sigX = pageWidth - 75;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(sig[0], sigX, y);
  doc.text(sig[1], sigX, y + 6);
  const nameY = y + 6 + 22;
  doc.setFont('helvetica', 'bold');
  doc.text(sig[3], sigX, nameY);
  doc.setFont('helvetica', 'normal');
  if (sig[4]) doc.text(sig[4], sigX, nameY + 6);

  doc.save(opts.filename);
}

// ===== Excel =====
export function exportReportExcel(opts: ReportExportOptions): void {
  const aoa: (string | number)[][] = [
    [opts.title],
    [opts.schoolName],
    [opts.period],
    [],
    ['No', 'Nama', 'NIS', 'Kelas', 'Tanggal', 'Jam', 'Status', 'Metode'],
    ...opts.rows.map((r, i) => [
      i + 1,
      r.name,
      r.nis ?? '',
      r.className ?? '',
      r.date ?? '',
      r.time ?? '',
      r.status === 'LATE' && r.lateMinutes ? `Terlambat (${r.lateMinutes}m)` : statusLabel(r.status),
      r.method || '',
    ]),
    [],
    [summaryLine(opts.summary)],
    [],
    ['REKAP PER KELAS'],
    ['Kelas', 'Total Siswa', 'Hadir', 'Terlambat', 'Izin / Sakit', 'Tidak Hadir'],
    ...(opts.classSummary?.length
      ? opts.classSummary.map((c) => [c.className, c.total, c.present, c.late, c.excused, c.absent])
      : []),
    [],
    ...signatureRows(opts).map((s) => [s]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 4 }, { wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan');
  XLSX.writeFile(wb, opts.filename, { bookType: 'xlsx' });
}
