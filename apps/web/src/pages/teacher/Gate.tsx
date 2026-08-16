import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Wifi, WifiOff, ArrowLeft, Users, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useToast } from '../../lib/toast';
import { Button } from '../../lib/ui';
import { useSocketEvent, joinDashboard } from '../../lib/socket';
import { startCamera, stopCamera, captureFrame, decodeQrFromVideo } from '../../lib/camera';
import { Badge } from '../../lib/ui';
import { STATUS_LABELS } from '../../lib/format';

interface Result {
  ok: boolean;
  message: string;
  fullName?: string;
  className?: string | null;
  time?: string;
  status?: string;
  method?: string;
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
  const lastFrameRef = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [scanCount, setScanCount] = useState(0);

  const { data: stats } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<{ success: boolean; data: { stats: { present: number; late: number; notYet: number } } }>('/dashboard').then((r) => r.data),
    refetchInterval: 30_000,
  });

  useSocketEvent<{ id: string }>('attendance:new', () => {
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  });

  useEffect(() => {
    joinDashboard();
    let cancelled = false;
    const init = async () => {
      try {
        const stream = await startCamera(videoRef.current!, 'environment');
        streamRef.current = stream;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setError('Kamera tidak dapat diakses. Periksa izin kamera pada browser.');
      }
    };
    init();
    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
    };
  }, []);

  // Loop scan otomatis: deteksi wajah ATAU QR setiap ~2,5 detik
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const loop = async () => {
      if (!alive) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && !busyRef.current) {
        // 1) coba QR dulu
        let qrToken: string | null = null;
        try {
          qrToken = await decodeQrFromVideo(video);
        } catch {
          qrToken = null;
        }
        if (qrToken) {
          busyRef.current = true;
          try {
            const res = await api<{ success: boolean; data: Omit<Result, 'ok'> }>('/attendance/gate', {
              method: 'POST',
              body: { method: 'GATE', proof: { token: qrToken } },
            });
            setResult({ ...res.data, ok: true });
            setScanCount((c) => c + 1);
          } catch (e) {
            if (e instanceof ApiError && e.code !== 'ALREADY_ATTENDANCE') {
              setResult({ ok: false, message: e.message });
            }
          } finally {
            busyRef.current = false;
            setTimeout(() => setResult(null), 3500);
          }
        }
        // 2) wajah: butuh 2 frame untuk liveness
        else {
          const frame = captureFrame(video);
          if (frame && lastFrameRef.current && frame !== lastFrameRef.current) {
            busyRef.current = true;
            try {
              const res = await api<{ success: boolean; data: Omit<Result, 'ok'> }>('/attendance/gate', {
                method: 'POST',
                body: { method: 'GATE', proof: { image: frame, prevImage: lastFrameRef.current } },
              });
              setResult({ ...res.data, ok: true });
              setScanCount((c) => c + 1);
            } catch (e) {
              if (e instanceof ApiError && e.code !== 'FACE_NOT_RECOGNIZED' && e.code !== 'ALREADY_ATTENDANCE') {
                setResult({ ok: false, message: e.message });
              }
            } finally {
              busyRef.current = false;
              setTimeout(() => setResult(null), 3500);
            }
          }
          lastFrameRef.current = frame;
        }
      }
      setTimeout(loop, 1500);
    };
    loop();
    return () => {
      alive = false;
    };
  }, [ready]);

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
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${ready ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
          {ready ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {ready ? 'ONLINE' : 'OFFLINE'}
        </span>
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
        <p className="absolute inset-x-0 bottom-4 text-center text-sm font-medium text-white/90">
          Arahkan wajah / QR / kartu siswa ke kamera
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
              <p className="text-lg font-extrabold text-ink">{result.fullName}</p>
              <p className="text-sm text-muted">{result.className} · ABSEN DATANG</p>
              <p className="mt-2 font-mono text-3xl font-extrabold text-ink">{result.time}</p>
              <Badge status={result.status || 'PRESENT'} label={STATUS_LABELS[result.status || 'PRESENT']} />
            </div>
          ) : (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-float animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-500 dark:bg-red-500/15">
                <XCircle className="h-9 w-9" />
              </div>
              <p className="font-bold text-ink">{result.message}</p>
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
        <div className="flex items-center justify-between bg-surface px-4 py-2 text-xs text-muted dark:bg-slate-900">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> {scanCount} scan berhasil sesi ini
          </span>
          <span>Mode otomatis</span>
        </div>
      )}
    </div>
  );
}
