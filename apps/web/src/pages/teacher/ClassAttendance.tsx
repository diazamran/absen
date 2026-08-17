import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserRound, CheckCircle2, Clock3, FileQuestion, UserX } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Card, Badge, Button, BottomSheet, Segmented, EmptyState, StatCard } from '../../lib/ui';
import { STATUS_LABELS, STATUS_COLORS, timeLabel, todayJakartaKey } from '../../lib/format';

interface StudentRow {
  studentId: string; name: string; nis: string; status: string;
  checkIn?: string | null; checkOut?: string | null; lateMinutes: number; method?: string | null;
}

const STATUS_OPTIONS = ['PRESENT', 'LATE', 'EXCUSED', 'SICK', 'OFFICIAL_DUTY', 'ABSENT'];

export default function ClassAttendance() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'all' | 'present' | 'absent'>('all');
  const [selected, setSelected] = useState<StudentRow | null>(null);
  const [date, setDate] = useState(todayJakartaKey());

  const { data: klass, isLoading } = useQuery({
    queryKey: ['attendance-class', id, date],
    queryFn: () => api<{ success: boolean; data: StudentRow[] }>(`/attendance/class/${id}?date=${date}`).then((r) => r.data),
  });
  const { data: classInfo } = useQuery({
    queryKey: ['class-info', id],
    queryFn: () =>
      api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data.find((c) => c.id === id)),
  });

  const mutation = useMutation({
    mutationFn: (payload: { studentId: string; status: string }) =>
      api('/attendance/manual', { method: 'POST', body: { ...payload, date } }),
    onSuccess: () => {
      toast('success', 'Status kehadiran diperbarui.');
      qc.invalidateQueries({ queryKey: ['attendance-class'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setSelected(null);
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  const stats = useMemo(() => {
    const list = klass ?? [];
    const excusedSet = new Set(['EXCUSED', 'SICK', 'OFFICIAL_DUTY', 'DISPENSATION', 'LEAVE']);
    return {
      present: list.filter((s) => s.status === 'PRESENT').length,
      late: list.filter((s) => s.status === 'LATE').length,
      excused: list.filter((s) => excusedSet.has(s.status)).length,
      absent: list.filter((s) => s.status === 'ABSENT').length,
    };
  }, [klass]);

  const filtered = klass?.filter((s) => (tab === 'present' ? s.status !== 'ABSENT' : tab === 'absent' ? s.status === 'ABSENT' : true));

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="rounded-xl p-2 text-muted hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowLeft className="h-5 w-5" /></button>
        <div>
          <h1 className="text-xl font-bold text-ink">{classInfo?.name || 'Kelas'}</h1>
          <p className="text-sm text-muted">Validasi kehadiran · {date}</p>
        </div>
      </div>

      {/* Ringkasan statistik kelas */}
      {!isLoading && klass && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Hadir" value={stats.present} icon={CheckCircle2} color="#22c55e" />
          <StatCard label="Terlambat" value={stats.late} icon={Clock3} color="#f59e0b" />
          <StatCard label="Izin / Sakit" value={stats.excused} icon={FileQuestion} color="#3b82f6" />
          <StatCard label="Belum" value={stats.absent} icon={UserX} color="#64748b" />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'Semua' },
            { value: 'present', label: 'Hadir' },
            { value: 'absent', label: 'Belum' },
          ]}
        />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900" />
      </div>

      <div className="space-y-2">
        {filtered?.map((s) => (
          <Card key={s.studentId} className="flex cursor-pointer items-center gap-3 p-3.5" onClick={() => setSelected(s)}>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-ink">{s.name}</p>
              <p className="text-xs text-muted">{s.nis} · {s.checkIn ? `Datang ${s.checkIn}` : 'Belum datang'}{s.checkOut ? ` · Pulang ${s.checkOut}` : ''}</p>
            </div>
            <Badge status={s.status} label={s.status === 'LATE' && s.lateMinutes ? `Terlambat ${s.lateMinutes}m` : STATUS_LABELS[s.status]} />
          </Card>
        ))}
        {filtered?.length === 0 && <EmptyState icon={UserRound} title="Tidak ada siswa" />}
      </div>

      {/* Bottom sheet: ubah status */}
      <BottomSheet open={!!selected} onClose={() => setSelected(null)} title={selected?.name}>
        <p className="mb-3 text-sm text-muted">NISN {selected?.nis} · Pilih status kehadiran:</p>
        <div className="grid grid-cols-2 gap-2">
          {STATUS_OPTIONS.map((st) => (
            <button
              key={st}
              onClick={() => mutation.mutate({ studentId: selected!.studentId, status: st })}
              className="flex items-center justify-between rounded-xl border border-line px-3.5 py-3 text-sm font-semibold text-ink hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[st] }} />
                {STATUS_LABELS[st]}
              </span>
              {selected?.status === st && '✓'}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Perubahan tercatat di Audit Log.</p>
      </BottomSheet>
    </div>
  );
}
