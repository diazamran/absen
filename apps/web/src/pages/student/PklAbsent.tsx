import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { MapPin, CheckCircle2, XCircle, Loader2, ArrowLeft, Navigation, Wifi, WifiOff } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, Card, Badge } from '../../lib/ui';
import { detectFaceDescriptor, initFaceModels, isFaceModelReady } from '../../lib/face';
import { feedbackSuccess, feedbackError } from '../../lib/feedback';
import { STATUS_LABELS } from '../../lib/format';

interface PklAssignment {
  assignmentId: string;
  studentId: string;
  nis: string | null;
  locationId: string;
  locationName: string;
  locationCity: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeter: number;
  supervisorName: string | null;
  className: string | null;
}

interface GeoPos {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface CheckResult {
  ok: boolean;
  message: string;
  status?: string;
  checkIn?: string;
  checkOut?: string;
  locationVerified?: boolean;
}

export default function PklAbsent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geo, setGeo] = useState<GeoPos | null>(null);
  const [type, setType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [modelsLoading, setModelsLoading] = useState(false);

  // Fetch PKL assignment for this student
  const { data: assignments, isLoading } = useQuery({
    queryKey: ['pkl-my-assignment'],
    queryFn: async () => {
      const r = await api<{ success: boolean; data: PklAssignment[] }>('/pkl/students');
      const myStudentId = user?.student?.id;
      const myNis = user?.student?.nis;
      return (r.data ?? []).filter((s) => s.studentId === myStudentId || s.nis === myNis);
    },
    enabled: !!user,
  });

  const assignment = assignments?.[0];

  // Get GPS position
  const getGeo = useCallback((): Promise<GeoPos | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      setGeoLoading(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const g = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
          setGeo(g);
          setGeoLoading(false);
          resolve(g);
        },
        () => { setGeoLoading(false); resolve(null); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    });
  }, []);

  // Start camera
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        setModelsLoading(true);
        initFaceModels().catch(() => {});
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try { await videoRef.current.play(); } catch { /* retry on gesture */ }
        }
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setError('Kamera tidak dapat diakses.');
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    };
    init();
    return () => { cancelled = true; if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop()); };
  }, []);

  // Scan loop: face auto-detect
  useEffect(() => {
    if (!ready || !assignment) return;
    let alive = true;
    const loop = async () => {
      if (!alive || busyRef.current) { setTimeout(loop, 500); return; }
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const descriptor = await detectFaceDescriptor(video);
          if (descriptor && !busyRef.current) {
            busyRef.current = true;
            const gps = await getGeo();
            try {
              const res = await api<{ success: boolean; message: string; data: CheckResult }>('/pkl/attendance', {
                method: 'POST',
                body: {
                  type,
                  pklLocationId: assignment.locationId,
                  method: 'FACE',
                  descriptor: Array.from(descriptor),
                  ...(gps ? { latitude: gps.latitude, longitude: gps.longitude } : {}),
                },
              });
              const d = res.data as CheckResult;
              setResult({ ok: true, message: res.message, status: d.status, checkIn: d.checkIn, checkOut: d.checkOut, locationVerified: d.locationVerified });
              feedbackSuccess();
              qc.invalidateQueries({ queryKey: ['dashboard'] });
            } catch (e) {
              if (e instanceof ApiError && e.code === 'ALREADY_ATTENDANCE') {
                setResult({ ok: true, message: e.message });
              } else {
                setResult({ ok: false, message: e instanceof ApiError ? e.message : 'Gagal absen.' });
                feedbackError();
              }
            } finally {
              busyRef.current = false;
              setTimeout(() => setResult(null), 4000);
            }
          }
        } catch { /* skip frame */ }
      }
      setTimeout(loop, 800);
    };
    void loop();
    return () => { alive = false; };
  }, [ready, assignment, type, getGeo, qc]);

  if (isLoading) return <div className="flex min-h-[50dvh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  if (!assignment) {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center px-4">
        <Card className="w-full max-w-sm p-6 text-center">
          <MapPin className="mx-auto mb-3 h-12 w-12 text-muted" />
          <p className="font-bold text-ink">Belum ada penugasan PKL</p>
          <p className="mt-1 text-sm text-muted">Hubungi admin untuk ditugaskan ke lokasi PKL.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="-mx-4 -mt-5 flex min-h-[calc(100dvh-0px)] flex-col lg:mx-0 lg:mt-0">
      {/* Header */}
      <div className="flex items-center justify-between bg-slate-950 px-4 py-3 text-white">
        <button onClick={() => navigate(-1)} className="rounded-xl p-2 hover:bg-white/10"><ArrowLeft className="h-5 w-5" /></button>
        <div className="text-center">
          <p className="text-sm font-bold">{assignment.locationName}</p>
          <p className="text-[10px] uppercase tracking-widest text-white/60">Absensi PKL</p>
        </div>
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${geo ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
          {geo ? <Navigation className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {geo ? 'GPS OK' : 'GPS ?'}
        </span>
      </div>

      {/* Type selector */}
      <div className="flex gap-2 bg-slate-900 px-4 py-2">
        {(['CHECK_IN', 'CHECK_OUT'] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} className={`flex-1 rounded-xl py-2 text-sm font-bold transition ${type === t ? 'bg-primary text-white' : 'bg-slate-700 text-white/60'}`}>
            {t === 'CHECK_IN' ? '📍 Absen Datang' : '🏠 Absen Pulang'}
          </button>
        ))}
      </div>

      {/* Camera */}
      <div className="relative flex-1 overflow-hidden bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-52 w-52">
            <div className="absolute inset-0 rounded-[2rem] border-2 border-white/40" />
            <div className="absolute left-0 top-0 h-10 w-10 rounded-tl-[2rem] border-l-4 border-t-4 border-primary" />
            <div className="absolute right-0 top-0 h-10 w-10 rounded-tr-[2rem] border-r-4 border-t-4 border-primary" />
            <div className="absolute bottom-0 left-0 h-10 w-10 rounded-bl-[2rem] border-b-4 border-l-4 border-primary" />
            <div className="absolute bottom-0 right-0 h-10 w-10 rounded-br-[2rem] border-b-4 border-r-4 border-primary" />
            <div className="absolute inset-x-4 animate-scan h-0.5 rounded-full bg-primary shadow-[0_0_12px_rgba(13,148,136,.9)]" />
          </div>
        </div>
        <p className="absolute inset-x-0 bottom-4 text-center text-sm text-white/90">
          {modelsLoading ? 'Menyiapkan model wajah…' : 'Arahkan wajah ke kamera untuk absen PKL'}
        </p>
      </div>

      {/* Result overlay */}
      {result && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          {result.ok ? (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-float animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 animate-pulse-ring"><CheckCircle2 className="h-9 w-9" /></div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-600">✓ {result.message}</p>
              {result.checkIn && <p className="mt-2 font-mono text-3xl font-extrabold text-ink">{result.checkIn}</p>}
              {result.checkOut && <p className="mt-2 font-mono text-3xl font-extrabold text-ink">{result.checkOut}</p>}
              {result.locationVerified !== undefined && (
                <p className="mt-2 text-xs text-muted">{result.locationVerified ? '✅ Lokasi terverifikasi' : '⚠️ Di luar radius lokasi'}</p>
              )}
            </div>
          ) : (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-float animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-500"><XCircle className="h-9 w-9" /></div>
              <p className="font-bold text-ink">{result.message}</p>
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="bg-surface px-4 py-3 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-sm text-muted">
          <MapPin className="h-4 w-4" />
          <span>{assignment.locationName}{assignment.locationCity ? `, ${assignment.locationCity}` : ''}</span>
        </div>
        {assignment.supervisorName && (
          <p className="mt-1 text-xs text-muted">👨‍🏫 Guru pembimbing: {assignment.supervisorName}</p>
        )}
        {geoLoading && <p className="mt-1 text-xs text-amber-500">📍 Mengambil lokasi GPS…</p>}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/10">
          <XCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}
