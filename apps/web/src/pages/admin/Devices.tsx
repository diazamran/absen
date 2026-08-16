import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Smartphone, Ban, CircleCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Card, Badge, Button, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';

interface DeviceRow {
  deviceId: string; name: string; browser?: string | null; os?: string | null; ip?: string | null;
  lastSeenAt?: string | null; status: string; userName?: string | null;
}

export default function Devices() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () => api<{ success: boolean; data: DeviceRow[] }>('/devices').then((r) => r.data),
    refetchInterval: 15_000,
  });

  const action = useMutation({
    mutationFn: ({ id, block }: { id: string; block: boolean }) => api(`/devices/${id}/${block ? 'block' : 'unblock'}`, { method: 'POST' }),
    onSuccess: (_d, v) => {
      toast('success', v.block ? 'Perangkat diblokir.' : 'Perangkat diaktifkan kembali.');
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });

  return (
    <div>
      <PageHeader title="Perangkat" subtitle="Kelola perangkat yang terhubung" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {devices?.map((d) => (
          <Card key={d.deviceId}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-primary-soft p-2.5 text-primary"><Smartphone className="h-5 w-5" /></div>
                <div>
                  <p className="font-bold text-ink">{d.name}</p>
                  <p className="text-xs text-muted">{d.browser || '?'} · {d.os || '?'} · {d.ip || '—'}</p>
                </div>
              </div>
              <Badge status={d.status} label={d.status} />
            </div>
            <p className="mt-2 truncate text-xs text-muted">Device ID: {d.deviceId}</p>
            <p className="text-xs text-muted">User: {d.userName || '—'} · Terakhir aktif: {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' }) : '—'}</p>
            {d.status !== 'BLOCKED' ? (
              <Button variant="danger" className="mt-3 w-full" onClick={() => action.mutate({ id: d.deviceId, block: true })}>
                <Ban className="h-4 w-4" /> Blokir
              </Button>
            ) : (
              <Button variant="outline" className="mt-3 w-full" onClick={() => action.mutate({ id: d.deviceId, block: false })}>
                <CircleCheck className="h-4 w-4" /> Aktifkan kembali
              </Button>
            )}
          </Card>
        ))}
        {devices?.length === 0 && <div className="sm:col-span-2 lg:col-span-3"><EmptyState icon={Smartphone} title="Belum ada perangkat" description="Perangkat akan terdaftar otomatis saat login dari HP/komputer." /></div>}
      </div>
    </div>
  );
}
