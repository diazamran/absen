import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/AppShell';
import { Card, Button, Input, Select, Field, Modal, EmptyState, LoadingCard } from '../../lib/ui';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { Plus, Search, Trash2, Edit, ClipboardCheck } from 'lucide-react';

interface Counseling {
  id: string;
  studentId: string;
  studentName: string;
  nis: string;
  className: string | null;
  type: string;
  title: string;
  description: string | null;
  action: string | null;
  followUp: string | null;
  createdBy: string;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  ACADEMIC: 'Akademik',
  DISCIPLINE: 'Disiplin',
  PERSONAL: 'Pribadi',
  SOCIAL: 'Sosial',
  CAREER: 'Karir',
  OTHER: 'Lainnya',
};

const TYPE_COLORS: Record<string, string> = {
  ACADEMIC: 'bg-blue-100 text-blue-700',
  DISCIPLINE: 'bg-red-100 text-red-700',
  PERSONAL: 'bg-purple-100 text-purple-700',
  SOCIAL: 'bg-green-100 text-green-700',
  CAREER: 'bg-orange-100 text-orange-700',
  OTHER: 'bg-gray-100 text-gray-700',
};

export default function BkCounseling() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Counseling | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    studentId: '',
    type: 'ACADEMIC',
    title: '',
    description: '',
    action: '',
    followUp: '',
  });

  const { data: counseling, isLoading } = useQuery({
    queryKey: ['bk-counseling', search],
    queryFn: () =>
      api<{ success: boolean; data: Counseling[] }>(`/bk/counseling?search=${encodeURIComponent(search)}`).then(
        (r) => r.data,
      ),
  });

  const { data: students } = useQuery({
    queryKey: ['students-list'],
    queryFn: () =>
      api<{ success: boolean; data: { id: string; nis: string; user: { fullName: string }; class: { name: string } | null }[] }>(
        '/students?pageSize=500',
      ).then((r) => r.data),
  });

  const createMut = useMutation({
    mutationFn: (data: typeof form) => api('/bk/counseling', { method: 'POST', body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bk-counseling'] });
      toast('success', 'Konseling berhasil ditambahkan.');
      setShowForm(false);
      resetForm();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & typeof form) =>
      api(`/bk/counseling/${id}`, { method: 'PUT', body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bk-counseling'] });
      toast('success', 'Konseling berhasil diupdate.');
      setShowForm(false);
      setEditItem(null);
      resetForm();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/bk/counseling/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bk-counseling'] });
      toast('success', 'Konseling berhasil dihapus.');
      setDeleteId(null);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const resetForm = () => setForm({ studentId: '', type: 'ACADEMIC', title: '', description: '', action: '', followUp: '' });

  const openEdit = (item: Counseling) => {
    setEditItem(item);
    setForm({
      studentId: item.studentId,
      type: item.type,
      title: item.title,
      description: item.description || '',
      action: item.action || '',
      followUp: item.followUp || '',
    });
    setShowForm(true);
  };

  return (
    <div>
      <PageHeader
        title="Bimbingan & Konseling"
        subtitle="Catatan konseling siswa"
        action={
          <Button onClick={() => { resetForm(); setEditItem(null); setShowForm(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Tambah
          </Button>
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted" />
          <Input placeholder="Cari siswa atau judul..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1" />
        </div>
      </Card>

      {isLoading ? (
        <LoadingCard />
      ) : !counseling?.length ? (
        <EmptyState icon={ClipboardCheck} title="Belum ada catatan konseling" description="Klik 'Tambah' untuk mencatat konseling siswa." />
      ) : (
        <div className="space-y-3">
          {counseling.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-semibold text-ink">{c.studentName}</span>
                    <span className="text-xs text-muted">({c.nis})</span>
                    {c.className && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{c.className}</span>}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[c.type] || 'bg-gray-100 text-gray-700'}`}>
                      {TYPE_LABELS[c.type] || c.type}
                    </span>
                  </div>
                  <p className="font-medium text-ink">{c.title}</p>
                  {c.description && <p className="mt-1 text-sm text-muted">{c.description}</p>}
                  {c.action && (
                    <p className="mt-1 text-sm"><span className="font-medium text-ink">Tindakan:</span> {c.action}</p>
                  )}
                  {c.followUp && (
                    <p className="mt-1 text-sm"><span className="font-medium text-ink">Follow-up:</span> {c.followUp}</p>
                  )}
                  <p className="mt-1 text-xs text-muted">
                    {new Date(c.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(c)} className="rounded-lg p-1.5 text-muted hover:bg-slate-100">
                    <Edit className="h-4 w-4" />
                  </button>
                  {user?.roleKey === 'SUPER_ADMIN' && (
                    <button onClick={() => setDeleteId(c.id)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <Modal open={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} title={editItem ? 'Edit Konseling' : 'Tambah Konseling'}>
          <div className="space-y-3">
            <Field label="Siswa">
              <Select
                value={form.studentId}
                onChange={(e) => setForm({ ...form, studentId: e.target.value })}
              >
                <option value="">Pilih siswa...</option>
                {students?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.user.fullName} ({s.nis}) - {s.class?.name || '-'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Jenis">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field label="Judul / Permasalahan">
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Contoh: Masalah belajar" />
            </Field>
            <Field label="Deskripsi">
              <textarea
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/40"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Detail permasalahan..."
              />
            </Field>
            <Field label="Tindakan / Solusi">
              <textarea
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/40"
                rows={2}
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                placeholder="Tindakan yang diambil..."
              />
            </Field>
            <Field label="Follow-up">
              <Input value={form.followUp} onChange={(e) => setForm({ ...form, followUp: e.target.value })} placeholder="Rencana tindak lanjut..." />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => { setShowForm(false); setEditItem(null); }}>Batal</Button>
              <Button
                onClick={() => {
                  if (!form.studentId || !form.title) { toast('error', 'Siswa dan judul wajib diisi.'); return; }
                  editItem ? updateMut.mutate({ id: editItem.id, ...form }) : createMut.mutate(form);
                }}
                disabled={createMut.isPending || updateMut.isPending}
              >
                {editItem ? 'Simpan' : 'Tambah'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Hapus Konseling">
          <p className="text-sm text-muted mb-4">Yakin ingin menghapus catatan konseling ini?</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteId(null)}>Batal</Button>
            <Button variant="danger" onClick={() => deleteMut.mutate(deleteId)} disabled={deleteMut.isPending}>Hapus</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
