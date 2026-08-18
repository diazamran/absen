import * as XLSX from 'xlsx';

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

function dayLabel(dk: string): string {
  const d = new Date(dk + 'T12:00:00+07:00');
  const day = d.toLocaleDateString('id-ID', { weekday: 'short' });
  const num = d.getDate();
  const mon = d.toLocaleDateString('id-ID', { month: 'short' });
  return `${day} ${num} ${mon}`;
}

export function exportRecapExcel(data: RecapData, filename?: string): void {
  const { today, semesterName, dateColumns, rows } = data;

  const semLabel = semesterName.split(' ')[0];

  // Header row 1: group labels
  const h1: (string | number)[] = ['No', 'Kelas', 'Nama'];
  h1.push(`Smt. ${semLabel}`, '', '', '', '', '');
  h1.push('Last 30 Day', '', '', '', '', '');
  for (const dk of dateColumns) h1.push(dk);

  // Header row 2: sub labels
  const h2: (string | number)[] = ['', '', ''];
  h2.push('S', 'I', 'A', 'D', 'P', 'Total');
  h2.push('S', 'I', 'A', 'D', 'P', 'Total');
  for (const dk of dateColumns) h2.push(dayLabel(dk));

  // Data rows
  const dataRows: (string | number)[][] = rows.map((row) => {
    const r: (string | number)[] = [
      row.no,
      row.className,
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

  const aoa: (string | number)[][] = [
    [`Rekap Absensi Siswa — ${today}`],
    [`Semester ${semesterName} · ${rows.length} siswa`],
    [],
    h1,
    h2,
    ...dataRows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  const cols: { wch: number }[] = [{ wch: 4 }, { wch: 12 }, { wch: 24 }];
  for (let i = 0; i < 12; i++) cols.push({ wch: 5 });
  for (let i = 0; i < dateColumns.length; i++) cols.push({ wch: 5 });
  ws['!cols'] = cols;

  // Merge title rows
  const totalCols = 3 + 12 + dateColumns.length;
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: 3, c: 3 }, e: { r: 3, c: 8 } },   // Semester group
    { s: { r: 3, c: 9 }, e: { r: 3, c: 14 } },  // Last30 group
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rekap Absensi');
  XLSX.writeFile(wb, filename || `rekap_absensi_${today}.xlsx`, { bookType: 'xlsx' });
}
