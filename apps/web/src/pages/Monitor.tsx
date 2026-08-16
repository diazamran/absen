import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useTheme } from '../lib/theme';
import { useSocketEvent, joinDashboard } from '../lib/socket';
import { STATUS_LABELS, STATUS_COLORS } from '../lib/format';
import { Clock } from '../components/AppShell';

interface MonitorData {
  stats: { total: number; present: number; late: number; excused: number; absent: number; notYet: number; percent: number; activeStudents: number };
  recent: { id: string; name: string; nis?: string | null; className?: string | null; time: string; status: string }[];
}

export default function Monitor() {
  const { branding } = useTheme();
  const [live, setLive] = useState<MonitorData['recent']>([]);

  const { data } = useQuery({
    queryKey: ['monitor'],
    queryFn: async () => {
      const token = localStorage.getItem('presensiku_access');
      if (!token) return null;
      return api<{ success: boolean; data: MonitorData }>('/dashboard').then((r) => r.data);
    },
    refetchInterval: 60_000,
  });

  useSocketEvent<MonitorData['recent'][number]>('attendance:new', (ev) => {
    setLive((prev) => [ev, ...prev].slice(0, 12));
  });

  useEffect(() => {
    joinDashboard();
  }, []);

  const s = data?.stats;
  const feed = live.length ? live : data?.recent.slice(0, 12) || [];

  return (
    <div className="flex h-full flex-col bg-slate-950 p-6 text-white" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #134e4a33, transparent), #020617' }}>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{branding?.schoolName}</h1>
          <p className="text-sm uppercase tracking-[0.3em] text-teal-400">Kehadiran Hari Ini</p>
        </div>
        <Clock />
      </header>

      {/* Statistik besar */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <BigStat label="HADIR" value={`${s?.percent ?? 0}%`} color="#22c55e" />
        <BigStat label="TERLAMBAT" value={s?.late ?? 0} color="#f59e0b" />
        <BigStat label="IZIN / SAKIT" value={s?.excused ?? 0} color="#3b82f6" />
        <BigStat label="TIDAK HADIR" value={s?.absent ?? 0} color="#ef4444" />
        <BigStat label="BELUM HADIR" value={s?.notYet ?? 0} color="#94a3b8" />
      </div>

      {/* Kedatangan terbaru */}
      <div className="mt-6 flex-1 overflow-hidden">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-white/50">Kedatangan Terbaru</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {feed.map((r, i) => (
            <div key={`${r.id}-${i}`} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur animate-fade-in">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-extrabold" style={{ backgroundColor: `${STATUS_COLORS[r.status]}22`, color: STATUS_COLORS[r.status] }}>
                {r.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold">{r.name}</p>
                <p className="text-sm text-white/50">{r.className}{r.nis ? ` · ${r.nis}` : ''}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-xl font-extrabold" style={{ color: STATUS_COLORS[r.status] }}>{r.time}</p>
                <p className="text-xs" style={{ color: STATUS_COLORS[r.status] }}>{STATUS_LABELS[r.status]}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <footer className="mt-4 flex items-center justify-between text-xs text-white/40">
        <span>{branding?.appName} · Mode Monitoring</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> REALTIME</span>
      </footer>
    </div>
  );
}

function BigStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
      <p className="text-5xl font-extrabold tabular-nums" style={{ color }}>{value}</p>
      <p className="mt-1 text-xs font-bold uppercase tracking-widest text-white/50">{label}</p>
    </div>
  );
}
