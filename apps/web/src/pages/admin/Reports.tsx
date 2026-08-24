import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { FileText, FileSpreadsheet, BarChart3, Table, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { Card, Select, Field, Button, EmptyState, Segmented, Badge } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS, STATUS_COLORS, currentMonthKey, todayJakartaKey } from '../../lib/format';
import { exportReportPdf, exportReportExcel, formatLongDate, type ReportExportRow } from '../../lib/reportExport';
import { exportRecapExcel } from '../../lib/recapExport';
import { exportRecapPdf } from '../../lib/recapPdfExport';
import RecapTable from '../../components/RecapTable';

// ===== Leave Recap Exports =====
function exportLeaveRecapPdf(data: any, schoolName: string) {
  import('jspdf').then(({ jsPDF }) => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`REKAP CUTI SISWA`, 14, 15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`${schoolName}  |  Periode: ${data.period?.from || '-'} s/d ${data.period?.to || '-'}`, 14, 22);
    doc.text(`Total: ${data.summary?.totalStudents || 0} siswa, ${data.summary?.totalDays || 0} hari cuti`, 14, 28);

    let y = 36;
    const headers = ['No', 'Nama Siswa', 'NISN', 'Kelas', 'Total Hari Cuti', 'Detail Cuti'];
    const colW = [10, 55, 30, 35, 25, 135];
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    let x = 14;
    headers.forEach((h, i) => { doc.text(h, x, y); x += colW[i]; });
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);

    (data.rows || []).forEach((r: any, i: number) => {
      if (y > 185) { doc.addPage(); y = 15; }
      const detail = (r.leaves || []).map((l: any) => `${l.type} ${l.start}-${l.end}`).join('; ');
      x = 14;
      doc.text(String(i + 1), x, y); x += colW[0];
      doc.text(r.name || '-', x, y); x += colW[1];
      doc.text(r.nis || '-', x, y); x += colW[2];
      doc.text(r.className || '-', x, y); x += colW[3];
      doc.text(String(r.totalDays), x, y); x += colW[4];
      doc.text(detail.slice(0, 120), x, y);
      y += 5;
    });

    doc.save(`rekap_cuti_${new Date().toISOString().slice(0,10)}.pdf`);
  });
}

function exportLeaveRecapExcel(data: any) {
  const headers = ['No', 'Nama Siswa', 'NISN', 'Kelas', 'Total Hari Cuti', 'Detail Cuti'];
  const rows = (data.rows || []).map((r: any, i: number) => {
    const detail = (r.leaves || []).map((l: any) => `${l.type} ${l.start}-${l.end}: ${l.reason}`).join('; ');
    return [i + 1, r.name || '', r.nis || '', r.className || '', r.totalDays, detail];
  });
  const csv = [headers.join(','), ...rows.map((r: any[]) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `rekap_cuti_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

interface Summary { PRESENT: number; LATE: number; EXCUSED: number; SICK: number; OFFICIAL_DUTY: number; DISPENSATION: number; ABSENT: number; }
interface ClassSummaryRow { className: string; total: number; present: number; late: number; excused: number; absent: number; }
interface ReportData {
  summary: Summary;
  classSummary?: ClassSummaryRow[];
  rows: { name: string; nis?: string | null; className?: string | null; date?: string; time?: string | null; status: string; method: string; lateMinutes: number }[];
}

const SUMMARY_KEYS: { key: keyof Summary; label: string }[] = [
  { key: 'PRESENT', label: 'Hadir' },
  { key: 'LATE', label: 'Terlambat' },
  { key: 'EXCUSED', label: 'Izin' },
  { key: 'SICK', label: 'Sakit' },
  { key: 'OFFICIAL_DUTY', label: 'Dinas' },
  { key: 'DISPENSATION', label: 'Dispensasi' },
  { key: 'ABSENT', label: 'Tidak Hadir' },
];

export default function Reports() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { branding } = useTheme();
  const [tab, setTab] = useState<'daily' | 'monthly' | 'recap' | 'leave'>('daily');
  const [date, setDate] = useState(todayJakartaKey());
  const [month, setMonth] = useState(currentMonthKey());
  const [classId, setClassId] = useState('');
  const [detailClass, setDetailClass] = useState<{ className: string; date: string } | null>(null);

  // Date range for recap (default: last 30 days)
  const [recapFrom, setRecapFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  });
  const [recapTo, setRecapTo] = useState(todayJakartaKey());

  const { data: report } = useQuery({
    queryKey: ['report', tab, date, month, classId, recapFrom, recapTo],
    queryFn: () =>
      tab === 'recap'
        ? api<{ success: boolean; data: any }>(`/reports/recap?from=${recapFrom}&to=${recapTo}`).then((r) => r.data)
        : tab === 'leave'
        ? api<{ success: boolean; data: any }>(`/reports/leave-recap?from=${recapFrom}&to=${recapTo}&classId=${classId}`).then((r) => r.data)
        : api<{ success: boolean; data: ReportData }>(
            tab === 'daily'
              ? `/reports/daily?date=${date}&classId=${classId}`
              : `/reports/monthly?month=${month}&classId=${classId}`,
          ).then((r) => r.data),
    enabled: true,
  });

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data),
  });

  // Fetch data kepala sekolah + petugas piket untuk tanda tangan (selalu jalan)
  const { data: signatureUsers } = useQuery({
    queryKey: ['signature-users'],
    queryFn: async () => {
      const res = await api<{ success: boolean; data: { id: string; fullName: string; roleKey: string; nip?: string | null }[] }>('/users');
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // cache 5 menit
  });
  const headmasterFromUsers = signatureUsers?.find((u) => u.roleKey === 'HEADMASTER');
  const selfFromUsers = signatureUsers?.find((u) => u.id === user?.id);

  // Data tanda tangan: prioritaskan dari recap backend, fallback ke fetch users
  const recapData = tab === 'recap' ? (report as any) : null;
  const headmasterName = recapData?.headmasterName || headmasterFromUsers?.fullName || null;
  const headmasterNip = recapData?.headmasterNip || headmasterFromUsers?.nip || null;
  const piketName = recapData?.piketName || user?.fullName || null;
  const piketNip = recapData?.piketNip || user?.teacher?.nip || user?.staff?.nip || selfFromUsers?.nip || null;

  const chartData = SUMMARY_KEYS.map((s) => ({ name: s.label, value: report?.summary?.[s.key] || 0, color: STATUS_COLORS[s.key] }));

  const period = tab === 'daily' ? `Tanggal: ${formatLongDate(date)}` : `Bulan: ${formatLongDate(`${month}-01`).replace(/^1\s/, '')}`;
  const doExport = (kind: 'pdf' | 'excel') => {
    if (!report?.rows.length && !report?.classSummary?.length) {
      toast('info', 'Tidak ada data untuk diexport.');
      return;
    }
    const opts = {
      title: `LAPORAN ABSENSI SISWA ${tab === 'daily' ? 'HARIAN' : 'BULANAN'}`,
      schoolName: branding?.schoolName || 'Sekolah',
      period,
      rows: report.rows as ReportExportRow[],
      summary: report.summary as unknown as Record<string, number | undefined>,
      classSummary: report.classSummary || [],
      headmasterName: headmasterName,
      headmasterNip: headmasterNip,
      signatureName: piketName,
      signatureNip: piketNip,
      filename: `laporan_${tab}_${date || month}.${kind === 'pdf' ? 'pdf' : 'xlsx'}`,
    };
    try {
      if (kind === 'pdf') exportReportPdf(opts);
      else exportReportExcel(opts);
      toast('success', kind === 'pdf' ? 'Laporan PDF diunduh.' : 'Laporan Excel diunduh.');
    } catch (e) {
      console.error('EXPORT_FAIL', e);
      toast('error', 'Gagal membuat laporan.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Laporan"
        subtitle="Rekap kehadiran harian & bulanan"
        action={
          <div className="flex flex-wrap gap-2">
            {tab === 'recap' ? (
              <>
                <Button variant="outline" onClick={() => {
                  if (report?.dateColumns && report?.rows) {
                    exportRecapPdf(report as any, {
                      schoolName: branding?.schoolName || 'Sekolah',
                      headmasterName: headmasterName || undefined,
                      headmasterNip: headmasterNip || undefined,
                      signatureName: piketName || undefined,
                      signatureNip: piketNip || undefined,
                    });
                    toast('success', 'Rekap PDF diunduh.');
                  } else toast('info', 'Belum ada data rekap.');
                }}><FileText className="h-4 w-4" /> Export PDF</Button>
                <Button variant="outline" onClick={() => {
                  if (report?.dateColumns && report?.rows) {
                    exportRecapExcel(report as any);
                    toast('success', 'Rekap Excel diunduh.');
                  } else toast('info', 'Belum ada data rekap.');
                }}><FileSpreadsheet className="h-4 w-4" /> Export Excel</Button>
              </>
            ) : tab === 'leave' ? (
              <>
                <Button variant="outline" onClick={() => {
                  if (report?.rows?.length) {
                    exportLeaveRecapPdf(report, branding?.schoolName || 'Sekolah');
                    toast('success', 'Rekap Cuti PDF diunduh.');
                  } else toast('info', 'Belum ada data rekap cuti.');
                }}><FileText className="h-4 w-4" /> Export PDF</Button>
                <Button variant="outline" onClick={() => {
                  if (report?.rows?.length) {
                    exportLeaveRecapExcel(report);
                    toast('success', 'Rekap Cuti Excel diunduh.');
                  } else toast('info', 'Belum ada data rekap cuti.');
                }}><FileSpreadsheet className="h-4 w-4" /> Export Excel</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => doExport('pdf')}><FileText className="h-4 w-4" /> Export PDF</Button>
                <Button variant="outline" onClick={() => doExport('excel')}><FileSpreadsheet className="h-4 w-4" /> Export Excel</Button>
              </>
            )}
          </div>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          options={[
            { value: 'daily', label: 'Harian' },
            { value: 'monthly', label: 'Bulanan' },
            { value: 'recap', label: 'Rekap Absensi' },
            { value: 'leave', label: 'Rekap Cuti' },
          ]}
        />
        {tab === 'recap' ? (
          <>
            <Field label="Dari"><input type="date" value={recapFrom} onChange={(e) => setRecapFrom(e.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900" /></Field>
            <span className="self-end pb-2 text-sm text-muted">—</span>
            <Field label="Sampai"><input type="date" value={recapTo} onChange={(e) => setRecapTo(e.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900" /></Field>
          </>
        ) : (
          <>
            {tab === 'daily' ? (
              <Field label="Tanggal"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900" /></Field>
            ) : (
              <Field label="Bulan"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900" /></Field>
            )}
            <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="sm:w-44">
              <option value="">Semua kelas</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </>
        )}
      </div>

      {tab !== 'recap' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 font-bold text-ink">Ringkasan</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SUMMARY_KEYS.map((s) => (
                <div key={s.key} className="rounded-2xl border border-line/60 p-3">
                  <p className="text-2xl font-extrabold" style={{ color: STATUS_COLORS[s.key] }}>{report?.summary?.[s.key] ?? 0}</p>
                  <p className="text-xs text-muted">{s.label}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h3 className="mb-3 font-bold text-ink">Grafik</h3>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 13 }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {chartData.map((c) => <Cell key={c.name} fill={c.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {tab === 'recap' && report?.dateColumns ? (
        <RecapTable
          data={report as any}
          headmasterName={headmasterName || undefined}
          headmasterNip={headmasterNip || undefined}
          piketName={piketName || undefined}
          piketNip={piketNip || undefined}
        />
      ) : null}

      {tab === 'leave' && report ? (
        <Card className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-ink">Rekap Cuti Siswa</h3>
              <p className="text-xs text-muted">Periode: {report.period?.from || '-'} s/d {report.period?.to || '-'}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-extrabold text-primary">{report.summary?.totalDays || 0}</p>
              <p className="text-xs text-muted">hari cuti total</p>
            </div>
          </div>
          {report.rows?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted">
                  <tr>
                    <th className="px-3 py-2">No</th>
                    <th className="px-3 py-2">Nama Siswa</th>
                    <th className="px-3 py-2">NISN</th>
                    <th className="px-3 py-2">Kelas</th>
                    <th className="px-3 py-2">Total Hari</th>
                    <th className="px-3 py-2">Detail Cuti</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.rows.map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-primary-soft/30">
                      <td className="px-3 py-2 text-muted">{i + 1}</td>
                      <td className="px-3 py-2 font-semibold text-ink">{r.name}</td>
                      <td className="px-3 py-2 text-muted">{r.nis || '-'}</td>
                      <td className="px-3 py-2 text-muted">{r.className || '-'}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-600 dark:bg-red-500/10">
                          {r.totalDays} hari
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">
                        {(r.leaves || []).map((l: any, j: number) => (
                          <div key={j} className="mb-0.5">
                            <span className="font-medium text-ink">{l.type}</span>: {l.start} s/d {l.end}
                            {l.reason && <span className="ml-1">— {l.reason.slice(0, 50)}</span>}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={BarChart3} title="Belum ada data cuti" description="Data cuti siswa akan muncul di sini setelah ada pengajuan izin yang disetujui." />
          )}
        </Card>
      ) : null}

      {tab !== 'recap' && tab !== 'leave' && classId === '' && report?.classSummary?.length ? (
        <Card className="mt-4">
          <h3 className="mb-3 font-bold text-ink">Rekap per Kelas — Semua Kelas</h3>
          <p className="mb-3 text-xs text-muted">Klik nama kelas untuk melihat detail siswa</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2">Kelas</th>
                  <th className="px-3 py-2">Total Siswa</th>
                  <th className="px-3 py-2">Hadir</th>
                  <th className="px-3 py-2">Terlambat</th>
                  <th className="px-3 py-2">Izin / Sakit / Dispensasi</th>
                  <th className="px-3 py-2">Tidak Hadir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.classSummary!.map((c: any) => (
                  <tr key={c.className} className="cursor-pointer transition-colors hover:bg-primary-soft/40" onClick={() => setDetailClass({ className: c.className, date: tab === 'daily' ? date : `${month}-01` })}>
                    <td className="px-3 py-2 font-semibold text-primary-dark">{c.className} →</td>
                    <td className="px-3 py-2 text-muted">{c.total}</td>
                    <td className="px-3 py-2 font-semibold text-emerald-600 dark:text-emerald-400">{c.present}</td>
                    <td className="px-3 py-2 font-semibold text-amber-600 dark:text-amber-400">{c.late}</td>
                    <td className="px-3 py-2 font-semibold text-sky-600 dark:text-sky-400">{c.excused}</td>
                    <td className="px-3 py-2 font-semibold text-red-500">{c.absent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {detailClass && (
        <ClassDetailModal
          className={detailClass.className}
          date={detailClass.date}
          tab={tab}
          onClose={() => setDetailClass(null)}
        />
      )}

      {tab !== 'recap' && tab !== 'leave' && (
        <Card className="mt-4">
          <h3 className="mb-3 font-bold text-ink">Rincian</h3>
          {report?.rows?.length ? (
            <div className="max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-left text-xs uppercase text-muted dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2">Nama</th>
                    <th className="px-3 py-2">Kelas</th>
                    {tab === 'monthly' && <th className="px-3 py-2">Tanggal</th>}
                    <th className="px-3 py-2">Jam</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.rows.map((r: any, i: number) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
                      <td className="px-3 py-2 text-muted">{r.className}</td>
                      {tab === 'monthly' && <td className="px-3 py-2 text-muted">{r.date}</td>}
                      <td className="px-3 py-2 font-mono text-muted">{r.time || '—'}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ backgroundColor: `${STATUS_COLORS[r.status]}1a`, color: STATUS_COLORS[r.status] }}>
                          {STATUS_LABELS[r.status]}{r.status === 'LATE' && r.lateMinutes ? ` (${r.lateMinutes}m)` : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={BarChart3} title="Belum ada data" description="Ubah filter tanggal/kelas untuk melihat laporan." />
          )}
        </Card>
      )}
    </div>
  );
}

function ClassDetailModal({ className, date, tab, onClose }: { className: string; date: string; tab: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['class-detail', className, date, tab],
    queryFn: async () => {
      if (tab === 'daily') {
        const res = await api<{ success: boolean; data: { rows: { name: string; nis?: string | null; className?: string | null; time?: string | null; status: string; method: string; lateMinutes: number }[] } }>(
          `/reports/daily?date=${date}`,
        );
        return res.data.rows.filter((r: any) => r.className === className);
      } else {
        // Find class ID from classes list
        const classes = await api<{ success: boolean; data: { id: string; name: string }[] }>('/classes');
        const cls = classes.data.find((c) => c.name === className);
        if (!cls) return [];
        const month = date.slice(0, 7);
        const res = await api<{ success: boolean; data: { className: string; month: string; rows: { name: string; nis?: string | null; total: number; present: number; late: number; excused: number; absent: number; attendanceRate: number }[] } }>(
          `/reports/class/${cls.id}?month=${month}`,
        );
        // Convert summary rows to detail rows
        return res.data.rows;
      }
    },
    enabled: true,
  });

  const rows = data || [];
  const counts = rows.reduce<Record<string, number>>((acc, r: any) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-ink">Detail Kelas {className}</h3>
            <p className="text-xs text-muted">{tab === 'daily' ? `Tanggal: ${date}` : `Bulan: ${date}`}</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="mb-3 grid grid-cols-4 gap-2">
          {Object.entries(STATUS_LABELS).filter(([k]) => counts[k]).map(([k, label]) => (
            <div key={k} className="rounded-xl border border-line/60 p-2 text-center">
              <p className="text-lg font-extrabold" style={{ color: STATUS_COLORS[k] }}>{counts[k] || 0}</p>
              <p className="text-[10px] text-muted">{label}</p>
            </div>
          ))}
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted">Memuat data…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Tidak ada data absensi untuk kelas ini.</p>
        ) : tab === 'daily' ? (
          <div className="max-h-[24rem] overflow-y-auto rounded-2xl border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs uppercase text-muted dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2">No</th>
                  <th className="px-3 py-2">Nama</th>
                  <th className="px-3 py-2">NISN</th>
                  <th className="px-3 py-2">Jam</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-muted">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
                    <td className="px-3 py-2 text-muted">{r.nis || '—'}</td>
                    <td className="px-3 py-2 font-mono text-muted">{r.time || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ backgroundColor: `${STATUS_COLORS[r.status]}1a`, color: STATUS_COLORS[r.status] }}>
                        {STATUS_LABELS[r.status]}{r.status === 'LATE' && r.lateMinutes ? ` (${r.lateMinutes}m)` : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="max-h-[24rem] overflow-y-auto rounded-2xl border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs uppercase text-muted dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2">No</th>
                  <th className="px-3 py-2">Nama</th>
                  <th className="px-3 py-2">NISN</th>
                  <th className="px-3 py-2">Hadir</th>
                  <th className="px-3 py-2">Terlambat</th>
                  <th className="px-3 py-2">Izin/Sakit</th>
                  <th className="px-3 py-2">Absen</th>
                  <th className="px-3 py-2">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-muted">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
                    <td className="px-3 py-2 text-muted">{r.nis || '—'}</td>
                    <td className="px-3 py-2 font-semibold text-emerald-600">{r.present}</td>
                    <td className="px-3 py-2 font-semibold text-amber-600">{r.late}</td>
                    <td className="px-3 py-2 font-semibold text-sky-600">{r.excused}</td>
                    <td className="px-3 py-2 font-semibold text-red-500">{r.absent}</td>
                    <td className="px-3 py-2 text-muted">{r.attendanceRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
