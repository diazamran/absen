import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Wifi, WifiOff, ArrowLeft, Users, ShieldCheck, Nfc } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useToast } from '../../lib/toast';
import { Button } from '../../lib/ui';
import { useSocketEvent, joinDashboard } from '../../lib/socket';
import { startCamera, stopCamera, decodeQrFromVideo } from '../../lib/camera';
import { detectFaceDescriptor, initFaceModels, isFaceModelReady } from '../../lib/face';
import { feedbackSuccess, feedbackInfo, feedbackError } from '../../lib/feedback';
import { Badge } from '../../lib/ui';
import { STATUS_LABELS } from '../../lib/format';

interface Result {
  ok: boolean;
  already?: boolean;
  message: string;
  fullName?: string;
  className?: string | null;
  time?: string;
  status?: string;
  method?: string;
}

interface NfcReader {
  scan: () => Promise<void>;
  stop?: () => Promise<void>;
  onreading: ((ev: { serialNumber?: string; message?: unknown }) => void) | null;
  onreadingerror: (() => void) | null;
}

export default function Gate() {
  const { branding } = useTheme();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const lastAlreadyAtRef = useRef(0);
  const nfcReaderRef = useRef<NfcReader | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [nfcSupported, setNfcSupported] = useState(false);
  const [nfcReady, setNfcReady] = useState(false);
  const [nfcNeedTap, setNfcNeedTap] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<{ success: boolean; data: { stats: { present: number; late: number; notYet: number } } }>('/dashboard').then((r) => r.data),
    refetchInterval: 30_000,
  });

  useSocketEvent<{ id: string }>('attendance:new', () => {
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  });

  /** Catat absen dari bukti apa pun (QR / wajah / kartu) — tanpa perlu sentuh layar. */
  const record = useCallback(async (proof: { token?: string; cardUid?: string; descriptor?: number[]; liveness?: boolean }, methodLabel: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const res = await api<{ success: boolean; data: Omit<Result, 'ok' | 'already'> }>('/attendance/gate', {
        method: 'POST',
        body: { method: 'GATE', proof },
      });
      setResult({ ...res.data, method: methodLabel, ok: true });
      setScanCount((c) => c + 1);
      feedbackSuccess();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_ATTENDANCE') {
        // Sudah absen: tampilkan notif informatif, bukan error (anti getar berulang)
        const now = Date.now();
        if (now - lastAlreadyAtRef.current > 4000) {
          lastAlreadyAtRef.current = now;
          setResult({ ok: false, already: true, message: 'Sudah absen hari ini', method: methodLabel });
          feedbackInfo();
        }
      } else if (e instanceof ApiError && (e.code === 'FACE_NOT_RECOGNIZED' || e.code === 'LIVENESS_FAILED' || e.code === 'INVALID_DESCRIPTOR')) {
        // Wajah lewat tanpa cocok → lanjut scan diam-diam
      } else if (e instanceof ApiError) {
        setResult({ ok: false, message: e.message, method: methodLabel });
        feedbackError();
      } else {
        setResult({ ok: false, message: 'Gagal terhubung. Cek internet.', method: methodLabel });
        feedbackError();
      }
    } finally {
      busyRef.current = false;
      setTimeout(() => setResult(null), 4000);
    }
  }, []);

  /** Aktifkan pembaca NFC (kartu) — sekali, lalu otomatis tiap kartu ditempel. */
  const startNfc = useCallback(async () => {
    const w = window as unknown as { NDEFReader?: new () => NfcReader };
    if (!w.NDEFReader) return;
    setNfcSupported(true);
    try {
      const reader = new w.NDEFReader();
      await reader.scan();
      reader.onreading = (ev) => {
        const uid = ev.serialNumber;
        if (uid) void record({ cardUid: uid }, 'KARTU');
      };
      reader.onreadingerror = () => {};
      nfcReaderRef.current = reader;
      setNfcReady(true);
      setNfcNeedTap(false);
    } catch {
      // Butuh izin sekali lewat tombol / belum aktif
      setNfcNeedTap(true);
    }
  }, [record]);

  useEffect(() => {
    joinDashboard();
    let cancelled = false;
    const init = async () => {
      try {
        // Panaskan model wajah paralel dengan kamera agar scan pertama cepat
        setModelsLoading(true);
        initFaceModels().catch(() => {});
        const stream = await startCamera(videoRef.current!, 'environment');
        streamRef.current = stream;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setError('Kamera tidak dapat diakses. Periksa izin kamera pada browser.');
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    };
    init();
    void startNfc();
    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
      try {
        void nfcReaderRef.current?.stop?.();
      } catch {
        // abaikan
      }
    };
  }, [startNfc]);

  // Loop scan otomatis: QR ATAU wajah, tanpa klik sama sekali
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const loop = async () => {
      if (!alive) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && !busyRef.current) {
        // 1) coba QR
        let qrToken: string | null = null;
        try {
          qrToken = await decodeQrFromVideo(video);
        } catch {
          qrToken = null;
        }
        if (qrToken) {
          await record({ token: qrToken }, 'QR');
        } else {
          // 2) wajah: deteksi + ekstrak descriptor langsung di HP petugas
          try {
            const descriptor = await detectFaceDescriptor(video);
            if (descriptor) {
              await record({ descriptor: Array.from(descriptor), liveness: true }, 'WAJAH');
            }
          } catch {
            // lanjut iterasi berikutnya
          }
        }
      }
      setTimeout(loop, 1200);
    };
    void loop();
    return () => {
      alive = false;
    };
  }, [ready, record]);

  const s = stats?.stats;

  // Hanya petugas piket / admin yang boleh scan absen siswa di gerbang
  const canOperateGate = ['PIKET', 'ADMIN', 'SUPER_ADMIN'].includes(user?.roleKey || '');
  if (!canOperateGate) {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-3xl border border-line/60 bg-surface p-6 text-center shadow-card dark:bg-slate-800/70">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <p className="font-bold text-ink">Hanya petugas piket</p>
          <p className="mt-1 text-sm text-muted">Scan gerbang untuk absen siswa hanya bisa dilakukan petugas piket atau admin. Kamu bisa absen sendiri lewat menu Absen.</p>
          <Button className="mt-4 w-full" onClick={() => navigate('/app/absent')}>
            <ArrowLeft className="h-4 w-4" /> Absen Diri Sendiri
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-4 -mt-5 flex min-h-[calc(100dvh-0px)] flex-col lg:mx-0 lg:mt-0">
      {/* Header gate */}
      <div className="flex items-center justify-between bg-slate-950 px-4 py-3 text-white">
        <button onClick={() => navigate(-1)} className="rounded-xl p-2 hover:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="text-sm font-bold">{branding?.schoolName}</p>
          <p className="text-[10px] uppercase tracking-widest text-white/60">Absensi Gerbang</p>
        </div>
        <div className="flex items-center gap-1.5">
          {nfcSupported && (
            <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${nfcReady ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-500/20 text-slate-400'}`}>
              <Nfc className="h-3 w-3" />
              {nfcReady ? 'NFC' : 'NFC ✕'}
            </span>
          )}
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${ready ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
            {ready ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {ready ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* Kamera */}
      <div className="relative flex-1 overflow-hidden bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {/* Frame scanning */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-56 w-56">
            <div className="absolute inset-0 rounded-[2rem] border-2 border-white/40" />
            <div className="absolute left-0 top-0 h-10 w-10 rounded-tl-[2rem] border-l-4 border-t-4 border-primary" />
            <div className="absolute right-0 top-0 h-10 w-10 rounded-tr-[2rem] border-r-4 border-t-4 border-primary" />
            <div className="absolute bottom-0 left-0 h-10 w-10 rounded-bl-[2rem] border-b-4 border-l-4 border-primary" />
            <div className="absolute bottom-0 right-0 h-10 w-10 rounded-br-[2rem] border-b-4 border-r-4 border-primary" />
            <div className="absolute inset-x-4 animate-scan h-0.5 rounded-full bg-primary shadow-[0_0_12px_rgba(13,148,136,.9)]" />
          </div>
        </div>
        <p className="absolute inset-x-0 bottom-4 px-4 text-center text-sm font-medium text-white/90">
          {modelsLoading || !isFaceModelReady()
            ? 'Menyiapkan model wajah… (±5 MB, sekali saja)'
            : 'Otomatis: arahkan wajah / QR / kartu siswa ke kamera — tanpa sentuh layar'}
        </p>
      </div>

      {/* Hasil scan */}
      {result && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          {result.ok ? (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-float animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 animate-pulse-ring dark:bg-emerald-500/15 dark:text-emerald-300">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-600">✓ ABSEN BERHASIL</p>
              <p className="mt-1 text-lg font-extrabold text-ink">{result.fullName}</p>
              <p className="text-sm text-muted">{result.className} · ABSEN DATANG · {result.method}</p>
              <p className="mt-2 font-mono text-3xl font-extrabold text-ink">{result.time}</p>
              <div className="mt-2 flex justify-center">
                <Badge status={result.status || 'PRESENT'} label={STATUS_LABELS[result.status || 'PRESENT']} />
              </div>
            </div>
          ) : result.already ? (
            <div className="mx-4 w-full max-w-sm rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center shadow-float animate-pop dark:border-amber-500/30 dark:bg-amber-500/10">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <p className="text-lg font-extrabold text-amber-600 dark:text-amber-300">SUDAH ABSEN</p>
              <p className="mt-1 text-sm font-semibold text-ink">{result.fullName}</p>
              <p className="text-xs text-muted">{result.method}</p>
            </div>
          ) : (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-float animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-500 dark:bg-red-500/15">
                <XCircle className="h-9 w-9" />
              </div>
              <p className="font-bold text-ink">{result.message}</p>
              {result.method && <p className="mt-1 text-xs text-muted">Metode: {result.method}</p>}
            </div>
          )}
        </div>
      )}

      {/* Statistik gate */}
      <div className="grid grid-cols-3 gap-px bg-slate-200 dark:bg-slate-700">
        {[
          { label: 'Hadir', value: s?.present ?? 0, color: 'text-emerald-500' },
          { label: 'Terlambat', value: s?.late ?? 0, color: 'text-amber-500' },
          { label: 'Belum Hadir', value: s?.notYet ?? 0, color: 'text-slate-500' },
        ].map((x) => (
          <div key={x.label} className="flex flex-col items-center bg-surface py-3 dark:bg-slate-900">
            <span className={`text-xl font-extrabold ${x.color}`}>{x.value}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted">{x.label}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/10">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
          <button className="ml-auto font-semibold underline" onClick={() => navigate('/app/absent')}>
            Metode lain
          </button>
        </div>
      )}

      {ready && (
        <div className="flex items-center justify-between gap-2 bg-surface px-4 py-2 text-xs text-muted dark:bg-slate-900">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> {scanCount} scan berhasil sesi ini
          </span>
          {nfcNeedTap ? (
            <button
              onClick={() => void startNfc()}
              className="flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-bold text-sky-600 dark:text-sky-300"
            >
              <Nfc className="h-3 w-3" /> Ketuk untuk aktifkan NFC kartu
            </button>
          ) : (
            <span>Mode otomatis</span>
          )}
        </div>
      )}
    </div>
  );
}
