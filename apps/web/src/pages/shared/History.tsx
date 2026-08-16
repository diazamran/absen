import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History as HistoryIcon } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Card, Badge, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS, STATUS_COLORS, currentMonthKey, timeLabel } from '../../lib/format';

interface AttRow {
  id: string; date: string; dayKey: string; checkIn?: string | null; checkOut?: string | null;
  status: string; method: string; lateMinutes: number; earlyLeave?: boolean;
}

export default function History() {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonthKey());

  // Orang tua melihat riwayat anak
  const isParent = user?.roleKey === 'PARENT';
  const { data: children } = useQuery({
    queryKey: ['dashboard-parent'],
    queryFn: () => api<{ success: boolean; data: { children: { studentId: string; name: string }[] } }>('/dashboard').then((r) => r.data),
    enabled: isParent,
  });
  const [childId, setChildId] = useState('');

  const studentId = isParent ? childId : undefined;

  const { data: rows } = useQuery({
    queryKey: ['attendance-history', month, studentId],
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
        // guru/staff: pakai laporan bulanan filter user — fallback: kosong dengan pesan
        const res = await api<{ success: boolean; data: { rows: AttRow[] } }>(`/reports/monthly?month=${month}`);
        return res.data.rows;
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
            {rows?.map((r) => (
              <Card key={r.id} className="flex items-center gap-3 p-3.5">
                <div className="flex flex-col items-center rounded-xl bg-slate-50 px-3 py-1.5 dark:bg-slate-900">
                  <span className="text-sm font-bold text-ink">{r.dayKey.slice(8)}</span>
                  <span className="text-[10px] uppercase text-muted">{r.dayKey.slice(5, 7)}</span>
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-ink">Masuk {timeLabel(r.checkIn)}</span>
                    {r.checkOut && <span className="text-xs text-muted">Pulang {timeLabel(r.checkOut)}</span>}
                    {r.earlyLeave && <Badge status="LATE" label="Pulang Awal" />}
                  </div>
                  <p className="text-xs text-muted">Metode: {r.method}</p>
                </div>
                <Badge status={r.status} label={r.status === 'LATE' && r.lateMinutes ? `Terlambat ${r.lateMinutes}m` : STATUS_LABELS[r.status]} />
              </Card>
            ))}
            {rows?.length === 0 && <EmptyState icon={HistoryIcon} title="Belum ada riwayat" description="Belum ada data absensi pada bulan ini." />}
          </div>
        </>
      ) : (
        <EmptyState icon={HistoryIcon} title="Pilih anak" description="Pilih anak Anda untuk melihat riwayat kehadiran." />
      )}
    </div>
  );
}
