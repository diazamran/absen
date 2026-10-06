import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, FileSpreadsheet, FileText, ClipboardEdit } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, Badge, Skeleton } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS, todayJakartaKey } from '../../lib/format';
import { useTheme } from '../../lib/theme';
import { formatLongDate } from '../../lib/reportExport';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface DailyRekapData {
  dates: string[];
  students: {
    id: string;
    name: string;
    class: string | null;
    location: string | null;
    attendance: Record<string, string>;
  }[];
}

interface SupervisedStudent {
  assignmentId: string;
  studentId: string;
  fullName: string;
  nis: string | null;
  className: string | null;
  location: { id: string; name: string; city: string | null };
  todayAttendance: {
    checkIn: string | null;
    checkOut: string | null;
    status: string;
    method: string | null;
    lateMinutes?: number | null;
    earlyLeave?: boolean;
  };
}

interface RekapItem {
  studentId: string;
  fullName: string;
  nis: string | null;
  className: string | null;
  locationName: string;
  startDate: string | null;
  endDate: string | null;
  totalDays: number;
  present: number;
  late: number;
  sick: number;
  excused: number;
  absent: number;
  percentage: number | null;
  hasData: boolean;
}

interface RekapData {
  month: string;
  schoolDays: number;
  rows: RekapItem[];
}

const METHOD_LABELS: Record<string, string> = {
  FACE: 'Wajah',
  QR: 'Kartu QR',
  MANUAL: 'Manual',
};

function statusText(s: string): string {
  return STATUS_LABELS[s] ?? s;
}

function methodText(m: string | null): string {
  if (!m) return '';
  return METHOD_LABELS[m] ?? m;
}

function statusColorClass(s: string): string {
  switch (s) {
    case 'PRESENT': return 'bg-emerald-100 text-emerald-600';
    case 'LATE': return 'bg-amber-100 text-amber-600';
    case 'SICK': return 'bg-blue-100 text-blue-600';
    case 'EXCUSED': return 'bg-purple-100 text-purple-600';
    case 'ABSENT': return 'bg-red-100 text-red-600';
    default: return 'bg-slate-100 text-slate-400';
  }
}

export default function PklDashboard() {
  const [month, setMonth] = useState(() => todayJakartaKey().slice(0, 7));
  // Absensi Harian: mode 'days' (N hari terakhir) atau 'month' (bulan tertentu)
  const [dailyMode, setDailyMode] = useState<'days' | 'month'>('days');
  const [dailyDays, setDailyDays] = useState<7 | 14 | 30>(7);
  const [dailyMonth, setDailyMonth] = useState(() => todayJakartaKey().slice(0, 7));
  const navigate = useNavigate();
  const { branding } = useTheme();
  const schoolName = branding?.schoolName || 'Sekolah';

  // Get teacherId from /pkl/me
  const { data: pklMe } = useQuery({
    queryKey: ['pkl-me'],
    queryFn: () => api<{ success: boolean; data: { isSupervisor: boolean; isPklAdmin: boolean; teacherId: string | null } }>('/pkl/me').then((r) => r.data),
    staleTime: 60_000,
  });
  const teacherId = pklMe?.teacherId;

  const { data: students, isLoading } = useQuery({
    queryKey: ['pkl-supervisor', teacherId],
    queryFn: () => api<{ success: boolean; data: SupervisedStudent[] }>(`/pkl/supervisor/${teacherId}`).then((r) => r.data),
    enabled: !!teacherId,
  });

  const { data: rekap, isLoading: rekapLoading } = useQuery({
    queryKey: ['pkl-rekap', teacherId, month],
    queryFn: () => api<{ success: boolean; data: RekapData }>(`/pkl/supervisor/${teacherId}/rekap?month=${month}`).then((r) => r.data),
    enabled: !!teacherId,
  });

  const { data: dailyRecap, isLoading: dailyRekapLoading } = useQuery({
    queryKey: ['pkl-daily-recap', teacherId, dailyMode, dailyMode === 'days' ? dailyDays : dailyMonth],
    queryFn: () => {
      const params = dailyMode === 'month'
        ? `month=${dailyMonth}`
        : `days=${dailyDays}`;
      return api<{ success: boolean; data: DailyRekapData }>(`/pkl/daily-recap?${params}`)
        .then((r) => r.data);
    },
    enabled: !!teacherId,
  });

  const present = students?.filter((s) => ['PRESENT', 'LATE', 'SICK', 'EXCUSED'].includes(s.todayAttendance.status)).length ?? 0;
  const notYet = students?.filter((s) => !['PRESENT', 'LATE', 'SICK', 'EXCUSED'].includes(s.todayAttendance.status)).length ?? 0;
  const belumPulang = students?.filter((s) => s.todayAttendance.checkIn && !s.todayAttendance.checkOut).length ?? 0;

  // ===== Export helpers =====
  const exportBaseName = `monitor-pkl-${month}`;

  // Label bulan Indonesia untuk header export
  const monthLabel = (() => {
    const [y, m] = month.split('-');
    const names = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return `${names[Number(m)]} ${y}`;
  })();

  const dailyLabel = dailyMode === 'month'
    ? (() => {
        const [y, m] = dailyMonth.split('-');
        const names = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        return `${names[Number(m)]} ${y}`;
      })()
    : `${dailyDays} hari terakhir`;

  function exportExcel() {
    if (!students) return;
    const rekapRows = rekap?.rows ?? [];
    const dailyStudents = dailyRecap?.students ?? [];
    const dailyDates = dailyRecap?.dates ?? [];

    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const statusLabel: Record<string, string> = {
      hadir: 'Hadir', tidak_hadir: 'Alpa', izin: 'Izin', sakit: 'Sakit', libur: 'Libur', cuti: 'Cuti',
    };

    // Sheet 1: Rekap ringkasan + kehadiran hari ini
    const aoa: (string | number)[][] = [
      ['Monitor PKL — Rekap Absensi'],
      [schoolName],
      [`Bulan: ${monthLabel}`],
      [],
      ['Kehadiran Hari Ini', formatLongDate(todayJakartaKey())],
      [],
      ['No', 'Nama Siswa', 'NIS', 'Kelas', 'Lokasi PKL', 'Jam Datang', 'Jam Pulang', 'Status', 'Metode'],
      ...students.map((s, i) => [
        i + 1,
        s.fullName,
        s.nis ?? '',
        s.className ?? '',
        s.location.name,
        s.todayAttendance.checkIn ?? '',
        s.todayAttendance.checkOut || (s.todayAttendance.checkIn ? 'Belum pulang' : ''),
        statusText(s.todayAttendance.status),
        methodText(s.todayAttendance.method),
      ]),
      [],
      [`Rekap Bulanan — ${monthLabel}${rekap?.schoolDays ? ` · ${rekap.schoolDays} hari kerja` : ''}`],
      [],
      ['No', 'Nama Siswa', 'NIS', 'Kelas', 'Lokasi PKL', 'Tgl Mulai', 'Tgl Selesai', 'Hadir', 'Terlambat', 'Sakit', 'Izin', 'Alpa', '%'],
      ...rekapRows.map((r, i) => [
        i + 1,
        r.fullName,
        r.nis ?? '',
        r.className ?? '',
        r.locationName,
        r.startDate ?? '',
        r.endDate ?? '',
        r.present,
        r.late,
        r.sick,
        r.excused,
        r.absent,
        r.percentage !== null ? `${r.percentage}%` : '—',
      ]),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(aoa);
    ws1['!cols'] = [{ wch: 4 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 11 }, { wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }];

    // Sheet 2: Absensi Harian per tanggal
    const dateHeaders = dailyDates.map((ds) => {
      const dayIdx = new Date(ds + 'T00:00:00+07:00').getDay();
      const [, mm, dd] = ds.split('-');
      return `${dayNames[dayIdx]} ${dd}/${mm}`;
    });
    const aoa2: (string | number)[][] = [
      [`Absensi Harian — ${dailyLabel}`],
      [schoolName],
      [],
      ['No', 'Nama Siswa', 'Kelas', 'Lokasi PKL', ...dateHeaders, 'Hadir', 'Tidak Hadir'],
      ...dailyStudents.map((stu, i) => {
        const hadirCount = dailyDates.filter((ds) => stu.attendance[ds] === 'hadir').length;
        const absenCount = dailyDates.filter((ds) => stu.attendance[ds] === 'tidak_hadir').length;
        return [
          i + 1,
          stu.name,
          stu.class ?? '',
          stu.location ?? '',
          ...dailyDates.map((ds) => statusLabel[stu.attendance[ds]] ?? '-'),
          hadirCount,
          absenCount,
        ];
      }),
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
    ws2['!cols'] = [
      { wch: 4 }, { wch: 28 }, { wch: 12 }, { wch: 22 },
      ...dailyDates.map(() => ({ wch: 8 })),
      { wch: 8 }, { wch: 10 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Rekap Bulanan');
    if (dailyStudents.length > 0) XLSX.utils.book_append_sheet(wb, ws2, 'Absensi Harian');
    XLSX.writeFile(wb, `${exportBaseName}.xlsx`, { bookType: 'xlsx' });
  }

  function exportPdf() {
    if (!students) return;
    const rekapRows = rekap?.rows ?? [];
    const dailyStudents = dailyRecap?.students ?? [];
    const dailyDates = dailyRecap?.dates ?? [];

    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const statusLabel: Record<string, string> = {
      hadir: 'H', tidak_hadir: 'A', izin: 'I', sakit: 'S', libur: '-', cuti: 'C',
    };

    const doc = new jsPDF({ orientation: 'landscape' });
    const pageWidth = doc.internal.pageSize.getWidth();

    // — Halaman 1: Rekap ringkasan bulanan —
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Monitor PKL - Rekap Absensi', pageWidth / 2, 15, { align: 'center' });
    doc.setFontSize(11);
    doc.text(schoolName, pageWidth / 2, 21, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Bulan: ${monthLabel}`, pageWidth / 2, 27, { align: 'center' });

    autoTable(doc, {
      startY: 35,
      head: [['No', 'Nama Siswa', 'NIS', 'Kelas', 'Lokasi PKL', 'Tgl Mulai', 'Tgl Selesai', 'Hadir', 'Terlambat', 'Sakit', 'Izin', 'Alpa', '%']],
      body: rekapRows.map((r, i) => [
        String(i + 1),
        r.fullName,
        r.nis ?? '',
        r.className ?? '',
        r.locationName,
        r.startDate ?? '-',
        r.endDate ?? '-',
        String(r.present),
        String(r.late),
        String(r.sick),
        String(r.excused),
        String(r.absent),
        r.percentage !== null ? `${r.percentage}%` : '—',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [13, 148, 136], fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 250, 249] },
    });

    // — Halaman 2: Absensi Harian per tanggal —
    if (dailyStudents.length > 0 && dailyDates.length > 0) {
      doc.addPage('landscape');
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text(`Absensi Harian PKL — ${dailyLabel}`, pageWidth / 2, 15, { align: 'center' });
      doc.setFontSize(10);
      doc.text(schoolName, pageWidth / 2, 21, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('H=Hadir  A=Alpa  I=Izin  S=Sakit  C=Cuti  -=Libur', pageWidth / 2, 27, { align: 'center' });

      const dateHeaders = dailyDates.map((ds) => {
        const dayIdx = new Date(ds + 'T00:00:00+07:00').getDay();
        const [, mm, dd] = ds.split('-');
        return `${dayNames[dayIdx]}\n${dd}/${mm}`;
      });

      autoTable(doc, {
        startY: 32,
        head: [['No', 'Nama Siswa', 'Kelas', 'Lokasi', ...dateHeaders, 'Hdr', 'Alpa']],
        body: dailyStudents.map((stu, i) => {
          const hadirCount = dailyDates.filter((ds) => stu.attendance[ds] === 'hadir').length;
          const absenCount = dailyDates.filter((ds) => stu.attendance[ds] === 'tidak_hadir').length;
          return [
            String(i + 1),
            stu.name,
            stu.class ?? '-',
            stu.location ?? '-',
            ...dailyDates.map((ds) => statusLabel[stu.attendance[ds]] ?? '-'),
            String(hadirCount),
            String(absenCount),
          ];
        }),
        styles: { fontSize: 7, cellPadding: 1.5, halign: 'center' },
        headStyles: { fillColor: [13, 148, 136], fontSize: 7, halign: 'center' },
        columnStyles: {
          0: { cellWidth: 8 },
          1: { cellWidth: 30, halign: 'left' },
          2: { cellWidth: 18, halign: 'left' },
          3: { cellWidth: 22, halign: 'left' },
        },
        alternateRowStyles: { fillColor: [245, 250, 249] },
      });
    }

    doc.save(`${exportBaseName}.pdf`);
  }

  const canExport = !isLoading && !!students && students.length > 0;

  return (
    <div>
      <PageHeader title="Monitor PKL" subtitle="Pantau kehadiran siswa bimbingan PKL Anda hari ini" />

      {/* Tombol Absensi Manual */}
      <button
        onClick={() => navigate('/app/pkl-manual')}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-primary/90 active:scale-[.98]"
      >
        <ClipboardEdit className="h-4 w-4" />
        Absensi Manual Siswa Bimbingan
      </button>

      {/* Stats */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Card className="p-3 text-center">
          <p className="text-2xl font-extrabold text-emerald-500">{students ? present : '-'}</p>
          <p className="text-xs text-muted">Sudah Absen Datang</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-extrabold text-amber-500">{students ? notYet : '-'}</p>
          <p className="text-xs text-muted">Belum Absen</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-extrabold text-primary">{students?.length ?? '-'}</p>
          <p className="text-xs text-muted">Total Siswa Bimbingan</p>
        </Card>
      </div>

      {students && belumPulang > 0 && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          ⏰ {belumPulang} siswa sudah absen datang tetapi <b>belum absen pulang</b>.
        </p>
      )}

      {/* Today list */}
      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-bold text-ink">📍 Kehadiran Hari Ini</p>
        </div>
        {isLoading && <Skeleton className="h-24 w-full" />}
        {!isLoading && students && students.length === 0 && (
          <p className="py-4 text-center text-sm text-muted">Belum ada siswa PKL yang ditugaskan kepada Anda.</p>
        )}
        {!isLoading && students && students.map((s) => {
          const ok = ['PRESENT', 'LATE', 'SICK', 'EXCUSED'].includes(s.todayAttendance.status);
          return (
            <div key={s.assignmentId} className="mb-2 flex items-center gap-3 rounded-xl border border-line/60 bg-surface p-3 last:mb-0 dark:bg-slate-800/50">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${ok ? statusColorClass(s.todayAttendance.status) : 'bg-slate-100 text-slate-400'}`}>
                {ok ? <CheckCircle2 className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{s.fullName}</p>
                <p className="text-xs text-muted">{s.className ?? '-'} · {s.location.name}</p>
                {s.todayAttendance.checkIn ? (
                  <p className="mt-0.5 text-xs text-muted">
                    Datang <span className="font-bold text-ink">{s.todayAttendance.checkIn}</span>
                    {s.todayAttendance.status === 'LATE' && !!s.todayAttendance.lateMinutes && (
                      <> (terlambat {s.todayAttendance.lateMinutes} menit)</>
                    )}
                    {s.todayAttendance.checkOut && <> · Pulang <span className="font-bold text-ink">{s.todayAttendance.checkOut}</span>{s.todayAttendance.earlyLeave && <span className="font-semibold text-amber-600"> (pulang awal)</span>}</>}
                    {!s.todayAttendance.checkOut && <span className="font-semibold text-amber-600"> · Belum absen pulang</span>}
                    {methodText(s.todayAttendance.method) && <> · via {methodText(s.todayAttendance.method)}</>}
                  </p>
                ) : ['SICK', 'EXCUSED'].includes(s.todayAttendance.status) ? (
                  <p className="mt-0.5 text-xs text-muted">Tercatat manual (tanpa jam datang)</p>
                ) : (
                  <p className="mt-0.5 text-xs font-semibold text-amber-500">Belum absen datang hari ini</p>
                )}
              </div>
              <Badge status={s.todayAttendance.status as never} label={statusText(s.todayAttendance.status)} />
            </div>
          );
        })}
      </Card>

      {/* Rekap bulanan */}
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="font-bold text-ink">📊 Rekap {rekap?.month ?? month}</p>
            {rekap?.schoolDays !== undefined && (
              <p className="text-xs text-muted">{rekap.schoolDays} hari kerja</p>
            )}
          </div>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" />
        </div>

        {rekapLoading && <Skeleton className="h-24 w-full" />}
        {!rekapLoading && rekap && rekap.rows.length === 0 && (
          <p className="py-4 text-center text-sm text-muted">Belum ada data rekap untuk bulan ini.</p>
        )}
        {!rekapLoading && rekap && rekap.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50 text-xs uppercase text-muted dark:border-slate-600 dark:bg-slate-800/60">
                  <th className="px-3 py-2.5 font-semibold">No</th>
                  <th className="px-3 py-2.5 font-semibold">Nama</th>
                  <th className="px-3 py-2.5 font-semibold">Kelas</th>
                  <th className="px-3 py-2.5 font-semibold">Lokasi</th>
                  <th className="px-3 py-2.5 font-semibold">Tgl Mulai</th>
                  <th className="px-3 py-2.5 font-semibold">Tgl Selesai</th>
                  <th className="px-3 py-2.5 text-center font-semibold text-emerald-600">Hadir</th>
                  <th className="px-3 py-2.5 text-center font-semibold text-amber-500">Terlambat</th>
                  <th className="px-3 py-2.5 text-center font-semibold text-blue-500">Sakit</th>
                  <th className="px-3 py-2.5 text-center font-semibold text-purple-500">Izin</th>
                  <th className="px-3 py-2.5 text-center font-semibold text-red-500">Alpa</th>
                  <th className="px-3 py-2.5 text-center font-semibold">%</th>
                </tr>
              </thead>
              <tbody>
                {rekap.rows.map((r, i) => {
                  const pct = r.percentage;
                  const pctColor = pct === null
                    ? 'bg-slate-100 text-slate-400 dark:bg-slate-700'
                    : pct >= 90
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : pct >= 75
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
                  return (
                    <tr key={r.studentId} className="border-b border-line/50 last:border-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2.5 text-muted">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-ink">{r.fullName}</p>
                        <p className="text-xs text-muted">{r.nis ?? '-'}</p>
                      </td>
                      <td className="px-3 py-2.5 text-muted">{r.className ?? '-'}</td>
                      <td className="px-3 py-2.5 text-muted">{r.locationName}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted">{r.startDate ?? '-'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted">{r.endDate ?? '-'}</td>
                      <td className="px-3 py-2.5 text-center font-bold text-emerald-600">{r.present}</td>
                      <td className="px-3 py-2.5 text-center font-bold text-amber-500">{r.late}</td>
                      <td className="px-3 py-2.5 text-center font-bold text-blue-500">{r.sick}</td>
                      <td className="px-3 py-2.5 text-center font-bold text-purple-500">{r.excused}</td>
                      <td className="px-3 py-2.5 text-center font-bold text-red-500">{r.absent}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${pctColor}`}>
                          {pct !== null ? `${pct}%` : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Rekap Absensi Harian */}
      <Card className="mt-4">
        <div className="mb-3 space-y-2">
          {/* Baris 1: judul + tombol export */}
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-bold text-ink">📅 Absensi Harian</p>
              <p className="text-xs text-muted">
                {dailyMode === 'month' ? dailyLabel : `${dailyDays} hari terakhir`}
                {dailyRecap ? ` · ${dailyRecap.dates.length} hari` : ''}
              </p>
            </div>
            {canExport && (
              <div className="flex gap-2">
                <button onClick={exportExcel} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700">
                  <FileSpreadsheet className="h-4 w-4" /> Excel
                </button>
                <button onClick={exportPdf} className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-700">
                  <FileText className="h-4 w-4" /> PDF
                </button>
              </div>
            )}
          </div>
          {/* Baris 2: tab mode + kontrol */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Tab mode */}
            <div className="flex rounded-xl border border-line overflow-hidden text-xs font-semibold">
              <button
                onClick={() => setDailyMode('days')}
                className={`px-3 py-1.5 transition ${dailyMode === 'days' ? 'bg-primary text-white' : 'bg-surface text-muted hover:bg-slate-100 dark:hover:bg-slate-700'}`}
              >
                N Hari
              </button>
              <button
                onClick={() => setDailyMode('month')}
                className={`px-3 py-1.5 transition ${dailyMode === 'month' ? 'bg-primary text-white' : 'bg-surface text-muted hover:bg-slate-100 dark:hover:bg-slate-700'}`}
              >
                Per Bulan
              </button>
            </div>
            {/* Kontrol sesuai mode */}
            {dailyMode === 'days' ? (
              <div className="flex gap-1.5">
                {([7, 14, 30] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDailyDays(d)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      dailyDays === d
                        ? 'bg-primary text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                    }`}
                  >
                    {d} hari
                  </button>
                ))}
              </div>
            ) : (
              <input
                type="month"
                value={dailyMonth}
                onChange={(e) => setDailyMonth(e.target.value)}
                className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            )}
          </div>
        </div>

        {dailyRekapLoading && <Skeleton className="h-32 w-full" />}
        {!dailyRekapLoading && (!dailyRecap || dailyRecap.students.length === 0) && (
          <p className="py-4 text-center text-sm text-muted">Belum ada data rekap harian.</p>
        )}
        {!dailyRekapLoading && dailyRecap && dailyRecap.students.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-slate-50 text-xs text-muted dark:border-slate-600 dark:bg-slate-800/60">
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 font-semibold dark:bg-slate-800/60">
                    Nama Siswa
                  </th>
                  {dailyRecap.dates.map((ds) => {
                    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
                    const dayIdx = new Date(ds + 'T00:00:00+07:00').getDay();
                    const [, mm, dd] = ds.split('-');
                    const isToday = ds === todayJakartaKey();
                    return (
                      <th
                        key={ds}
                        className={`px-1.5 py-2 text-center font-semibold ${isToday ? 'bg-primary/10 text-primary' : ''}`}
                      >
                        <div>{dayNames[dayIdx]}</div>
                        <div>{dd}/{mm}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {dailyRecap.students.map((stu) => (
                  <tr
                    key={stu.id}
                    className="border-b border-line/50 last:border-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40"
                  >
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 dark:bg-slate-900">
                      <p className="font-semibold text-ink">{stu.name}</p>
                      <p className="text-xs text-muted">{stu.class ?? '-'} · {stu.location ?? '-'}</p>
                    </td>
                    {dailyRecap.dates.map((ds) => {
                      const status = stu.attendance[ds];
                      let icon = '—';
                      let cellClass = 'bg-slate-50 text-slate-300 dark:bg-slate-800/30';
                      if (status === 'hadir') {
                        icon = '✅';
                        cellClass = 'bg-emerald-100 text-emerald-700';
                      } else if (status === 'tidak_hadir') {
                        icon = '❌';
                        cellClass = 'bg-red-100 text-red-600';
                      } else if (status === 'izin' || status === 'sakit') {
                        icon = '📝';
                        cellClass = 'bg-amber-100 text-amber-700';
                      } else if (status === 'cuti') {
                        icon = '🏝️';
                        cellClass = 'bg-indigo-100 text-indigo-600';
                      } else if (status === 'libur') {
                        icon = '🏖️';
                        cellClass = 'bg-slate-100 text-slate-400';
                      }
                      return (
                        <td key={ds} className="px-1.5 py-2 text-center">
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs ${cellClass}`}
                          >
                            {icon}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
