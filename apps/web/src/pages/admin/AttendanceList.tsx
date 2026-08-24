import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ScanLine, Search, ClipboardEdit, Filter, Pencil, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Card, Input, Select, Button, Badge, Modal, Field, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS, METHOD_LABELS } from '../../lib/format';

interface AttRow {
  id: string; name: string; nis: string | null; className: string | null; time: string | null;
  checkOut?: string | null; status: string; method: string; lateMinutes: number;
}

export default function AttendanceList() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canDelete = user?.roles?.includes('SUPER_ADMIN') || user?.roleKey === 'SUPER_ADMIN';
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [editing, setEditing] = useState<AttRow | null>(null);

  const { data: rows } = useQuery({
    queryKey: ['attendance-today', classId, status],
    queryFn: () => api<{ success: boolean; data: AttRow[] }>(`/attendance/today?classId=${classId}&status=${status}`).then((r) => r.data),
    refetchInterval: 15_000,
  });
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data),
  });

  const editMutation = useMutation({
    mutationFn: (payload: { id: string; status: string; checkIn?: string; checkOut?: string; notes?: string }) =>
      api(`/attendance/${payload.id}`, {
        method: 'PATCH',
        body: {
          status: payload.status,
          checkIn: payload.checkIn || undefined,
          checkOut: payload.checkOut || undefined,
          notes: payload.notes || undefined,
        },
      }),
    onSuccess: () => {
      toast('success', 'Catatan absensi diperbarui.');
      qc.invalidateQueries({ queryKey: ['attendance-today'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['attendance-history'] });
      setEditing(null);
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan perubahan.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/attendance/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Catatan absensi dihapus dari database.');
      qc.invalidateQueries({ queryKey: ['attendance-today'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['attendance-history'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus catatan.'),
  });

  return (
    <div>
      <PageHeader
        title="Absensi Hari Ini"
        subtitle="Data kehadiran realtime — klik ikon pensil untuk koreksi status/jam siswa"
        action={<Button onClick={() => setManualOpen(true)}><ClipboardEdit className="h-4 w-4" /> Absen Manual</Button>}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari siswa / NISN…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-muted"><Filter className="h-4 w-4" /> Filter:</div>
        <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="sm:w-44">
          <option value="">Semua kelas</option>
          {classes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-40">
          <option value="">Semua status</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>

      <div className="space-y-2">
        {(rows || [])
          .filter((r) => {
            const term = q.trim().toLowerCase();
            if (!term) return true;
            return r.name.toLowerCase().includes(term) || (r.nis || '').toLowerCase().includes(term);
          })
          .map((r) => (
          <Card key={r.id} className="flex items-center gap-3 p-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary">
              <ScanLine className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-ink">{r.name}</p>
              <p className="text-xs text-muted">{r.className} · {r.nis} · {METHOD_LABELS[r.method] || r.method}</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-sm font-bold text-ink">{r.time || '—'}</p>
              <Badge status={r.status} label={r.status === 'LATE' ? `Terlambat ${r.lateMinutes}m` : STATUS_LABELS[r.status]} />
            </div>
            <button
              onClick={() => setEditing(r)}
              className="rounded-xl p-2 text-muted transition-colors hover:bg-primary-soft hover:text-primary"
              title="Koreksi absen siswa"
            >
              <Pencil className="h-4 w-4" />
            </button>
            {canDelete && (
              <button
                onClick={() => {
                  if (window.confirm(`Hapus PERMANEN catatan absen ${r.name} (${r.time || '-'})? Data akan terhapus bersih dari database dan tidak bisa dikembalikan.`)) deleteMutation.mutate(r.id);
                }}
                className="rounded-xl p-2 text-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                title="Hapus catatan absen"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </Card>
        ))}
        {rows && rows.length === 0 && (
          <EmptyState icon={Search} title="Belum ada data absensi" description="Data akan muncul saat siswa mulai absen." />
        )}
        {rows && rows.length > 0 && q.trim() && (rows || []).filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()) || (r.nis || '').includes(q.trim())).length === 0 && (
          <EmptyState icon={Search} title="Siswa tidak ditemukan" description={`Tidak ada siswa dengan nama/NISN "${q.trim()}" pada daftar hari ini. Coba klik Absen Manual untuk mencari semua siswa.`} />
        )}
      </div>

      {manualOpen && <ManualForm onClose={() => setManualOpen(false)} />}
      {editing && (
        <EditForm
          row={editing}
          onClose={() => setEditing(null)}
          onSave={(payload) => editMutation.mutate({ id: editing.id, ...payload })}
          saving={editMutation.isPending}
        />
      )}
    </div>
  );
}

function EditForm({ row, onClose, onSave, saving }: {
  row: AttRow;
  onClose: () => void;
  onSave: (p: { status: string; checkIn?: string; checkOut?: string; notes?: string }) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({ status: row.status, checkIn: row.time || '', checkOut: row.checkOut || '', notes: '' });
  return (
    <Modal open onClose={onClose} title={`Koreksi Absen — ${row.name}`} wide>
      <p className="mb-3 text-sm text-muted">{row.className} · {row.nis} · Metode: {METHOD_LABELS[row.method] || row.method}</p>
      <div className="space-y-3">
        <Field label="Status kehadiran">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Jam datang (HH:MM)">
            <Input value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} placeholder="07:00" />
          </Field>
          <Field label="Jam pulang (HH:MM)">
            <Input value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} placeholder="14:00" />
          </Field>
        </div>
        <Field label="Catatan (opsional)">
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="mis. koreksi oleh admin" />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button onClick={() => onSave(form)} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan Perubahan'}</Button>
      </div>
    </Modal>
  );
}

function ManualForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ studentId: '', status: 'PRESENT', type: 'CHECK_IN', date: '', checkIn: '', checkOut: '', notes: '' });
  const [search, setSearch] = useState('');

  const { data: students, isLoading } = useQuery({
    queryKey: ['students-manual', search],
    queryFn: () => api<{ success: boolean; data: { id: string; nis: string; fullName: string; className: string | null }[] }>(
      `/students?search=${encodeURIComponent(search)}&pageSize=50&isActive=true`
    ).then((r) => r.data),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api('/attendance/manual', {
        method: 'POST',
        body: {
          ...form,
          date: form.date || undefined,
          checkIn: form.checkIn || undefined,
          checkOut: form.checkOut || undefined,
          notes: form.notes || undefined,
        },
      }),
    onSuccess: () => {
      toast('success', 'Absensi manual disimpan.');
      qc.invalidateQueries({ queryKey: ['attendance-today'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  return (
    <Modal open onClose={onClose} title="Absensi Manual" wide>
      <div className="space-y-3">
        <Field label="Cari siswa" hint={students?.length ? `${students.length} siswa ditemukan — tekan Enter untuk pilih yang pertama` : undefined}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Enter → pilih siswa pertama langsung (percepat absensi piket)
              if (e.key === 'Enter' && students?.length) setForm({ ...form, studentId: students[0].id });
            }}
            placeholder="NISN / nama…"
          />
        </Field>
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-2xl border border-line p-2">
          {students?.map((s) => (
            <button
              key={s.id}
              onClick={() => setForm({ ...form, studentId: s.id })}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${form.studentId === s.id ? 'bg-primary-soft font-semibold text-primary-dark' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
            >
              <span className="font-medium text-ink">{s.fullName}</span>
              <span className="text-xs text-muted">{s.nis} · {s.className}</span>
            </button>
          ))}
          {students?.length === 0 && <p className="py-4 text-center text-sm text-muted">Tidak ada siswa ditemukan</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Tipe">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="CHECK_IN">Datang</option>
              <option value="CHECK_OUT">Pulang</option>
            </Select>
          </Field>
        </div>
        <Field label="Tanggal (kosongkan = hari ini)"><Input value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} placeholder="2026-08-16" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Jam datang (opsional)"><Input value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} placeholder="07:00" /></Field>
          <Field label="Jam pulang (opsional)"><Input value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} placeholder="14:00" /></Field>
        </div>
        <Field label="Catatan"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Opsional" /></Field>
        <p className="text-xs text-muted">Jika siswa sudah punya catatan pada tanggal tersebut, catatan akan diperbarui (bukan ditolak).</p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button onClick={() => mutation.mutate()} disabled={!form.studentId || mutation.isPending}>{mutation.isPending ? 'Menyimpan…' : 'Simpan'}</Button>
      </div>
    </Modal>
  );
}
