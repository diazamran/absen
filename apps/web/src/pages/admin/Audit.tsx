import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, Input, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';

interface AuditRow {
  id: string; action: string; entity?: string | null; entityId?: string | null;
  ipAddress?: string | null; userName?: string | null; createdAt: string;
  oldValue?: unknown; newValue?: unknown;
}

export default function Audit() {
  const [search, setSearch] = useState('');
  const { data: page } = useQuery({
    queryKey: ['audit', search],
    queryFn: () => api<{ success: boolean; data: AuditRow[]; meta: { total: number } }>(`/audit?action=${encodeURIComponent(search)}&pageSize=50`),
  });

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Semua aktivitas penting tercatat di sini" />
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input className="pl-10" placeholder="Filter aksi (mis. ATTENDANCE_CREATED)" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="space-y-2">
        {page?.data.map((a) => (
          <Card key={a.id} className="flex items-start gap-3 p-3.5">
            <div className="rounded-xl bg-primary-soft p-2 text-primary"><ScrollText className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-bold text-ink">{a.action}</p>
              <p className="text-xs text-muted">
                {a.userName || 'Sistem'} · {a.entity}{a.entityId ? ` #${a.entityId}` : ''} · {a.ipAddress || '—'}
              </p>
              {a.newValue != null && <pre className="mt-1 max-h-24 overflow-auto rounded-lg bg-slate-50 p-2 text-[10px] text-muted dark:bg-slate-900">{JSON.stringify(a.newValue, null, 1) ?? ''}</pre>}
            </div>
            <span className="shrink-0 text-xs text-muted">{new Date(a.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })}</span>
          </Card>
        ))}
        {page?.data.length === 0 && <EmptyState icon={Search} title="Tidak ada catatan" description="Aktivitas sistem akan dicatat otomatis." />}
      </div>
    </div>
  );
}
