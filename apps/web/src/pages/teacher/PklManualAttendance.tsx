import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserRound, CheckCircle2, Clock, ClipboardEdit } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Card, Badge, Button, BottomSheet, EmptyState, Skeleton, Segmented } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS, STATUS_COLORS, todayJakartaKey } from '../../lib/format';

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

const STATUS_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'PRESENT',      label: 'Hadir',         color: 'text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20' },
  { value: 'LATE',         label: 'Terlambat',     color: 'text-amber-600   border-amber-200   bg-amber-50   dark:bg-amber-900/20'   },
  { value: 'SICK',         label: 'Sakit',         color: 'text-blue-600    border-blue-200    bg-blue-50    dark:bg-blue-900/20'    },
  { value: 'EXCUSED',      label: 'Izin',          color: 'text-purple-600  border-purple-200  bg-purple-50  dark:bg-purple-900/20'  },
  { value: 'OFFICIAL_DUTY',label: 'Dinas',         color: 'text-cyan-600    border-cyan-200    bg-cyan-50    dark:bg-cyan-900/20'    },
  { value: 'ABSENT',       label: 'Alpa',          color: 'text-red-600     border-red-200     bg-red-50     dark:bg-red-900/20'     },
];

const TYPE_OPTIONS = [
  { value: 'CHECK_IN',  label: 'Datang' },
  { value: 'CHECK_OUT', label: 'Pulang' },
];

function statusColorClass(s: string): string {
  switch (s) {
    case 'PRESENT':       return 'bg-emerald-100 text-emerald-600';
    case 'LATE':          return 'bg-amber-100 text-amber-600';
    case 'SICK':          return 'bg-blue-100 text-blue-600';
    case 'EXCUSED':       return 'bg-purple-100 text-purple-600';
    case 'OFFICIAL_DUTY': return 'bg-cyan-100 text-cyan-600';
    case 'ABSENT':        return 'bg-red-100 text-red-600';
    default:              return 'bg-slate-100 text-slate-400';
  }
}

export default function PklManualAttendance() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [date, setDate] = useState(todayJakartaKey());
  const [tab, setTab] = useState<'all' | 'present' | 'absent'>('all');
  const [selected, setSelected] = useState<SupervisedStudent | null>(null);

  // Form state bottom sheet
  const [formType, setFormType]     = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [formStatus, setFormStatus] = useState('PRESENT');
  const [formCheckIn, setFormCheckIn]   = useState('');
  const [formCheckOut, setFormCheckOut] = useState('');
  const [formNotes, setFormNotes]   = useState('');

  // Ambil teacherId dari /pkl/me
  const { data: pklMe } = useQuery({
    queryKey: ['pkl-me'],
    queryFn: () =>
      api<{ success: boolean; data: { isSupervisor: boolean; isPklAdmin: boolean; teacherId: string | null } }>('/pkl/me').then((r) => r.data),
    staleTime: 60_000,
  });
  const teacherId = pklMe?.teacherId;

  // Daftar siswa bimbingan — endpoint yang sama dengan PklDashboard, sudah ter-scope otomatis
  const { data: students, isLoading } = useQuery({
    queryKey: ['pkl-supervisor', teacherId, date],
    queryFn: () =>
      api<{ success: boolean; data: SupervisedStudent[] }>(`/pkl/supervisor/${teacherId}`).then((r) => r.data),
    enabled: !!teacherId,
  });

  const mutation = useMutation({
    mutationFn: (payload: {
      studentId: string;
      status: string;
      type: string;
      date: string;
      checkIn?: string;
      checkOut?: string;
      notes?: string;
    }) => api('/pkl/manual-attendance', { method: 'POST', body: payload }),
    onSuccess: () => {
      toast('success', 'Absensi PKL berhasil disimpan.');
      qc.invalidateQueries({ queryKey: ['pkl-supervisor'] });
      setSelected(null);
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan absensi.'),
  });

  function openSheet(student: SupervisedStudent) {
    setSelected(student);
    // Pre-fill form berdasarkan data yang sudah ada
    const att = student.todayAttendance;
    setFormType(att.checkIn ? 'CHECK_OUT' : 'CHECK_IN');
    setFormStatus(att.status !== 'NOT_YET' ? att.status : 'PRESENT');
    setFormCheckIn(att.checkIn ?? '');
    setFormCheckOut(att.checkOut ?? '');
    setFormNotes('');
  }

  function handleSubmit() {
    if (!selected) return;
    mutation.mutate({
      studentId: selected.studentId,
      status: formStatus,
      type: formType,
      date,
      checkIn:  formType === 'CHECK_IN'  && formCheckIn  ? formCheckIn  : undefined,
      checkOut: formType === 'CHECK_OUT' && formCheckOut ? formCheckOut : undefined,
      notes:    formNotes || undefined,
    });
  }

  const filtered = students?.filter((s) =>
    tab === 'present' ? s.todayAttendance.status !== 'NOT_YET' && s.todayAttendance.status !== 'ABSENT'
    : tab === 'absent' ? (s.todayAttendance.status === 'NOT_YET' || s.todayAttendance.status === 'ABSENT')
    : true
  );

  const presentCount = students?.filter((s) => ['PRESENT', 'LATE', 'SICK', 'EXCUSED', 'OFFICIAL_DUTY'].includes(s.todayAttendance.status)).length ?? 0;
  const belumCount   = students?.filter((s) => s.todayAttendance.status === 'NOT_YET').length ?? 0;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="rounded-xl p-2 text-muted hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-ink">Absensi Manual PKL</h1>
          <p className="text-sm text-muted">Input/koreksi kehadiran siswa bimbingan PKL</p>
        </div>
      </div>

      {/* Filter tanggal */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
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

      {/* Daftar siswa */}
      <div className="space-y-2">
        {isLoading && (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        )}

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
          const hadir = ['PRESENT', 'LATE', 'SICK', 'EXCUSED', 'OFFICIAL_DUTY'].includes(att.status);
          return (
            <Card
              key={s.assignmentId}
              className="flex cursor-pointer items-center gap-3 p-3.5 transition hover:shadow-sm"
              onClick={() => openSheet(s)}
            >
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${hadir ? statusColorClass(att.status) : 'bg-slate-100 text-slate-400'}`}>
                {hadir ? <CheckCircle2 className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{s.fullName}</p>
                <p className="text-xs text-muted">{s.nis ?? '-'} · {s.className ?? '-'} · {s.location.name}</p>
                {att.checkIn ? (
                  <p className="mt-0.5 text-xs text-muted">
                    Datang <span className="font-semibold text-ink">{att.checkIn}</span>
                    {att.checkOut && <> · Pulang <span className="font-semibold text-ink">{att.checkOut}</span></>}
                    {!att.checkOut && att.checkIn && <span className="text-amber-500"> · Belum pulang</span>}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs font-semibold text-amber-500">Belum absen hari ini</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge status={att.status as never} label={STATUS_LABELS[att.status] ?? att.status} />
                <ClipboardEdit className="h-4 w-4 shrink-0 text-muted" />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Bottom sheet input absensi */}
      <BottomSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? selected?.fullName ?? ''}
      >
        {selected && (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              {selected.nis ?? '-'} · {selected.className ?? '-'} · {selected.location.name}
            </p>

            {/* Tipe: Datang / Pulang */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted uppercase tracking-wide">Tipe Absensi</p>
              <div className="grid grid-cols-2 gap-2">
                {TYPE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setFormType(t.value as 'CHECK_IN' | 'CHECK_OUT')}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                      formType === t.value
                        ? 'border-primary bg-primary text-white'
                        : 'border-line text-ink hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted uppercase tracking-wide">Status Kehadiran</p>
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTIONS.map((st) => (
                  <button
                    key={st.value}
                    onClick={() => setFormStatus(st.value)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                      formStatus === st.value
                        ? 'border-primary bg-primary text-white'
                        : `${st.color} border`
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Jam */}
            <div className="grid grid-cols-2 gap-3">
              {formType === 'CHECK_IN' && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Jam Datang (opsional)</label>
                  <input
                    type="time"
                    value={formCheckIn}
                    onChange={(e) => setFormCheckIn(e.target.value)}
                    className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm dark:bg-slate-900"
                  />
                </div>
              )}
              {formType === 'CHECK_OUT' && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Jam Pulang (opsional)</label>
                  <input
                    type="time"
                    value={formCheckOut}
                    onChange={(e) => setFormCheckOut(e.target.value)}
                    className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm dark:bg-slate-900"
                  />
                </div>
              )}
            </div>

            {/* Catatan */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Catatan (opsional)</label>
              <textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
                placeholder="Misal: sakit demam, izin keluarga..."
                className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm dark:bg-slate-900"
              />
            </div>

            <Button
              onClick={handleSubmit}
              disabled={mutation.isPending}
              className="w-full"
            >
              {mutation.isPending ? 'Menyimpan...' : 'Simpan Absensi'}
            </Button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
