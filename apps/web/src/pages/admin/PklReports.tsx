import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, MapPin, MapPinOff, Download, Loader2, BarChart3 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../lib/api';
import { Card, Badge, Skeleton, Button, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { Segmented } from '../../lib/ui';
import { STATUS_LABELS, todayJakartaKey, currentMonthKey } from '../../lib/format';

interface LocationInfo {
  latitude: number;
  longitude: number;
  distanceMeters: number | null;
  locationVerified: boolean;
  mapsUrl: string;
}

interface DailyRow {
  studentId: string;
  fullName: string;
  nis: string | null;
  className: string | null;
  locationName: string;
  supervisorName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  earlyLeave?: boolean;
  status: string;
  method: string | null;
  lateMinutes: number;
  checkInLocation?: LocationInfo | null;
  checkOutLocation?: LocationInfo | null;
}

/** Badge lokasi absen: jarak dari titik PKL + link Google Maps */
function PklLocationCell({ loc }: { loc: LocationInfo | null | undefined }) {
  if (!loc) return <span className="text-xs text-muted">—</span>;
  const ok = loc.locationVerified;
  const Icon = ok ? MapPin : MapPinOff;
  const color = ok ? 'text-emerald-600' : 'text-amber-500';
  return (
    <a
      href={loc.mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}`}
      className={`inline-flex items-center gap-1 text-xs font-semibold hover:underline ${color}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {loc.distanceMeters != null ? `${loc.distanceMeters} m` : 'Lihat'}
    </a>
  );
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
  startDate: string | null;         // tanggal mulai PKL siswa
  endDate: string | null;           // tanggal selesai PKL siswa
  totalDays: number;
  present: number;
  late: number;
  sick: number;
  excused: number;
  absent: number;
  percentage: number | null;
  hasData: boolean;
}

interface MonthlyReport {
  month: string;
  schoolDays: number;
  pklStartDate: string | null;      // tanggal mulai PKL yang dipakai server
  totalPklWorkdays: number | null;  // total hari kerja PKL dari startDate s.d. sekarang
  totalStudents: number;
  rows: MonthlyRow[];
}

interface PklLocation {
  id: string;
  name: string;
}

function exportDailyToExcel(report: DailyReport) {
  const title = `Laporan PKL Harian — ${report.date}`;
  const subtitle = `Total: ${report.total} siswa · Hadir: ${report.present} · Terlambat: ${report.late} · Sakit/Izin: ${report.sick + report.excused} · Absen: ${report.absent}`;

  const headers = [
    'No', 'Nama', 'NISN', 'Kelas', 'Lokasi PKL', 'Guru Pembimbing',
    'Jam Masuk', 'Titik Masuk (m)', 'Koordinat Masuk',
    'Jam Pulang', 'Titik Pulang (m)', 'Koordinat Pulang',
    'Status', 'Metode',
  ];

  const rows = report.rows.map((r, i) => [
    i + 1,
    r.fullName,
    r.nis ?? '',
    r.className ?? '',
    r.locationName,
    r.supervisorName ?? '',
    r.checkIn ?? '-',
    r.checkInLocation ? r.checkInLocation.distanceMeters ?? '' : '',
    r.checkInLocation ? `${r.checkInLocation.latitude},${r.checkInLocation.longitude}` : '',
    r.checkOut ? r.checkOut + (r.earlyLeave ? ' (Pulang Awal)' : '') : '-',
    r.checkOutLocation ? r.checkOutLocation.distanceMeters ?? '' : '',
    r.checkOutLocation ? `${r.checkOutLocation.latitude},${r.checkOutLocation.longitude}` : '',
    STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status,
    r.method ?? '-',
  ]);

  const aoa: (string | number)[][] = [
    [title],
    [subtitle],
    [],
    headers,
    ...rows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Lebar kolom
  ws['!cols'] = [
    { wch: 4 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 26 },
    { wch: 10 }, { wch: 14 }, { wch: 24 },
    { wch: 10 }, { wch: 14 }, { wch: 24 },
    { wch: 14 }, { wch: 10 },
  ];
  // Merge baris judul
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan PKL Harian');
  XLSX.writeFile(wb, `laporan-pkl-harian-${report.date}.xlsx`, { bookType: 'xlsx' });
}

function exportMonthlyToExcel(report: MonthlyReport) {
  const title = `Laporan PKL Bulanan — ${report.month}`;
  const subtitle = `Total: ${report.totalStudents} siswa · ${report.schoolDays} hari kerja${report.pklStartDate ? ` · Mulai PKL: ${report.pklStartDate}` : ''}${report.totalPklWorkdays != null ? ` · Durasi: ${report.totalPklWorkdays} hari kerja` : ''}`;

  const headers = [
    'No', 'Nama', 'NISN', 'Kelas', 'Lokasi PKL', 'Guru Pembimbing',
    'Tgl Mulai PKL', 'Tgl Selesai PKL',
    'Hadir', 'Terlambat', 'Sakit', 'Izin', 'Absen', 'Persentase (%)',
  ];

  const rows = report.rows.map((r, i) => [
    i + 1,
    r.fullName,
    r.nis ?? '',
    r.className ?? '',
    r.locationName,
    r.supervisorName ?? '',
    r.startDate ?? '-',
    r.endDate ?? '-',
    r.present,
    r.late,
    r.sick,
    r.excused,
    r.absent,
    r.percentage !== null ? r.percentage : '-',
  ]);

  const aoa: (string | number)[][] = [
    [title],
    [subtitle],
    [],
    headers,
    ...rows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 4 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 26 },
    { wch: 13 }, { wch: 13 },
    { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 14 },
  ];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan PKL Bulanan');
  XLSX.writeFile(wb, `laporan-pkl-bulanan-${report.month}.xlsx`, { bookType: 'xlsx' });
}

export default function PklReports() {
  const [tab, setTab] = useState<'daily' | 'monthly'>('daily');
  const [date, setDate] = useState(todayJakartaKey());
  const [month, setMonth] = useState(currentMonthKey());
  const [locationFilter, setLocationFilter] = useState('');
  // Tanggal mulai PKL untuk laporan bulanan — kosong = server tentukan otomatis
  const [pklStartDate, setPklStartDate] = useState('');

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
    queryKey: ['pkl-report-monthly', month, locationFilter, pklStartDate],
    queryFn: () => {
      const params = new URLSearchParams({ month });
      if (locationFilter) params.set('locationId', locationFilter);
      if (pklStartDate) params.set('startDate', pklStartDate);
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
            onClick={() => tab === 'daily' && daily ? exportDailyToExcel(daily) : tab === 'monthly' && monthly ? exportMonthlyToExcel(monthly) : null}
            disabled={tab === 'daily' ? !daily : !monthly}
          >
            <Download className="h-4 w-4" /> Export Excel
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
          <>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-muted whitespace-nowrap">Mulai PKL:</label>
              <input
                type="date"
                value={pklStartDate}
                onChange={(e) => setPklStartDate(e.target.value)}
                className="rounded-xl border border-line bg-surface px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                title="Tanggal mulai PKL — untuk menghitung hari kerja yang tepat"
              />
              {pklStartDate && (
                <button
                  onClick={() => setPklStartDate('')}
                  className="text-xs text-muted hover:text-red-500"
                  title="Reset ke otomatis"
                >✕</button>
              )}
            </div>
          </>
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
                          <th className="px-3 py-2">Titik Masuk</th>
                          <th className="px-3 py-2">Pulang</th>
                          <th className="px-3 py-2">Titik Pulang</th>
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
                            <td className="px-3 py-2"><PklLocationCell loc={r.checkInLocation} /></td>
                            <td className="px-3 py-2 font-mono text-ink">{r.checkOut ?? '-'}{r.earlyLeave && <span className="ml-1 text-[10px] font-semibold text-amber-500">(Awal)</span>}</td>
                            <td className="px-3 py-2"><PklLocationCell loc={r.checkOutLocation} /></td>
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
              {/* Info tanggal mulai PKL + durasi */}
              {monthly.pklStartDate && (
                <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/20 bg-primary-soft/20 px-4 py-2.5 text-sm">
                  <span className="font-semibold text-ink">📅 Mulai PKL:</span>
                  <span className="font-mono text-primary">{monthly.pklStartDate}</span>
                  {monthly.totalPklWorkdays !== null && (
                    <>
                      <span className="text-muted">·</span>
                      <span className="text-muted">
                        Durasi s.d. sekarang: <b className="text-ink">{monthly.totalPklWorkdays} hari kerja</b>
                      </span>
                    </>
                  )}
                  {!pklStartDate && (
                    <span className="text-xs text-muted italic">(otomatis dari data penugasan)</span>
                  )}
                </div>
              )}

              {/* Stats — hanya hitung dari siswa yang punya data attendance */}
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
                  {(() => {
                    const withData = monthly.rows.filter((r) => r.hasData);
                    const avg = withData.length > 0
                      ? Math.round(withData.reduce((a, r) => a + (r.percentage ?? 0), 0) / withData.length)
                      : null;
                    return (
                      <>
                        <p className="text-2xl font-extrabold text-emerald-500">
                          {avg !== null ? `${avg}%` : '—'}
                        </p>
                        <p className="text-xs text-muted">Rata-rata Kehadiran</p>
                      </>
                    );
                  })()}
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
                          <th className="px-3 py-2">Tgl Mulai</th>
                          <th className="px-3 py-2">Tgl Selesai</th>
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
                            <td className="px-3 py-2 font-mono text-xs text-muted">{r.startDate ?? '-'}</td>
                            <td className="px-3 py-2 font-mono text-xs text-muted">{r.endDate ?? '-'}</td>
                            <td className="px-3 py-2 text-center font-bold text-emerald-600">{r.present}</td>
                            <td className="px-3 py-2 text-center font-bold text-amber-600">{r.late}</td>
                            <td className="px-3 py-2 text-center font-bold text-blue-600">{r.sick}</td>
                            <td className="px-3 py-2 text-center font-bold text-purple-600">{r.excused}</td>
                            <td className="px-3 py-2 text-center font-bold text-red-600">{r.absent}</td>
                            <td className="px-3 py-2 text-center">
                              {r.percentage === null ? (
                                <span className="text-xs text-muted">—</span>
                              ) : (
                                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.percentage >= 90 ? 'bg-emerald-100 text-emerald-700' : r.percentage >= 75 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                  {r.percentage}%
                                </span>
                              )}
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
