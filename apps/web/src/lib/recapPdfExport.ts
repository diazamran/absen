import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { todayJakartaKey } from './format';

interface RecapRow {
  no: number;
  className: string;
  nis: string;
  name: string;
  semester: { S: number; I: number; A: number; D: number; P: number; total: number };
  last30Days: { S: number; I: number; A: number; D: number; P: number; total: number };
  daily: Record<string, string>;
}

interface RecapData {
  today: string;
  semesterName: string;
  dateColumns: string[];
  rows: RecapRow[];
}

function cityFromSchool(name: string): string {
  // Extract city from school name (e.g. "SMK Negeri 1 Kras" → "Kras")
  const parts = name.split(' ');
  return parts[parts.length - 1] || 'Kota';
}

export function exportRecapPdf(data: RecapData, opts: { schoolName?: string; signatureName?: string; signatureNip?: string }, filename?: string): void {
  const { today, semesterName, dateColumns, rows } = data;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Title
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Rekap Absensi Siswa', pageWidth / 2, 12, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Semester ${semesterName}`, pageWidth / 2, 17, { align: 'center' });
  doc.text(`Tanggal: ${today}`, pageWidth / 2, 22, { align: 'center' });

  // Build table: No, Kelas, NIS, Nama, S, I, A, D, P, Tot (Smt), S, I, A, D, P, Tot (30d), then daily columns
  const dailyCols = dateColumns.map((dk) => {
    const d = new Date(dk + 'T12:00:00+07:00');
    const day = d.toLocaleDateString('id-ID', { weekday: 'short' });
    return `${day} ${d.getDate()}`;
  });

  const head = [
    ['No', 'Kelas', 'NIS', 'Nama', ...['S', 'I', 'A', 'D', 'P', 'Tot'], ...['S', 'I', 'A', 'D', 'P', 'Tot'], ...dailyCols],
  ];

  const body = rows.map((row) => {
    const r: (string | number)[] = [
      row.no,
      row.className,
      row.nis,
      row.name,
      row.semester.S || '',
      row.semester.I || '',
      row.semester.A || '',
      row.semester.D || '',
      row.semester.P || '',
      row.semester.total || '',
      row.last30Days.S || '',
      row.last30Days.I || '',
      row.last30Days.A || '',
      row.last30Days.D || '',
      row.last30Days.P || '',
      row.last30Days.total || '',
    ];
    for (const dk of dateColumns) r.push(row.daily[dk] ?? '');
    return r;
  });

  // Column widths
  const fixedCols = [8, 18, 14, 28]; // No, Kelas, NIS, Nama
  const statCols = Array(12).fill(7); // semester + last30 = 12 cols x 7mm
  const dailyW = Math.max(4, (pageWidth - 20 - fixedCols.reduce((a, b) => a + b, 0) - statCols.reduce((a, b) => a + b, 0)) / dateColumns.length);
  const dailyCols2 = Array(dateColumns.length).fill(dailyW);

  autoTable(doc, {
    startY: 26,
    head,
    body,
    styles: { fontSize: 6, cellPadding: 1, overflow: 'linebreak' },
    headStyles: { fillColor: [13, 148, 136], fontSize: 6, cellPadding: 1 },
    alternateRowStyles: { fillColor: [245, 250, 249] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },   // No
      1: { cellWidth: 18 },                       // Kelas
      2: { cellWidth: 14 },                       // NIS
      3: { cellWidth: 28 },                       // Nama
    },
    margin: { left: 10, right: 10 },
  });

  // Signature area
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let y = finalY + 12;
  if (y > pageHeight - 50) {
    doc.addPage();
    y = 20;
  }

  const schoolName = opts.schoolName || 'Sekolah';
  const city = cityFromSchool(schoolName);

  // Layout: Kepala Sekolah (kiri) | Petugas Piket (kanan)
  const leftX = 30;
  const rightX = pageWidth - 80;
  const lineLen = 50;

  // === KIRI: Kepala Sekolah ===
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Mengetahui,', leftX, y);
  doc.text(`Kepala ${schoolName}`, leftX, y + 6);

  // Garis tanda tangan
  doc.setFont('helvetica', 'normal');
  doc.text('_'.repeat(35), leftX, y + 28);

  // Nama kepala sekolah (bold, tanpa underline)
  doc.setFont('helvetica', 'bold');
  if (opts.signatureName) {
    doc.text(opts.signatureName.toUpperCase(), leftX, y + 33);
  }

  // NIP
  doc.setFont('helvetica', 'normal');
  if (opts.signatureNip) {
    doc.text(`NIP. ${opts.signatureNip}`, leftX, y + 38);
  }

  // === KANAN: Petugas Piket ===
  doc.setFont('helvetica', 'normal');
  doc.text(`${city}, ${today}`, rightX, y);
  doc.text('Petugas Piket,', rightX, y + 6);

  // Garis tanda tangan
  doc.text('_'.repeat(35), rightX, y + 28);

  // Nama petugas piket (bold)
  doc.setFont('helvetica', 'bold');
  if (opts.signatureName) {
    doc.text(opts.signatureName.toUpperCase(), rightX, y + 33);
  }

  // NIP
  doc.setFont('helvetica', 'normal');
  if (opts.signatureNip) {
    doc.text(`NIP. ${opts.signatureNip}`, rightX, y + 38);
  }

  doc.save(filename || `rekap_absensi_${today}.pdf`);
}
