import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, FileSpreadsheet, FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, Badge, Skeleton } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS, todayJakartaKey } from '../../lib/format';
import { useTheme } from '../../lib/theme';
import { formatLongDate } from '../../lib/reportExport';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  totalDays: number;
  present: number;
  late: number;
  sick: number;
  excused: number;
  absent: number;
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
    queryFn: () => api<{ success: boolean; data: RekapItem[] }>(`/pkl/supervisor/${teacherId}/rekap?month=${month}`).then((r) => r.data),
    enabled: !!teacherId,
  });

  const present = students?.filter((s) => ['PRESENT', 'LATE', 'SICK', 'EXCUSED'].includes(s.todayAttendance.status)).length ?? 0;
  const notYet = students?.filter((s) => !['PRESENT', 'LATE', 'SICK', 'EXCUSED'].includes(s.todayAttendance.status)).length ?? 0;
  const belumPulang = students?.filter((s) => s.todayAttendance.checkIn && !s.todayAttendance.checkOut).length ?? 0;

  // ===== Export helpers =====
  const exportBaseName = `monitor-pkl-${todayJakartaKey()}`;

  function exportExcel() {
    if (!students) return;
    const rekapRows = rekap ?? [];
    const aoa: (string | number)[][] = [
      ['Monitor PKL — Kehadiran Hari Ini'],
      [schoolName],
      [`Tanggal: ${formatLongDate(todayJakartaKey())}`],
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
      [`Rekap Bulanan - ${formatLongDate(`${month}-01`).replace(/^\d+ /, '')}`],
      ['No', 'Nama Siswa', 'NIS', 'Kelas', 'Lokasi PKL', 'Hadir', 'Terlambat', 'Sakit', 'Izin', 'Alpa', 'Total Hari'],
      ...rekapRows.map((r, i) => [
        i + 1,
        r.fullName,
        r.nis ?? '',
        r.className ?? '',
        r.locationName,
        r.present,
        r.late,
        r.sick,
        r.excused,
        r.absent,
        r.totalDays,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 4 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Monitor PKL');
    XLSX.writeFile(wb, `${exportBaseName}.xlsx`, { bookType: 'xlsx' });
  }

  function exportPdf() {
    if (!students) return;
    const rekapRows = rekap ?? [];
    const doc = new jsPDF({ orientation: 'landscape' });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Monitor PKL - Kehadiran Siswa', pageWidth / 2, 15, { align: 'center' });
    doc.setFontSize(11);
    doc.text(schoolName, pageWidth / 2, 21, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Tanggal: ${formatLongDate(todayJakartaKey())}`, pageWidth / 2, 27, { align: 'center' });

    autoTable(doc, {
      startY: 32,
      head: [['No', 'Nama Siswa', 'NIS', 'Kelas', 'Lokasi PKL', 'Jam Datang', 'Jam Pulang', 'Status', 'Metode']],
      body: students.map((s, i) => [
        String(i + 1),
        s.fullName,
        s.nis ?? '',
        s.className ?? '',
        s.location.name,
        s.todayAttendance.checkIn ?? '-',
        s.todayAttendance.checkOut ?? (s.todayAttendance.checkIn ? '(belum pulang)' : '-'),
        statusText(s.todayAttendance.status),
        methodText(s.todayAttendance.method),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [13, 148, 136], fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 250, 249] },
    });

    let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = 24; }

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Rekap Bulanan - ${formatLongDate(`${month}-01`).replace(/^\d+ /, '')}`, 14, y);

    autoTable(doc, {
      startY: y + 3,
      head: [['No', 'Nama Siswa', 'NIS', 'Kelas', 'Lokasi PKL', 'Hadir', 'Terlambat', 'Sakit', 'Izin', 'Tidak Hadir', 'Total Hari']],
      body: rekapRows.map((r, i) => [
        String(i + 1),
        r.fullName,
        r.nis ?? '',
        r.className ?? '',
        r.locationName,
        String(r.present),
        String(r.late),
        String(r.sick),
        String(r.excused),
        String(r.absent),
        String(r.totalDays),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [13, 148, 136], fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 250, 249] },
    });

    doc.save(`${exportBaseName}.pdf`);
  }

  const canExport = !isLoading && !!students && students.length > 0;

  return (
    <div>
      <PageHeader title="Monitor PKL" subtitle="Pantau kehadiran siswa bimbingan PKL Anda hari ini" />

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
          {canExport && (
            <div className="flex gap-2">
              <button
                onClick={exportExcel}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Excel
              </button>
              <button
                onClick={exportPdf}
                className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-700"
              >
                <FileText className="h-4 w-4" />
                PDF
              </button>
            </div>
          )}
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
          <p className="font-bold text-ink">📊 Rekap Bulanan</p>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" />
        </div>
        {/* Keterangan warna */}
        <div className="mb-1 flex flex-wrap gap-2 text-xs text-muted">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-bold text-emerald-600">Hadir</span>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-600">Terlambat</span>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 font-bold text-blue-600">Sakit</span>
          <span className="rounded-full bg-purple-50 px-2 py-0.5 font-bold text-purple-600">Izin</span>
          <span className="rounded-full bg-red-50 px-2 py-0.5 font-bold text-red-600">Alpa</span>
        </div>
        <p className="mb-3 text-[11px] text-muted">Angka "Hadir" sudah mencakup siswa yang datang terlambat.</p>
        {rekapLoading && <Skeleton className="h-24 w-full" />}
        {!rekapLoading && rekap && rekap.length === 0 && (
          <p className="py-4 text-center text-sm text-muted">Belum ada data rekap untuk bulan ini.</p>
        )}
        {!rekapLoading && rekap && rekap.map((r) => (
          <div key={r.studentId} className="mb-2 rounded-xl border border-line/60 bg-surface p-3 last:mb-0 dark:bg-slate-800/50">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-ink">{r.fullName}</p>
                <p className="text-xs text-muted">{r.className ?? '-'} · {r.locationName}</p>
              </div>
              <p className="text-xs text-muted">{r.totalDays} hari absen</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-bold text-emerald-600">Hadir: {r.present}</span>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-600">Terlambat: {r.late}</span>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 font-bold text-blue-600">Sakit: {r.sick}</span>
              <span className="rounded-full bg-purple-50 px-2 py-0.5 font-bold text-purple-600">Izin: {r.excused}</span>
              <span className="rounded-full bg-red-50 px-2 py-0.5 font-bold text-red-600">Alpa: {r.absent}</span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
