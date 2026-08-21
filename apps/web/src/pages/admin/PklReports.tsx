import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, MapPin, Download, Loader2, BarChart3 } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, Badge, Skeleton, Button, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { Segmented } from '../../lib/ui';
import { STATUS_LABELS } from '../../lib/format';

interface DailyRow {
  studentId: string;
  fullName: string;
  nis: string | null;
  className: string | null;
  locationName: string;
  supervisorName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  method: string | null;
  lateMinutes: number;
}

interface DailyReport {
  date: string;
  total: number;
  present: number;
  late: number;
  sick: number;
  excused: number;
  absent: number;
  rows: DailyRow[];
}

interface MonthlyRow {
  studentId: string;
  fullName: string;
  nis: string | null;
  className: string | null;
  locationName: string;
  supervisorName: string | null;
  totalDays: number;
  present: number;
  late: number;
  sick: number;
  excused: number;
  absent: number;
  percentage: number;
}

interface MonthlyReport {
  month: string;
  schoolDays: number;
  totalStudents: number;
  rows: MonthlyRow[];
}

interface PklLocation {
  id: string;
  name: string;
}

function exportDailyToCSV(report: DailyReport) {
  const headers = ['No', 'Nama', 'NISN', 'Kelas', 'Lokasi', 'Guru Pembimbing', 'Jam Masuk', 'Jam Pulang', 'Status', 'Metode'];
  const rows = report.rows.map((r, i) => [
    i + 1, r.fullName, r.nis ?? '', r.className ?? '', r.locationName, r.supervisorName ?? '',
    r.checkIn ?? '-', r.checkOut ?? '-', STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status, r.method ?? '-',
  ]);
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `laporan-pkl-harian-${report.date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportMonthlyToCSV(report: MonthlyReport) {
  const headers = ['No', 'Nama', 'NISN', 'Kelas', 'Lokasi', 'Guru Pembimbing', 'Hadir', 'Terlambat', 'Sakit', 'Izin', 'Absen', 'Persentase'];
  const rows = report.rows.map((r, i) => [
    i + 1, r.fullName, r.nis ?? '', r.className ?? '', r.locationName, r.supervisorName ?? '',
    r.present, r.late, r.sick, r.excused, r.absent, `${r.percentage}%`,
  ]);
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `laporan-pkl-bulanan-${report.month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PklReports() {
  const [tab, setTab] = useState<'daily' | 'monthly'>('daily');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [locationFilter, setLocationFilter] = useState('');

  const { data: locations } = useQuery({
    queryKey: ['pkl-locations-list'],
    queryFn: () => api<{ success: boolean; data: PklLocation[] }>('/pkl/locations').then((r) => r.data),
  });

  const { data: daily, isLoading: dailyLoading } = useQuery({
    queryKey: ['pkl-report-daily', date, locationFilter],
    queryFn: () => {
      const params = new URLSearchParams({ date });
      if (locationFilter) params.set('locationId', locationFilter);
      return api<{ success: boolean; data: DailyReport }>(`/pkl/report/daily?${params}`).then((r) => r.data);
    },
    enabled: tab === 'daily',
  });

  const { data: monthly, isLoading: monthlyLoading } = useQuery({
    queryKey: ['pkl-report-monthly', month, locationFilter],
    queryFn: () => {
      const params = new URLSearchParams({ month });
      if (locationFilter) params.set('locationId', locationFilter);
      return api<{ success: boolean; data: MonthlyReport }>(`/pkl/report/monthly?${params}`).then((r) => r.data);
    },
    enabled: tab === 'monthly',
  });

  return (
    <div>
      <PageHeader
        title="Laporan PKL"
        subtitle="Rekap kehadiran siswa PKL per hari dan per bulan"
        action={
          <Button
            variant="outline"
            onClick={() => tab === 'daily' && daily ? exportDailyToCSV(daily) : tab === 'monthly' && monthly ? exportMonthlyToCSV(monthly) : null}
            disabled={tab === 'daily' ? !daily : !monthly}
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      {/* Tabs + Filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as 'daily' | 'monthly')}
          options={[
            { value: 'daily', label: 'Harian' },
            { value: 'monthly', label: 'Bulanan' },
          ]}
        />
        {tab === 'daily' ? (
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
        ) : (
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
        )}
        <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
          <option value="">Semua Lokasi</option>
          {locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {/* ===== DAILY REPORT ===== */}
      {tab === 'daily' && (
        <>
          {dailyLoading && <Skeleton className="h-32 w-full" />}
          {!dailyLoading && daily && (
            <>
              {/* Stats */}
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  { label: 'Total', value: daily.total, color: 'text-ink' },
                  { label: 'Hadir', value: daily.present, color: 'text-emerald-500' },
                  { label: 'Terlambat', value: daily.late, color: 'text-amber-500' },
                  { label: 'Sakit/Izin', value: daily.sick + daily.excused, color: 'text-blue-500' },
                  { label: 'Absen', value: daily.absent, color: 'text-red-500' },
                ].map((s) => (
                  <Card key={s.label} className="p-3 text-center">
                    <p className={`text-2xl font-extrabold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-muted">{s.label}</p>
                  </Card>
                ))}
              </div>

              {/* Table */}
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-bold text-ink">📋 Kehadiran {daily.date}</p>
                  <Badge status="APPROVED" label={`${daily.present}/${daily.total} hadir`} />
                </div>
                {daily.rows.length === 0 ? (
                  <EmptyState icon={Calendar} title="Belum ada data" description="Belum ada penugasan PKL untuk filter ini." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-line text-xs uppercase text-muted dark:border-slate-600">
                          <th className="px-3 py-2">No</th>
                          <th className="px-3 py-2">Nama</th>
                          <th className="px-3 py-2">Kelas</th>
                          <th className="px-3 py-2">Lokasi</th>
                          <th className="px-3 py-2">Pembimbing</th>
                          <th className="px-3 py-2">Masuk</th>
                          <th className="px-3 py-2">Pulang</th>
                          <th className="px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {daily.rows.map((r, i) => (
                          <tr key={r.studentId} className="border-b border-line/50 last:border-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50">
                            <td className="px-3 py-2 text-muted">{i + 1}</td>
                            <td className="px-3 py-2">
                              <p className="font-semibold text-ink">{r.fullName}</p>
                              <p className="text-xs text-muted">{r.nis}</p>
                            </td>
                            <td className="px-3 py-2 text-muted">{r.className ?? '-'}</td>
                            <td className="px-3 py-2 text-muted">{r.locationName}</td>
                            <td className="px-3 py-2 text-muted">{r.supervisorName ?? '-'}</td>
                            <td className="px-3 py-2 font-mono text-ink">{r.checkIn ?? '-'}</td>
                            <td className="px-3 py-2 font-mono text-ink">{r.checkOut ?? '-'}</td>
                            <td className="px-3 py-2"><Badge status={r.status as never} label={STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}
        </>
      )}

      {/* ===== MONTHLY REPORT ===== */}
      {tab === 'monthly' && (
        <>
          {monthlyLoading && <Skeleton className="h-32 w-full" />}
          {!monthlyLoading && monthly && (
            <>
              {/* Stats */}
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Card className="p-3 text-center">
                  <p className="text-2xl font-extrabold text-ink">{monthly.totalStudents}</p>
                  <p className="text-xs text-muted">Total Siswa PKL</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-2xl font-extrabold text-primary">{monthly.schoolDays}</p>
                  <p className="text-xs text-muted">Hari Kerja</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-2xl font-extrabold text-emerald-500">
                    {monthly.rows.length > 0 ? Math.round(monthly.rows.reduce((a, r) => a + r.percentage, 0) / monthly.rows.length) : 0}%
                  </p>
                  <p className="text-xs text-muted">Rata-rata Kehadiran</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-2xl font-extrabold text-red-500">
                    {monthly.rows.reduce((a, r) => a + r.absent, 0)}
                  </p>
                  <p className="text-xs text-muted">Total Absen</p>
                </Card>
              </div>

              {/* Table */}
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-bold text-ink">📊 Rekap {monthly.month}</p>
                  <span className="text-xs text-muted">{monthly.schoolDays} hari kerja</span>
                </div>
                {monthly.rows.length === 0 ? (
                  <EmptyState icon={BarChart3} title="Belum ada data" description="Belum ada penugasan PKL untuk filter ini." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-line text-xs uppercase text-muted dark:border-slate-600">
                          <th className="px-3 py-2">No</th>
                          <th className="px-3 py-2">Nama</th>
                          <th className="px-3 py-2">Kelas</th>
                          <th className="px-3 py-2">Lokasi</th>
                          <th className="px-3 py-2">Hadir</th>
                          <th className="px-3 py-2">Terlambat</th>
                          <th className="px-3 py-2">Sakit</th>
                          <th className="px-3 py-2">Izin</th>
                          <th className="px-3 py-2">Absen</th>
                          <th className="px-3 py-2">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthly.rows.map((r, i) => (
                          <tr key={r.studentId} className="border-b border-line/50 last:border-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50">
                            <td className="px-3 py-2 text-muted">{i + 1}</td>
                            <td className="px-3 py-2">
                              <p className="font-semibold text-ink">{r.fullName}</p>
                              <p className="text-xs text-muted">{r.nis}</p>
                            </td>
                            <td className="px-3 py-2 text-muted">{r.className ?? '-'}</td>
                            <td className="px-3 py-2 text-muted">{r.locationName}</td>
                            <td className="px-3 py-2 text-center font-bold text-emerald-600">{r.present}</td>
                            <td className="px-3 py-2 text-center font-bold text-amber-600">{r.late}</td>
                            <td className="px-3 py-2 text-center font-bold text-blue-600">{r.sick}</td>
                            <td className="px-3 py-2 text-center font-bold text-purple-600">{r.excused}</td>
                            <td className="px-3 py-2 text-center font-bold text-red-600">{r.absent}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.percentage >= 90 ? 'bg-emerald-100 text-emerald-700' : r.percentage >= 75 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                {r.percentage}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
