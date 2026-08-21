import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScanFace, Search, Camera, CheckCircle2, Trash2, Loader2, ShieldCheck, Clock } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Card, Input, Badge, EmptyState, Skeleton } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { startCamera, stopCamera, captureFrame } from '../../lib/camera';
import { detectFaceDescriptor, initFaceModels, isFaceModelReady } from '../../lib/face';

interface StudentRow {
  id: string;
  userId: string;
  nis: string;
  fullName: string;
  className: string | null;
  faceRegistered: boolean;
}

interface RegisteredFace {
  userId: string;
  fullName: string;
  nis: string | null;
  className: string | null;
  samples: number;
  embeddingsCount: number;
  status: string;
}

interface FaceStatus {
  registered: boolean;
  pending: boolean;
  status: string;
  provider: string | null;
  samples: number;
  embeddingsCount: number;
  consentAt: string | null;
  needsReenroll?: boolean;
}

interface PendingRow {
  userId: string;
  fullName: string;
  nis: string | null;
  className: string | null;
  samples: number;
  embeddingsCount: number;
  submittedAt: string;
}

const MAX_SAMPLES = 4;

export default function FaceRegister() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<StudentRow | null>(null);
  const [pendingSelected, setPendingSelected] = useState<Set<string>>(new Set());
  const [registeredSelected, setRegisteredSelected] = useState<Set<string>>(new Set());
  const [descriptors, setDescriptors] = useState<number[][]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [ready, setReady] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);

  const { data: results } = useQuery({
    queryKey: ['students', search],
    queryFn: () =>
      api<{ success: boolean; data: StudentRow[] }>(`/students?search=${encodeURIComponent(search)}&pageSize=20`).then((r) => r.data),
  });

  const { data: faceStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['face-status', selected?.userId],
    queryFn: () => api<{ success: boolean; data: FaceStatus }>(`/face/status/${selected!.userId}`).then((r) => r.data),
    enabled: !!selected,
  });

  // Daftar wajah yang menunggu persetujuan
  const { data: pending, isLoading: pendingLoading } = useQuery({
    queryKey: ['face-pending'],
    queryFn: () => api<{ success: boolean; data: PendingRow[] }>('/face/pending').then((r) => r.data),
  });

  const approveMutation = useMutation({
    mutationFn: (userId: string) => api(`/face/${userId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      toast('success', 'Registrasi wajah disetujui.');
      qc.invalidateQueries({ queryKey: ['face-pending'] });
      qc.invalidateQueries({ queryKey: ['face-status'] });
      qc.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyetujui.'),
  });

  const bulkApprove = useMutation({
    mutationFn: async () => {
      for (const userId of pendingSelected) {
        await api(`/face/${userId}/approve`, { method: 'POST' });
      }
    },
    onSuccess: () => {
      toast('success', `${pendingSelected.size} registrasi wajah disetujui.`);
      setPendingSelected(new Set());
      qc.invalidateQueries({ queryKey: ['face-pending'] });
      qc.invalidateQueries({ queryKey: ['face-status'] });
      qc.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyetujui massal.'),
  });

  const bulkReset = useMutation({
    mutationFn: async () => {
      for (const userId of pendingSelected) {
        await api(`/face/${userId}`, { method: 'DELETE' });
      }
    },
    onSuccess: () => {
      toast('success', `${pendingSelected.size} data wajah dihapus.`);
      setPendingSelected(new Set());
      qc.invalidateQueries({ queryKey: ['face-pending'] });
      qc.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus massal.'),
  });

  const togglePending = (userId: string) => {
    setPendingSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };
  const toggleAllPending = () => {
    if (!pending?.length) return;
    setPendingSelected((prev) => (prev.size === pending.length ? new Set() : new Set(pending.map((p) => p.userId))));
  };

  // Daftar siswa yang sudah punya wajah terdaftar
  const { data: registeredFaces, isLoading: regLoading } = useQuery({
    queryKey: ['face-registered'],
    queryFn: () => api<{ success: boolean; data: RegisteredFace[] }>('/face/registered').then((r) => r.data),
  });

  const bulkResetRegistered = useMutation({
    mutationFn: async () => {
      for (const userId of registeredSelected) {
        await api(`/face/${userId}`, { method: 'DELETE' });
      }
    },
    onSuccess: () => {
      toast('success', `${registeredSelected.size} data wajah dihapus.`);
      setRegisteredSelected(new Set());
      qc.invalidateQueries({ queryKey: ['face-registered'] });
      qc.invalidateQueries({ queryKey: ['face-status'] });
      qc.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus massal.'),
  });

  const toggleRegistered = (userId: string) => {
    setRegisteredSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };
  const toggleAllRegistered = () => {
    if (!registeredFaces?.length) return;
    setRegisteredSelected((prev) => (prev.size === registeredFaces.length ? new Set() : new Set(registeredFaces.map((r) => r.userId))));
  };

  // Nyalakan kamera saat siswa dipilih & belum terdaftar
  useEffect(() => {
    if (!selected || faceStatus?.registered || faceStatus?.pending) return;
    let cancelled = false;
    const init = async () => {
      try {
        const stream = await startCamera(videoRef.current!, 'user');
        streamRef.current = stream;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setCameraError('Kamera tidak dapat diakses. Periksa izin kamera pada browser.');
      }
    };
    init();
    return () => {
      cancelled = true;
      setReady(false);
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, [selected?.userId, faceStatus?.registered]);

  // Panaskan model wajah diam-diam agar sampel pertama cepat
  useEffect(() => {
    initFaceModels().catch(() => {
      // tidak fatal; capture akan mencoba lagi
    });
  }, []);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || descriptors.length >= MAX_SAMPLES || modelsLoading) return;
    if (!isFaceModelReady()) setModelsLoading(true);
    try {
      // Deteksi wajah & ekstrak descriptor langsung di browser
      const descriptor = await detectFaceDescriptor(video);
      if (!descriptor) {
        toast('warning', 'Wajah tidak terdeteksi. Pastikan wajah siswa terlihat jelas, pencahayaan cukup, dan posisikan wajah di tengah.');
        return;
      }
      const frame = captureFrame(video);
      setDescriptors((s) => [...s, Array.from(descriptor)]);
      if (frame) setPreviews((p) => [...p, frame]);
      toast('success', `Sampel ${descriptors.length + 1} diambil.`);
    } catch {
      toast('error', 'Gagal memproses wajah. Coba lagi.');
    } finally {
      setModelsLoading(false);
    }
  };

  const registerMutation = useMutation({
    mutationFn: () => api('/face/register', { method: 'POST', body: { userId: selected!.userId, descriptors, consent } }),
    onSuccess: () => {
      toast('success', 'Registrasi wajah berhasil.');
      setDescriptors([]);
      setPreviews([]);
      setConsent(false);
      qc.invalidateQueries({ queryKey: ['face-status'] });
      qc.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan data wajah.'),
  });

  const resetMutation = useMutation({
    mutationFn: (userId: string) => api(`/face/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Data wajah telah dihapus.');
      qc.invalidateQueries({ queryKey: ['face-status'] });
      qc.invalidateQueries({ queryKey: ['face-pending'] });
      qc.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus data wajah.'),
  });

  const pick = (s: StudentRow) => {
    setSelected(s);
    setDescriptors([]);
    setPreviews([]);
    setConsent(false);
    setCameraError('');
    setSearch('');
  };

  return (
    <div>
      <PageHeader title="Registrasi Wajah" subtitle="Daftarkan data wajah siswa untuk absensi Face Recognition" />

      {/* Menunggu persetujuan */}
      {pendingLoading && <Skeleton className="mb-4 h-24 w-full" />}
      {!pendingLoading && pending && pending.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50/50 dark:bg-amber-500/5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-600" />
              <p className="font-bold text-ink">Menunggu Persetujuan ({pending.length})</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={pendingSelected.size === pending.length && pending.length > 0} onChange={toggleAllPending} className="h-4 w-4 accent-[var(--primary)]" />
              Pilih semua
            </label>
          </div>
          {pendingSelected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-100/60 px-3 py-2 dark:bg-amber-500/10">
              <span className="text-xs font-semibold text-ink">{pendingSelected.size} dipilih</span>
              <Button className="!px-3 !py-1.5 text-xs" onClick={() => {
                if (window.confirm(`Setujui ${pendingSelected.size} registrasi wajah?`)) bulkApprove.mutate();
              }} disabled={bulkApprove.isPending}>
                {bulkApprove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Setujui Semua
              </Button>
              <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => {
                if (window.confirm(`Hapus data wajah ${pendingSelected.size} siswa?`)) bulkReset.mutate();
              }} disabled={bulkReset.isPending}>
                {bulkReset.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Hapus Semua
              </Button>
            </div>
          )}
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.userId} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 dark:bg-slate-800/70 ${pendingSelected.has(p.userId) ? 'border-primary bg-primary-soft/30' : 'border-line/60 bg-surface'}`}>
                <input type="checkbox" checked={pendingSelected.has(p.userId)} onChange={() => togglePending(p.userId)} className="h-4 w-4 shrink-0 accent-[var(--primary)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{p.fullName}</p>
                  <p className="text-xs text-muted">{p.nis ?? '-'} · {p.className ?? '-'} · {p.samples} sampel</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="!px-3 !py-1.5 text-xs" onClick={() => {
                    if (window.confirm(`Hapus data wajah ${p.fullName}? Siswa harus mendaftar ulang.`)) resetMutation.mutate(p.userId);
                  }} disabled={resetMutation.isPending}>
                    <Trash2 className="h-3.5 w-3.5" /> Reset
                  </Button>
                  <Button className="!px-3 !py-1.5 text-xs" onClick={() => approveMutation.mutate(p.userId)} disabled={approveMutation.isPending}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Setujui
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Siswa dengan wajah terdaftar */}
      {regLoading && <Skeleton className="mb-4 h-24 w-full" />}
      {!regLoading && registeredFaces && registeredFaces.length > 0 && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50/50 dark:bg-emerald-500/5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <p className="font-bold text-ink">Wajah Terdaftar ({registeredFaces.length})</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={registeredSelected.size === registeredFaces.length && registeredFaces.length > 0} onChange={toggleAllRegistered} className="h-4 w-4 accent-[var(--primary)]" />
              Pilih semua
            </label>
          </div>
          {registeredSelected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-100/60 px-3 py-2 dark:bg-red-500/10">
              <span className="text-xs font-semibold text-ink">{registeredSelected.size} dipilih</span>
              <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => {
                if (window.confirm(`Hapus data wajah ${registeredSelected.size} siswa? Semua harus mendaftar ulang.`)) bulkResetRegistered.mutate();
              }} disabled={bulkResetRegistered.isPending}>
                {bulkResetRegistered.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Reset Massal
              </Button>
            </div>
          )}
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {registeredFaces.map((r) => (
              <div key={r.userId} className={`flex items-center gap-3 rounded-xl border p-2.5 dark:bg-slate-800/70 ${registeredSelected.has(r.userId) ? 'border-primary bg-primary-soft/30' : 'border-line/60 bg-surface'}`}>
                <input type="checkbox" checked={registeredSelected.has(r.userId)} onChange={() => toggleRegistered(r.userId)} className="h-4 w-4 shrink-0 accent-[var(--primary)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{r.fullName}</p>
                  <p className="text-xs text-muted">{r.nis ?? '-'} · {r.className ?? '-'} · {r.embeddingsCount} embedding</p>
                </div>
                <Badge status="APPROVED" label="Aktif" />
                <button
                  onClick={() => {
                    if (window.confirm(`Reset wajah ${r.fullName}? Siswa harus mendaftar ulang.`)) resetMutation.mutate(r.userId);
                  }}
                  className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-500"
                  title="Reset wajah"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Pilih siswa */}
      <Card className="mb-4">
        <p className="mb-2 text-sm font-semibold text-ink">1. Pilih Siswa</p>
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            className="pl-10"
            placeholder="Cari nama atau NISN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearch((s) => s)}
          />
          {search.trim() !== '' && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-float">
              {results?.length === 0 && <p className="px-3 py-3 text-sm text-muted">Tidak ada siswa ditemukan.</p>}
              {results?.map((s) => (
                <button
                  key={s.id}
                  onClick={() => pick(s)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-primary-soft/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{s.fullName}</p>
                    <p className="text-xs text-muted">{s.nis} · {s.className ?? '-'}</p>
                  </div>
                  {s.faceRegistered && <Badge status="APPROVED" label="Terdaftar" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-primary-soft/50 p-3">
            <div className="min-w-0">
              <p className="truncate font-bold text-ink">{selected.fullName}</p>
              <p className="text-xs text-muted">{selected.nis} · {selected.className ?? '-'}</p>
            </div>
            <button onClick={() => setSelected(null)} className="text-xs font-semibold text-primary hover:underline">
              Ganti
            </button>
          </div>
        )}
      </Card>

      {selected && (
        <>
          {statusLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : faceStatus?.registered || faceStatus?.pending ? (
            <Card className="space-y-3">
              <div className="flex items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${faceStatus.pending ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                  {faceStatus.pending ? <Clock className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
                </div>
                <div>
                  <p className="font-bold text-ink">{faceStatus.pending ? 'Menunggu persetujuan' : 'Wajah sudah terdaftar'}</p>
                  <p className="text-xs text-muted">
                    Provider: {faceStatus.provider ?? '-'} · Sampel: {faceStatus.samples} · Embedding: {faceStatus.embeddingsCount}
                    {faceStatus.needsReenroll && ' · ⚠️ Data LAMA, perlu daftar ulang'}
                  </p>
                </div>
                <div className="ml-auto"><Badge status={faceStatus.pending ? 'PENDING' : 'APPROVED'} label={faceStatus.pending ? 'Menunggu' : 'Aktif'} /></div>
              </div>
              <p className="text-xs text-muted">
                {faceStatus.pending ? (
                  'Siswa mendaftar wajah dari HP-nya sendiri. Setujui agar bisa absen wajah, atau reset bila data bermasalah.'
                ) : (
                  <>
                    Siswa ini sudah bisa melakukan absensi melalui <b>Absen Wajah</b> (login sebagai siswa → menu Absen).
                  </>
                )}
              </p>
              <div className="flex justify-end gap-2">
                {faceStatus.pending && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (window.confirm('Hapus data wajah siswa ini? Siswa harus mendaftar ulang.')) resetMutation.mutate(selected.userId);
                    }}
                    disabled={resetMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" /> Reset
                  </Button>
                )}
                {faceStatus.pending ? (
                  <Button onClick={() => approveMutation.mutate(selected.userId)} disabled={approveMutation.isPending}>
                    {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Setujui
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (window.confirm('Hapus seluruh data wajah siswa ini? Siswa harus mendaftar ulang untuk absen wajah.')) {
                        resetMutation.mutate(selected.userId);
                      }
                    }}
                    disabled={resetMutation.isPending}
                  >
                    {resetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Reset Data Wajah
                  </Button>
                )}
              </div>
            </Card>
          ) : (
            <>
              {/* Kamera + sampel */}
              <Card className="mb-4">
                <p className="mb-2 text-sm font-semibold text-ink">2. Ambil Sampel Wajah</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="relative overflow-hidden rounded-2xl bg-slate-900" style={{ aspectRatio: '4/3' }}>
                      <video ref={videoRef} className="camera-view h-full w-full" muted playsInline />
                      {!ready && !cameraError && (
                        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
                          Menyalakan kamera…
                        </div>
                      )}
                      {cameraError && (
                        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-red-300">{cameraError}</div>
                      )}
                    </div>
                    <Button className="mt-3 w-full" onClick={capture} disabled={!ready || descriptors.length >= MAX_SAMPLES || modelsLoading}>
                      {modelsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                      {modelsLoading ? 'Menyiapkan model wajah…' : `Ambil Sampel (${descriptors.length}/${MAX_SAMPLES})`}
                    </Button>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-medium text-muted">Sampel yang diambil</p>
                    <div className="grid grid-cols-2 gap-2">
                      {previews.map((s, i) => (
                        <div key={i} className="overflow-hidden rounded-xl border border-line">
                          <img src={s} alt={`Sampel ${i + 1}`} className="aspect-square w-full object-cover" />
                        </div>
                      ))}
                      {previews.length === 0 && (
                        <div className="col-span-2">
                          <EmptyState icon={Camera} title="Belum ada sampel" description="Arahkan wajah siswa ke kamera, lalu tekan tombol Ambil Sampel." />
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      Minta siswa melihat ke kamera, posisi wajah di tengah, dan sedikit mengubah posisi kepala tiap sampel.
                    </p>
                  </div>
                </div>
              </Card>

              {/* Consent + simpan */}
              <Card className="space-y-3">
                <div className="flex items-start gap-3 rounded-2xl bg-primary-soft/40 p-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <p className="text-xs leading-relaxed text-muted">
                    Data biometrik digunakan <b>hanya</b> untuk verifikasi kehadiran dan dikelola sesuai kebijakan privasi sekolah.
                    Foto mentah tidak disimpan — yang disimpan hanyalah representasi matematis (embedding).
                  </p>
                </div>
                <label className="flex items-start gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                  />
                  Saya menyatakan siswa <b>&nbsp;{selected.fullName}&nbsp;</b> telah menyetujui pendaftaran data wajah untuk keperluan absensi.
                </label>
                <div className="flex justify-end">
                  <Button
                    onClick={() => registerMutation.mutate()}
                    disabled={descriptors.length === 0 || !consent || registerMutation.isPending}
                  >
                    {registerMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanFace className="h-4 w-4" />}
                    Simpan Registrasi
                  </Button>
                </div>
              </Card>
            </>
          )}
        </>
      )}

      {!selected && (
        <EmptyState
          icon={ScanFace}
          title="Pilih siswa untuk memulai"
          description="Cari siswa berdasarkan nama atau NISN, lalu daftarkan wajahnya melalui kamera."
        />
      )}
    </div>
  );
}
