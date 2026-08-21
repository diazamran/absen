import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, Clock, Loader2, RefreshCw, ScanFace, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, Card, EmptyState } from '../../lib/ui';
import { startCamera, stopCamera, captureFrame } from '../../lib/camera';
import { detectFaceDescriptor, initFaceModels, isFaceModelReady } from '../../lib/face';

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

const MAX_SAMPLES = 4;

export default function FaceMe() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [descriptors, setDescriptors] = useState<number[][]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [reEnroll, setReEnroll] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ['face-status', user?.id],
    queryFn: () => api<{ success: boolean; data: FaceStatus }>(`/face/status/${user!.id}`).then((r) => r.data),
    enabled: !!user,
  });

  const needsCamera = reEnroll || (!status?.registered && !status?.pending && !justSubmitted);

  // Panaskan model wajah diam-diam saat halaman terbuka agar sampel pertama cepat
  useEffect(() => {
    initFaceModels().catch(() => {
      // gagal muat di sini tidak fatal; capture akan mencoba lagi
    });
  }, []);

  useEffect(() => {
    if (!needsCamera) return;
    let cancelled = false;
    const init = async () => {
      try {
        const stream = await startCamera(videoRef.current!, 'user');
        streamRef.current = stream;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setCameraError('Kamera tidak dapat diakses. Periksa izin kamera pada browser, lalu coba lagi.');
      }
    };
    init();
    return () => {
      cancelled = true;
      setReady(false);
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, [needsCamera]);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || descriptors.length >= MAX_SAMPLES || modelsLoading) return;
    if (!isFaceModelReady()) setModelsLoading(true);
    try {
      // Deteksi wajah & ekstrak descriptor (diproses di HP, bukan dikirim ke server)
      const descriptor = await detectFaceDescriptor(video);
      if (!descriptor) {
        toast('warning', 'Wajah tidak terdeteksi. Pastikan wajah terlihat jelas, pencahayaan cukup, dan posisikan wajah di tengah.');
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

  const submit = useMutation({
    mutationFn: () => api('/face/register', { method: 'POST', body: { descriptors, consent } }),
    onSuccess: () => {
      toast('success', 'Registrasi wajah dikirim. Menunggu persetujuan admin.');
      setJustSubmitted(true);
      setReEnroll(false);
      setDescriptors([]);
      setPreviews([]);
      setConsent(false);
      qc.invalidateQueries({ queryKey: ['face-status'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal mengirim registrasi wajah.'),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">Registrasi Wajah</h1>
        <p className="text-sm text-muted">Daftarkan wajahmu untuk absensi Face Recognition.</p>
      </div>

      {isLoading && <Card><EmptyState icon={Loader2} title="Memuat status…" /></Card>}

      {/* Terdaftar & versi baru (aktif) */}
      {!isLoading && status?.registered && !status?.needsReenroll && !reEnroll && (
        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-ink">Wajah sudah terdaftar & aktif</p>
              <p className="text-xs text-muted">Kamu bisa langsung absen melalui menu <b>Absen → Absen Wajah</b>.</p>
              <p className="mt-1 text-[11px] text-muted">Untuk mengubah atau mendaftar ulang wajah, hubungi admin / TU.</p>
            </div>
          </div>
        </Card>
      )}

      {/* Terdaftar tapi versi LAMA → wajib daftar ulang */}
      {!isLoading && status?.registered && status?.needsReenroll && !reEnroll && (
        <Card className="space-y-3 border-amber-200 bg-amber-50/60 dark:bg-amber-500/10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
              <RefreshCw className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-ink">Data wajah lama — perlu daftar ulang</p>
              <p className="text-sm text-muted">
                Mesin pengenalan wajah sudah diperbarui menjadi lebih akurat. Data lama tidak bisa dipakai lagi,
                silakan daftar ulang sekali (dengan pencahayaan cukup & beberapa sudut) agar wajahmu dikenali.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setReEnroll(true)}>
              <RefreshCw className="h-4 w-4" /> Daftar Ulang Sekarang
            </Button>
          </div>
        </Card>
      )}

      {!isLoading && (status?.pending || justSubmitted) && (
        <Card className="space-y-3 border-amber-200 bg-amber-50/60 dark:bg-amber-500/10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
              <Clock className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-ink">Menunggu persetujuan admin</p>
              <p className="text-sm text-muted">
                Registrasi wajahmu telah dikirim. Setelah disetujui oleh admin / TU, kamu bisa absen menggunakan wajah.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ['face-status'] })}>
            Periksa Status
          </Button>
        </Card>
      )}

      {!isLoading && needsCamera && (
        <>
          <Card>
            <p className="mb-2 text-sm font-semibold text-ink">1. Ambil Sampel Wajah</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="relative overflow-hidden rounded-2xl bg-slate-900" style={{ aspectRatio: '4/3' }}>
                  <video ref={videoRef} className="camera-view h-full w-full" muted playsInline />
                  {!ready && !cameraError && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Menyalakan kamera…</div>
                  )}
                  {cameraError && (
                    <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-red-300">{cameraError}</div>
                  )}
                </div>
                <Button className="mt-3 w-full" onClick={capture} disabled={!ready || descriptors.length >= MAX_SAMPLES || modelsLoading}>
                  {modelsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  {modelsLoading
                    ? 'Menyiapkan model wajah…'
                    : `Ambil Sampel (${descriptors.length}/${MAX_SAMPLES})`}
                </Button>
                {!isFaceModelReady() && !modelsLoading && (
                  <p className="mt-2 text-center text-[11px] text-muted">
                    Sampel pertama memuat model wajah (±5 MB, sekali saja).
                  </p>
                )}
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
                      <EmptyState icon={Camera} title="Belum ada sampel" description="Posisikan wajah di tengah layar, lalu tekan Ambil Sampel. Ambil beberapa sampel dari sudut sedikit berbeda." />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

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
              Saya menyetujui pendaftaran data wajah saya untuk keperluan absensi sekolah.
            </label>
            <div className="flex justify-end gap-2">
              {reEnroll && (
                <Button variant="outline" onClick={() => { setReEnroll(false); setDescriptors([]); setPreviews([]); }}>
                  Batal
                </Button>
              )}
              <Button onClick={() => submit.mutate()} disabled={descriptors.length === 0 || !consent || submit.isPending}>
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanFace className="h-4 w-4" />}
                Kirim untuk Persetujuan
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
