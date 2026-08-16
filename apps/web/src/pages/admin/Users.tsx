import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users as UsersIcon, Plus, Search } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Card, Input, Field, Select, Modal, Badge, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';

interface UserRow {
  id: string; username: string; fullName: string; roleKey: string; roleName: string; nip?: string | null;
  position?: string | null; subjectName?: string | null; phone?: string | null; isActive: boolean;
}

export default function Users() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: users } = useQuery({
    queryKey: ['users', search],
    queryFn: () => api<{ success: boolean; data: UserRow[] }>(`/users?search=${encodeURIComponent(search)}`).then((r) => r.data),
  });
  const { data: subjects } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/subjects').then((r) => r.data),
  });

  return (
    <div>
      <PageHeader title="Guru & Staff" subtitle="Kelola akun tenaga pendidik dan kependidikan" />
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="pl-10" placeholder="Cari nama atau username…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Tambah
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {users?.map((u) => (
          <Card key={u.id}>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <UsersIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-ink">{u.fullName}</p>
                <p className="text-xs text-muted">@{u.username}{u.nip ? ` · ${u.nip}` : ''}</p>
              </div>
              <Badge status={u.isActive ? 'APPROVED' : 'BLOCKED'} label={u.isActive ? 'Aktif' : 'Nonaktif'} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              <span className="rounded-full bg-primary-soft px-2.5 py-1 font-semibold text-primary-dark">{u.roleName}</span>
              {u.subjectName && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-muted dark:bg-slate-700">{u.subjectName}</span>}
              {u.position && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-muted dark:bg-slate-700">{u.position}</span>}
            </div>
          </Card>
        ))}
        {users?.length === 0 && <div className="sm:col-span-2 lg:col-span-3"><EmptyState icon={Search} title="Tidak ada akun" /></div>}
      </div>

      {showCreate && <UserForm onClose={() => setShowCreate(false)} subjects={subjects || []} />}
    </div>
  );
}

function UserForm({ onClose, subjects }: { onClose: () => void; subjects: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    username: '', password: 'guru123', fullName: '', roleKey: 'TEACHER', nip: '', position: '', phone: '', subjectId: '',
  });

  const mutation = useMutation({
    mutationFn: () => api('/users', { method: 'POST', body: form }),
    onSuccess: () => {
      toast('success', 'Akun berhasil dibuat.');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  return (
    <Modal open onClose={onClose} title="Tambah Akun" wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama Lengkap *"><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
        <Field label="Username *"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
        <Field label="Role">
          <Select value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
            <option value="TEACHER">Guru</option>
            <option value="HOMEROOM_TEACHER">Wali Kelas</option>
            <option value="STAFF">Staff</option>
            <option value="ADMIN">Admin / TU</option>
            <option value="HEADMASTER">Kepala Sekolah</option>
          </Select>
        </Field>
        <Field label="Password"><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Field label="NIP"><Input value={form.nip} onChange={(e) => setForm({ ...form, nip: e.target.value })} /></Field>
        <Field label="Jabatan"><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Guru Mapel / Staf TU" /></Field>
        <Field label="Mata Pelajaran (guru)">
          <Select value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
            <option value="">—</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="No HP"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button onClick={() => mutation.mutate()} disabled={!form.fullName || !form.username || mutation.isPending}>Simpan</Button>
      </div>
    </Modal>
  );
}
