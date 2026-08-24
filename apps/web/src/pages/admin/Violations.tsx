import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/AppShell';
import { Card, Button, Input, Select, Field, Modal, EmptyState, LoadingCard } from '../../lib/ui';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { Plus, Search, Trash2, Edit, AlertTriangle, Award, Users, Filter } from 'lucide-react';

interface ViolationType {
  id: string;
  name: string;
  description: string | null;
  points: number;
  isActive: boolean;
}

interface StudentViolation {
  id: string;
  studentId: string;
  violationTypeId: string;
  date: string;
  notes: string | null;
  student: { id: string; user?: { fullName: string } | null; nis: string; class?: { name: string } | null; major?: { name: string } | null };
  violationType: ViolationType;
  recordedBy: { id: string; fullName: string };
}

interface TopStudent {
  studentId: string;
  name: string;
  nis: string;
  className: string;
  majorName: string;
  totalPoints: number;
  totalViolations: number;
}

export default function Violations() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'types' | 'list' | 'top'>('list');
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [editType, setEditType] = useState<ViolationType | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [deleteTypeId, setDeleteTypeId] = useState<string | null>(null);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);

  // Forms
  const [typeName, setTypeName] = useState('');
  const [typeDesc, setTypeDesc] = useState('');
  const [typePoints, setTypePoints] = useState(1);

  const [addStudentId, setAddStudentId] = useState('');
  const [addViolationTypeId, setAddViolationTypeId] = useState('');
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10));
  const [addNotes, setAddNotes] = useState('');

  const [bulkViolationTypeId, setBulkViolationTypeId] = useState('');
  const [bulkDate, setBulkDate] = useState(new Date().toISOString().slice(0, 10));
  const [bulkNotes, setBulkNotes] = useState('');
  const [bulkSearch, setBulkSearch] = useState('');

  // Queries
  const types = useQuery({
    queryKey: ['violation-types'],
    queryFn: () => api<{ success: boolean; data: ViolationType[] }>('/violations/types').then((r) => r.data),
  });

  const violations = useQuery({
    queryKey: ['violations', search, classFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (classFilter) params.set('classId', classFilter);
      params.set('pageSize', '100');
      return api<{ success: boolean; data: StudentViolation[]; total: number }>(`/violations?${params}`).then((r) => r.data);
    },
  });

  const topStudents = useQuery({
    queryKey: ['violations-top', classFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (classFilter) params.set('classId', classFilter);
      return api<{ success: boolean; data: TopStudent[] }>(`/violations/top?${params}`).then((r) => r.data);
    },
  });

  const allStudents = useQuery({
    queryKey: ['students-for-violation', bulkSearch],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: '100', isActive: 'true' });
      if (bulkSearch) params.set('search', bulkSearch);
      return api<{ success: boolean; data: Array<{ id: string; fullName: string; nis: string; className: string }> }>(`/students?${params}`).then((r) => r.data);
    },
    enabled: showBulkForm,
  });

  const classes = useQuery({
    queryKey: ['classes-list'],
    queryFn: () => api<{ success: boolean; data: Array<{ id: string; name: string }> }>('/classes?pageSize=200').then((r) => r.data),
  });

  // Mutations
  const createType = useMutation({
    mutationFn: (data: { name: string; description?: string; points: number }) =>
      api('/violations/types', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      toast('success', 'Jenis pelanggaran ditambahkan');
      qc.invalidateQueries({ queryKey: ['violation-types'] });
      resetTypeForm();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const updateType = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ViolationType> }) =>
      api(`/violations/types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      toast('success', 'Jenis pelanggaran diperbarui');
      qc.invalidateQueries({ queryKey: ['violation-types'] });
      resetTypeForm();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteType = useMutation({
    mutationFn: (id: string) => api(`/violations/types/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Jenis pelanggaran dihapus');
      qc.invalidateQueries({ queryKey: ['violation-types'] });
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const addViolation = useMutation({
    mutationFn: (data: { studentId: string; violationTypeId: string; date: string; notes?: string }) =>
      api('/violations', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      toast('success', 'Pelanggaran dicatat');
      qc.invalidateQueries({ queryKey: ['violations'] });
      qc.invalidateQueries({ queryKey: ['violations-top'] });
      resetAddForm();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const bulkAdd = useMutation({
    mutationFn: (data: { studentIds: string[]; violationTypeId: string; date: string; notes?: string }) =>
      api('/violations/bulk', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: (r: { success: boolean; data: { count: number } }) => {
      toast('success', `${r.data.count} pelanggaran dicatat`);
      qc.invalidateQueries({ queryKey: ['violations'] });
      qc.invalidateQueries({ queryKey: ['violations-top'] });
      setShowBulkForm(false);
      setSelectedStudents([]);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteViolation = useMutation({
    mutationFn: (id: string) => api(`/violations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Data pelanggaran dihapus');
      qc.invalidateQueries({ queryKey: ['violations'] });
      qc.invalidateQueries({ queryKey: ['violations-top'] });
    },
    onError: (e: Error) => toast('error', e.message),
  });

  function resetTypeForm() {
    setTypeName('');
    setTypeDesc('');
    setTypePoints(1);
    setEditType(null);
    setShowTypeForm(false);
  }

  function resetAddForm() {
    setAddStudentId('');
    setAddViolationTypeId('');
    setAddDate(new Date().toISOString().slice(0, 10));
    setAddNotes('');
    setShowAddForm(false);
  }

  const totalPointsAll = (topStudents.data ?? []).reduce((s, st) => s + st.totalPoints, 0);

  return (
    <div>
      <PageHeader
        title="Pelanggaran Siswa"
        subtitle="Kelola jenis pelanggaran dan catatan pelanggaran siswa"
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> Catat Pelanggaran
            </Button>
            <Button variant="outline" onClick={() => setShowBulkForm(true)}>
              <Users className="h-4 w-4 mr-1" /> Catat Massal
            </Button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {[
          { key: 'list' as const, label: 'Daftar Pelanggaran' },
          { key: 'types' as const, label: 'Jenis Pelanggaran' },
          { key: 'top' as const, label: 'Peringkat Poin' },
        ].map((t) => (
          <button
            key={t.key}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === t.key
                ? 'border-red-500 text-red-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
            placeholder="Cari nama / NISN / jenis pelanggaran..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="border rounded-lg px-3 py-2 text-sm"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
        >
          <option value="">Semua Kelas</option>
          {(classes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Tab: Daftar Pelanggaran */}
      {activeTab === 'list' && (
        <Card>
          {violations.isLoading ? (
            <LoadingCard />
          ) : (violations.data?.data ?? []).length === 0 ? (
            <EmptyState icon={<AlertTriangle />} title="Belum ada pelanggaran" description="Mulai catat pelanggaran siswa" />
          ) : (
            <div className="space-y-2">
              {(violations.data?.data ?? []).map((v) => (
                <div key={v.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{v.student?.user?.fullName ?? v.student?.nis}</span>
                      <span className="text-xs text-gray-500">{v.student?.nis}</span>
                      {v.student?.class && (
                        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">{v.student.class.name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        v.violationType.points >= 5 ? 'bg-red-100 text-red-700' :
                        v.violationType.points >= 3 ? 'bg-orange-100 text-orange-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {v.violationType.name} ({v.violationType.points} poin)
                      </span>
                      <span className="text-xs text-gray-400">{new Date(v.date).toLocaleDateString('id-ID')}</span>
                      {v.notes && <span className="text-xs text-gray-500 italic">"{v.notes}"</span>}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">Dicatat oleh: {v.recordedBy.fullName}</div>
                  </div>
                  {(user?.roles?.includes('SUPER_ADMIN') || user?.roles?.includes('ADMIN') || user?.roles?.includes('BK')) && (
                    <button
                      className="text-red-400 hover:text-red-600 p-1"
                      onClick={() => {
                        if (window.confirm('Hapus data pelanggaran ini?')) deleteViolation.mutate(v.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Tab: Jenis Pelanggaran */}
      {activeTab === 'types' && (
        <div>
          <div className="mb-4">
            <Button variant="primary" onClick={() => { setEditType(null); setShowTypeForm(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Tambah Jenis
            </Button>
          </div>
          {types.isLoading ? (
            <LoadingCard />
          ) : (types.data ?? []).length === 0 ? (
            <EmptyState icon={<AlertTriangle />} title="Belum ada jenis pelanggaran" description="Tambahkan jenis pelanggaran terlebih dahulu" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(types.data ?? []).map((t) => (
                <Card key={t.id} className="!p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">{t.name}</div>
                      {t.description && <div className="text-xs text-gray-500 mt-1">{t.description}</div>}
                      <div className={`inline-block mt-2 text-xs px-2 py-0.5 rounded font-bold ${
                        t.points >= 5 ? 'bg-red-100 text-red-700' :
                        t.points >= 3 ? 'bg-orange-100 text-orange-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {t.points} poin
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="text-gray-400 hover:text-blue-600 p-1"
                        onClick={() => {
                          setTypeName(t.name);
                          setTypeDesc(t.description ?? '');
                          setTypePoints(t.points);
                          setEditType(t);
                          setShowTypeForm(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        className="text-gray-400 hover:text-red-600 p-1"
                        onClick={() => {
                          if (window.confirm(`Hapus jenis "${t.name}"?`)) deleteType.mutate(t.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Peringkat Poin */}
      {activeTab === 'top' && (
        <div>
          <Card className="!p-4 mb-4">
            <div className="flex items-center gap-3">
              <Award className="h-6 w-6 text-red-500" />
              <div>
                <div className="text-sm text-gray-500">Total Pelanggaran</div>
                <div className="text-2xl font-bold">{totalPointsAll} poin</div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-sm text-gray-500">Siswa Melanggar</div>
                <div className="text-2xl font-bold">{(topStudents.data ?? []).length}</div>
              </div>
            </div>
          </Card>

          {topStudents.isLoading ? (
            <LoadingCard />
          ) : (topStudents.data ?? []).length === 0 ? (
            <EmptyState icon={<Award />} title="Belum ada pelanggaran" />
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 px-3">No</th>
                      <th className="py-2 px-3">Nama</th>
                      <th className="py-2 px-3">NISN</th>
                      <th className="py-2 px-3">Kelas</th>
                      <th className="py-2 px-3 text-center">Pelanggaran</th>
                      <th className="py-2 px-3 text-center">Poin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(topStudents.data ?? []).map((s, i) => (
                      <tr key={s.studentId} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-2 px-3 font-medium">{i + 1}</td>
                        <td className="py-2 px-3 font-medium">{s.name}</td>
                        <td className="py-2 px-3 text-gray-500">{s.nis}</td>
                        <td className="py-2 px-3 text-gray-500">{s.className}</td>
                        <td className="py-2 px-3 text-center">{s.totalViolations}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`font-bold px-2 py-0.5 rounded ${
                            s.totalPoints >= 20 ? 'bg-red-100 text-red-700' :
                            s.totalPoints >= 10 ? 'bg-orange-100 text-orange-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {s.totalPoints}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Modal: Tambah/Jenis Pelanggaran */}
      <Modal open={showTypeForm} onClose={resetTypeForm} title={editType ? 'Edit Jenis Pelanggaran' : 'Tambah Jenis Pelanggaran'}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (editType) {
              updateType.mutate({ id: editType.id, data: { name: typeName, description: typeDesc || undefined, points: typePoints } });
            } else {
              createType.mutate({ name: typeName, description: typeDesc || undefined, points: typePoints });
            }
          }}
        >
          <Field label="Nama Jenis Pelanggaran">
            <Input value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="contoh: Terlambat, Tidak Pakai Seragam" required />
          </Field>
          <Field label="Deskripsi (opsional)">
            <Input value={typeDesc} onChange={(e) => setTypeDesc(e.target.value)} placeholder="Deskripsi singkat" />
          </Field>
          <Field label="Bobot Poin">
            <Input type="number" min={1} value={typePoints} onChange={(e) => setTypePoints(Number(e.target.value))} required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={resetTypeForm}>Batal</Button>
            <Button variant="primary" type="submit" disabled={createType.isPending || updateType.isPending}>
              {createType.isPending || updateType.isPending ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Catat Pelanggaran */}
      <Modal open={showAddForm} onClose={resetAddForm} title="Catat Pelanggaran Siswa">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!addStudentId || !addViolationTypeId) {
              toast('error', 'Pilih siswa dan jenis pelanggaran');
              return;
            }
            addViolation.mutate({
              studentId: addStudentId,
              violationTypeId: addViolationTypeId,
              date: addDate,
              notes: addNotes || undefined,
            });
          }}
        >
          <Field label="Siswa">
            <Input
              value={addStudentId}
              onChange={(e) => setAddStudentId(e.target.value)}
              placeholder="Masukkan Student ID"
            />
            <p className="text-xs text-gray-400 mt-1">Cari siswa di Daftar Siswa untuk melihat ID</p>
          </Field>
          <Field label="Jenis Pelanggaran">
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={addViolationTypeId}
              onChange={(e) => setAddViolationTypeId(e.target.value)}
              required
            >
              <option value="">Pilih jenis pelanggaran</option>
              {(types.data ?? []).filter((t) => t.isActive).map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.points} poin)</option>
              ))}
            </select>
          </Field>
          <Field label="Tanggal">
            <Input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} required />
          </Field>
          <Field label="Catatan (opsional)">
            <Input value={addNotes} onChange={(e) => setAddNotes(e.target.value)} placeholder="Keterangan tambahan" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={resetAddForm}>Batal</Button>
            <Button variant="primary" type="submit" disabled={addViolation.isPending}>
              {addViolation.isPending ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Catat Massal */}
      <Modal open={showBulkForm} onClose={() => { setShowBulkForm(false); setSelectedStudents([]); }} title="Catat Pelanggaran Massal" wide>
        <div className="space-y-4">
          <Field label="Jenis Pelanggaran">
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={bulkViolationTypeId}
              onChange={(e) => setBulkViolationTypeId(e.target.value)}
              required
            >
              <option value="">Pilih jenis pelanggaran</option>
              {(types.data ?? []).filter((t) => t.isActive).map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.points} poin)</option>
              ))}
            </select>
          </Field>
          <Field label="Tanggal">
            <Input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} required />
          </Field>
          <Field label="Catatan (opsional)">
            <Input value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} placeholder="Keterangan" />
          </Field>

          {/* Student picker */}
          <div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
                placeholder="Cari nama / NISN siswa..."
                value={bulkSearch}
                onChange={(e) => setBulkSearch(e.target.value)}
              />
            </div>
            <div className="max-h-60 overflow-y-auto border rounded-lg">
              {(allStudents.data ?? []).length === 0 ? (
                <div className="p-4 text-center text-gray-400 text-sm">Ketik nama untuk mencari siswa</div>
              ) : (
                (allStudents.data ?? []).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer border-b last:border-0">
                    <input
                      type="checkbox"
                      checked={selectedStudents.includes(s.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedStudents((prev) => [...prev, s.id]);
                        } else {
                          setSelectedStudents((prev) => prev.filter((id) => id !== s.id));
                        }
                      }}
                    />
                    <div>
                      <div className="text-sm font-medium">{s.fullName}</div>
                      <div className="text-xs text-gray-500">{s.nis} · {s.className}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1">{selectedStudents.length} siswa dipilih</div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setShowBulkForm(false); setSelectedStudents([]); }}>Batal</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!bulkViolationTypeId) { toast('error', 'Pilih jenis pelanggaran'); return; }
                if (selectedStudents.length === 0) { toast('error', 'Pilih minimal 1 siswa'); return; }
                bulkAdd.mutate({
                  studentIds: selectedStudents,
                  violationTypeId: bulkViolationTypeId,
                  date: bulkDate,
                  notes: bulkNotes || undefined,
                });
              }}
              disabled={bulkAdd.isPending}
            >
              {bulkAdd.isPending ? 'Menyimpan...' : `Catat ${selectedStudents.length} Pelanggaran`}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
