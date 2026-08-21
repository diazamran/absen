import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Trash2, Edit, Users, Search, Loader2, X, ChevronDown, Building2, GraduationCap } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Card, Input, Badge, EmptyState, Skeleton } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { Segmented } from '../../lib/ui';

// ===== Types =====
interface PklLocation {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeter: number;
  phone: string | null;
  contactName: string | null;
  isActive: boolean;
  studentCount: number;
  students: PklStudent[];
}

interface PklStudent {
  assignmentId: string;
  studentId: string;
  fullName: string;
  nis: string | null;
  className: string | null;
  supervisorId: string | null;
  supervisorName: string | null;
  startDate: string | null;
  endDate: string | null;
}

interface StudentOption {
  id: string;
  userId: string;
  nis: string;
  fullName: string;
  className: string | null;
  isActive: boolean;
}

interface TeacherOption {
  id: string;
  userId: string;
  fullName: string;
  nip: string | null;
  isPiket: boolean;
}

// ===== Location Form =====
function LocationForm({ initial, onClose }: { initial?: PklLocation; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    address: initial?.address ?? '',
    city: initial?.city ?? '',
    latitude: initial?.latitude ?? '',
    longitude: initial?.longitude ?? '',
    radiusMeter: initial?.radiusMeter ?? 100,
    phone: initial?.phone ?? '',
    contactName: initial?.contactName ?? '',
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        latitude: form.latitude ? Number(form.latitude) : undefined,
        longitude: form.longitude ? Number(form.longitude) : undefined,
        radiusMeter: Number(form.radiusMeter),
      };
      return initial
        ? api(`/pkl/locations/${initial.id}`, { method: 'PUT', body })
        : api('/pkl/locations', { method: 'POST', body });
    },
    onSuccess: () => {
      toast('success', initial ? 'Lokasi diperbarui.' : 'Lokasi ditambahkan.');
      qc.invalidateQueries({ queryKey: ['pkl-locations'] });
      onClose();
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Nama Tempat *</label>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="PT. Maju Jaya" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Kota</label>
          <Input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Kediri" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Alamat</label>
        <Input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Jl. Raya No. 123" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Latitude</label>
          <Input type="number" step="any" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} placeholder="-7.8205" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Longitude</label>
          <Input type="number" step="any" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} placeholder="112.0153" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Radius (m)</label>
          <Input type="number" value={form.radiusMeter} onChange={(e) => set('radiusMeter', e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Kontak / PIC</label>
          <Input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="Budi Santoso" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">No. HP</label>
          <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="08123456789" />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button onClick={() => save.mutate()} disabled={!form.name || save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Simpan
        </Button>
      </div>
    </div>
  );
}

// ===== Assignment Form =====
function AssignmentForm({ locationId, onClose }: { locationId: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [supervisorId, setSupervisorId] = useState('');
  const [search, setSearch] = useState('');

  const { data: students } = useQuery({
    queryKey: ['students-for-pkl', search],
    queryFn: () => api<{ success: boolean; data: StudentOption[] }>(`/students?search=${encodeURIComponent(search)}&pageSize=50`).then((r) => r.data),
  });

  const { data: teachers } = useQuery({
    queryKey: ['teachers-for-pkl'],
    queryFn: () => api<{ success: boolean; data: TeacherOption[] }>('/users?pageSize=200').then((r) => (r.data ?? []).filter((u: TeacherOption & { roleKey?: string }) => (u as TeacherOption & { roleKey?: string }).roleKey === 'TEACHER' || (u as TeacherOption & { roleKey?: string }).roleKey === 'HOMEROOM_TEACHER' || (u as TeacherOption & { roleKey?: string }).roleKey === 'SUPER_ADMIN')),
  });

  const assign = useMutation({
    mutationFn: async () => {
      await api('/pkl/assignments/bulk', {
        method: 'POST',
        body: {
          studentIds: [...selectedStudents],
          pklLocationId: locationId,
          supervisorId: supervisorId || undefined,
        },
      });
    },
    onSuccess: () => {
      toast('success', `${selectedStudents.size} siswa ditugaskan.`);
      qc.invalidateQueries({ queryKey: ['pkl-locations'] });
      onClose();
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menugaskan.'),
  });

  const toggle = (id: string) => {
    setSelectedStudents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Guru Pembimbing</label>
        <select
          value={supervisorId}
          onChange={(e) => setSupervisorId(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="">— Pilih Guru —</option>
          {teachers?.map((t) => (
            <option key={t.id} value={t.id}>{t.fullName}{t.nip ? ` (${t.nip})` : ''}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Pilih Siswa ({selectedStudents.size} dipilih)</label>
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="pl-10" placeholder="Cari nama / NISN..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-line p-2 dark:border-slate-600">
          {students?.map((s) => (
            <label key={s.id} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-primary-soft/50 ${selectedStudents.has(s.id) ? 'bg-primary-soft/30' : ''}`}>
              <input type="checkbox" checked={selectedStudents.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 accent-[var(--primary)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{s.fullName}</p>
                <p className="text-xs text-muted">{s.nis} · {s.className ?? '-'}</p>
              </div>
            </label>
          ))}
          {students && students.length === 0 && <p className="py-3 text-center text-sm text-muted">Tidak ada siswa ditemukan.</p>}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button onClick={() => assign.mutate()} disabled={selectedStudents.size === 0 || assign.isPending}>
          {assign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Tugaskan {selectedStudents.size} Siswa
        </Button>
      </div>
    </div>
  );
}

// ===== Main Page =====
export default function PklManagement() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'locations' | 'assignments'>('locations');
  const [showForm, setShowForm] = useState<'add-location' | null>(null);
  const [editLocation, setEditLocation] = useState<PklLocation | null>(null);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { data: locations, isLoading } = useQuery({
    queryKey: ['pkl-locations', search],
    queryFn: () => api<{ success: boolean; data: PklLocation[] }>(`/pkl/locations?search=${encodeURIComponent(search)}`).then((r) => r.data),
  });

  const { data: allStudents } = useQuery({
    queryKey: ['pkl-students'],
    queryFn: () => api<{ success: boolean; data: PklStudent[] }>('/pkl/students').then((r) => r.data),
  });

  const deleteLocation = useMutation({
    mutationFn: (id: string) => api(`/pkl/locations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Lokasi dihapus.');
      qc.invalidateQueries({ queryKey: ['pkl-locations'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus.'),
  });

  const deleteAssignment = useMutation({
    mutationFn: (id: string) => api(`/pkl/assignments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Penugasan dihapus.');
      qc.invalidateQueries({ queryKey: ['pkl-locations'] });
      qc.invalidateQueries({ queryKey: ['pkl-students'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus.'),
  });

  return (
    <div>
      <PageHeader
        title="Manajemen PKL"
        subtitle="Kelola lokasi PKL, penugasan siswa, dan guru pembimbing"
      />

      {/* Tabs */}
      <div className="mb-4 flex items-center justify-between">
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as 'locations' | 'assignments')}
          options={[
            { value: 'locations', label: `Lokasi (${locations?.length ?? 0})` },
            { value: 'assignments', label: `Penugasan (${allStudents?.length ?? 0})` },
          ]}
        />
        {tab === 'locations' && (
          <Button onClick={() => setShowForm('add-location')}>
            <Plus className="h-4 w-4" /> Tambah Lokasi
          </Button>
        )}
      </div>

      {/* ===== TAB LOKASI ===== */}
      {tab === 'locations' && (
        <>
          {/* Add Location Form */}
          {showForm === 'add-location' && (
            <Card className="mb-4">
              <p className="mb-3 font-bold text-ink">Tambah Lokasi PKL</p>
              <LocationForm onClose={() => setShowForm(null)} />
            </Card>
          )}

          {/* Edit Location Form */}
          {editLocation && (
            <Card className="mb-4">
              <p className="mb-3 font-bold text-ink">Edit Lokasi PKL</p>
              <LocationForm initial={editLocation} onClose={() => setEditLocation(null)} />
            </Card>
          )}

          {/* Assignment Form */}
          {assignTo && (
            <Card className="mb-4">
              <p className="mb-3 font-bold text-ink">Tugaskan Siswa ke Lokasi</p>
              <AssignmentForm locationId={assignTo} onClose={() => setAssignTo(null)} />
            </Card>
          )}

          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input className="pl-10" placeholder="Cari lokasi / kota..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {/* Locations list */}
          {isLoading && <Skeleton className="h-32 w-full" />}
          {!isLoading && (
        <div className="space-y-3">
          {locations && locations.length === 0 && (
            <EmptyState icon={MapPin} title="Belum ada lokasi PKL" description="Klik 'Tambah Lokasi' untuk menambahkan tempat PKL." />
          )}
          {locations?.map((loc) => (
            <Card key={loc.id} className="overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-bold text-ink">{loc.name}</p>
                    <p className="text-xs text-muted">{loc.city ?? '-'} · {loc.address ?? '-'} · Radius: {loc.radiusMeter}m</p>
                    {loc.contactName && <p className="text-xs text-muted">PIC: {loc.contactName}{loc.phone ? ` · ${loc.phone}` : ''}</p>}
                    <p className="mt-1 text-xs font-semibold text-primary">{loc.studentCount} siswa ditugaskan</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" className="!px-2 !py-1.5" onClick={() => setAssignTo(loc.id)} title="Tambah siswa">
                    <Users className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" className="!px-2 !py-1.5" onClick={() => setEditLocation(loc)} title="Edit">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="danger" className="!px-2 !py-1.5" onClick={() => {
                    if (window.confirm(`Hapus lokasi "${loc.name}"? Semua penugasan siswa juga akan dihapus.`)) deleteLocation.mutate(loc.id);
                  }} title="Hapus">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {/* Students list */}
              {loc.students.length > 0 && (
                <div className="mt-3 border-t border-line pt-3 dark:border-slate-600">
                  <div className="space-y-1.5">
                    {loc.students.map((s) => (
                      <div key={s.assignmentId} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{s.fullName}</p>
                          <p className="text-xs text-muted">{s.nis} · {s.className ?? '-'}{s.supervisorName ? ` · 👨‍🏫 ${s.supervisorName}` : ''}</p>
                        </div>
                        <button
                          onClick={() => {
                            if (window.confirm(`Hapus penugasan ${s.fullName}?`)) deleteAssignment.mutate(s.assignmentId);
                          }}
                          className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
          {!isLoading && locations && locations.length === 0 && (
            <EmptyState icon={MapPin} title="Belum ada lokasi PKL" description="Klik 'Tambah Lokasi' untuk menambahkan tempat PKL." />
          )}
        </div>
        )}
        </>
      )}

      {/* ===== TAB PENUGASAN ===== */}
      {tab === 'assignments' && (
        <>
          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input className="pl-10" placeholder="Cari siswa / lokasi..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {isLoading && <Skeleton className="h-32 w-full" />}
          {!isLoading && (
            <div className="space-y-3">
              {allStudents && allStudents.length === 0 && (
                <EmptyState icon={GraduationCap} title="Belum ada siswa PKL" description="Tugaskan siswa ke lokasi PKL dari tab Lokasi." />
              )}
              {/* Group by location */}
              {locations?.filter((l) => l.students.length > 0).map((loc) => (
                <Card key={loc.id}>
                  <p className="mb-2 font-bold text-ink">{loc.name} <span className="text-xs font-normal text-muted">({loc.city ?? '-'})</span></p>
                  <div className="space-y-1.5">
                    {loc.students.map((s) => (
                      <div key={s.assignmentId} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-ink">{s.fullName}</p>
                          <p className="text-xs text-muted">{s.nis} · {s.className ?? '-'}{s.supervisorName ? ` · 👨‍🏫 ${s.supervisorName}` : ''}</p>
                        </div>
                        <button
                          onClick={() => {
                            if (window.confirm(`Hapus penugasan ${s.fullName} dari ${loc.name}?`)) deleteAssignment.mutate(s.assignmentId);
                          }}
                          className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
