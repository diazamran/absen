import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Loader2, Camera, RefreshCw, Zap, ZapOff } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { startCamera, stopCamera, captureFrame } from '../../lib/camera';
import { detectFaceDescriptor, framesHaveMotion, initFaceModels, isFaceModelReady } from '../../lib/face';
import { feedbackSuccess, feedbackInfo, feedbackError } from '../../lib/feedback';
import { Segmented, Badge, Button } from '../../lib/ui';
import { STATUS_LABELS } from '../../lib/format';

type Type = 'CHECK_IN' | 'CHECK_OUT';

interface ScanResult {
  ok: boolean;
  already?: boolean;
  message: string;
  fullName?: string;
  time?: string;
  status?: string;
  lateMinutes?: number;
}

export default function FaceScan() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const doneRef = useRef(false);

  const [type, setType] = useState<Type>('CHECK_IN');
  const [auto, setAuto] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const stream = await startCamera(videoRef.current!, 'user');
        streamRef.current = stream;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setError('Kamera tidak dapat diakses. Periksa izin kamera.');
      }
    };
    init();
    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
    };
  }, []);

  // Panaskan model wajah diam-diam saat halaman dibuka
  useEffect(() => {
    initFaceModels().catch(() => {
      // tidak fatal; runScan akan mencoba lagi
    });
  }, []);

  /** Satu siklus scan: liveness ringan → deteksi wajah → verifikasi di server. */
  const runScan = useCallback(async () => {
    const video = videoRef.current;
    if (!video || runningRef.current || doneRef.current) return;
    runningRef.current = true;
    setScanning(true);
    setResult(null);
    if (!isFaceModelReady()) setModelsLoading(true);
    try {
      // Liveness ringan: 2 frame berjarak sebentar harus ada sedikit pergerakan
      const frame1 = captureFrame(video);
      await new Promise((r) => setTimeout(r, 350));
      const frame2 = captureFrame(video);
      if (!frame1 || !frame2) {
        toast('warning', 'Wajah belum terlihat jelas. Pastikan pencahayaan cukup.');
        return;
      }
      const motion = await framesHaveMotion(frame1, frame2);
      if (!motion) {
        setResult({ ok: false, message: 'Deteksi gerakan gagal. Gerakkan kepala sedikit lalu coba lagi.' });
        return;
      }

      // Deteksi wajah & ekstrak descriptor di HP (bukan kirim foto ke server)
      const descriptor = await detectFaceDescriptor(video);
      if (!descriptor) {
        setResult({ ok: false, message: 'Wajah tidak terdeteksi. Pastikan wajah di tengah & pencahayaan cukup.' });
        return;
      }

      const res = await api<{ success: boolean; message: string; data: { fullName: string; time: string; status: string; lateMinutes: number } }>('/attendance/face', {
        method: 'POST',
        body: { type, descriptor: Array.from(descriptor), liveness: true, deviceId: 'web' },
      });
      setResult({ ok: true, message: 'ABSEN BERHASIL', ...res.data });
      doneRef.current = true;
      feedbackSuccess();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_ATTENDANCE') {
        setResult({ ok: false, already: true, message: 'Kamu sudah absen hari ini' });
        doneRef.current = true;
        feedbackInfo();
      } else if (e instanceof ApiError && e.code === 'FACE_NOT_RECOGNIZED') {
        setResult({ ok: false, message: 'Wajah tidak dikenali. Coba lagi.' });
        feedbackInfo();
      } else {
        setResult({ ok: false, message: e instanceof ApiError ? e.message : 'Wajah tidak dikenali.' });
        feedbackError();
      }
    } finally {
      runningRef.current = false;
      setScanning(false);
      setModelsLoading(false);
      setTimeout(() => setResult(null), 3500);
    }
  }, [type, toast]);

  // Mode otomatis: scan berulang tanpa sentuh layar, berhenti setelah berhasil
  useEffect(() => {
    if (!ready || !auto) return;
    let alive = true;
    const loop = async () => {
      if (!alive || doneRef.current) return;
      if (!runningRef.current) await runScan();
      setTimeout(loop, 1600);
    };
    void loop();
    return () => {
      alive = false;
    };
  }, [ready, auto, runScan]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button onClick={() => navigate(-1)} className="rounded-xl p-2 hover:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="font-bold">Absensi Wajah</h2>
        <div className="w-9" />
      </div>

      <div className="flex justify-center px-4 pb-3">
        <Segmented
          value={type}
          onChange={(t) => {
            // Ganti ke pulang (atau datang) → izinkan scan lagi
            doneRef.current = false;
            setType(t);
          }}
          options={[
            { value: 'CHECK_IN', label: 'Absen Datang' },
            { value: 'CHECK_OUT', label: 'Absen Pulang' },
          ]}
        />
      </div>

      {/* Kamera */}
      <div className="relative flex-1 overflow-hidden bg-slate-900">
        <video ref={videoRef} className="camera-view h-full w-full" muted playsInline />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-64 w-64">
            <div className="absolute inset-0 rounded-[2.5rem] border-2 border-white/30" />
            <div className="absolute left-0 top-0 h-12 w-12 rounded-tl-[2.5rem] border-l-4 border-t-4 border-primary" />
            <div className="absolute right-0 top-0 h-12 w-12 rounded-tr-[2.5rem] border-r-4 border-t-4 border-primary" />
            <div className="absolute bottom-0 left-0 h-12 w-12 rounded-bl-[2.5rem] border-b-4 border-l-4 border-primary" />
            <div className="absolute bottom-0 right-0 h-12 w-12 rounded-br-[2.5rem] border-b-4 border-r-4 border-primary" />
            <div className="absolute inset-x-6 animate-scan h-1 rounded-full bg-primary shadow-[0_0_14px_rgba(13,148,136,1)]" />
          </div>
        </div>
        <p className="absolute inset-x-0 bottom-4 px-4 text-center text-sm text-white/90">
          {scanning
            ? 'Memverifikasi wajah…'
            : modelsLoading
              ? 'Menyiapkan model wajah… (±5 MB, sekali saja)'
              : auto
                ? 'Otomatis: tatap kamera — absen masuk tercatat tanpa sentuh layar'
                : 'Posisikan wajah di dalam area, lalu tekan tombol'}
        </p>
      </div>

      {/* Tombol scan + toggle otomatis */}
      <div className="flex items-center justify-center gap-4 bg-black py-5">
        <button
          onClick={() => setAuto((a) => !a)}
          className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold transition ${auto ? 'bg-primary/20 text-primary' : 'bg-white/10 text-white/60'}`}
          title="Aktifkan / matikan scan otomatis"
        >
          {auto ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
          {auto ? 'Otomatis' : 'Manual'}
        </button>
        <button
          onClick={() => void runScan()}
          disabled={!ready || scanning || modelsLoading || doneRef.current}
          className="relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-primary text-white transition-transform active:scale-95 disabled:opacity-50"
        >
          {scanning || modelsLoading ? <Loader2 className="h-9 w-9 animate-spin" /> : <Camera className="h-9 w-9" />}
        </button>
      </div>

      {/* Hasil */}
      {result && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          {result.ok ? (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 animate-pulse-ring dark:bg-emerald-500/15 dark:text-emerald-300">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <p className="text-xl font-extrabold text-primary">✓ ABSEN BERHASIL</p>
              <p className="mt-1 text-lg font-bold text-ink">{result.fullName}</p>
              <p className="font-mono text-4xl font-extrabold text-ink">{result.time}</p>
              <div className="mt-2 flex justify-center">
                <Badge status={result.status || 'PRESENT'} label={STATUS_LABELS[result.status || 'PRESENT']} />
              </div>
              {result.lateMinutes ? <p className="mt-1 text-xs text-amber-500">Terlambat {result.lateMinutes} menit</p> : <p className="mt-1 text-xs text-emerald-600">Tepat waktu</p>}
            </div>
          ) : result.already ? (
            <div className="mx-4 w-full max-w-sm rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center animate-pop dark:border-amber-500/30 dark:bg-amber-500/10">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <p className="text-xl font-extrabold text-amber-600 dark:text-amber-300">SUDAH ABSEN</p>
              <p className="mt-1 text-sm text-muted">{result.message}</p>
            </div>
          ) : (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-500 dark:bg-red-500/15">
                <XCircle className="h-9 w-9" />
              </div>
              <p className="text-lg font-bold text-ink">{result.message}</p>
              <p className="mt-1 text-sm text-muted">Silakan coba lagi dengan pencahayaan yang cukup.</p>
              <div className="mt-4 flex flex-col gap-2">
                <Button variant="outline" onClick={() => { setResult(null); navigate('/app/face-me'); }}>
                  <RefreshCw className="h-4 w-4" /> Perbarui Data Wajah
                </Button>
                <Button onClick={() => setResult(null)}>Coba Lagi</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">{error}</p>}
    </div>
  );
}
