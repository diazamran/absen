import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Cog, Pencil, Upload, Download, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { api, ApiError, downloadCsv } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Card, Input, Field, Select, Segmented, EmptyState, Modal } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { useAuth } from '../../lib/auth';

type Tab = 'classes' | 'subjects' | 'majors' | 'schedules';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const DAY_LABELS: Record<string, string> = {
  MONDAY: 'Senin', TUESDAY: 'Selasa', WEDNESDAY: 'Rabu', THURSDAY: 'Kamis', FRIDAY: 'Jumat', SATURDAY: 'Sabtu', SUNDAY: 'Minggu',
};

export default function Classes() {
  const { user } = useAuth();
  const isAdmin = user?.roleKey === 'ADMIN' || user?.roleKey === 'SUPER_ADMIN';
  const [tab, setTab] = useState<Tab>(isAdmin ? 'classes' : 'schedules');

  return (
    <div>
      <PageHeader title="Kelas & Jadwal" subtitle="Data akademik sekolah" />
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            ...(isAdmin ? [{ value: 'classes' as Tab, label: 'Kelas' }, { value: 'majors' as Tab, label: 'Jurusan' }, { value: 'subjects' as Tab, label: 'Mapel' }] : []),
            { value: 'schedules' as Tab, label: 'Jadwal' },
          ]}
        />
      </div>
      {tab === 'classes' && <ClassesTab />}
      {tab === 'majors' && <MajorsTab />}
      {tab === 'subjects' && <SubjectsTab />}
      {tab === 'schedules' && <SchedulesTab />}
    </div>
  );
}

interface ClassRow {
  id: string; name: string; grade: string; majorId?: string | null; majorName?: string | null;
  homeroomTeacher?: string | null; room?: string | null; studentCount: number;
}

const CLASS_HEADERS = ['Nama Kelas', 'Tingkat', 'Jurusan', 'Ruang'];
const CLASS_SAMPLE = ['X-TKJ-1', 'X', 'TKJ', 'Labkom 1'];

function ClassesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [showImport, setShowImport] = useState(false);

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api<{ success: boolean; data: ClassRow[] }>('/classes').then((r) => r.data),
  });
  const { data: majors } = useQuery({
    queryKey: ['majors'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/majors').then((r) => r.data),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/classes/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('success', 'Kelas dinonaktifkan.'); qc.invalidateQueries({ queryKey: ['classes'] }); },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        <Button variant="outline" className="px-3 py-2 text-sm" onClick={async () => {
          try { await downloadCsv('/export/classes', 'kelas.csv'); toast('success', 'Export CSV berhasil diunduh.'); }
          catch (e) { toast('error', e instanceof ApiError ? e.message : 'Gagal export.'); }
        }}><Download className="h-4 w-4" /> Export</Button>
        <Button variant="outline" className="px-3 py-2 text-sm" onClick={() => setShowImport(true)}><Upload className="h-4 w-4" /> Import</Button>
        <Button className="px-3 py-2 text-sm" onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" /> Kelas Baru</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {classes?.map((c) => (
          <Card key={c.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-lg font-extrabold text-ink">{c.name}</p>
                <p className="text-xs text-muted">{c.majorName || '—'} · {c.homeroomTeacher || 'Tanpa wali kelas'}{c.room ? ` · ${c.room}` : ''}</p>
              </div>
              <span className="shrink-0 rounded-xl bg-primary-soft px-3 py-1.5 text-sm font-bold text-primary-dark">{c.studentCount} siswa</span>
            </div>
            <div className="mt-3 flex justify-end gap-1">
              <button onClick={() => setEditing(c)} className="rounded-xl p-2 text-muted hover:bg-primary-soft hover:text-primary" title="Edit">
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Nonaktifkan kelas ${c.name}? Siswa di dalamnya tidak akan hilang.`)) del.mutate(c.id);
                }}
                className="rounded-xl p-2 text-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                title="Nonaktifkan"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </Card>
        ))}
        {classes?.length === 0 && <div className="col-span-full"><EmptyState icon={Plus} title="Belum ada kelas" description="Tambahkan kelas baru untuk memulai." /></div>}
      </div>
      {formOpen && <ClassForm majors={majors || []} onClose={() => setFormOpen(false)} />}
      {editing && <ClassForm majors={majors || []} initial={editing} onClose={() => setEditing(null)} />}
      {showImport && <ClassImport onClose={() => setShowImport(false)} />}
    </div>
  );
}

interface ClassPreviewRow {
  line: number; name: string; grade: string; majorName: string; room: string; errors: string[]; valid: boolean;
}

function downloadClassTemplate() {
  const csv = [CLASS_HEADERS.join(','), CLASS_SAMPLE.join(',')].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'template-import-kelas.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function ClassImport({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ClassPreviewRow[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; valid: number; invalid: number } | null>(null);

  const doPreview = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await api<{ success: boolean; data: { total: number; valid: number; invalid: number; rows: ClassPreviewRow[] } }>('/import/classes/preview', { method: 'POST', formData: form });
      return res.data;
    },
    onSuccess: (data) => { setPreview(data.rows); setMeta({ total: data.total, valid: data.valid, invalid: data.invalid }); },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal membaca file.'),
  });

  const doConfirm = useMutation({
    mutationFn: () =>
      api<{ success: boolean; message: string; data: { created: number; errors: { name: string; error: string }[] } }>('/import/classes/confirm', {
        method: 'POST',
        body: { rows: (preview || []).filter((r) => r.valid).map((r) => ({ name: r.name, grade: r.grade, majorName: r.majorName, room: r.room })) },
      }),
    onSuccess: (res) => {
      toast('success', res.message);
      qc.invalidateQueries({ queryKey: ['classes'] });
      setPreview(null); setMeta(null); onClose();
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal import.'),
  });

  return (
    <Modal open onClose={onClose} title="Import Kelas (CSV)" wide>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-2xl bg-primary-soft/40 p-3">
          <p className="text-xs text-muted">Kolom: Nama Kelas, Tingkat (X/XI/XII), Jurusan, Ruang.</p>
          <Button variant="outline" className="!px-3 !py-1.5 text-xs" onClick={downloadClassTemplate}>
            <Download className="h-3.5 w-3.5" /> Template
          </Button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && doPreview.mutate(e.target.files[0])} />
        {!preview && (
          <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-line py-10 transition-colors hover:border-primary">
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
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.name}</span>
                  <span className="text-xs text-muted">{r.grade}{r.majorName ? ` · ${r.majorName}` : ''}</span>
                  {r.errors.length > 0 && <span className="text-xs text-red-500">{r.errors.join('; ')}</span>}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setPreview(null); setMeta(null); }}>Batal</Button>
              <Button onClick={() => doConfirm.mutate()} disabled={meta.valid === 0 || doConfirm.isPending}>
                {doConfirm.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Import {meta.valid} Kelas
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ClassForm({ majors, initial, onClose }: { majors: { id: string; name: string }[]; initial?: ClassRow; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name || '',
    grade: initial?.grade || 'X',
    majorId: initial?.majorId || '',
    room: initial?.room || '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      initial
        ? api(`/classes/${initial.id}`, { method: 'PUT', body: form })
        : api('/classes', { method: 'POST', body: form }),
    onSuccess: () => {
      toast('success', initial ? 'Kelas diperbarui.' : 'Kelas ditambahkan.');
      qc.invalidateQueries({ queryKey: ['classes'] });
      onClose();
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });

  return (
    <Modal open onClose={onClose} title={initial ? `Edit Kelas — ${initial.name}` : 'Kelas Baru'}>
      <div className="space-y-3">
        <Field label="Nama Kelas"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="X-TKJ-1" /></Field>
        <Field label="Tingkat">
          <Select value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}>
            {['X', 'XI', 'XII'].map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </Field>
        <Field label="Jurusan">
          <Select value={form.majorId} onChange={(e) => setForm({ ...form, majorId: e.target.value })}>
            <option value="">Tanpa jurusan</option>
            {majors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Ruang"><Input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="Labkom 1" /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button onClick={() => mutation.mutate()} disabled={!form.name}>Simpan</Button>
      </div>
    </Modal>
  );
}

function MajorsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const { data: majors } = useQuery({
    queryKey: ['majors'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string; code?: string | null }[] }>('/majors').then((r) => r.data),
  });
  const mutation = useMutation({
    mutationFn: () => api('/majors', { method: 'POST', body: { name } }),
    onSuccess: () => { toast('success', 'Jurusan ditambahkan.'); qc.invalidateQueries({ queryKey: ['majors'] }); setName(''); },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <h3 className="mb-3 flex items-center gap-2 font-bold text-ink"><Cog className="h-4 w-4" /> Tambah Jurusan</h3>
        <div className="space-y-3">
          <Field label="Nama Jurusan"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="TKJ / TKR / TPTUP / KULINER" /></Field>
          <Button className="w-full" onClick={() => mutation.mutate()} disabled={!name}>Simpan</Button>
        </div>
      </Card>
      <div className="lg:col-span-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {majors?.map((m) => (
          <Card key={m.id} className="flex flex-col items-center gap-1 py-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Cog className="h-5 w-5" />
            </div>
            <p className="font-bold text-ink">{m.name}</p>
            {m.code && <p className="text-xs text-muted">{m.code}</p>}
          </Card>
        ))}
        {majors?.length === 0 && <div className="col-span-full"><EmptyState icon={Cog} title="Belum ada jurusan" /></div>}
      </div>
    </div>
  );
}

const SUBJECT_HEADERS = ['Nama', 'Kode'];
const SUBJECT_SAMPLE = ['Dasar-Dasar Program Keahlian TKJ', 'DPK-TKJ'];

interface SubjectRow {
  id: string; name: string; code?: string | null; color?: string | null;
}

function SubjectsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState<SubjectRow | null>(null);
  const [preview, setPreview] = useState<{ line: number; name: string; code: string; errors: string[]; valid: boolean }[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; valid: number; invalid: number } | null>(null);

  const { data: subjects } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<{ success: boolean; data: SubjectRow[] }>('/subjects').then((r) => r.data),
  });

  const mutation = useMutation({
    mutationFn: () => api('/subjects', { method: 'POST', body: { name, code } }),
    onSuccess: () => { toast('success', 'Mapel ditambahkan.'); qc.invalidateQueries({ queryKey: ['subjects'] }); setName(''); setCode(''); },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });

  const doPreview = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await api<{ success: boolean; data: { total: number; valid: number; invalid: number; rows: { line: number; name: string; code: string; errors: string[]; valid: boolean }[] } }>('/import/subjects/preview', { method: 'POST', formData: form });
      return res.data;
    },
    onSuccess: (data) => { setPreview(data.rows); setMeta({ total: data.total, valid: data.valid, invalid: data.invalid }); },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal membaca file.'),
  });

  const doConfirm = useMutation({
    mutationFn: () =>
      api<{ success: boolean; message: string }>('/import/subjects/confirm', {
        method: 'POST',
        body: { rows: (preview || []).filter((r) => r.valid).map((r) => ({ name: r.name, code: r.code })) },
      }),
    onSuccess: (res) => {
      toast('success', res.message);
      qc.invalidateQueries({ queryKey: ['subjects'] });
      setPreview(null); setMeta(null);
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal import.'),
  });

  const downloadTemplate = () => {
    const csv = [SUBJECT_HEADERS.join(','), SUBJECT_SAMPLE.join(',')].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-import-mapel.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const doExport = async () => {
    try { await downloadCsv('/export/subjects', 'mapel.csv'); toast('success', 'Export CSV berhasil diunduh.'); }
    catch (e) { toast('error', e instanceof ApiError ? e.message : 'Gagal export.'); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <h3 className="mb-3 font-bold text-ink">Tambah Mata Pelajaran</h3>
        <div className="space-y-3">
          <Field label="Nama"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Biologi" /></Field>
          <Field label="Kode"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BIO" /></Field>
          <Button className="w-full" onClick={() => mutation.mutate()} disabled={!name}>Simpan</Button>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1 !px-2 !py-2 text-xs" onClick={doExport}><Download className="h-3.5 w-3.5" /> Export</Button>
          <Button variant="outline" className="flex-1 !px-2 !py-2 text-xs" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" /> Import</Button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && doPreview.mutate(e.target.files[0])} />
      </Card>
      <div className="lg:col-span-2">
        {preview && meta && (
          <Card className="mb-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">Pratinjau Import Mapel</p>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-emerald-600">Valid: <b>{meta.valid}</b></span>
                <span className="text-red-500">Error: <b>{meta.invalid}</b></span>
                <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={downloadTemplate}><Download className="h-3 w-3" /> Template</Button>
              </div>
            </div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {preview.map((r) => (
                <div key={r.line} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${r.valid ? 'bg-emerald-50/60 dark:bg-emerald-500/10' : 'bg-red-50/60 dark:bg-red-500/10'}`}>
                  {r.valid ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                  <span className="w-10 text-xs text-muted">#{r.line}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.name}</span>
                  <span className="text-xs text-muted">{r.code}</span>
                  {r.errors.length > 0 && <span className="text-xs text-red-500">{r.errors.join('; ')}</span>}
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" className="!px-3 !py-1.5 text-xs" onClick={() => { setPreview(null); setMeta(null); }}>Batal</Button>
              <Button className="!px-3 !py-1.5 text-xs" onClick={() => doConfirm.mutate()} disabled={!meta.valid || doConfirm.isPending}>
                {doConfirm.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Import {meta.valid} Mapel
              </Button>
            </div>
          </Card>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {subjects?.map((s) => (
            <Card key={s.id} className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-xl" style={{ backgroundColor: s.color || '#0d9488' }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-ink">{s.name}</p>
                <p className="text-xs text-muted">{s.code}</p>
              </div>
              <button onClick={() => setEditing(s)} className="rounded-xl p-2 text-muted hover:bg-primary-soft hover:text-primary" title="Edit"><Pencil className="h-4 w-4" /></button>
              <button
                onClick={() => {
                  if (window.confirm(`Nonaktifkan mapel ${s.name}?`)) {
                    api(`/subjects/${s.id}`, { method: 'DELETE' })
                      .then(() => { toast('success', 'Mapel dinonaktifkan.'); qc.invalidateQueries({ queryKey: ['subjects'] }); })
                      .catch((e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'));
                  }
                }}
                className="rounded-xl p-2 text-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                title="Nonaktifkan"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </Card>
          ))}
          {subjects?.length === 0 && <div className="col-span-full"><EmptyState icon={Cog} title="Belum ada mapel" /></div>}
        </div>
      </div>
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={`Edit Mapel — ${editing.name}`}>
          <SubjectEditForm initial={editing} onClose={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

function SubjectEditForm({ initial, onClose }: { initial: SubjectRow; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: initial.name, code: initial.code || '', color: initial.color || '' });
  const mutation = useMutation({
    mutationFn: () => api(`/subjects/${initial.id}`, { method: 'PUT', body: form }),
    onSuccess: () => { toast('success', 'Mapel diperbarui.'); qc.invalidateQueries({ queryKey: ['subjects'] }); onClose(); },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });
  return (
    <div className="space-y-3">
      <Field label="Nama"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Kode"><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button onClick={() => mutation.mutate()} disabled={!form.name}>Simpan</Button>
      </div>
    </div>
  );
}

function SchedulesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ classId: '', subjectId: '', teacherId: '', day: 'MONDAY', startTime: '07:00', endTime: '08:30', room: '' });
  const [showForm, setShowForm] = useState(false);

  const { data: schedules } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => api<{ success: boolean; data: { id: string; day: string; startTime: string; endTime: string; className: string; subjectName: string; teacherName: string; room?: string | null }[] }>('/schedules').then((r) => r.data),
  });
  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data) });
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/subjects').then((r) => r.data) });
  const { data: teachers } = useQuery({ queryKey: ['teachers'], queryFn: () => api<{ success: boolean; data: { id: string; fullName: string }[] }>('/teachers').then((r) => r.data) });

  const mutation = useMutation({
    mutationFn: () => api('/schedules', { method: 'POST', body: form }),
    onSuccess: () => { toast('success', 'Jadwal ditambahkan.'); qc.invalidateQueries({ queryKey: ['schedules'] }); setShowForm(false); },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('success', 'Jadwal dihapus.'); qc.invalidateQueries({ queryKey: ['schedules'] }); },
  });

  const byDay = DAYS.map((d) => ({ day: d, items: (schedules || []).filter((s) => s.day === d) }));

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button className="px-3 py-2 text-sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> Jadwal Baru</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {byDay.map(({ day, items }) => (
          <Card key={day}>
            <h4 className="mb-2 font-bold text-ink">{DAY_LABELS[day]}</h4>
            {items.length === 0 ? (
              <p className="text-sm text-muted">Tidak ada jadwal</p>
            ) : (
              <div className="space-y-2">
                {items.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900/60">
                    <span className="font-mono text-xs font-bold text-primary-dark">{s.startTime}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{s.subjectName} · {s.className}</p>
                      <p className="truncate text-xs text-muted">{s.teacherName}{s.room ? ` · ${s.room}` : ''}</p>
                    </div>
                    <button onClick={() => del.mutate(s.id)} className="text-muted hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-surface p-5 shadow-float dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-bold text-ink">Jadwal Baru</h3>
            <div className="space-y-3">
              <Field label="Kelas"><Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">Pilih</option>{classes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
              <Field label="Mata Pelajaran"><Select value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}><option value="">Pilih</option>{subjects?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Guru"><Select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}><option value="">Pilih</option>{teachers?.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Hari"><Select value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })}>{DAYS.map((d) => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}</Select></Field>
                <Field label="Ruang"><Input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mulai"><Input value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field>
                <Field label="Selesai"><Input value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></Field>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
              <Button onClick={() => mutation.mutate()} disabled={!form.classId || !form.subjectId || !form.teacherId}>Simpan</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
