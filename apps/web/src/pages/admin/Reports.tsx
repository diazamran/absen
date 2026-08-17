import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { FileText, FileSpreadsheet, BarChart3 } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { Card, Select, Field, Button, EmptyState, Segmented } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS, STATUS_COLORS, currentMonthKey, todayJakartaKey } from '../../lib/format';
import { exportReportPdf, exportReportExcel, formatLongDate, type ReportExportRow } from '../../lib/reportExport';

interface Summary { PRESENT: number; LATE: number; EXCUSED: number; SICK: number; OFFICIAL_DUTY: number; ABSENT: number; }
interface ReportData {
  summary: Summary; rows: { name: string; nis?: string | null; className?: string | null; date?: string; time?: string | null; status: string; method: string; lateMinutes: number }[];
}

const SUMMARY_KEYS: { key: keyof Summary; label: string }[] = [
  { key: 'PRESENT', label: 'Hadir' },
  { key: 'LATE', label: 'Terlambat' },
  { key: 'EXCUSED', label: 'Izin' },
  { key: 'SICK', label: 'Sakit' },
  { key: 'OFFICIAL_DUTY', label: 'Dinas' },
  { key: 'ABSENT', label: 'Tidak Hadir' },
];

export default function Reports() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { branding } = useTheme();
  const [type, setType] = useState<'daily' | 'monthly'>('daily');
  const [date, setDate] = useState(todayJakartaKey());
  const [month, setMonth] = useState(currentMonthKey());
  const [classId, setClassId] = useState('');

  const { data: report } = useQuery({
    queryKey: ['report', type, date, month, classId],
    queryFn: () =>
      api<{ success: boolean; data: ReportData }>(
        type === 'daily'
          ? `/reports/daily?date=${date}&classId=${classId}`
          : `/reports/monthly?month=${month}&classId=${classId}`,
      ).then((r) => r.data),
  });

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data),
  });

  const chartData = SUMMARY_KEYS.map((s) => ({ name: s.label, value: report?.summary[s.key] || 0, color: STATUS_COLORS[s.key] }));

  const period = type === 'daily' ? `Tanggal: ${formatLongDate(date)}` : `Bulan: ${formatLongDate(`${month}-01`).replace(/^1\s/, '')}`;
  const doExport = (kind: 'pdf' | 'excel') => {
    if (!report?.rows.length) {
      toast('info', 'Tidak ada data untuk diexport.');
      return;
    }
    const opts = {
      title: `LAPORAN ABSENSI SISWA ${type === 'daily' ? 'HARIAN' : 'BULANAN'}`,
      schoolName: branding?.schoolName || 'Sekolah',
      period,
      rows: report.rows as ReportExportRow[],
      summary: report.summary as unknown as Record<string, number | undefined>,
      signatureName: user?.fullName,
      signatureNip: user?.teacher?.nip || user?.staff?.nip || null,
      filename: `laporan_${type}_${date || month}.${kind}`,
    };
    try {
      if (kind === 'pdf') exportReportPdf(opts);
      else exportReportExcel(opts);
      toast('success', kind === 'pdf' ? 'Laporan PDF diunduh.' : 'Laporan Excel diunduh.');
    } catch {
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
            <Button variant="outline" onClick={() => doExport('pdf')}><FileText className="h-4 w-4" /> Export PDF</Button>
            <Button variant="outline" onClick={() => doExport('excel')}><FileSpreadsheet className="h-4 w-4" /> Export Excel</Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'daily', label: 'Harian' },
            { value: 'monthly', label: 'Bulanan' },
          ]}
        />
        {type === 'daily' ? (
          <Field label="Tanggal"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900" /></Field>
        ) : (
          <Field label="Bulan"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900" /></Field>
        )}
        <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="sm:w-44">
          <option value="">Semua kelas</option>
          {classes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-bold text-ink">Ringkasan</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SUMMARY_KEYS.map((s) => (
              <div key={s.key} className="rounded-2xl border border-line/60 p-3">
                <p className="text-2xl font-extrabold" style={{ color: STATUS_COLORS[s.key] }}>{report?.summary[s.key] ?? 0}</p>
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

      <Card className="mt-4">
        <h3 className="mb-3 font-bold text-ink">Rincian</h3>
        {report?.rows.length ? (
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs uppercase text-muted dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2">Nama</th>
                  <th className="px-3 py-2">Kelas</th>
                  {type === 'monthly' && <th className="px-3 py-2">Tanggal</th>}
                  <th className="px-3 py-2">Jam</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
                    <td className="px-3 py-2 text-muted">{r.className}</td>
                    {type === 'monthly' && <td className="px-3 py-2 text-muted">{r.date}</td>}
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
    </div>
  );
}
