import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ScanLine, Search, ClipboardEdit, Filter } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Card, Input, Select, Button, Badge, Modal, Field, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS, METHOD_LABELS } from '../../lib/format';

interface AttRow {
  id: string; name: string; nis: string | null; className: string | null; time: string | null;
  status: string; method: string; lateMinutes: number;
}

export default function AttendanceList() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('');
  const [manualOpen, setManualOpen] = useState(false);

  const { data: rows } = useQuery({
    queryKey: ['attendance-today', classId, status],
    queryFn: () => api<{ success: boolean; data: AttRow[] }>(`/attendance/today?classId=${classId}&status=${status}`).then((r) => r.data),
    refetchInterval: 15_000,
  });
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data),
  });

  return (
    <div>
      <PageHeader
        title="Absensi Hari Ini"
        subtitle="Data kehadiran realtime"
        action={<Button onClick={() => setManualOpen(true)}><ClipboardEdit className="h-4 w-4" /> Absen Manual</Button>}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
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
        {rows?.map((r) => (
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
          </Card>
        ))}
        {rows?.length === 0 && <EmptyState icon={Search} title="Belum ada data absensi" description="Data akan muncul saat siswa mulai absen." />}
      </div>

      {manualOpen && <ManualForm onClose={() => setManualOpen(false)} />}
    </div>
  );
}

function ManualForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ studentId: '', status: 'PRESENT', type: 'CHECK_IN', date: '', notes: '' });
  const [search, setSearch] = useState('');

  const { data: students } = useQuery({
    queryKey: ['students', search],
    queryFn: () => api<{ success: boolean; data: { id: string; nis: string; fullName: string; className: string | null }[] }>(`/students?search=${encodeURIComponent(search)}`).then((r) => r.data),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api('/attendance/manual', {
        method: 'POST',
        body: { ...form, date: form.date || undefined, notes: form.notes || undefined },
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
        <Field label="Cari siswa"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="NISN / nama…" /></Field>
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
        <Field label="Catatan"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Opsional" /></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button onClick={() => mutation.mutate()} disabled={!form.studentId || mutation.isPending}>Simpan</Button>
      </div>
    </Modal>
  );
}
