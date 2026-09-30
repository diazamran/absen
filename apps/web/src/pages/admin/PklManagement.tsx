import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Trash2, Edit, Users, Search, Loader2, X, ChevronDown, Building2, GraduationCap, Download, Upload, Clock3 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { Button, Card, Input, Badge, EmptyState, Skeleton } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { Segmented } from '../../lib/ui';

// ===== Types =====
interface PklSchedule {
  lateAfterHour: number;
  lateAfterMinute: number;
  checkInDeadlineHour: number;
  checkInDeadlineMinute: number;
  checkOutAfterHour: number;
  checkOutAfterMinute: number;
  earlyLeaveBeforeHour: number;
  earlyLeaveBeforeMinute: number;
}

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
  startDate: string | null;
  endDate: string | null;
  workDays: number[] | null;
  schedule: PklSchedule | null;
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
  teacherId: string | null;
  fullName: string;
  nip: string | null;
  isPiket: boolean;
}

// ===== Helper: TimeInput (jam:menit) =====
function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h, m] = value.split(':').map(Number);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="flex items-center gap-1">
      <select
        value={h}
        onChange={(e) => onChange(`${pad2(Number(e.target.value))}:${pad2(m)}`)}
        className="rounded-xl border border-line bg-white px-2 py-2 text-sm text-ink dark:bg-slate-900"
      >
        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{pad2(i)}</option>)}
      </select>
      <span className="font-bold text-muted">:</span>
      <select
        value={m}
        onChange={(e) => onChange(`${pad2(h)}:${pad2(Number(e.target.value))}`)}
        className="rounded-xl border border-line bg-white px-2 py-2 text-sm text-ink dark:bg-slate-900"
      >
        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((i) => (
          <option key={i} value={i}>{pad2(i)}</option>
        ))}
      </select>
    </div>
  );
}

// ===== Schedule Form (jadwal PKL per-lokasi) =====
function ScheduleForm({
  locationId,
  locationName,
  initialSchedule,
  onClose,
  readOnly,
}: {
  locationId: string;
  locationName: string;
  initialSchedule: PklSchedule | null;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pad2 = (n: number) => String(n).padStart(2, '0');

  const DEFAULT_SCHEDULE: PklSchedule = {
    lateAfterHour: 8, lateAfterMinute: 0,
    checkInDeadlineHour: 23, checkInDeadlineMinute: 59,
    checkOutAfterHour: 16, checkOutAfterMinute: 0,
    earlyLeaveBeforeHour: 15, earlyLeaveBeforeMinute: 30,
  };

  const [schedOn, setSchedOn] = useState(initialSchedule !== null);
  const [sched, setSched] = useState<PklSchedule>(initialSchedule ?? DEFAULT_SCHEDULE);
  const setS = (k: keyof PklSchedule, v: number) => setSched((s) => ({ ...s, [k]: v }));
  const setTime = (key: string, val: string) => {
    const [h, m] = val.split(':').map(Number);
    setSched((s) => ({ ...s, [`${key}Hour`]: h, [`${key}Minute`]: m }));
  };

  const save = useMutation({
    mutationFn: () =>
      api(`/pkl/locations/${locationId}`, {
        method: 'PUT',
        body: { schedule: schedOn ? sched : null },
      }),
    onSuccess: () => {
      toast('success', 'Jadwal PKL disimpan.');
      qc.invalidateQueries({ queryKey: ['pkl-locations'] });
      onClose();
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan jadwal.'),
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Jadwal absensi khusus untuk <span className="font-semibold text-ink">{locationName}</span>. Jika tidak diatur, siswa di lokasi ini mengikuti jadwal PKL global di Settings.
      </p>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input
          type="checkbox"
          checked={schedOn}
          onChange={(e) => setSchedOn(e.target.checked)}
          disabled={readOnly}
          className="h-4 w-4 accent-teal-600"
        />
        Aktifkan jadwal khusus untuk lokasi ini
      </label>

      {schedOn && (
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Batas terlambat</label>
            <TimeInput
              value={`${pad2(sched.lateAfterHour)}:${pad2(sched.lateAfterMinute)}`}
              onChange={(v) => setTime('lateAfter', v)}
            />
            <p className="mt-1 text-xs text-muted">Absen datang setelah jam ini = Terlambat.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Batas akhir absen datang</label>
            <TimeInput
              value={`${pad2(sched.checkInDeadlineHour)}:${pad2(sched.checkInDeadlineMinute)}`}
              onChange={(v) => setTime('checkInDeadline', v)}
            />
            <p className="mt-1 text-xs text-muted">Setelah jam ini, absen datang ditutup. 23:59 = tidak dibatasi.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Jam selesai kerja</label>
            <TimeInput
              value={`${pad2(sched.checkOutAfterHour)}:${pad2(sched.checkOutAfterMinute)}`}
              onChange={(v) => setTime('checkOutAfter', v)}
            />
            <p className="mt-1 text-xs text-muted">Acuan jam pulang PKL di laporan.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Mulai dihitung Pulang Awal</label>
            <TimeInput
              value={`${pad2(sched.earlyLeaveBeforeHour)}:${pad2(sched.earlyLeaveBeforeMinute)}`}
              onChange={(v) => setTime('earlyLeaveBefore', v)}
            />
            <p className="mt-1 text-xs text-muted">Absen pulang sebelum jam ini = Pulang Awal. Sekaligus jam absen pulang dibuka.</p>
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Simpan Jadwal
          </Button>
        </div>
      )}
    </div>
  );
}

// ===== Location Form (hanya untuk admin) =====
function LocationForm({ initial, onClose }: { initial?: PklLocation; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pad2 = (n: number) => String(n).padStart(2, '0');

  const [form, setForm] = useState({
    name: initial?.name ?? '',
    address: initial?.address ?? '',
    city: initial?.city ?? '',
    latitude: (() => {
      const v = initial?.latitude;
      if (v == null) return '';
      return (Number.isFinite(v) && v >= -90 && v <= 90) ? v : '';
    })(),
    longitude: (() => {
      const v = initial?.longitude;
      if (v == null) return '';
      return (Number.isFinite(v) && v >= -180 && v <= 180) ? v : '';
    })(),
    radiusMeter: initial?.radiusMeter ?? 100,
    phone: initial?.phone ?? '',
    contactName: initial?.contactName ?? '',
    startDate: initial?.startDate ?? '',
    endDate: initial?.endDate ?? '',
    workDays: initial?.workDays ?? [1, 2, 3, 4, 5], // default Senin-Jumat
  });

  // Jadwal PKL di-handle di ScheduleForm terpisah (tab bawah) untuk edit,
  // atau bisa langsung di sini saat create dengan toggle.
  const [schedOn, setSchedOn] = useState(!!initial?.schedule);
  const DEFAULT_SCHED = {
    lateAfterHour: 8, lateAfterMinute: 0,
    checkInDeadlineHour: 23, checkInDeadlineMinute: 59,
    checkOutAfterHour: 16, checkOutAfterMinute: 0,
    earlyLeaveBeforeHour: 15, earlyLeaveBeforeMinute: 30,
  };
  const [sched, setSched] = useState<PklSchedule>(initial?.schedule ?? DEFAULT_SCHED);
  const setTime = (key: string, val: string) => {
    const [h, m] = val.split(':').map(Number);
    setSched((s) => ({ ...s, [`${key}Hour`]: h, [`${key}Minute`]: m }));
  };

  // Hitung durasi PKL berdasarkan workDays yang dipilih
  const durasiHariKerja = (() => {
    if (!form.startDate || !form.endDate) return null;
    const start = new Date(form.startDate);
    const end = new Date(form.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return null;
    const workSet = new Set(form.workDays);
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const wd = cur.getDay(); // 0=Min,1=Sen,...,6=Sab
      const wdNum = wd === 0 ? 7 : wd;
      if (workSet.has(wdNum)) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  })();

  const save = useMutation({
    mutationFn: () => {
      const lat = parseFloat(String(form.latitude));
      const lng = parseFloat(String(form.longitude));
      const validLat = Number.isFinite(lat) && lat >= -90 && lat <= 90;
      const validLng = Number.isFinite(lng) && lng >= -180 && lng <= 180;
      const body = {
        ...form,
        latitude: validLat ? lat : undefined,
        longitude: validLng ? lng : undefined,
        radiusMeter: Number(form.radiusMeter),
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        workDays: form.workDays.length > 0 ? form.workDays : [1, 2, 3, 4, 5],
        schedule: schedOn ? sched : null,
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

      {/* Periode PKL */}
      <div className="rounded-2xl border border-line/70 bg-slate-50/60 p-3 dark:bg-slate-900/40">
        <p className="mb-2 text-xs font-semibold text-ink">📅 Periode & Hari Kerja PKL</p>
        {/* Hari kerja */}
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold text-muted">Hari Kerja di Tempat PKL</p>
          <div className="flex flex-wrap gap-2">
            {[
              { d: 1, label: 'Sen' }, { d: 2, label: 'Sel' }, { d: 3, label: 'Rab' },
              { d: 4, label: 'Kam' }, { d: 5, label: 'Jum' }, { d: 6, label: 'Sab' }, { d: 7, label: 'Min' },
            ].map(({ d, label }) => {
              const checked = form.workDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    const next = checked
                      ? form.workDays.filter((x) => x !== d)
                      : [...form.workDays, d].sort();
                    set('workDays', next);
                  }}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                    checked
                      ? d >= 6
                        ? 'bg-amber-500 text-white'
                        : 'bg-primary text-white'
                      : 'bg-slate-100 text-muted hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted">
            Dipilih: {form.workDays.length} hari/minggu
            {form.workDays.includes(6) || form.workDays.includes(7)
              ? ' · Termasuk akhir pekan'
              : ' · Hanya hari kerja'}
          </p>
        </div>
        {/* Tanggal mulai-selesai */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Tanggal Mulai</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Tanggal Selesai</label>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900"
            />
          </div>
        </div>
        {durasiHariKerja !== null && (
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-primary-soft/40 px-3 py-2">
            <span className="text-xs font-semibold text-primary">⏱ Durasi PKL:</span>
            <span className="text-sm font-bold text-ink">{durasiHariKerja} hari kerja</span>
            <span className="text-xs text-muted">({form.startDate} s.d. {form.endDate})</span>
          </div>
        )}
        {form.startDate && form.endDate && durasiHariKerja === null && (
          <p className="mt-1 text-xs text-red-500">Tanggal selesai tidak boleh sebelum tanggal mulai.</p>
        )}
        <p className="mt-2 text-xs text-muted">Opsional — dipakai untuk menghitung hari kerja di laporan bulanan PKL.</p>
      </div>

      {/* Jadwal PKL per-lokasi */}
      <div className="rounded-2xl border border-line/70 bg-slate-50/60 p-3 dark:bg-slate-900/40">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            checked={schedOn}
            onChange={(e) => setSchedOn(e.target.checked)}
            className="h-4 w-4 accent-teal-600"
          />
          <Clock3 className="h-4 w-4 text-muted" />
          Jadwal absensi khusus untuk DUDI ini
        </label>
        <p className="mt-1 text-xs text-muted">
          Aktifkan jika jam kerja DUDI ini berbeda dari jadwal PKL global. Guru pembimbing juga bisa mengatur jadwal ini nanti.
        </p>
        {schedOn && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Batas terlambat</label>
              <TimeInput
                value={`${pad2(sched.lateAfterHour)}:${pad2(sched.lateAfterMinute)}`}
                onChange={(v) => setTime('lateAfter', v)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Batas akhir absen datang</label>
              <TimeInput
                value={`${pad2(sched.checkInDeadlineHour)}:${pad2(sched.checkInDeadlineMinute)}`}
                onChange={(v) => setTime('checkInDeadline', v)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Jam selesai kerja</label>
              <TimeInput
                value={`${pad2(sched.checkOutAfterHour)}:${pad2(sched.checkOutAfterMinute)}`}
                onChange={(v) => setTime('checkOutAfter', v)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Mulai dihitung Pulang Awal</label>
              <TimeInput
                value={`${pad2(sched.earlyLeaveBeforeHour)}:${pad2(sched.earlyLeaveBeforeMinute)}`}
                onChange={(v) => setTime('earlyLeaveBefore', v)}
              />
            </div>
          </div>
        )}
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
// canSetSupervisor: true = admin (bisa pilih guru), false = guru (supervisorId auto = dirinya)
function AssignmentForm({
  locationId,
  canSetSupervisor,
  onClose,
}: {
  locationId: string;
  canSetSupervisor: boolean;
  onClose: () => void;
}) {
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
    enabled: canSetSupervisor,
    queryFn: () =>
      api<{ success: boolean; data: TeacherOption[] }>('/users?pageSize=200').then((r) =>
        (r.data ?? []).filter((u: TeacherOption & { roleKey?: string; additionalRoles?: string[] }) => {
          const roles = [u.roleKey, ...((u as TeacherOption & { additionalRoles?: string[] }).additionalRoles || [])];
          return roles.includes('TEACHER') || roles.includes('HOMEROOM_TEACHER') || roles.includes('SUPER_ADMIN');
        }),
      ),
  });

  const assign = useMutation({
    mutationFn: async () => {
      await api('/pkl/assignments/bulk', {
        method: 'POST',
        body: {
          studentIds: [...selectedStudents],
          pklLocationId: locationId,
          ...(canSetSupervisor ? { supervisorId: supervisorId || undefined } : {}),
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
      {canSetSupervisor && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Guru Pembimbing</label>
          <select
            value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink dark:border-slate-600 dark:bg-slate-800"
          >
            <option value="">— Pilih Guru —</option>
            {teachers?.filter((t) => t.teacherId).map((t) => (
              <option key={t.id} value={t.teacherId!}>{t.fullName}{t.nip ? ` (${t.nip})` : ''}</option>
            ))}
          </select>
        </div>
      )}

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
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'locations' | 'assignments'>('locations');

  // Check if current user is PKL admin or supervisor
  const { data: pklRole, isLoading: pklRoleLoading } = useQuery({
    queryKey: ['pkl-me'],
    queryFn: () =>
      api<{ success: boolean; data: { isSupervisor: boolean; isPklAdmin: boolean; teacherId: string | null; supervisedLocationIds: string[] } }>(
        '/pkl/me',
      ).then((r) => r.data),
    staleTime: 60_000,
  });

  // isPklAdmin: admin/kepala sekolah — bisa CRUD lokasi dan manage semua penugasan
  const isPklAdmin = pklRole?.isPklAdmin ?? false;
  // isSupervisor: guru yang sudah di-mapping ke minimal 1 lokasi PKL
  const isSupervisor = pklRole?.isSupervisor ?? false;
  const supervisedLocationIds = pklRole?.supervisedLocationIds ?? [];
  // canManage: bisa manage penugasan (admin atau supervisor di lokasi itu)
  const canManage = isPklAdmin || isSupervisor;

  const [showForm, setShowForm] = useState<'add-location' | null>(null);
  const [editLocation, setEditLocation] = useState<PklLocation | null>(null);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  // jadwal form: hanya untuk lokasi yang bisa diedit (admin atau supervisor lokasi)
  const [scheduleFor, setScheduleFor] = useState<PklLocation | null>(null);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: locations, isLoading } = useQuery({
    queryKey: ['pkl-locations', search],
    queryFn: () => api<{ success: boolean; data: PklLocation[] }>(`/pkl/locations?search=${encodeURIComponent(search)}`).then((r) => r.data),
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

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nama Tempat', 'Kota', 'Alamat', 'Latitude', 'Longitude', 'Radius (meter)', 'Kontak / PIC', 'No. HP'],
      ['PT. Maju Jaya', 'Kediri', 'Jl. Raya No. 123', -7.8205, 112.0153, 100, 'Budi Santoso', '08123456789'],
    ]);
    ws['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Template Lokasi PKL');
    XLSX.writeFile(wb, 'template-lokasi-pkl.xlsx');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/import/pkl-locations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      }).then((r) => r.json());
      if (res.success) {
        toast('success', res.message);
        qc.invalidateQueries({ queryKey: ['pkl-locations'] });
      } else {
        toast('error', res.message || 'Gagal import.');
      }
    } catch {
      toast('error', 'Gagal import lokasi PKL.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const pad2 = (n: number) => String(n).padStart(2, '0');

  return (
    <div>
      <PageHeader
        title="Manajemen PKL"
        subtitle={
          isPklAdmin
            ? 'Kelola lokasi PKL, penugasan siswa, dan guru pembimbing'
            : isSupervisor
            ? 'Kelola siswa bimbingan PKL Anda dan atur jadwal absensi per DUDI'
            : 'Lihat data PKL'
        }
      />

      {/* Tabs */}
      <div className="mb-4 flex items-center justify-between">
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as 'locations' | 'assignments')}
          options={[
            {
              value: 'locations',
              label: `Lokasi (${
                pklRoleLoading ? '…' :
                isPklAdmin
                  ? (locations?.length ?? 0)
                  : (locations ?? []).filter((l) => supervisedLocationIds.includes(l.id)).length
              })`,
            },
            {
              value: 'assignments',
              label: `Penugasan (${
                pklRoleLoading ? '…' :
                isPklAdmin
                  ? (locations?.reduce((sum, l) => sum + l.students.length, 0) ?? 0)
                  : (locations ?? [])
                      .filter((l) => supervisedLocationIds.includes(l.id))
                      .reduce((sum, l) => sum + l.students.length, 0)
              })`,
            },
          ]}
        />
        {tab === 'locations' && isPklAdmin && (
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> Template
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Import Excel
            </Button>
            <Button onClick={() => setShowForm('add-location')}>
              <Plus className="h-4 w-4" /> Tambah Lokasi
            </Button>
          </div>
        )}
      </div>

      {/* Guru non-admin: banner info */}
      {!isPklAdmin && isSupervisor && (
        <div className="mb-4 rounded-2xl bg-primary-soft/30 border border-primary/20 px-4 py-3 text-sm text-ink">
          <p className="font-semibold text-primary mb-0.5">👨‍🏫 Mode Guru Pembimbing PKL</p>
          <p className="text-xs text-muted">
            Anda dapat menambah / menghapus siswa bimbingan dan mengatur jadwal absensi di lokasi PKL yang Anda bimbing.
            Lokasi PKL dikelola oleh admin.
          </p>
        </div>
      )}

      {/* ===== TAB LOKASI ===== */}
      {tab === 'locations' && (
        <>
          {/* Add Location Form (admin only) */}
          {showForm === 'add-location' && (
            <Card className="mb-4">
              <p className="mb-3 font-bold text-ink">Tambah Lokasi PKL</p>
              <LocationForm onClose={() => setShowForm(null)} />
            </Card>
          )}

          {/* Edit Location Form (admin only) */}
          {editLocation && (
            <Card className="mb-4">
              <p className="mb-3 font-bold text-ink">Edit Lokasi PKL</p>
              <LocationForm initial={editLocation} onClose={() => setEditLocation(null)} />
            </Card>
          )}

          {/* Schedule Form (admin atau guru pembimbing lokasi) */}
          {scheduleFor && (
            <Card className="mb-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-bold text-ink flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-primary" />
                  Jadwal PKL — {scheduleFor.name}
                </p>
                <button onClick={() => setScheduleFor(null)} className="rounded p-1 text-muted hover:bg-slate-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ScheduleForm
                locationId={scheduleFor.id}
                locationName={scheduleFor.name}
                initialSchedule={scheduleFor.schedule}
                onClose={() => setScheduleFor(null)}
              />
            </Card>
          )}

          {/* Assignment Form */}
          {assignTo && (
            <Card className="mb-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-bold text-ink">
                  Tambah Siswa ke {locations?.find((l) => l.id === assignTo)?.name ?? 'Lokasi PKL'}
                </p>
                <button onClick={() => setAssignTo(null)} className="rounded p-1 text-muted hover:bg-slate-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <AssignmentForm
                locationId={assignTo}
                canSetSupervisor={isPklAdmin}
                onClose={() => setAssignTo(null)}
              />
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
          {(isLoading || pklRoleLoading) && <Skeleton className="h-32 w-full" />}
          {!isLoading && !pklRoleLoading && (
            <div className="space-y-3">
              {(() => {
                // Guru non-admin hanya lihat lokasi yang ia bimbing
                const visibleLocations = isPklAdmin
                  ? (locations ?? [])
                  : (locations ?? []).filter((l) => supervisedLocationIds.includes(l.id));
                if (visibleLocations.length === 0) {
                  return isPklAdmin
                    ? <EmptyState icon={MapPin} title="Belum ada lokasi PKL" description="Klik 'Tambah Lokasi' untuk menambahkan tempat PKL." />
                    : <EmptyState icon={MapPin} title="Belum ada lokasi PKL yang dibimbing" description="Minta admin untuk mendaftarkan Anda sebagai pembimbing di lokasi PKL." />;
                }
                return null;
              })()}
              {(isPklAdmin ? (locations ?? []) : (locations ?? []).filter((l) => supervisedLocationIds.includes(l.id))).map((loc) => {
                // Guru selalu bisa manage lokasinya (sudah difilter)
                const isMyLocation = supervisedLocationIds.includes(loc.id);
                const canManageLoc = isPklAdmin || isMyLocation;

                return (
                  <Card key={loc.id} className="overflow-hidden">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                          <Building2 className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-ink">{loc.name}</p>
                            {isMyLocation && !isPklAdmin && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Bimbingan Anda</span>
                            )}
                            {loc.schedule && (
                              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                                🕐 Jadwal khusus
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted">{loc.city ?? '-'} · {loc.address ?? '-'} · Radius: {loc.radiusMeter}m</p>
                          {loc.contactName && <p className="text-xs text-muted">PIC: {loc.contactName}{loc.phone ? ` · ${loc.phone}` : ''}</p>}
                          {(loc.startDate || loc.endDate) && (
                            <p className="text-xs text-muted">
                              📅 {loc.startDate ?? '?'} s.d. {loc.endDate ?? '?'}
                              {loc.startDate && loc.endDate && (() => {
                                const start = new Date(loc.startDate!);
                                const end = new Date(loc.endDate!);
                                const workSet = new Set(loc.workDays ?? [1, 2, 3, 4, 5]);
                                let count = 0;
                                const cur = new Date(start);
                                while (cur <= end) {
                                  const wd = cur.getDay();
                                  const wdNum = wd === 0 ? 7 : wd;
                                  if (workSet.has(wdNum)) count++;
                                  cur.setDate(cur.getDate() + 1);
                                }
                                return ` · ${count} hari kerja`;
                              })()}
                            </p>
                          )}
                          {loc.workDays && (
                            <p className="text-xs text-muted">
                              {(() => {
                                const names = ['', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
                                return '🗓 ' + loc.workDays.map((d: number) => names[d]).join(', ');
                              })()}
                            </p>
                          )}
                          {/* Tampilkan ringkasan jadwal jika ada */}
                          {loc.schedule && (
                            <p className="text-xs text-teal-700 dark:text-teal-400">
                              🕐 Masuk: {pad2(loc.schedule.lateAfterHour)}:{pad2(loc.schedule.lateAfterMinute)} · Pulang: {pad2(loc.schedule.checkOutAfterHour)}:{pad2(loc.schedule.checkOutAfterMinute)}
                            </p>
                          )}
                          <p className="mt-1 text-xs font-semibold text-primary">{loc.studentCount} siswa ditugaskan</p>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-col gap-1 items-end">
                        {/* Tombol kelola untuk guru di lokasi bimbingannya */}
                        {canManageLoc && (
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              className="!px-2 !py-1.5"
                              onClick={() => setAssignTo(loc.id)}
                              title="Tambah siswa"
                            >
                              <Users className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              className="!px-2 !py-1.5"
                              onClick={() => setScheduleFor(loc)}
                              title="Atur jadwal PKL"
                            >
                              <Clock3 className="h-4 w-4" />
                            </Button>
                            {isPklAdmin && (
                              <>
                                <Button variant="outline" className="!px-2 !py-1.5" onClick={() => setEditLocation(loc)} title="Edit lokasi">
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="danger"
                                  className="!px-2 !py-1.5"
                                  onClick={() => {
                                    if (window.confirm(`Hapus lokasi "${loc.name}"? Semua penugasan siswa juga akan dihapus.`)) deleteLocation.mutate(loc.id);
                                  }}
                                  title="Hapus"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        )}
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
                              {canManageLoc && (
                                <button
                                  onClick={() => {
                                    if (window.confirm(`Hapus penugasan ${s.fullName}?`)) deleteAssignment.mutate(s.assignmentId);
                                  }}
                                  className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-500"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
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
              {locations?.filter((l) => {
                // Guru hanya lihat lokasi yang dibimbing + ada siswanya
                if (!isPklAdmin) return supervisedLocationIds.includes(l.id) && l.students.length > 0;
                return l.students.length > 0;
              }).length === 0 && (
                <EmptyState
                  icon={GraduationCap}
                  title="Belum ada siswa PKL"
                  description={isPklAdmin ? 'Tugaskan siswa ke lokasi PKL dari tab Lokasi.' : 'Anda belum memiliki siswa bimbingan PKL.'}
                />
              )}
              {/* Group by location */}
              {locations
                ?.filter((l) => {
                  if (!isPklAdmin) return supervisedLocationIds.includes(l.id) && l.students.length > 0;
                  return l.students.length > 0;
                })
                .map((loc) => {
                  const isMyLocation = supervisedLocationIds.includes(loc.id);
                  const canManageLoc = isPklAdmin || isMyLocation;
                  return (
                    <Card key={loc.id}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="font-bold text-ink">
                          {loc.name}{' '}
                          <span className="text-xs font-normal text-muted">({loc.city ?? '-'})</span>
                        </p>
                        {canManageLoc && (
                          <Button
                            variant="outline"
                            className="!px-2 !py-1"
                            onClick={() => setAssignTo(loc.id)}
                            title="Tambah siswa"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {loc.students.map((s) => (
                          <div key={s.assignmentId} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-ink">{s.fullName}</p>
                              <p className="text-xs text-muted">{s.nis} · {s.className ?? '-'}{s.supervisorName ? ` · 👨‍🏫 ${s.supervisorName}` : ''}</p>
                            </div>
                            {canManageLoc && (
                              <button
                                onClick={() => {
                                  if (window.confirm(`Hapus penugasan ${s.fullName} dari ${loc.name}?`)) deleteAssignment.mutate(s.assignmentId);
                                }}
                                className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                })}
            </div>
          )}
          {/* Assignment form juga bisa muncul di tab penugasan */}
          {assignTo && (
            <Card className="mt-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-bold text-ink">
                  Tambah Siswa ke {locations?.find((l) => l.id === assignTo)?.name ?? 'Lokasi PKL'}
                </p>
                <button onClick={() => setAssignTo(null)} className="rounded p-1 text-muted hover:bg-slate-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <AssignmentForm
                locationId={assignTo}
                canSetSupervisor={isPklAdmin}
                onClose={() => setAssignTo(null)}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
