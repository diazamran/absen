import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Smartphone, Ban, CircleCheck, Search, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Card, Badge, Button, Input, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';

interface DeviceRow {
  deviceId: string; name: string; browser?: string | null; os?: string | null; ip?: string | null;
  lastSeenAt?: string | null; status: string; userName?: string | null;
}

export default function Devices() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () => api<{ success: boolean; data: DeviceRow[] }>('/devices').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const shown = (devices || []).filter((d) => {
    if (filter !== 'ALL' && d.status !== filter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.name?.toLowerCase().includes(q) ||
      d.userName?.toLowerCase().includes(q) ||
      d.deviceId.toLowerCase().includes(q) ||
      d.ip?.toLowerCase().includes(q)
    );
  });

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((prev) => (shown.length && prev.size === shown.length ? new Set() : new Set(shown.map((d) => d.deviceId))));

  const action = useMutation({
    mutationFn: ({ id, block }: { id: string; block: boolean }) => api(`/devices/${id}/${block ? 'block' : 'unblock'}`, { method: 'POST' }),
    onSuccess: (_d, v) => {
      toast('success', v.block ? 'Perangkat diblokir.' : 'Perangkat diaktifkan kembali.');
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/devices/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Perangkat dihapus (akan terdaftar ulang saat login berikutnya).');
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });

  const bulkRemove = useMutation({
    mutationFn: async () => {
      for (const id of selected) await api(`/devices/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast('success', `${selected.size} perangkat dihapus.`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });

  return (
    <div>
      <PageHeader title="Perangkat" subtitle="HP/komputer yang pernah login ke aplikasi" />

      <Card className="mb-4 border-primary/30 bg-primary-soft/40 p-3.5 text-xs leading-relaxed text-muted">
        Setiap HP/komputer <b>terdaftar otomatis</b> saat login. Menu ini untuk: memblokir HP yang hilang/dicuri (tidak bisa dipakai login),
        menghapus perangkat lama, atau merapikan daftar. <b>Tidak memperlambat server</b> — 1000+ perangkat hanya sekadar baris data kecil.
      </Card>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="pl-10" placeholder="Cari nama / user / ID / IP…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink dark:bg-slate-900 sm:w-40">
          <option value="ALL">Semua status</option>
          <option value="ONLINE">Online</option>
          <option value="OFFLINE">Offline</option>
          <option value="BLOCKED">Diblokir</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50/60 px-4 py-2.5 dark:bg-red-500/10">
          <p className="text-sm font-semibold text-red-600">{selected.size} perangkat dipilih</p>
          <Button
            variant="danger"
            className="ml-auto !px-3 !py-1.5 text-xs"
            onClick={() => window.confirm(`Hapus ${selected.size} perangkat terpilih?`) && bulkRemove.mutate()}
            disabled={bulkRemove.isPending}
          >
            {bulkRemove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Hapus Terpilih
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {shown.map((d) => (
          <Card key={d.deviceId} className={`flex items-center gap-3 p-3 ${selected.has(d.deviceId) ? 'border-primary ring-2 ring-primary/20' : ''}`}>
            <input type="checkbox" checked={selected.has(d.deviceId)} onChange={() => toggle(d.deviceId)} className="h-4 w-4 shrink-0 accent-[var(--primary)]" />
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-ink">{d.name} {d.userName ? <span className="font-normal text-muted">· {d.userName}</span> : null}</p>
              <p className="truncate text-xs text-muted">
                {d.browser || '?'} · {d.os || '?'} · {d.ip || '—'} · {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' }) : '—'}
              </p>
              <p className="truncate font-mono text-[10px] text-muted/70">{d.deviceId}</p>
            </div>
            <Badge status={d.status} label={d.status === 'BLOCKED' ? 'Diblokir' : d.status} />
            <div className="flex shrink-0 items-center gap-1">
              {d.status !== 'BLOCKED' ? (
                <button onClick={() => action.mutate({ id: d.deviceId, block: true })} className="rounded-xl p-2 text-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10" title="Blokir">
                  <Ban className="h-4 w-4" />
                </button>
              ) : (
                <button onClick={() => action.mutate({ id: d.deviceId, block: false })} className="rounded-xl p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10" title="Aktifkan kembali">
                  <CircleCheck className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => window.confirm(`Hapus perangkat "${d.name}"? Perangkat akan terdaftar ulang saat login berikutnya.`) && remove.mutate(d.deviceId)}
                className="rounded-xl p-2 text-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                title="Hapus / reset perangkat"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </Card>
        ))}
        {shown.length === 0 && <EmptyState icon={Smartphone} title="Tidak ada perangkat" description={search || filter !== 'ALL' ? 'Coba ubah kata kunci atau filter.' : 'Perangkat akan terdaftar otomatis saat login.'} />}
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
        <RefreshCw className="h-3.5 w-3.5" /> Daftar diperbarui otomatis setiap 30 detik · total terdaftar: {devices?.length || 0}
      </p>
    </div>
  );
}
