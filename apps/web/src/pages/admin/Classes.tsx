import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Cog, Pencil } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
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

function ClassesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClassRow | null>(null);

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
      <div className="mb-3 flex justify-end">
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
    </div>
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

function SubjectsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const { data: subjects } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string; code?: string | null; color?: string | null }[] }>('/subjects').then((r) => r.data),
  });
  const mutation = useMutation({
    mutationFn: () => api('/subjects', { method: 'POST', body: { name, code } }),
    onSuccess: () => { toast('success', 'Mapel ditambahkan.'); qc.invalidateQueries({ queryKey: ['subjects'] }); setName(''); setCode(''); },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <h3 className="mb-3 font-bold text-ink">Tambah Mata Pelajaran</h3>
        <div className="space-y-3">
          <Field label="Nama"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Biologi" /></Field>
          <Field label="Kode"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BIO" /></Field>
          <Button className="w-full" onClick={() => mutation.mutate()} disabled={!name}>Simpan</Button>
        </div>
      </Card>
      <div className="lg:col-span-2 grid grid-cols-2 gap-3">
        {subjects?.map((s) => (
          <Card key={s.id} className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl" style={{ backgroundColor: s.color || '#0d9488' }} />
            <div>
              <p className="font-bold text-ink">{s.name}</p>
              <p className="text-xs text-muted">{s.code}</p>
            </div>
          </Card>
        ))}
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
