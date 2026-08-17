import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  FilePlus2, FileText, ScanLine, BookOpen, ClipboardList, Camera, History, Clock3, CheckCircle2, XCircle, CalendarDays, MapPin, ShieldCheck, ScanFace, BarChart3, ClipboardCheck,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Card, Button, Badge } from '../../lib/ui';
import { greeting, STATUS_LABELS } from '../../lib/format';
import AdminDashboard from '../admin/AdminDashboard';

interface HomeData {
  role: string;
  date: string;
  myAttendance: {
    checkIn: { status: string; statusLabel: string; time: string | null; lateMinutes: number } | null;
    checkOut: { time: string | null } | null;
  } | null;
  schedules: { id: string; subject: string; className: string; classId: string; startTime: string; endTime: string; room: string | null }[];
  myClass?: { id: string; name: string; studentCount: number } | null;
  student?: { id: string; nis: string; className: string | null } | null;
  attendanceRules?: { lateAfterHour: number; lateAfterMinute: number };
}

export default function TeacherHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', user?.roleKey],
    queryFn: () => api<{ success: boolean; data: HomeData }>('/dashboard').then((r) => r.data),
  });

  const isStudent = user?.roleKey === 'STUDENT';
  const isParent = user?.roleKey === 'PARENT';
  const isPiket = user?.roleKey === 'PIKET';
  const isTeacher = user?.roleKey === 'TEACHER';
  const isHomeroom = user?.roleKey === 'HOMEROOM_TEACHER';

  const menu = isStudent
    ? [
        { label: 'Registrasi Wajah', icon: <ScanFace className="h-6 w-6" />, to: '/app/face-me' },
        { label: 'Absen Wajah', icon: <Camera className="h-6 w-6" />, to: '/app/absent/face' },
        { label: 'QR Saya', icon: <ScanLine className="h-6 w-6" />, to: '/app/absent/qr' },
        { label: 'Ajukan Izin', icon: <FilePlus2 className="h-6 w-6" />, to: '/app/leave/mine' },
        { label: 'Riwayat', icon: <History className="h-6 w-6" />, to: '/app/history' },
      ]
    : isPiket
      ? [
          { label: 'Scan Gerbang', icon: <ScanLine className="h-6 w-6" />, to: '/app/gate' },
          { label: 'Absen Manual', icon: <ClipboardCheck className="h-6 w-6" />, to: '/app/attendance' },
          { label: 'Persetujuan Izin', icon: <FileText className="h-6 w-6" />, to: '/app/leave' },
          { label: 'Riwayat', icon: <History className="h-6 w-6" />, to: '/app/history' },
        ]
      : isHomeroom
        ? [
            // Wali kelas: persetujuan izin + laporan kelasnya, tanpa Absen
            { label: 'Persetujuan Izin', icon: <FileText className="h-6 w-6" />, to: '/app/leave' },
            { label: 'Jurnal Mengajar', icon: <BookOpen className="h-6 w-6" />, to: '/app/journal' },
            { label: 'Kelas', icon: <ClipboardList className="h-6 w-6" />, to: '/app/classes' },
            { label: 'Laporan', icon: <BarChart3 className="h-6 w-6" />, to: '/app/reports' },
            { label: 'Riwayat', icon: <History className="h-6 w-6" />, to: '/app/history' },
          ]
        : [
            // Guru: tanpa Ajukan Izin & Absen (cukup jurnal, kelas, riwayat)
            ...(isTeacher
              ? []
              : [
                  { label: 'Ajukan Izin', icon: <FilePlus2 className="h-6 w-6" />, to: '/app/leave/mine' },
                  { label: 'Absen', icon: <Camera className="h-6 w-6" />, to: '/app/absent' },
                ]),
            { label: 'Jurnal Mengajar', icon: <BookOpen className="h-6 w-6" />, to: '/app/journal' },
            { label: 'Kelas', icon: <ClipboardList className="h-6 w-6" />, to: '/app/classes' },
            { label: 'Riwayat', icon: <History className="h-6 w-6" />, to: '/app/history' },
          ];

  const quickAction = async () => {
    toast('info', 'Buka halaman Absen untuk memilih metode.');
    navigate(isStudent ? '/app/absent' : isPiket ? '/app/gate' : '/app/absent');
  };

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-700/60" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-700/60" />)}
        </div>
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-700/60" />
      </div>
    );
  }

  const att = data.myAttendance;

  return (
    <div className="space-y-5">
      {/* Sambutan — 3 baris: sapaan, nama lengkap, kelas/jabatan (kecil) */}
      <div className="rounded-3xl bg-gradient-to-br from-primary to-primary-dark p-5 text-white shadow-float">
        <p className="text-sm font-medium opacity-90">{greeting()},</p>
        <h1 className="text-2xl font-extrabold">{user?.fullName}</h1>
        {isStudent ? (
          data.student?.className && <p className="mt-1 text-sm font-medium opacity-80">{data.student.className}</p>
        ) : (
          <p className="mt-1 text-sm font-medium opacity-80">{user?.roleName}</p>
        )}
        {data.myClass && (
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/15 px-4 py-3 backdrop-blur">
            <div>
              <p className="text-xs opacity-80">Wali Kelas</p>
              <p className="font-bold">{data.myClass.name}</p>
            </div>
            <span className="text-sm font-semibold">{data.myClass.studentCount} siswa</span>
          </div>
        )}
      </div>

      {/* Petugas piket */}
      {isPiket && (
        <Card className="flex items-center justify-between gap-3 border-amber-200 bg-amber-50/70 dark:bg-amber-500/10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-ink">Kamu petugas piket hari ini</p>
              <p className="text-sm text-muted">Buka Scan Gerbang untuk absen otomatis (wajah / QR / kartu) atau gunakan Absen Manual untuk koreksi.</p>
            </div>
          </div>
          <Button className="shrink-0" onClick={() => navigate('/app/gate')}>
            <ScanLine className="h-4 w-4" /> Buka Gerbang
          </Button>
        </Card>
      )}

      {/* Kehadiran saya — khusus siswa; guru/petugas piket tidak memerlukan kartu ini */}
      {isStudent && (
        <Card className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${att?.checkIn ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-700'}`}>
              {att?.checkIn ? <CheckCircle2 className="h-7 w-7" /> : <Clock3 className="h-7 w-7" />}
            </div>
            <div>
              <p className="text-xs font-medium text-muted">Kehadiran Saya</p>
              <p className="font-mono text-3xl font-extrabold leading-none text-ink">{att?.checkIn?.time || '--:--'}</p>
              <p className="mt-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                {att?.checkIn ? (att.checkIn.status === 'LATE' ? `Terlambat ${att.checkIn.lateMinutes} menit` : 'Hadir tepat waktu') : 'Belum absen'}
              </p>
            </div>
          </div>
          <Button variant="secondary" onClick={quickAction} className="shrink-0">
            <Camera className="h-4 w-4" /> Absen
          </Button>
        </Card>
      )}

      {/* Menu grid */}
      <div className="grid grid-cols-3 gap-3">
        {menu.map((m) => (
          <button key={m.label} onClick={() => navigate(m.to)} className="flex flex-col items-center gap-2 rounded-2xl border border-line/60 bg-surface p-4 shadow-card transition-transform active:scale-95 dark:bg-slate-800/70">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              {m.icon}
            </div>
            <span className="text-center text-xs font-semibold text-ink">{m.label}</span>
          </button>
        ))}
      </div>

      {/* Dashboard petugas piket — ala admin: statistik seluruh sekolah, tanpa Sesi Mengajar */}
      {isPiket && <AdminDashboard />}

      {/* Sesi mengajar — khusus guru/wali kelas (petugas piket tidak memerlukannya) */}
      {!isPiket && !isStudent && !isParent && (
      <div>
        <h2 className="mb-3 font-bold text-ink">Sesi Mengajar</h2>
        {data.schedules.length === 0 ? (
          <Card className="flex flex-col items-center py-8 text-muted">
            <CalendarDays className="mb-2 h-8 w-8 opacity-40" />
            <p className="text-sm">Tidak ada sesi hari ini</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {data.schedules.map((s) => (
              <Card key={s.id} className="flex items-center gap-4">
                <div className="flex flex-col items-center rounded-xl bg-primary-soft px-3 py-2 text-primary-dark">
                  <span className="font-mono text-sm font-bold">{s.startTime}</span>
                  <span className="text-[10px] opacity-70">{s.endTime}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink">{s.subject}</p>
                  <p className="text-xs text-muted">{s.className} · {s.room || '—'}</p>
                </div>
                <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => navigate(`/app/class/${s.classId}`)}>
                  Validasi
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
      )}

      {isParent && (
        <Card className="flex items-center gap-3 border-amber-200 bg-amber-50 dark:bg-amber-500/10">
          <XCircle className="h-5 w-5 text-amber-500" />
          <p className="text-sm text-amber-700 dark:text-amber-300">Dashboard orang tua tersedia di tab "Anak".</p>
        </Card>
      )}
    </div>
  );
}
