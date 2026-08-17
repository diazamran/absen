import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { History as HistoryIcon, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Card, Badge, EmptyState, Select } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS, STATUS_COLORS, currentMonthKey, timeLabel } from '../../lib/format';

interface AttRow {
  id?: string; nis?: string | null; date: string; dayKey: string; checkIn?: string | null; checkOut?: string | null;
  status: string; method: string; lateMinutes: number; earlyLeave?: boolean; className?: string | null; name?: string | null;
}

function timeStr(v?: string | null): string {
  if (v && /^\d{2}:\d{2}$/.test(v)) return v;
  return timeLabel(v);
}

export default function History() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonthKey());

  // Admin / piket / wali kelas bisa menghapus bersih catatan absensi siswa
  const canDelete = ['ADMIN', 'SUPER_ADMIN', 'PIKET', 'HOMEROOM_TEACHER'].includes(user?.roleKey || '');
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/attendance/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Catatan absensi dihapus dari database.');
      qc.invalidateQueries({ queryKey: ['attendance-history'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus catatan.'),
  });

  // Orang tua melihat riwayat anak
  const isParent = user?.roleKey === 'PARENT';
  const { data: children } = useQuery({
    queryKey: ['dashboard-parent'],
    queryFn: () => api<{ success: boolean; data: { children: { studentId: string; name: string }[] } }>('/dashboard').then((r) => r.data),
    enabled: isParent,
  });
  const [childId, setChildId] = useState('');

  // Filter kelas: wali kelas / piket / admin bisa melihat semua kelas atau per kelas
  const canFilterClass = !isParent && ['ADMIN', 'SUPER_ADMIN', 'HEADMASTER', 'HOMEROOM_TEACHER', 'PIKET'].includes(user?.roleKey || '');
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data),
    enabled: canFilterClass,
  });
  const [classId, setClassId] = useState('');

  const studentId = isParent ? childId : undefined;

  const { data: rows } = useQuery({
    queryKey: ['attendance-history', month, studentId, classId],
    queryFn: async () => {
      if (isParent && !studentId) return [];
      if (isParent) {
        // riwayat per anak via endpoint siswa
        const res = await api<{ success: boolean; data: AttRow[] }>(`/attendance/student/${studentId}?month=${month}`);
        return res.data;
      }
      // diri sendiri: cari id siswa dari me
      const me = await api<{ success: boolean; data: { student?: { id: string } | null } }>('/auth/me');
      if (!me.data.student) {
        // guru/staff/wali/piket/admin: laporan bulanan (bisa difilter kelas)
        const res = await api<{ success: boolean; data: { rows: { id?: string; name: string; nis?: string | null; className?: string | null; date: string; time?: string | null; status: string; method: string; lateMinutes: number }[] } }>(
          `/reports/monthly?month=${month}${classId ? `&classId=${classId}` : ''}`,
        );
        return res.data.rows.map((r, i) => ({
          id: r.id ?? `${r.date}-${r.nis || r.name || i}`,
          nis: r.nis ?? null,
          date: r.date,
          dayKey: r.date,
          checkIn: r.time ?? null,
          checkOut: null,
          status: r.status,
          method: r.method,
          lateMinutes: r.lateMinutes,
          earlyLeave: false,
          className: r.className ?? null,
          name: r.name,
        }));
      }
      const res = await api<{ success: boolean; data: AttRow[] }>(`/attendance/student/${me.data.student.id}?month=${month}`);
      return res.data;
    },
  });

  const stats = (rows || []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="Riwayat Absensi"
        subtitle={month.replace('-', ' ')}
        action={
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900" />
        }
      />

      {isParent && (
        <div className="mb-4">
          <select value={childId} onChange={(e) => setChildId(e.target.value)} className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink dark:bg-slate-900 sm:w-64">
            <option value="">Pilih anak…</option>
            {children?.children.map((c) => <option key={c.studentId} value={c.studentId}>{c.name}</option>)}
          </select>
        </div>
      )}

      {canFilterClass && (
        <div className="mb-4">
          <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full sm:w-64">
            <option value="">Semua kelas</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
      )}

      {!isParent || childId ? (
        <>
          {/* Rekap bulan */}
          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <Card key={k} className="p-3 text-center">
                <p className="text-xl font-extrabold" style={{ color: STATUS_COLORS[k] }}>{stats[k] || 0}</p>
                <p className="text-[11px] text-muted">{label}</p>
              </Card>
            ))}
          </div>

          <div className="space-y-2">
            {rows?.map((r) => {
              const delId = canDelete ? r.id : undefined;
              return (
                <Card key={r.id || `${r.date}-${r.nis || r.name || 0}`} className="flex items-center gap-3 p-3.5">
                  <div className="flex flex-col items-center rounded-xl bg-slate-50 px-3 py-1.5 dark:bg-slate-900">
                    {/* dayKey bisa tidak ada pada laporan bulanan guru/staff — fallback ke date */}
                    <span className="text-sm font-bold text-ink">{(r.dayKey || r.date || '').slice(8)}</span>
                    <span className="text-[10px] uppercase text-muted">{(r.dayKey || r.date || '').slice(5, 7)}</span>
                  </div>
                  <div className="flex-1">
                    {r.name && <p className="text-sm font-bold text-ink">{r.name}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-ink">Masuk {timeStr(r.checkIn)}</span>
                      {r.checkOut && <span className="text-xs text-muted">Pulang {timeStr(r.checkOut)}</span>}
                      {r.earlyLeave && <Badge status="LATE" label="Pulang Awal" />}
                    </div>
                    <p className="text-xs text-muted">{r.className ? `Kelas ${r.className} · ` : ''}Metode: {r.method}</p>
                  </div>
                  <Badge status={r.status} label={r.status === 'LATE' && r.lateMinutes ? `Terlambat ${r.lateMinutes}m` : STATUS_LABELS[r.status]} />
                  {delId && (
                    <button
                      onClick={() => {
                        if (window.confirm(`Hapus PERMANEN catatan absen ${r.name || ''} (${(r.dayKey || r.date || '').slice(8)}/${(r.dayKey || r.date || '').slice(5, 7)}, Masuk ${timeStr(r.checkIn)})? Data akan terhapus bersih dari database dan tidak bisa dikembalikan.`)) deleteMutation.mutate(delId);
                      }}
                      className="rounded-xl p-2 text-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                      title="Hapus catatan absen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </Card>
              );
            })}
            {rows?.length === 0 && <EmptyState icon={HistoryIcon} title="Belum ada riwayat" description="Belum ada data absensi pada bulan ini." />}
          </div>
        </>
      ) : (
        <EmptyState icon={HistoryIcon} title="Pilih anak" description="Pilih anak Anda untuk melihat riwayat kehadiran." />
      )}
    </div>
  );
}
