import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Card, Button, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { useSocketEvent } from '../../lib/socket';
import { cn } from '../../lib/format';

interface NotifItem { id: string; title: string; body: string; readAt?: string | null; createdAt: string; }
interface NotifData { unread: number; items: NotifItem[]; }

export default function Notifications() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ success: boolean; data: NotifData }>('/notifications').then((r) => r.data),
    refetchInterval: 30_000,
  });

  useSocketEvent<unknown>('notification:new', () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
  });

  const readAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readOne = useMutation({
    mutationFn: (id: string) => api(`/notifications/read/${id}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div>
      <PageHeader
        title="Notifikasi"
        subtitle={data?.unread ? `${data.unread} belum dibaca` : 'Semua sudah dibaca'}
        action={data?.unread ? <Button variant="outline" onClick={() => readAll.mutate()}><CheckCheck className="h-4 w-4" /> Tandai dibaca</Button> : undefined}
      />
      <div className="space-y-2">
        {data?.items.map((n) => (
          <Card
            key={n.id}
            className={cn('cursor-pointer', !n.readAt && 'border-primary/40 bg-primary-soft/40')}
            onClick={() => !n.readAt && readOne.mutate(n.id)}
          >
            <div className="flex items-start gap-3">
              <div className={cn('rounded-xl p-2.5', n.readAt ? 'bg-slate-100 text-muted dark:bg-slate-700' : 'bg-primary text-white')}>
                <Bell className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink">{n.title}</p>
                <p className="text-sm text-muted">{n.body}</p>
                <p className="mt-1 text-xs text-muted/70">
                  {new Date(n.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })}
                </p>
              </div>
              {!n.readAt && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
            </div>
          </Card>
        ))}
        {data?.items.length === 0 && (
          <EmptyState
            icon={Bell}
            title="Belum ada notifikasi"
            description={user?.roleKey === 'STUDENT' ? 'Notifikasi absensi murid akan muncul di sini.' : 'Notifikasi absensi anak/guru akan muncul di sini.'}
          />
        )}
      </div>
    </div>
  );
}
