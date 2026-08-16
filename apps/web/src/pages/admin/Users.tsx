import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users as UsersIcon, Plus, Search, Upload, Download, Loader2, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Card, Input, Field, Select, Modal, Badge, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';

interface UserRow {
  id: string; username: string; fullName: string; roleKey: string; roleName: string; nip?: string | null;
  position?: string | null; subjectName?: string | null; phone?: string | null; isActive: boolean; isPiket: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  TEACHER: 'Guru', HOMEROOM_TEACHER: 'Wali Kelas', STAFF: 'Staff', ADMIN: 'Admin / TU', HEADMASTER: 'Kepala Sekolah',
};

export default function Users() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data: users } = useQuery({
    queryKey: ['users', search],
    queryFn: () => api<{ success: boolean; data: UserRow[] }>(`/users?search=${encodeURIComponent(search)}`).then((r) => r.data),
  });
  const { data: subjects } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/subjects').then((r) => r.data),
  });

  const togglePiket = useMutation({
    mutationFn: (u: UserRow) => api(`/users/${u.id}`, { method: 'PUT', body: { isPiket: !u.isPiket } }),
    onSuccess: () => {
      toast('success', 'Status piket diperbarui.');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  return (
    <div>
      <PageHeader title="Guru & Staff" subtitle="Kelola akun tenaga pendidik dan kependidikan" />
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="pl-10" placeholder="Cari nama atau username…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => setShowImport(true)}>
          <Upload className="h-4 w-4" /> Import
        </Button>
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
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-full bg-primary-soft px-2.5 py-1 font-semibold text-primary-dark">{u.roleName}</span>
              {u.subjectName && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-muted dark:bg-slate-700">{u.subjectName}</span>}
              {u.position && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-muted dark:bg-slate-700">{u.position}</span>}
              {(u.roleKey === 'TEACHER' || u.roleKey === 'HOMEROOM_TEACHER') && (
                <button
                  onClick={() => togglePiket.mutate(u)}
                  disabled={togglePiket.isPending}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold transition-colors ${
                    u.isPiket
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-300'
                      : 'bg-slate-100 text-muted hover:bg-amber-50 hover:text-amber-600 dark:bg-slate-700'
                  }`}
                  title={u.isPiket ? 'Klik untuk melepas piket' : 'Jadikan guru piket (jaga gerbang)'}
                >
                  <ShieldCheck className="h-3 w-3" />
                  {u.isPiket ? 'Guru Piket' : 'Piket'}
                </button>
              )}
            </div>
          </Card>
        ))}
        {users?.length === 0 && <div className="sm:col-span-2 lg:col-span-3"><EmptyState icon={Search} title="Tidak ada akun" /></div>}
      </div>

      {showCreate && <UserForm onClose={() => setShowCreate(false)} subjects={subjects || []} />}
      {showImport && <UserImport onClose={() => setShowImport(false)} />}
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

// ===== Import massal CSV =====
interface PreviewRow {
  line: number; nama: string; username: string; roleLabel: string; roleKey: string;
  password: string; nip: string; position: string; subjectName: string; phone: string;
  errors: string[]; valid: boolean;
}

const TEMPLATE_HEADERS = ['Nama', 'Username', 'Role', 'Password', 'NIP', 'Jabatan', 'Mata Pelajaran', 'No HP'];
const TEMPLATE_SAMPLE = ['CONTOH GURU', 'guru_baru', 'Guru', 'guru123', '198001012010012001', 'Guru Mapel', 'Matematika', '081234567899'];

function downloadTemplate() {
  const csv = [TEMPLATE_HEADERS.join(','), TEMPLATE_SAMPLE.join(',')].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'template-import-guru-staff.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function UserImport({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; valid: number; invalid: number } | null>(null);

  const doPreview = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await api<{ success: boolean; data: { total: number; valid: number; invalid: number; rows: PreviewRow[] } }>('/import/users/preview', { method: 'POST', formData: form });
      return res.data;
    },
    onSuccess: (data) => {
      setPreview(data.rows);
      setMeta({ total: data.total, valid: data.valid, invalid: data.invalid });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal membaca file.'),
  });

  const doConfirm = useMutation({
    mutationFn: () =>
      api<{ success: boolean; message: string; data: { created: number; errors: { username: string; error: string }[] } }>('/import/users/confirm', {
        method: 'POST',
        body: { rows: (preview || []).filter((r) => r.valid).map((r) => ({ nama: r.nama, username: r.username, roleKey: r.roleKey, password: r.password, nip: r.nip, position: r.position, subjectName: r.subjectName, phone: r.phone })) },
      }),
    onSuccess: (res) => {
      toast('success', res.message);
      qc.invalidateQueries({ queryKey: ['users'] });
      setPreview(null);
      setMeta(null);
      onClose();
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal import.'),
  });

  return (
    <Modal open onClose={onClose} title="Import Guru & Staff (CSV)" wide>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-2xl bg-primary-soft/40 p-3">
          <p className="text-xs text-muted">Kolom: Nama, Username, Role (Guru/Wali Kelas/Staff/Admin/Kepala Sekolah), Password, NIP, Jabatan, Mata Pelajaran, No HP.</p>
          <Button variant="outline" className="!px-3 !py-1.5 text-xs" onClick={downloadTemplate}>
            <Download className="h-3.5 w-3.5" /> Template
          </Button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && doPreview.mutate(e.target.files[0])} />

        {!preview && (
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-line py-10 transition-colors hover:border-primary"
          >
            <div className="rounded-2xl bg-primary-soft p-3 text-primary"><Upload className="h-6 w-6" /></div>
            <p className="font-bold text-ink">Pilih file CSV</p>
            <p className="text-sm text-muted">Pratinjau & validasi per baris sebelum disimpan.</p>
          </button>
        )}

        {preview && meta && (
          <>
            <Card className="flex items-center justify-between">
              <div className="flex gap-4 text-sm">
                <span className="text-muted">Total: <b className="text-ink">{meta.total}</b></span>
                <span className="text-emerald-600">Valid: <b>{meta.valid}</b></span>
                <span className="text-red-500">Error: <b>{meta.invalid}</b></span>
              </div>
              <Button variant="outline" className="!px-3 !py-1.5 text-xs" onClick={() => { setPreview(null); setMeta(null); }}>Pilih file lain</Button>
            </Card>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {preview.map((r) => (
                <div key={r.line} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${r.valid ? 'bg-emerald-50/60 dark:bg-emerald-500/10' : 'bg-red-50/60 dark:bg-red-500/10'}`}>
                  {r.valid ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                  <span className="w-10 text-xs text-muted">#{r.line}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.nama}</span>
                  <span className="text-xs text-muted">@{r.username}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700">{ROLE_LABEL[r.roleKey] || r.roleLabel}</span>
                  {r.errors.length > 0 && <span className="text-xs text-red-500">{r.errors.join('; ')}</span>}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setPreview(null); setMeta(null); }}>Batal</Button>
              <Button onClick={() => doConfirm.mutate()} disabled={meta.valid === 0 || doConfirm.isPending}>
                {doConfirm.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Import {meta.valid} Akun
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
