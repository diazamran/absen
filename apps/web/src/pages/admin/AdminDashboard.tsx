import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { Users, CheckCircle2, Clock3, FileQuestion, UserX, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocketEvent, joinDashboard } from '../../lib/socket';
import { StatCard, Card, Badge, EmptyState, Skeleton, Segmented } from '../../lib/ui';
import { STATUS_LABELS, STATUS_COLORS, timeLabel, cn } from '../../lib/format';

interface DashboardData {
  stats: {
    total: number; present: number; late: number; excused: number; absent: number; notYet: number; percent: number; activeStudents: number;
  };
  chart: { name: string; value: number; color: string }[];
  recent: { id: string; name: string; nis: string | null; className: string | null; time: string; status: string; statusLabel: string; method: string; lateMinutes: number }[];
  absentToday: { id: string; name: string; nis: string; className: string | null }[];
  classes: { id: string; name: string; total: number; present: number }[];
}

interface RealtimeEvent {
  id: string; type: string; userId: string; fullName: string; nis?: string | null; className?: string | null;
  time: string; status: string; method: string; lateMinutes: number;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<'today' | 'class'>('today');
  const [liveEvents, setLiveEvents] = useState<RealtimeEvent[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', user?.roleKey],
    queryFn: () => api<{ success: boolean; data: DashboardData }>('/dashboard').then((r) => r.data),
  });

  // Realtime: event absensi baru langsung masuk tanpa reload
  const onAttendance = useCallback(
    (ev: RealtimeEvent) => {
      setLiveEvents((prev) => [ev, ...prev].slice(0, 5));
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    [qc],
  );
  useSocketEvent<RealtimeEvent>('attendance:new', onAttendance);

  useEffect(() => {
    joinDashboard();
  }, []);

  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;

  const s = data.stats;

  return (
    <div className="space-y-5">
      {/* Kartu statistik */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Kehadiran Hari Ini" value={`${s.percent}%`} icon={Users} color="#0d9488" />
        <StatCard label="Hadir" value={s.present} icon={CheckCircle2} color="#22c55e" />
        <StatCard label="Terlambat" value={s.late} icon={Clock3} color="#f59e0b" />
        <StatCard label="Izin / Sakit" value={s.excused} icon={FileQuestion} color="#3b82f6" />
        <StatCard label="Belum Hadir" value={s.notYet} icon={UserX} color="#64748b" />
        <StatCard label="Total Siswa" value={s.activeStudents} icon={Users} color="#0ea5e9" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Chart */}
        <Card className="lg:col-span-2">
          <h3 className="mb-3 font-bold text-ink">Kehadiran Hari Ini</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.chart.filter((c) => c.value > 0)} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={3}>
                  {data.chart.map((c) => (
                    <Cell key={c.name} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            {data.chart.filter((c) => c.value > 0).map((c) => (
              <div key={c.name} className="flex items-center gap-2 text-muted">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name} <b className="text-ink">{c.value}</b>
              </div>
            ))}
          </div>
        </Card>

        {/* Kedatangan terbaru (realtime) */}
        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-ink">Kedatangan Terbaru</h3>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> LIVE
            </span>
          </div>
          <div className="space-y-2">
            {liveEvents.map((e) => (
              <div key={`live-${e.id}`} className="flex items-center gap-3 rounded-xl bg-emerald-50/70 px-3 py-2.5 animate-fade-in dark:bg-emerald-500/10">
                <div className="h-9 w-9 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex items-center justify-center text-sm font-bold">
                  {e.fullName.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{e.fullName}</p>
                  <p className="text-xs text-muted">{e.className} · {e.nis}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-bold text-ink">{e.time}</p>
                  <Badge status={e.status} label={STATUS_LABELS[e.status]} />
                </div>
              </div>
            ))}
            {data.recent.slice(0, 8 - liveEvents.length).map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <div className={cn('h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold', r.status === 'LATE' ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300')}>
                  {r.name.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{r.name}</p>
                  <p className="text-xs text-muted">{r.className} · {r.nis}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-bold text-ink">{r.time}</p>
                  <Badge status={r.status} label={r.statusLabel} />
                </div>
              </div>
            ))}
            {data.recent.length === 0 && liveEvents.length === 0 && (
              <EmptyState icon={Loader2} title="Belum ada kedatangan hari ini" description="Data akan tampil otomatis saat siswa mulai absen." />
            )}
          </div>
        </Card>
      </div>

      {/* Kehadiran per kelas */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-ink">Kehadiran per Kelas</h3>
          <Segmented value={period} onChange={setPeriod} options={[{ value: 'today', label: 'Hari Ini' }, { value: 'class', label: 'Kelas' }]} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.classes.map((c) => {
            const pct = c.total ? Math.round((c.present / c.total) * 100) : 0;
            return (
              <div key={c.id} className="rounded-xl border border-line/60 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-bold text-ink">{c.name}</p>
                  <span className="text-xs font-semibold text-muted">{c.present}/{c.total} hadir</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-muted">{pct}% kehadiran</p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Belum hadir */}
      {data.absentToday.length > 0 && (
        <Card>
          <h3 className="mb-3 font-bold text-ink">Belum Melakukan Absensi</h3>
          <div className="flex flex-wrap gap-2">
            {data.absentToday.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm text-muted">
                <UserX className="h-4 w-4 text-red-400" />
                <b className="text-ink">{a.name}</b>
                <span>{a.className}</span>
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
