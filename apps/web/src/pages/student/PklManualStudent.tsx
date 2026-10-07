/**
 * Halaman Absen Manual PKL untuk siswa yang diaktifkan allowManualAttendance oleh admin.
 * Menampilkan tombol Datang dan Pulang dengan geolokasi, tanpa kamera.
 * Muncul di sidebar hanya jika user.student.allowManualAttendance === true.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { MapPin, CheckCircle2, XCircle, Loader2, ArrowLeft, Navigation, WifiOff } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Card } from '../../lib/ui';
import { getBestEffortPosition, warmUpGps } from '../../lib/geo';
import { feedbackSuccess, feedbackError, feedbackInfo } from '../../lib/feedback';

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
  todayAttendance?: {
    checkIn: string | null;
    checkOut: string | null;
    status: string;
  };
}

interface GeoPos { latitude: number; longitude: number; accuracy: number; }
interface CheckResult {
  ok: boolean; message: string;
  checkIn?: string; checkOut?: string; locationVerified?: boolean;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nowMinutesWIB(): number {
  const wib = new Date(Date.now() + 7 * 3600_000);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export default function PklManualStudent() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [geo, setGeo] = useState<GeoPos | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [rules, setRules] = useState<Record<string, unknown> | null>(null);
  const [nowTick, setNowTick] = useState(0);

  // Fetch assignment
  const { data: assignments, isLoading } = useQuery({
    queryKey: ['pkl-my-assignment'],
    queryFn: async () => {
      const r = await api<{ success: boolean; data: PklAssignment[] }>('/pkl/students');
      const myStudentId = user?.student?.id;
      const myNis = user?.student?.nis;
      return (r.data ?? []).filter((s) => s.studentId === myStudentId || s.nis === myNis);
    },
    enabled: !!user,
    refetchInterval: 30_000,
  });
  const assignment = assignments?.[0];

  // Fetch jadwal
  useEffect(() => {
    const fetchRules = () =>
      fetch('/api/settings/public').then((r) => r.json()).then((d) => setRules(d?.data?.rules ?? null)).catch(() => {});
    fetchRules();
    const id = setInterval(() => setNowTick((t) => t + 1), 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') { fetchRules(); setNowTick((t) => t + 1); } };
    document.addEventListener('visibilitychange', onVisible);
    void warmUpGps();
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  void nowTick;
  const nowMin = nowMinutesWIB();
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  const canCheckIn = rules
    ? nowMin <= (num(rules.pklCheckInDeadlineHour ?? rules.checkInDeadlineHour, 23) * 60 +
        num(rules.pklCheckInDeadlineMinute ?? rules.checkInDeadlineMinute, 59))
    : true;
  const earlyH = num(rules?.pklEarlyLeaveBeforeHour ?? rules?.earlyLeaveBeforeHour ?? rules?.checkOutAfterHour, 15);
  const earlyM = num(rules?.pklEarlyLeaveBeforeMinute ?? rules?.earlyLeaveBeforeMinute ?? rules?.checkOutAfterMinute, 0);
  const canCheckOut = rules ? nowMin >= earlyH * 60 + earlyM : true;
  const checkInDeadlineH = num(rules?.pklCheckInDeadlineHour ?? rules?.checkInDeadlineHour, 23);
  const checkInDeadlineM = num(rules?.pklCheckInDeadlineMinute ?? rules?.checkInDeadlineMinute, 59);

  const getGeo = useCallback(async (): Promise<GeoPos | null> => {
    setGeoLoading(true);
    const res = await getBestEffortPosition();
    setGeoLoading(false);
    setGeo(res.position);
    return res.position;
  }, []);

  const handleAbsen = useCallback(async (type: 'CHECK_IN' | 'CHECK_OUT') => {
    if (loading || !assignment) return;
    setLoading(true);
    const gps = await getGeo();
    try {
      const res = await api<{ success: boolean; message: string; data: CheckResult }>('/pkl/attendance', {
        method: 'POST',
        body: {
          type,
          pklLocationId: assignment.locationId,
          method: 'MANUAL',
          ...(gps ? { latitude: gps.latitude, longitude: gps.longitude } : {}),
        },
      });
      const d = res.data as CheckResult;
      setResult({ ok: true, message: res.message, checkIn: d.checkIn, checkOut: d.checkOut, locationVerified: d.locationVerified });
      feedbackSuccess();
      qc.invalidateQueries({ queryKey: ['pkl-my-assignment'] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_ATTENDANCE') {
        setResult({ ok: true, message: e.message });
        feedbackInfo();
      } else {
        setResult({ ok: false, message: e instanceof ApiError ? e.message : 'Gagal absen.' });
        feedbackError();
      }
    } finally {
      setLoading(false);
      setTimeout(() => setResult(null), 4000);
      qc.invalidateQueries({ queryKey: ['pkl-my-assignment'] });
    }
  }, [assignment, loading, getGeo, qc]);

  if (isLoading) return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (!assignment) return (
    <div className="flex min-h-[70dvh] items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6 text-center">
        <MapPin className="mx-auto mb-3 h-12 w-12 text-muted" />
        <p className="font-bold text-ink">Belum ada penugasan PKL</p>
        <p className="mt-1 text-sm text-muted">Hubungi admin untuk ditugaskan ke lokasi PKL.</p>
      </Card>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="rounded-xl p-2 text-muted hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-ink">Absen Manual PKL</h1>
          <p className="truncate text-sm text-muted">{assignment.locationName}</p>
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${geo ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {geo ? <Navigation className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {geo ? 'GPS OK' : 'GPS ?'}
        </span>
      </div>

      {/* Indikator jarak */}
      {geo && assignment.latitude != null && assignment.longitude != null && (() => {
        const d = Math.round(haversineMeters(geo.latitude, geo.longitude, assignment.latitude, assignment.longitude));
        const inside = d <= assignment.radiusMeter;
        return (
          <div className={`mb-4 rounded-2xl px-4 py-3 text-center text-sm font-semibold ${inside ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20' : 'bg-red-50 text-red-600 dark:bg-red-900/20'}`}>
            {inside
              ? `📍 ${d} m dari ${assignment.locationName} — dalam radius ${assignment.radiusMeter} m`
              : `⚠️ ${d} m dari ${assignment.locationName} — di luar radius ${assignment.radiusMeter} m`}
          </div>
        );
      })()}

      {/* Status hari ini */}
      <Card className="mb-4 p-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Status Absensi Hari Ini</p>
        {assignment.todayAttendance?.checkIn ? (
          <div className="space-y-1.5 text-sm">
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>Datang: <span className="font-mono font-bold text-ink">{assignment.todayAttendance.checkIn}</span></span>
            </p>
            {assignment.todayAttendance.checkOut ? (
              <p className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span>Pulang: <span className="font-mono font-bold text-ink">{assignment.todayAttendance.checkOut}</span></span>
              </p>
            ) : (
              <p className="text-amber-600">⏳ Belum absen pulang</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">Belum absen hari ini</p>
        )}
        {geoLoading && <p className="mt-2 text-xs text-amber-500">📍 Mengambil lokasi GPS…</p>}
      </Card>

      {/* Tombol Datang */}
      <div className="space-y-3">
        {canCheckIn ? (
          <button
            onClick={() => handleAbsen('CHECK_IN')}
            disabled={loading || !!assignment.todayAttendance?.checkIn}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-500 py-5 text-xl font-bold text-white shadow-sm transition disabled:opacity-50 active:scale-[.98] active:bg-emerald-600"
          >
            {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <CheckCircle2 className="h-6 w-6" />}
            {assignment.todayAttendance?.checkIn ? 'Sudah Absen Datang ✓' : 'Absen Datang'}
          </button>
        ) : (
          <div className="rounded-2xl bg-slate-100 px-4 py-4 text-center text-sm text-muted dark:bg-slate-800">
            ⏰ Absen datang ditutup pukul {pad2(checkInDeadlineH)}:{pad2(checkInDeadlineM)}
          </div>
        )}

        {/* Tombol Pulang */}
        {canCheckOut ? (
          <button
            onClick={() => handleAbsen('CHECK_OUT')}
            disabled={loading || !assignment.todayAttendance?.checkIn || !!assignment.todayAttendance?.checkOut}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-teal-500 py-5 text-xl font-bold text-white shadow-sm transition disabled:opacity-50 active:scale-[.98] active:bg-teal-600"
          >
            {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : null}
            {assignment.todayAttendance?.checkOut
              ? 'Sudah Absen Pulang ✓'
              : !assignment.todayAttendance?.checkIn
              ? 'Absen Pulang (datang dulu)'
              : 'Absen Pulang'}
          </button>
        ) : (
          <div className="rounded-2xl bg-slate-100 px-4 py-4 text-center text-sm text-muted dark:bg-slate-800">
            🕐 Absen pulang dibuka pukul {pad2(earlyH)}:{pad2(earlyM)}
          </div>
        )}
      </div>

      {/* Info lokasi */}
      <div className="mt-4 rounded-2xl border border-line/50 px-4 py-3 text-sm text-muted">
        <p className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {assignment.locationName}{assignment.locationCity ? `, ${assignment.locationCity}` : ''}</p>
        {assignment.supervisorName && <p className="mt-1">👨‍🏫 Guru pembimbing: {assignment.supervisorName}</p>}
      </div>

      {/* Result overlay */}
      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          {result.ok ? (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-float animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <p className="text-sm font-bold text-emerald-600">✓ {result.message}</p>
              {result.checkIn && <p className="mt-2 font-mono text-3xl font-extrabold text-ink">{result.checkIn}</p>}
              {result.checkOut && <p className="mt-2 font-mono text-3xl font-extrabold text-ink">{result.checkOut}</p>}
              {result.locationVerified !== undefined && (
                <p className="mt-2 text-xs text-muted">
                  {result.locationVerified ? '✅ Lokasi terverifikasi' : '⚠️ Di luar radius — tercatat tetap'}
                </p>
              )}
            </div>
          ) : (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-float animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-500">
                <XCircle className="h-9 w-9" />
              </div>
              <p className="font-bold text-ink">{result.message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
