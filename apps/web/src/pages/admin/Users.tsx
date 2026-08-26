import { useRef, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Upload, Download, Loader2, ShieldCheck, CheckCircle2, XCircle, Pencil, Trash2, KeyRound } from 'lucide-react';
import { api, ApiError, downloadCsv } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Card, Input, Field, Select, Modal, Badge, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { useAuth } from '../../lib/auth';

interface UserRow {
  id: string; username: string; fullName: string; roleKey: string; roleName: string; nip?: string | null;
  position?: string | null; subjectName?: string | null; phone?: string | null; isActive: boolean; isPiket: boolean;
  additionalRoles?: string[];
}

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', TEACHER: 'Guru', HOMEROOM_TEACHER: 'Wali Kelas', BK: 'Guru BK', STAFF: 'Staff', ADMIN: 'Admin', HEADMASTER: 'Kepala Sekolah', PIKET: 'Petugas Piket',
};

export default function Users() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [showResetPwd, setShowResetPwd] = useState(false);

  useEffect(() => { setPage(1); }, [search]);

  const { data: usersRes } = useQuery({
    queryKey: ['users', search, page, perPage],
    queryFn: () => api<{ success: boolean; data: UserRow[]; meta: { total: number; page: number; pageSize: number; pages: number } }>(
      `/users?search=${encodeURIComponent(search)}&page=${page}&pageSize=${perPage}`
    ),
  });
  const users = usersRes?.data;
  const meta = usersRes?.meta;
  const total = meta?.total || 0;
  const totalPages = meta?.pages || 1;
  const safePage = meta?.page || page;
  const { data: subjects } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/subjects').then((r) => r.data),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Akun dihapus permanen.');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus.'),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const togglePageAll = () => {
    if (!users?.length) return;
    setSelected((prev) => {
      const allSel = users.every((u) => prev.has(u.id));
      const next = new Set(prev);
      if (allSel) users.forEach((u) => next.delete(u.id));
      else users.forEach((u) => next.add(u.id));
      return next;
    });
  };

  const bulkDelete = useMutation({
    mutationFn: async () => {
      await api('/users/bulk-delete', { method: 'POST', body: { ids: Array.from(selected) } });
    },
    onSuccess: () => {
      toast('success', `${selected.size} akun dihapus permanen.`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus.'),
  });

  const resetPassword = useMutation({
    mutationFn: async (password?: string) => {
      return api<{ success: boolean; message: string; data: { count: number; password: string } }>(
        '/users/reset-password',
        { method: 'POST', body: { ids: Array.from(selected), ...(password ? { password } : {}) } }
      );
    },
    onSuccess: (res) => {
      toast('success', res.message);
      setSelected(new Set());
      setShowResetPwd(false);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal reset password.'),
  });

  const doExport = async () => {
    try {
      await downloadCsv('/export/users', 'guru-staff.csv');
      toast('success', 'Export CSV berhasil diunduh.');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gagal export.');
    }
  };

  return (
    <div>
      <PageHeader title="Guru" subtitle="Kelola akun guru dan tenaga pendidik" />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="pl-10" placeholder="Cari nama atau username…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.size > 0 && (
            <>
              <Button variant="warning" onClick={() => setShowResetPwd(true)} disabled={resetPassword.isPending}>
                {resetPassword.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Reset Password ({selected.size})
              </Button>
              <Button variant="danger" onClick={() => window.confirm(`Hapus permanen ${selected.size} akun terpilih? Riwayat absen, jadwal, dan izin terkait ikut terhapus dan tidak bisa dikembalikan.`) && bulkDelete.mutate()} disabled={bulkDelete.isPending}>
                {bulkDelete.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Hapus Terpilih ({selected.size})
              </Button>
            </>
          )}
          <Button variant="outline" onClick={doExport}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Tambah
          </Button>
        </div>
      </div>

      {users && users.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line/60 bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/60 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-muted dark:bg-slate-800/60">
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" checked={users.length > 0 && users.every((u) => selected.has(u.id))} onChange={togglePageAll} className="h-4 w-4 accent-[var(--primary)]" />
                </th>
                <th className="px-3 py-2.5">Nama</th>
                <th className="px-3 py-2.5">Username</th>
                <th className="px-3 py-2.5">NIP</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="w-20 px-3 py-2.5 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line/40 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2.5">
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} className="h-4 w-4 accent-[var(--primary)]" />
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2.5 font-medium text-ink">
                    {u.fullName}
                    {u.subjectName && <span className="ml-1 text-xs text-muted">· {u.subjectName}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">@{u.username}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">{u.nip || '-'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary-dark">
                        {u.roleKey === 'PIKET' && <ShieldCheck className="h-3 w-3" />}
                        {u.roleName}
                      </span>
                      {u.additionalRoles && u.additionalRoles.length > 0 && (
                        u.additionalRoles.map((ar) => (
                          <span key={ar} className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            +{ar === 'PIKET' ? 'Piket' : ar === 'HOMEROOM_TEACHER' ? 'Wali' : ar === 'HEADMASTER' ? 'Kepsek' : ar === 'BK' ? 'BK' : ar === 'TEACHER' ? 'Guru' : ar === 'STAFF' ? 'Staff' : ar}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><Badge status={u.isActive ? 'APPROVED' : 'BLOCKED'} label={u.isActive ? 'Aktif' : 'Nonaktif'} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setEditing(u)} className="rounded-lg p-1.5 text-muted hover:bg-primary-soft hover:text-primary" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Hapus PERMANEN akun ${u.fullName} (@${u.username})? Seluruh data terkait akan dihapus.`)) deleteUser.mutate(u.id);
                        }}
                        className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                        title="Hapus"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Search} title="Tidak ada akun" description="Coba ubah kata kunci pencarian atau tambahkan akun baru." />
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-line/60 bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-muted">
            <span className="text-xs">Tampilkan</span>
            {[10, 25, 50, 100, 200].map((n) => (
              <button key={n} onClick={() => { setPerPage(n); setPage(1); }} className={`min-w-[36px] rounded-lg px-2 py-1 text-xs font-semibold transition-all ${perPage === n ? 'bg-[var(--primary)] text-white shadow-sm' : 'border border-line/60 text-muted hover:border-[var(--primary)] hover:text-[var(--primary)]'}`}>{n}</button>
            ))}
            <span className="text-xs text-muted">per halaman</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Menampilkan {(safePage - 1) * perPage + 1}–{Math.min(safePage * perPage, total)} dari {total} data</span>
            <div className="flex items-center gap-0.5">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800">‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p: number;
                if (totalPages <= 5) p = i + 1;
                else if (safePage <= 3) p = i + 1;
                else if (safePage >= totalPages - 2) p = totalPages - 4 + i;
                else p = safePage - 2 + i;
                return <button key={p} onClick={() => setPage(p)} className={`flex h-8 min-w-[32px] items-center justify-center rounded-lg px-2 text-xs font-medium transition-all ${p === safePage ? 'bg-[var(--primary)] text-white shadow-sm' : 'text-muted hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{p}</button>;
              })}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800">›</button>
            </div>
          </div>
        </div>
      )}

      {showCreate && <UserForm onClose={() => setShowCreate(false)} subjects={subjects || []} />}
      {editing && <UserForm initial={editing} onClose={() => setEditing(null)} subjects={subjects || []} />}
      {showImport && <UserImport onClose={() => setShowImport(false)} />}
      {showResetPwd && (
        <ResetPasswordModal
          count={selected.size}
          onConfirm={(pwd) => resetPassword.mutate(pwd || undefined)}
          onClose={() => setShowResetPwd(false)}
          isLoading={resetPassword.isPending}
        />
      )}
    </div>
  );
}

/* ───── Reset Password Massal Modal ───── */
function ResetPasswordModal({ count, onConfirm, onClose, isLoading }: {
  count: number;
  onConfirm: (password: string) => void;
  onClose: () => void;
  isLoading: boolean;
}) {
  const [mode, setMode] = useState<'default' | 'custom'>('default');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const canSubmit = mode === 'default' || (password.length >= 6);

  return (
    <Modal open onClose={onClose} title="Reset Password Massal" wide>
      <div className="space-y-5">
        {/* Info */}
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 dark:bg-amber-500/10">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Reset password {count} akun terpilih
            </p>
            <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/70">
              Semua akun yang dipilih akan memiliki password yang sama. Pastikan Anda sudah memberitahu pemilik akun.
            </p>
          </div>
        </div>

        {/* Pilihan Mode */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-ink">Pilih Metode Reset</p>

          {/* Default Password */}
          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-all ${mode === 'default' ? 'border-[var(--primary)] bg-primary-soft/30' : 'border-line/60 hover:border-primary/40'}`}>
            <input
              type="radio"
              name="pwd-mode"
              className="mt-0.5 accent-[var(--primary)]"
              checked={mode === 'default'}
              onChange={() => setMode('default')}
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink">Password Default</p>
              <p className="mt-1 text-xs text-muted">Semua akun akan direset ke <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-700">guru12345</code></p>
            </div>
          </label>

          {/* Custom Password */}
          <label className={`flex items-start gap-3 rounded-xl border-2 p-4 transition-all ${mode === 'custom' ? 'border-[var(--primary)] bg-primary-soft/30' : 'border-line/60 hover:border-primary/40'}`}>
            <input
              type="radio"
              name="pwd-mode"
              className="mt-0.5 accent-[var(--primary)]"
              checked={mode === 'custom'}
              onChange={() => setMode('custom')}
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink">Password Kustom</p>
              <p className="mb-2 text-xs text-muted">Tentukan password sendiri untuk semua akun terpilih</p>
              {mode === 'custom' && (
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan password baru (min. 6 karakter)"
                    autoFocus
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 pr-16 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] dark:border-slate-600 dark:bg-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-muted hover:text-ink"
                  >
                    {showPassword ? 'Sembunyi' : 'Lihat'}
                  </button>
                </div>
              )}
              {mode === 'custom' && password.length > 0 && password.length < 6 && (
                <p className="mt-1 text-xs text-red-500">Minimal 6 karakter</p>
              )}
            </div>
          </label>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-line/60 pt-4">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Batal</Button>
          <Button
            variant="warning"
            onClick={() => onConfirm(mode === 'default' ? '' : password)}
            disabled={!canSubmit || isLoading}
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'default' ? `Reset ke "guru12345"` : `Reset ke "${password || '...'}"`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ───── User Create / Edit Form ───── */
function UserForm({ onClose, subjects, initial }: { onClose: () => void; subjects: { id: string; name: string }[]; initial?: UserRow }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = user?.roles?.includes('SUPER_ADMIN') || user?.roleKey === 'SUPER_ADMIN';
  const [form, setForm] = useState(() => ({
    username: initial?.username || '',
    password: '',
    fullName: initial?.fullName || '',
    roleKey: initial?.roleKey || 'TEACHER',
    nip: initial?.nip || '',
    position: initial?.position || '',
    phone: initial?.phone || '',
    subjectId: initial?.subjectName ? subjects.find((s) => s.name === initial.subjectName)?.id || '' : '',
  }));
  const [additionalRoles, setAdditionalRoles] = useState<string[]>(initial?.additionalRoles || []);

  const mutation = useMutation({
    mutationFn: () => {
      if (initial) {
        const { password, ...rest } = form;
        const body: Record<string, unknown> = { ...rest, additionalRoles };
        if (password) body.password = password;
        return api(`/users/${initial.id}`, { method: 'PUT', body });
      }
      return api('/users', { method: 'POST', body: { ...form, password: form.password || 'guru123', additionalRoles } });
    },
    onSuccess: () => {
      toast('success', initial ? 'Akun diperbarui.' : 'Akun berhasil dibuat.');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  return (
    <Modal open onClose={onClose} title={initial ? `Edit Akun — ${initial.fullName}` : 'Tambah Akun'} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama Lengkap *"><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
        <Field label="Username *"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoCapitalize="none" /></Field>
        <Field label="Role">
          <Select value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
            {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
            <option value="ADMIN">Admin</option>
            <option value="HEADMASTER">Kepala Sekolah</option>
            <option value="HOMEROOM_TEACHER">Wali Kelas</option>
            <option value="TEACHER">Guru</option>
            <option value="BK">Guru BK</option>
            <option value="PIKET">Petugas Piket</option>
            <option value="STAFF">Staff</option>
          </Select>
        </Field>
        <Field label={initial ? 'Password baru (opsional)' : 'Password'} hint={initial ? 'Kosongkan jika tidak diubah' : undefined}><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
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
      {/* Tambahan Role (Multi-Role) */}
      {initial && (
        <div className="mt-4 rounded-xl border border-line/60 bg-slate-50 p-4 dark:bg-slate-800/50">
          <p className="mb-2 text-sm font-semibold text-ink">Tambahan Role</p>
          <p className="mb-3 text-xs text-muted">Pilih role tambahan selain role utama. Contoh: Guru yang juga Petugas Piket dan Wali Kelas.</p>
          <div className="flex flex-wrap gap-3">
            {['PIKET', 'HOMEROOM_TEACHER', 'HEADMASTER', 'BK', 'TEACHER', 'STAFF', 'ADMIN'].map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-primary focus:ring-primary"
                  checked={additionalRoles.includes(r)}
                  onChange={(e) => {
                    setAdditionalRoles(e.target.checked ? [...additionalRoles, r] : additionalRoles.filter((x) => x !== r));
                  }}
                />
                {r === 'PIKET' ? 'Petugas Piket' : r === 'HOMEROOM_TEACHER' ? 'Wali Kelas' : r === 'HEADMASTER' ? 'Kepala Sekolah' : r === 'BK' ? 'Guru BK' : r === 'TEACHER' ? 'Guru' : r === 'STAFF' ? 'Staff' : 'Admin'}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button onClick={() => mutation.mutate()} disabled={!form.fullName || !form.username || mutation.isPending}>Simpan</Button>
      </div>
    </Modal>
  );
}

/* ───── Import massal CSV ───── */
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
    <Modal open onClose={onClose} title="Import Guru (CSV)" wide>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-2xl bg-primary-soft/40 p-3">
          <p className="text-xs text-muted">Kolom: Nama, Username, Role (Guru/Wali Kelas/Staff/Admin/Kepala Sekolah/Petugas Piket), Password, NIP, Jabatan, Mata Pelajaran, No HP.</p>
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
