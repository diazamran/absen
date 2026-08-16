import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Plus, Search, Upload, Download, Pencil, Trash2, Camera, CreditCard, Loader2 } from 'lucide-react';
import { api, ApiError, downloadCsv } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Card, Input, Field, Select, Modal, Badge, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { useNavigate } from 'react-router-dom';

interface StudentRow {
  id: string; userId: string; nis: string; fullName: string; className: string | null; classId: string | null; majorName: string | null;
  faceRegistered: boolean; hasCard: boolean; isActive: boolean; gender: string; birthDate?: string | null;
  parents?: { id: string; name: string; phone: string }[];
}

export default function Students() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [classId, setClassId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: students } = useQuery({
    queryKey: ['students', search, classId],
    queryFn: () =>
      api<{ success: boolean; data: StudentRow[] }>(`/students?search=${encodeURIComponent(search)}&classId=${classId}`).then((r) => r.data),
  });
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (!students?.length) return;
    setSelected((prev) => (prev.size === students.length ? new Set() : new Set(students.map((s) => s.id))));
  };

  const deleteOne = useMutation({
    mutationFn: (id: string) => api(`/students/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Siswa dihapus permanen.');
      qc.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus.'),
  });

  const doExport = async () => {
    try {
      await downloadCsv('/export/students', 'siswa.csv');
      toast('success', 'Export CSV berhasil diunduh.');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gagal export.');
    }
  };

  const bulkDelete = useMutation({
    mutationFn: async () => {
      for (const id of selected) {
        await api(`/students/${id}`, { method: 'DELETE' });
      }
    },
    onSuccess: () => {
      toast('success', `${selected.size} siswa dihapus permanen.`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus.'),
  });

  return (
    <div>
      <PageHeader title="Siswa" subtitle="Kelola data siswa" />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="pl-10" placeholder="Cari NISN atau nama…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="lg:w-48">
          <option value="">Semua kelas</option>
          {classes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={doExport}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="outline" onClick={() => navigate('/app/import')}>
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Tambah Siswa
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-2xl border border-red-200 bg-red-50/60 px-4 py-2.5 dark:bg-red-500/10">
          <p className="text-sm font-semibold text-red-600">{selected.size} siswa dipilih</p>
          <Button
            variant="danger"
            className="!px-3 !py-1.5 text-xs"
            onClick={() => {
              if (window.confirm(`Hapus PERMANEN ${selected.size} siswa terpilih? Riwayat absen, izin, dan data wajah ikut terhapus dari database dan tidak bisa dikembalikan.`)) bulkDelete.mutate();
            }}
            disabled={bulkDelete.isPending}
          >
            {bulkDelete.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Hapus Terpilih
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {students?.map((s) => (
          <Card key={s.id} className="flex items-center gap-3 p-3.5">
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={() => toggle(s.id)}
              className="h-4 w-4 shrink-0 accent-[var(--primary)]"
              title="Pilih untuk hapus massal"
            />
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold text-ink">{s.fullName}</p>
              <p className="text-xs text-muted">{s.nis} · {s.className || 'Tanpa kelas'} {s.majorName ? `· ${s.majorName}` : ''}</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-primary">Login: NISN {s.nis} + tanggal lahir</p>
            </div>
            <div className="hidden items-center gap-1.5 sm:flex">
              {s.faceRegistered ? <Badge status="PRESENT" label="Wajah" /> : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-muted dark:bg-slate-700">No wajah</span>}
              {s.hasCard ? <Badge status="APPROVED" label="Kartu" /> : null}
              {!s.isActive && <Badge status="BLOCKED" label="Nonaktif" />}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setEditing(s)} className="rounded-xl p-2 text-muted hover:bg-primary-soft hover:text-primary" title="Edit">
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Hapus PERMANEN ${s.fullName} (NISN ${s.nis})? Riwayat absen, izin, dan data wajah ikut terhapus dan tidak bisa dikembalikan.`)) deleteOne.mutate(s.id);
                }}
                className="rounded-xl p-2 text-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                title="Hapus"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </Card>
        ))}
        {students?.length === 0 && (
          <EmptyState icon={Search} title="Tidak ada siswa" description="Coba ubah kata kunci pencarian atau tambahkan siswa baru." />
        )}
      </div>

      {showCreate && <StudentForm onClose={() => setShowCreate(false)} classes={classes || []} />}
      {editing && <StudentEdit student={editing} classes={classes || []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StudentForm({ onClose, classes }: { onClose: () => void; classes: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    nis: '', fullName: '', gender: 'MALE', birthDate: '', classId: '', parentName: '', parentPhone: '', cardUid: '',
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
        <Field label="NISN *"><Input value={form.nis} onChange={(e) => setForm({ ...form, nis: e.target.value })} placeholder="Nomor Induk Siswa Nasional" /></Field>
        <Field label="Nama Lengkap *"><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Nama siswa" /></Field>
        <Field label="Tanggal Lahir" hint="Dipakai untuk login siswa (NISN + tanggal lahir)"><Input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></Field>
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

function StudentEdit({ student, classes, onClose }: { student: StudentRow; classes: { id: string; name: string }[]; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const parent = student.parents?.[0];
  const [form, setForm] = useState({
    nis: student.nis,
    fullName: student.fullName,
    gender: student.gender,
    birthDate: student.birthDate ? student.birthDate.slice(0, 10) : '',
    classId: student.classId || '',
    isActive: student.isActive,
    parentName: parent?.name || '',
    parentPhone: parent?.phone || '',
    cardUid: '',
  });

  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        nis: form.nis,
        fullName: form.fullName,
        gender: form.gender,
        birthDate: form.birthDate,
        classId: form.classId,
        isActive: form.isActive,
      };
      if (form.parentName && form.parentPhone) {
        body.parentName = form.parentName;
        body.parentPhone = form.parentPhone;
      }
      if (form.cardUid.trim()) body.cardUid = form.cardUid.trim();
      return api(`/students/${student.id}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      toast('success', 'Data siswa diperbarui.');
      qc.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  return (
    <Modal open onClose={onClose} title={`Edit Siswa — NISN ${student.nis}`} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="NISN *"><Input value={form.nis} onChange={(e) => setForm({ ...form, nis: e.target.value })} /></Field>
        <Field label="Nama Lengkap *"><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
        <Field label="Tanggal Lahir" hint="Dipakai untuk login siswa (NISN + tanggal lahir)"><Input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></Field>
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
        <Field label="UID Kartu (kosongkan jika tidak diubah)" hint="UID disimpan terenkripsi, tidak bisa ditampilkan kembali."><Input value={form.cardUid} onChange={(e) => setForm({ ...form, cardUid: e.target.value })} placeholder="04:A2:3B:…" /></Field>
        <Field label="Status">
          <Select value={form.isActive ? 'true' : 'false'} onChange={(e) => setForm({ ...form, isActive: e.target.value === 'true' })}>
            <option value="true">Aktif</option>
            <option value="false">Nonaktif</option>
          </Select>
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button onClick={() => mutation.mutate()} disabled={!form.fullName || !form.nis || mutation.isPending}>Simpan</Button>
      </div>
    </Modal>
  );
}
