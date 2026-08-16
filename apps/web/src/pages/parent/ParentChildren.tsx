import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { Baby } from 'lucide-react';
import { api } from '../../lib/api';
import { useNavigate } from 'react-router-dom';
import { Card, Segmented } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS, STATUS_COLORS, currentMonthKey, timeLabel } from '../../lib/format';

interface ChildDetail {
  studentId: string; name: string; nis: string; className?: string | null;
  today: { checkIn?: { checkIn?: string | null; status: string } | null; checkOut?: { checkOut?: string | null } | null };
  monthStats: Record<string, number>;
}

export default function ParentChildren() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string>('');
  const { data } = useQuery({
    queryKey: ['dashboard-parent'],
    queryFn: () => api<{ success: boolean; data: { children: ChildDetail[] } }>('/dashboard').then((r) => r.data),
  });

  const children = data?.children || [];
  const active = children.find((c) => c.studentId === selected) || children[0];

  const chartData = Object.entries(STATUS_LABELS)
    .map(([k, label]) => ({ name: label, value: active?.monthStats[k] || 0, color: STATUS_COLORS[k] }))
    .filter((c) => c.value > 0);

  return (
    <div>
      <PageHeader title="Anak" subtitle="Pantau kehadiran anak Anda" />
      {children.length > 1 && (
        <div className="mb-4">
          <Segmented
            value={active?.studentId || ''}
            onChange={setSelected}
            options={children.map((c) => ({ value: c.studentId, label: c.name.split(' ')[0] }))}
          />
        </div>
      )}

      {active ? (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-extrabold text-ink">{active.name}</p>
                <p className="text-sm text-muted">{active.className} · NISN {active.nis}</p>
              </div>
              <div className="rounded-2xl bg-primary-soft p-3 text-primary"><Baby className="h-6 w-6" /></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900/60">
                <p className="text-xs text-muted">Datang hari ini</p>
                <p className="font-mono text-2xl font-extrabold text-ink">{active.today.checkIn ? timeLabel(active.today.checkIn.checkIn) : '—'}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900/60">
                <p className="text-xs text-muted">Pulang hari ini</p>
                <p className="font-mono text-2xl font-extrabold text-ink">{active.today.checkOut ? timeLabel(active.today.checkOut.checkOut) : '—'}</p>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 font-bold text-ink">Rekap {currentMonthKey().replace('-', ' ')}</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 13 }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {chartData.map((c) => <Cell key={c.name} fill={c.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <button onClick={() => navigate('/app/history')} className="mt-2 w-full rounded-xl bg-primary-soft py-2.5 text-sm font-bold text-primary-dark">
              Lihat Riwayat Lengkap
            </button>
          </Card>
        </div>
      ) : (
        <Card className="py-10 text-center text-muted">Belum ada anak terhubung.</Card>
      )}
    </div>
  );
}
