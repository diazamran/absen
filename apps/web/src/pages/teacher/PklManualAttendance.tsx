import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserRound, CheckCircle2, Clock, ClipboardEdit, CheckSquare, Square, Users } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Card, Badge, Button, BottomSheet, EmptyState, Skeleton, Segmented } from '../../lib/ui';
import { STATUS_LABELS, todayJakartaKey } from '../../lib/format';

interface SupervisedStudent {
  assignmentId: string;
  studentId: string;
  fullName: string;
  nis: string | null;
  className: string | null;
  location: { id: string; name: string; city: string | null };
  todayAttendance: {
    checkIn: string | null;
    checkOut: string | null;
    status: string;
    method: string | null;
    lateMinutes?: number | null;
    earlyLeave?: boolean;
  };
}

const STATUS_OPTIONS: { value: string; label: string; colorClass: string }[] = [
  { value: 'PRESENT',       label: 'Hadir',     colorClass: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20' },
  { value: 'LATE',          label: 'Terlambat', colorClass: 'border-amber-200   bg-amber-50   text-amber-700   dark:bg-amber-900/20'   },
  { value: 'SICK',          label: 'Sakit',     colorClass: 'border-blue-200    bg-blue-50    text-blue-700    dark:bg-blue-900/20'    },
  { value: 'EXCUSED',       label: 'Izin',      colorClass: 'border-purple-200  bg-purple-50  text-purple-700  dark:bg-purple-900/20'  },
  { value: 'OFFICIAL_DUTY', label: 'Dinas',     colorClass: 'border-cyan-200    bg-cyan-50    text-cyan-700    dark:bg-cyan-900/20'    },
  { value: 'ABSENT',        label: 'Alpa',      colorClass: 'border-red-200     bg-red-50     text-red-700     dark:bg-red-900/20'     },
  { value: 'LEAVE',         label: 'Cuti',      colorClass: 'border-indigo-200  bg-indigo-50  text-indigo-700  dark:bg-indigo-900/20'  },
  { value: 'HOLIDAY',       label: 'Libur',     colorClass: 'border-slate-200   bg-slate-100  text-slate-600   dark:bg-slate-700/40'   },
];

const TYPE_OPTIONS = [
  { value: 'CHECK_IN',  label: 'Datang' },
  { value: 'CHECK_OUT', label: 'Pulang' },
];

function statusBadgeClass(s: string): string {
  switch (s) {
    case 'PRESENT':       return 'bg-emerald-100 text-emerald-600';
    case 'LATE':          return 'bg-amber-100 text-amber-600';
    case 'SICK':          return 'bg-blue-100 text-blue-600';
    case 'EXCUSED':       return 'bg-purple-100 text-purple-600';
    case 'OFFICIAL_DUTY': return 'bg-cyan-100 text-cyan-600';
    case 'ABSENT':        return 'bg-red-100 text-red-600';
    case 'LEAVE':         return 'bg-indigo-100 text-indigo-600';
    case 'HOLIDAY':       return 'bg-slate-100 text-slate-500';
    default:              return 'bg-slate-100 text-slate-400';
  }
}

export default function PklManualAttendance() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [date, setDate] = useState(todayJakartaKey());
  const [tab, setTab] = useState<'all' | 'present' | 'absent'>('all');

  // ── Mode seleksi ──────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Bottom sheet individual ────────────────────────────────────
  const [singleStudent, setSingleStudent] = useState<SupervisedStudent | null>(null);
  const [formType, setFormType]       = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [formStatus, setFormStatus]   = useState('PRESENT');
  const [formCheckIn, setFormCheckIn]   = useState('');
  const [formCheckOut, setFormCheckOut] = useState('');
  const [formNotes, setFormNotes]     = useState('');

  // ── Bottom sheet massal ────────────────────────────────────────
  const [bulkOpen, setBulkOpen]       = useState(false);
  const [bulkType, setBulkType]       = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [bulkStatus, setBulkStatus]   = useState('PRESENT');
  const [bulkCheckIn, setBulkCheckIn]   = useState('');
  const [bulkCheckOut, setBulkCheckOut] = useState('');
  const [bulkNotes, setBulkNotes]     = useState('');

  // ── Data ──────────────────────────────────────────────────────
  const { data: pklMe } = useQuery({
    queryKey: ['pkl-me'],
    queryFn: () =>
      api<{ success: boolean; data: { isSupervisor: boolean; isPklAdmin: boolean; teacherId: string | null } }>('/pkl/me')
        .then((r) => r.data),
    staleTime: 60_000,
  });
  const teacherId = pklMe?.teacherId;

  const { data: students, isLoading } = useQuery({
    queryKey: ['pkl-supervisor', teacherId, date],
    queryFn: () =>
      api<{ success: boolean; data: SupervisedStudent[] }>(`/pkl/supervisor/${teacherId}`)
        .then((r) => r.data),
    enabled: !!teacherId,
  });

  // ── Mutations ─────────────────────────────────────────────────
  const singleMutation = useMutation({
    mutationFn: (payload: {
      studentId: string; status: string; type: string; date: string;
      checkIn?: string; checkOut?: string; notes?: string;
    }) => api('/pkl/manual-attendance', { method: 'POST', body: payload }),
    onSuccess: () => {
      toast('success', 'Absensi PKL berhasil disimpan.');
      qc.invalidateQueries({ queryKey: ['pkl-supervisor'] });
      setSingleStudent(null);
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  const bulkMutation = useMutation({
    mutationFn: (payload: {
      studentIds: string[]; status: string; type: string; date: string;
      checkIn?: string; checkOut?: string; notes?: string;
    }) => api('/pkl/manual-attendance/bulk', { method: 'POST', body: payload }),
    onSuccess: (res: any) => {
      toast('success', res?.message ?? 'Absensi massal berhasil.');
      qc.invalidateQueries({ queryKey: ['pkl-supervisor'] });
      setBulkOpen(false);
      setSelectedIds(new Set());
      setSelectMode(false);
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  // ── Helpers ───────────────────────────────────────────────────
  function openSingle(student: SupervisedStudent) {
    if (selectMode) return toggleSelect(student.studentId);
    setSingleStudent(student);
    const att = student.todayAttendance;
    setFormType(att.checkIn ? 'CHECK_OUT' : 'CHECK_IN');
    setFormStatus(att.status !== 'NOT_YET' ? att.status : 'PRESENT');
    setFormCheckIn(att.checkIn ?? '');
    setFormCheckOut(att.checkOut ?? '');
    setFormNotes('');
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!filtered) return;
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((s) => s.studentId)));
    }
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function submitSingle() {
    if (!singleStudent) return;
    singleMutation.mutate({
      studentId: singleStudent.studentId,
      status: formStatus,
      type: formType,
      date,
      checkIn:  formType === 'CHECK_IN'  && formCheckIn  ? formCheckIn  : undefined,
      checkOut: formType === 'CHECK_OUT' && formCheckOut ? formCheckOut : undefined,
      notes: formNotes || undefined,
    });
  }

  function submitBulk() {
    bulkMutation.mutate({
      studentIds: Array.from(selectedIds),
      status: bulkStatus,
      type: bulkType,
      date,
      checkIn:  bulkType === 'CHECK_IN'  && bulkCheckIn  ? bulkCheckIn  : undefined,
      checkOut: bulkType === 'CHECK_OUT' && bulkCheckOut ? bulkCheckOut : undefined,
      notes: bulkNotes || undefined,
    });
  }

  // ── Derived state ─────────────────────────────────────────────
  const filtered = useMemo(() =>
    students?.filter((s) =>
      tab === 'present'
        ? !['NOT_YET', 'ABSENT'].includes(s.todayAttendance.status)
        : tab === 'absent'
        ? ['NOT_YET', 'ABSENT'].includes(s.todayAttendance.status)
        : true
    ), [students, tab]);

  const presentCount = students?.filter((s) => ['PRESENT', 'LATE', 'SICK', 'EXCUSED', 'OFFICIAL_DUTY', 'LEAVE', 'HOLIDAY'].includes(s.todayAttendance.status)).length ?? 0;
  const belumCount   = students?.filter((s) => ['NOT_YET', 'ABSENT'].includes(s.todayAttendance.status)).length ?? 0;
  const allSelected  = !!filtered?.length && selectedIds.size === filtered.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  return (
    <div className="pb-32">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => selectMode ? exitSelectMode() : navigate(-1)}
          className="rounded-xl p-2 text-muted hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-ink">Absensi Manual PKL</h1>
          <p className="text-sm text-muted">
            {selectMode ? `${selectedIds.size} siswa dipilih` : 'Input/koreksi kehadiran siswa bimbingan PKL'}
          </p>
        </div>
        {/* Tombol masuk / keluar mode pilih */}
        {!selectMode ? (
          <button
            onClick={() => setSelectMode(true)}
            className="flex items-center gap-1.5 rounded-xl border border-primary px-3 py-2 text-xs font-bold text-primary hover:bg-primary/5"
          >
            <Users className="h-4 w-4" />
            Pilih Massal
          </button>
        ) : (
          <button
            onClick={exitSelectMode}
            className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-muted hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Batal
          </button>
        )}
      </div>

      {/* Filter */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={(v) => { setTab(v); setSelectedIds(new Set()); }}
          options={[
            { value: 'all',     label: `Semua (${students?.length ?? 0})` },
            { value: 'present', label: `Hadir (${presentCount})` },
            { value: 'absent',  label: `Belum (${belumCount})` },
          ]}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900"
        />
      </div>

      {/* Stats mini */}
      {!isLoading && students && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Card className="p-3 text-center">
            <p className="text-xl font-extrabold text-emerald-500">{presentCount}</p>
            <p className="text-xs text-muted">Sudah Hadir</p>
          </Card>
          <Card className="p-3 text-center">
            <p className="text-xl font-extrabold text-amber-500">{belumCount}</p>
            <p className="text-xs text-muted">Belum Absen</p>
          </Card>
          <Card className="p-3 text-center">
            <p className="text-xl font-extrabold text-primary">{students.length}</p>
            <p className="text-xs text-muted">Total Siswa</p>
          </Card>
        </div>
      )}

      {/* Toolbar Pilih Semua — muncul saat mode seleksi */}
      {selectMode && !!filtered?.length && (
        <button
          onClick={toggleSelectAll}
          className="mb-3 flex w-full items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          {allSelected
            ? <CheckSquare className="h-5 w-5 text-primary" />
            : someSelected
            ? <CheckSquare className="h-5 w-5 text-slate-400" />
            : <Square className="h-5 w-5 text-slate-400" />
          }
          {allSelected ? 'Batalkan semua pilihan' : `Pilih semua (${filtered.length})`}
        </button>
      )}

      {/* Daftar siswa */}
      <div className="space-y-2">
        {isLoading && <><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></>}

        {!isLoading && !teacherId && (
          <Card className="p-6 text-center">
            <p className="text-sm text-muted">Anda tidak terdaftar sebagai guru pembimbing PKL.</p>
          </Card>
        )}

        {!isLoading && teacherId && filtered?.length === 0 && (
          <EmptyState icon={UserRound} title="Tidak ada siswa" description="Belum ada siswa PKL yang ditugaskan kepada Anda." />
        )}

        {filtered?.map((s) => {
          const att = s.todayAttendance;
          const hadir = ['PRESENT', 'LATE', 'SICK', 'EXCUSED', 'OFFICIAL_DUTY', 'LEAVE', 'HOLIDAY'].includes(att.status);
          const isChecked = selectedIds.has(s.studentId);

          return (
            <Card
              key={s.assignmentId}
              className={`flex cursor-pointer items-center gap-3 p-3.5 transition hover:shadow-sm ${isChecked ? 'ring-2 ring-primary bg-primary/5' : ''}`}
              onClick={() => openSingle(s)}
            >
              {/* Checkbox area */}
              {selectMode && (
                <div className="shrink-0">
                  {isChecked
                    ? <CheckSquare className="h-6 w-6 text-primary" />
                    : <Square className="h-6 w-6 text-slate-300 dark:text-slate-600" />
                  }
                </div>
              )}

              {/* Status icon */}
              {!selectMode && (
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${hadir ? statusBadgeClass(att.status) : 'bg-slate-100 text-slate-400'}`}>
                  {hadir ? <CheckCircle2 className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
                </div>
              )}

              {/* Info siswa */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{s.fullName}</p>
                <p className="text-xs text-muted">{s.nis ?? '-'} · {s.className ?? '-'} · {s.location.name}</p>
                {att.checkIn ? (
                  <p className="mt-0.5 text-xs text-muted">
                    Datang <span className="font-semibold text-ink">{att.checkIn}</span>
                    {att.checkOut
                      ? <> · Pulang <span className="font-semibold text-ink">{att.checkOut}</span></>
                      : <span className="text-amber-500"> · Belum pulang</span>
                    }
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs font-semibold text-amber-500">Belum absen hari ini</p>
                )}
              </div>

              {/* Badge + edit icon */}
              <div className="flex items-center gap-2 shrink-0">
                <Badge status={att.status as never} label={STATUS_LABELS[att.status] ?? att.status} />
                {!selectMode && <ClipboardEdit className="h-4 w-4 text-muted" />}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Toolbar aksi massal — fixed bottom, muncul saat ada yang dipilih */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-20 left-0 right-0 z-40 flex justify-center px-4">
          <div className="flex w-full max-w-md items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-2xl ring-1 ring-line dark:bg-slate-900">
            <p className="flex-1 text-sm font-bold text-ink">
              {selectedIds.size} siswa dipilih
            </p>
            <button
              onClick={() => {
                setBulkType('CHECK_IN');
                setBulkStatus('PRESENT');
                setBulkCheckIn('');
                setBulkCheckOut('');
                setBulkNotes('');
                setBulkOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90"
            >
              <ClipboardEdit className="h-4 w-4" />
              Isi Absensi
            </button>
          </div>
        </div>
      )}

      {/* ── Bottom sheet: absensi individual ── */}
      <BottomSheet open={!!singleStudent} onClose={() => setSingleStudent(null)} title={singleStudent?.fullName ?? ''}>
        {singleStudent && (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              {singleStudent.nis ?? '-'} · {singleStudent.className ?? '-'} · {singleStudent.location.name}
            </p>

            {/* Tipe */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Tipe Absensi</p>
              <div className="grid grid-cols-2 gap-2">
                {TYPE_OPTIONS.map((t) => (
                  <button key={t.value} onClick={() => setFormType(t.value as 'CHECK_IN' | 'CHECK_OUT')}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${formType === t.value ? 'border-primary bg-primary text-white' : 'border-line text-ink hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Status Kehadiran</p>
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTIONS.map((st) => (
                  <button key={st.value} onClick={() => setFormStatus(st.value)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${formStatus === st.value ? 'border-primary bg-primary text-white' : `${st.colorClass} border`}`}>
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Jam */}
            {formType === 'CHECK_IN' && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Jam Datang (opsional)</label>
                <input type="time" value={formCheckIn} onChange={(e) => setFormCheckIn(e.target.value)}
                  className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm dark:bg-slate-900" />
              </div>
            )}
            {formType === 'CHECK_OUT' && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Jam Pulang (opsional)</label>
                <input type="time" value={formCheckOut} onChange={(e) => setFormCheckOut(e.target.value)}
                  className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm dark:bg-slate-900" />
              </div>
            )}

            {/* Catatan */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Catatan (opsional)</label>
              <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2}
                placeholder="Misal: sakit demam, izin keluarga..."
                className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm dark:bg-slate-900" />
            </div>

            <Button onClick={submitSingle} disabled={singleMutation.isPending} className="w-full">
              {singleMutation.isPending ? 'Menyimpan...' : 'Simpan Absensi'}
            </Button>
          </div>
        )}
      </BottomSheet>

      {/* ── Bottom sheet: absensi massal ── */}
      <BottomSheet
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={`Absensi Massal — ${selectedIds.size} Siswa`}
      >
        <div className="space-y-4">
          <p className="rounded-xl bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
            Status yang dipilih akan diterapkan ke <b>{selectedIds.size} siswa</b> sekaligus.
          </p>

          {/* Tipe */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Tipe Absensi</p>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map((t) => (
                <button key={t.value} onClick={() => setBulkType(t.value as 'CHECK_IN' | 'CHECK_OUT')}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${bulkType === t.value ? 'border-primary bg-primary text-white' : 'border-line text-ink hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Status Kehadiran</p>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map((st) => (
                <button key={st.value} onClick={() => setBulkStatus(st.value)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${bulkStatus === st.value ? 'border-primary bg-primary text-white' : `${st.colorClass} border`}`}>
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {/* Jam */}
          {bulkType === 'CHECK_IN' && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Jam Datang (opsional)</label>
              <input type="time" value={bulkCheckIn} onChange={(e) => setBulkCheckIn(e.target.value)}
                className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm dark:bg-slate-900" />
            </div>
          )}
          {bulkType === 'CHECK_OUT' && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Jam Pulang (opsional)</label>
              <input type="time" value={bulkCheckOut} onChange={(e) => setBulkCheckOut(e.target.value)}
                className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm dark:bg-slate-900" />
            </div>
          )}

          {/* Catatan */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Catatan (opsional)</label>
            <textarea value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} rows={2}
              placeholder="Misal: kunjungan industri, libur bersama..."
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm dark:bg-slate-900" />
          </div>

          <Button onClick={submitBulk} disabled={bulkMutation.isPending} className="w-full">
            {bulkMutation.isPending ? 'Menyimpan...' : `Simpan Absensi ${selectedIds.size} Siswa`}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
