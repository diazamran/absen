import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, QrCode, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { startCamera, stopCamera, decodeQrFromVideo } from '../../lib/camera';
import { Segmented, Badge } from '../../lib/ui';
import { STATUS_LABELS } from '../../lib/format';

type Type = 'CHECK_IN' | 'CHECK_OUT';
type Mode = 'scan' | 'show';

export default function QrScan() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);

  const isStudent = user?.roleKey === 'STUDENT';
  const [type, setType] = useState<Type>('CHECK_IN');
  // Siswa hanya melihat QR miliknya sendiri (bukan memindai QR)
  const [mode, setMode] = useState<Mode>(isStudent ? 'show' : 'scan');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [myQr, setMyQr] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string; fullName?: string; time?: string; status?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const stream = await startCamera(videoRef.current!, 'environment');
        streamRef.current = stream;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setError('Kamera tidak dapat diakses.');
      }
    };
    if (mode === 'scan') init();
    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
    };
  }, [mode]);

  // Muat QR sendiri (untuk mode show / ditunjukkan ke gerbang)
  useEffect(() => {
    if (mode === 'show' && !myQr) {
      api<{ success: boolean; data: { token: string } }>('/qr/me')
        .then((r) => QRCode.toDataURL(r.data.token, { width: 256, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }))
        .then(setMyQr)
        .catch(() => toast('error', 'Gagal memuat QR.'));
    }
  }, [mode, myQr, toast]);

  // Loop deteksi QR
  useEffect(() => {
    if (!ready || mode !== 'scan') return;
    let alive = true;
    const loop = async () => {
      if (!alive || busyRef.current) {
        setTimeout(loop, 400);
        return;
      }
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const token = await decodeQrFromVideo(video);
          if (token) {
            busyRef.current = true;
            try {
              const res = await api<{ success: boolean; message: string; data: { fullName: string; time: string; status: string } }>('/attendance/qr', {
                method: 'POST',
                body: { type, token, deviceId: 'web' },
              });
              setResult({ ok: true, message: res.message, ...res.data });
            } catch (e) {
              setResult({ ok: false, message: e instanceof ApiError ? e.message : 'QR Code tidak valid.' });
            } finally {
              busyRef.current = false;
              setTimeout(() => setResult(null), 3500);
            }
          }
        } catch {
          // abaikan frame gagal
        }
      }
      setTimeout(loop, 300);
    };
    loop();
    return () => {
      alive = false;
    };
  }, [ready, type, mode]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button onClick={() => navigate(-1)} className="rounded-xl p-2 hover:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="font-bold">QR Code</h2>
        <div className="w-9" />
      </div>

      <div className="flex flex-col items-center gap-3 px-4 pb-3">
        {!isStudent && (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[{ value: 'scan', label: 'Pindai QR' }]}
          />
        )}
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'CHECK_IN', label: 'Datang' },
            { value: 'CHECK_OUT', label: 'Pulang' },
          ]}
        />
      </div>

      {mode === 'scan' ? (
        <div className="relative flex-1 overflow-hidden bg-slate-900">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-60 w-60">
              <div className="absolute inset-0 rounded-3xl border-2 border-white/30" />
              <div className="absolute left-0 top-0 h-12 w-12 rounded-tl-3xl border-l-4 border-t-4 border-primary" />
              <div className="absolute right-0 top-0 h-12 w-12 rounded-tr-3xl border-r-4 border-t-4 border-primary" />
              <div className="absolute bottom-0 left-0 h-12 w-12 rounded-bl-3xl border-b-4 border-l-4 border-primary" />
              <div className="absolute bottom-0 right-0 h-12 w-12 rounded-br-3xl border-b-4 border-r-4 border-primary" />
              <div className="absolute inset-x-6 animate-scan h-1 rounded-full bg-primary shadow-[0_0_14px_rgba(13,148,136,1)]" />
            </div>
          </div>
          <p className="absolute inset-x-0 bottom-4 text-center text-sm text-white/90">Arahkan kamera ke QR Code</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-950 p-6">
          {myQr ? (
            <>
              <img src={myQr} alt="QR Saya" className="h-72 w-72 rounded-2xl bg-white p-3 shadow-float" />
              <p className="text-center text-sm text-white/80">Tunjukkan QR ini ke kamera gerbang untuk absen.</p>
              <p className="text-xs text-white/50">QR diperbarui setiap 60 detik · {user?.fullName}</p>
            </>
          ) : (
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          )}
        </div>
      )}

      <div className="flex justify-center bg-black py-5">
        {mode === 'show' && (
          <button
            onClick={async () => {
              try {
                const res = await api<{ success: boolean; message: string; data: { fullName: string; time: string; status: string } }>('/attendance/qr', {
                  method: 'POST',
                  body: { type, token: (await api<{ success: boolean; data: { token: string } }>('/qr/me')).data.token },
                });
                setResult({ ok: true, message: res.message, ...res.data });
              } catch (e) {
                setResult({ ok: false, message: e instanceof ApiError ? e.message : 'Gagal absen.' });
              }
              setTimeout(() => setResult(null), 3500);
            }}
            className="rounded-2xl bg-primary px-8 py-3.5 font-bold text-white shadow-float active:scale-95"
          >
            Absen Sekarang ({type === 'CHECK_IN' ? 'Datang' : 'Pulang'})
          </button>
        )}
      </div>

      {result && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          {result.ok ? (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 animate-pulse-ring dark:bg-emerald-500/15 dark:text-emerald-300">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <p className="text-xl font-extrabold text-primary">✓ {result.message}</p>
              <p className="mt-1 text-lg font-bold text-ink">{result.fullName}</p>
              <p className="font-mono text-4xl font-extrabold text-ink">{result.time}</p>
              <div className="mt-2 flex justify-center">
                <Badge status={result.status || 'PRESENT'} label={STATUS_LABELS[result.status || 'PRESENT']} />
              </div>
            </div>
          ) : (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-500 dark:bg-red-500/15">
                <XCircle className="h-9 w-9" />
              </div>
              <p className="font-bold text-ink">{result.message}</p>
            </div>
          )}
        </div>
      )}

      {error && <p className="bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">{error}</p>}
    </div>
  );
}
