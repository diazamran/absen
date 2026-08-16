import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock3, XCircle, ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, Badge } from '../../lib/ui';
import { STATUS_LABELS, timeLabel, greeting } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';

interface ChildToday {
  studentId: string; name: string; nis: string; className?: string | null;
  today: { checkIn?: { status: string; checkIn?: string | null } | null; checkOut?: { checkOut?: string | null } | null };
  monthStats: Record<string, number>;
}

export default function ParentHome() {
  const { user } = useAuth();
  const { branding } = useTheme();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-parent'],
    queryFn: () => api<{ success: boolean; data: { date: string; children: ChildToday[] } }>('/dashboard').then((r) => r.data),
  });

  if (isLoading || !data) return <div className="h-40 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-700/60" />;

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-gradient-to-br from-primary to-primary-dark p-5 text-white shadow-float">
        <p className="text-sm font-medium opacity-90">{greeting()},</p>
        <h1 className="text-2xl font-extrabold">{user?.fullName}</h1>
        <p className="mt-1 text-sm opacity-80">{data.date} · Kehadiran Anak</p>
      </div>

      {data.children.map((c) => {
        const checkIn = c.today.checkIn;
        const checkOut = c.today.checkOut;
        const status = checkIn?.status || 'ABSENT';
        return (
          <Card key={c.studentId} className="cursor-pointer" onClick={() => navigate('/app/children')}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${status === 'PRESENT' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' : status === 'LATE' ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-red-100 text-red-500 dark:bg-red-500/15'}`}>
                  {status === 'ABSENT' ? <XCircle className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
                </div>
                <div>
                  <p className="text-lg font-extrabold text-ink">{c.name}</p>
                  <p className="text-xs text-muted">{c.className} · {c.nis}</p>
                </div>
              </div>
              <Badge status={status} label={STATUS_LABELS[status]} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900/60">
                <p className="flex items-center gap-1.5 text-xs text-muted"><Clock3 className="h-3.5 w-3.5" /> Datang</p>
                <p className="mt-0.5 font-mono text-xl font-extrabold text-ink">{checkIn ? timeLabel(checkIn.checkIn) : '—'}</p>
                <p className="text-[11px] text-muted">{checkIn ? (checkIn.status === 'LATE' ? 'Terlambat' : 'Tepat waktu') : 'Belum hadir'}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900/60">
                <p className="flex items-center gap-1.5 text-xs text-muted"><Clock3 className="h-3.5 w-3.5" /> Pulang</p>
                <p className="mt-0.5 font-mono text-xl font-extrabold text-ink">{checkOut ? timeLabel(checkOut.checkOut) : '—'}</p>
                <p className="text-[11px] text-muted">Belum pulang</p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>Bulan ini: {Object.entries(c.monthStats).reduce((a, [, v]) => a + v, 0)} catatan</span>
              <span className="flex items-center gap-1 font-semibold text-primary">Detail <ArrowRight className="h-3.5 w-3.5" /></span>
            </div>
          </Card>
        );
      })}

      {data.children.length === 0 && (
        <Card className="py-10 text-center text-muted">Belum ada anak terhubung ke akun ini.</Card>
      )}
    </div>
  );
}
