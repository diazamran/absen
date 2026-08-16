import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, Clock, Loader2, ScanFace, ShieldCheck, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, Card, EmptyState } from '../../lib/ui';
import { startCamera, stopCamera, captureFrame } from '../../lib/camera';

interface FaceStatus {
  registered: boolean;
  pending: boolean;
  status: string;
  provider: string | null;
  samples: number;
  embeddingsCount: number;
  consentAt: string | null;
}

const MAX_SAMPLES = 4;

export default function FaceMe() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [samples, setSamples] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ['face-status', user?.id],
    queryFn: () => api<{ success: boolean; data: FaceStatus }>(`/face/status/${user!.id}`).then((r) => r.data),
    enabled: !!user,
  });

  const needsCamera = !status?.registered && !status?.pending && !justSubmitted;

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

  const capture = () => {
    const video = videoRef.current;
    if (!video || samples.length >= MAX_SAMPLES) return;
    const frame = captureFrame(video);
    if (!frame) {
      toast('warning', 'Wajah belum terlihat jelas. Pastikan pencahayaan cukup dan posisikan wajah di tengah.');
      return;
    }
    setSamples((s) => [...s, frame]);
  };

  const reset = useMutation({
    mutationFn: () => api(`/face/${user!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Data wajah kamu telah dihapus.');
      qc.invalidateQueries({ queryKey: ['face-status'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus data wajah.'),
  });

  const submit = useMutation({
    mutationFn: () => api('/face/register', { method: 'POST', body: { samples, consent } }),
    onSuccess: () => {
      toast('success', 'Registrasi wajah dikirim. Menunggu persetujuan admin.');
      setJustSubmitted(true);
      setSamples([]);
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

      {!isLoading && status?.registered && (
        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-ink">Wajah sudah terdaftar & aktif</p>
              <p className="text-xs text-muted">Kamu bisa langsung absen melalui menu <b>Absen → Absen Wajah</b>.</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm('Hapus data wajah kamu? Kamu harus mendaftar ulang untuk absen wajah.')) reset.mutate();
              }}
              disabled={reset.isPending}
            >
              {reset.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Hapus Data Wajah
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

      {!isLoading && !status?.registered && !status?.pending && !justSubmitted && (
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
                <Button className="mt-3 w-full" onClick={capture} disabled={!ready || samples.length >= MAX_SAMPLES}>
                  <Camera className="h-4 w-4" />
                  Ambil Sampel ({samples.length}/{MAX_SAMPLES})
                </Button>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted">Sampel yang diambil</p>
                <div className="grid grid-cols-2 gap-2">
                  {samples.map((s, i) => (
                    <div key={i} className="overflow-hidden rounded-xl border border-line">
                      <img src={s} alt={`Sampel ${i + 1}`} className="aspect-square w-full object-cover" />
                    </div>
                  ))}
                  {samples.length === 0 && (
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
            <div className="flex justify-end">
              <Button onClick={() => submit.mutate()} disabled={samples.length === 0 || !consent || submit.isPending}>
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
