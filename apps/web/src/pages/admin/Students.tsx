import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Plus, Search, Upload, Camera, CreditCard, Eye } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Card, Input, Field, Select, Modal, Badge, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { useNavigate } from 'react-router-dom';

interface StudentRow {
  id: string; userId: string; nis: string; fullName: string; className: string | null; majorName: string | null;
  faceRegistered: boolean; hasCard: boolean; isActive: boolean; gender: string;
}

export default function Students() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [classId, setClassId] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: students } = useQuery({
    queryKey: ['students', search, classId],
    queryFn: () =>
      api<{ success: boolean; data: StudentRow[] }>(`/students?search=${encodeURIComponent(search)}&classId=${classId}`).then((r) => r.data),
  });
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data),
  });

  return (
    <div>
      <PageHeader title="Siswa" subtitle="Kelola data siswa" />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="pl-10" placeholder="Cari NIS atau nama…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="sm:w-48">
          <option value="">Semua kelas</option>
          {classes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/app/import')}>
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Tambah Siswa
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {students?.map((s) => (
          <Card key={s.id} className="flex items-center gap-3 p-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold text-ink">{s.fullName}</p>
              <p className="text-xs text-muted">{s.nis} · {s.className || 'Tanpa kelas'} {s.majorName ? `· ${s.majorName}` : ''}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {s.faceRegistered ? <Badge status="PRESENT" label="Wajah" /> : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-muted dark:bg-slate-700">No wajah</span>}
              {s.hasCard ? <Badge status="APPROVED" label="Kartu" /> : null}
            </div>
          </Card>
        ))}
        {students?.length === 0 && (
          <EmptyState icon={Search} title="Tidak ada siswa" description="Coba ubah kata kunci pencarian atau tambahkan siswa baru." />
        )}
      </div>

      {showCreate && <StudentForm onClose={() => setShowCreate(false)} classes={classes || []} />}
    </div>
  );
}

function StudentForm({ onClose, classes }: { onClose: () => void; classes: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    nis: '', fullName: '', gender: 'MALE', classId: '', password: 'siswa123', parentName: '', parentPhone: '', cardUid: '',
  });

  const mutation = useMutation({
    mutationFn: () => api('/students', { method: 'POST', body: form }),
    onSuccess: () => {
      toast('success', 'Siswa berhasil ditambahkan.');
      qc.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  return (
    <Modal open onClose={onClose} title="Tambah Siswa" wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="NIS *"><Input value={form.nis} onChange={(e) => setForm({ ...form, nis: e.target.value })} placeholder="121217" /></Field>
        <Field label="Nama Lengkap *"><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Nama siswa" /></Field>
        <Field label="Jenis Kelamin">
          <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="MALE">Laki-laki</option>
            <option value="FEMALE">Perempuan</option>
          </Select>
        </Field>
        <Field label="Kelas">
          <Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
            <option value="">Tanpa kelas</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Nama Orang Tua"><Input value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })} placeholder="Opsional" /></Field>
        <Field label="No WhatsApp Orang Tua"><Input value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} placeholder="0812…" /></Field>
        <Field label="UID Kartu (opsional)"><Input value={form.cardUid} onChange={(e) => setForm({ ...form, cardUid: e.target.value })} placeholder="04:A2:3B:…" /></Field>
        <Field label="Password awal" hint="Default: siswa123"><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button onClick={() => mutation.mutate()} disabled={!form.nis || !form.fullName || mutation.isPending}>
          Simpan
        </Button>
      </div>
    </Modal>
  );
}
