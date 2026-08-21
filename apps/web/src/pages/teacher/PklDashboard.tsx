import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Clock, MapPin, Users, Loader2, Calendar, BarChart3 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Card, Badge, Skeleton } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS } from '../../lib/format';
import { Segmented } from '../../lib/ui';

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

export default function PklDashboard() {
  const { user } = useAuth();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const { data: students, isLoading } = useQuery({
    queryKey: ['pkl-supervisor', user?.id],
    queryFn: () => api<{ success: boolean; data: SupervisedStudent[] }>(`/pkl/supervisor/${user!.id}`).then((r) => r.data),
    enabled: !!user,
  });

  const { data: rekap, isLoading: rekapLoading } = useQuery({
    queryKey: ['pkl-rekap', user?.id, month],
    queryFn: () => api<{ success: boolean; data: RekapItem[] }>(`/pkl/supervisor/${user!.id}/rekap?month=${month}`).then((r) => r.data),
    enabled: !!user,
  });

  const present = students?.filter((s) => s.todayAttendance.status === 'PRESENT' || s.todayAttendance.status === 'LATE').length ?? 0;
  const notYet = students?.filter((s) => s.todayAttendance.status === 'NOT_YET' || s.todayAttendance.status === 'ABSENT').length ?? 0;

  return (
    <div>
      <PageHeader title="Monitor PKL" subtitle="Pantau kehadiran siswa bimbingan PKL hari ini" />

      {/* Stats */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Card className="p-3 text-center">
          <p className="text-2xl font-extrabold text-emerald-500">{students ? present : '-'}</p>
          <p className="text-xs text-muted">Hadir</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-extrabold text-amber-500">{students ? notYet : '-'}</p>
          <p className="text-xs text-muted">Belum Absen</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-extrabold text-primary">{students?.length ?? '-'}</p>
          <p className="text-xs text-muted">Total Siswa</p>
        </Card>
      </div>

      {/* Today list */}
      <Card className="mb-4">
        <p className="mb-3 font-bold text-ink">📍 Kehadiran Hari Ini</p>
        {isLoading && <Skeleton className="h-24 w-full" />}
        {!isLoading && students && students.length === 0 && (
          <p className="py-4 text-center text-sm text-muted">Belum ada siswa PKL yang ditugaskan.</p>
        )}
        {!isLoading && students && students.map((s) => (
          <div key={s.assignmentId} className="flex items-center gap-3 rounded-xl border border-line/60 bg-surface p-3 mb-2 last:mb-0 dark:bg-slate-800/50">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              s.todayAttendance.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-600' :
              s.todayAttendance.status === 'LATE' ? 'bg-amber-100 text-amber-600' :
              'bg-slate-100 text-slate-400'
            }`}>
              {s.todayAttendance.status === 'PRESENT' || s.todayAttendance.status === 'LATE'
                ? <CheckCircle2 className="h-5 w-5" />
                : <Clock className="h-5 w-5" />
              }
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-ink">{s.fullName}</p>
              <p className="text-xs text-muted">{s.className ?? '-'} · {s.location.name}</p>
            </div>
            <div className="text-right">
              {s.todayAttendance.checkIn ? (
                <>
                  <p className="text-sm font-bold text-ink">{s.todayAttendance.checkIn}</p>
                  {s.todayAttendance.checkOut && <p className="text-xs text-muted">↑ {s.todayAttendance.checkOut}</p>}
                </>
              ) : (
                <p className="text-xs font-semibold text-amber-500">Belum absen</p>
              )}
              <Badge status={s.todayAttendance.status as never} label={STATUS_LABELS[s.todayAttendance.status as keyof typeof STATUS_LABELS] ?? s.todayAttendance.status} />
            </div>
          </div>
        ))}
      </Card>

      {/* Rekap bulanan */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-bold text-ink">📊 Rekap Bulanan</p>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" />
        </div>
        {rekapLoading && <Skeleton className="h-24 w-full" />}
        {!rekapLoading && rekap && rekap.length === 0 && (
          <p className="py-4 text-center text-sm text-muted">Belum ada data rekap.</p>
        )}
        {!rekapLoading && rekap && rekap.map((r) => (
          <div key={r.studentId} className="rounded-xl border border-line/60 bg-surface p-3 mb-2 last:mb-0 dark:bg-slate-800/50">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-ink">{r.fullName}</p>
                <p className="text-xs text-muted">{r.className ?? '-'} · {r.locationName}</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-bold text-emerald-600">H: {r.present}</span>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-600">T: {r.late}</span>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 font-bold text-blue-600">S: {r.sick}</span>
              <span className="rounded-full bg-purple-50 px-2 py-0.5 font-bold text-purple-600">I: {r.excused}</span>
              <span className="rounded-full bg-red-50 px-2 py-0.5 font-bold text-red-600">A: {r.absent}</span>
              <span className="text-muted">Total: {r.totalDays} hari</span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
