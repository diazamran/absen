import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Card, Skeleton } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import {
  Wifi, WifiOff, RefreshCw, Activity, Users, GraduationCap,
  BookOpen, Clock, AlertTriangle, CheckCircle2, Loader2,
  Server, Zap, History, ArrowRight, UserX, AlertCircle,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UnsyncedStudent {
  id: string;
  userId: string;
  nis: string;
  fullName: string;
  className: string | null;
  createdAt: string;
}
interface UnsyncedTeacher {
  id: string;
  userId: string;
  nip: string;
  fullName: string;
  createdAt: string;
}
interface UnsyncedData {
  students: UnsyncedStudent[];
  teachers: UnsyncedTeacher[];
}

interface MonitorData {
  connection: {
    status: 'online' | 'offline' | 'not_configured';
    latencyMs: number | null;
    sdmsStudentsCount: number | null;
    errorMessage: string | null;
    configured: boolean;
  };
  lastSync: {
    time: string | null;
    results: { students?: number; teachers?: number; classes?: number; errors?: string[] } | null;
    webhookTime: string | null;
    webhookEvent: string | null;
  };
  local: {
    students: number;
    teachers: number;
    classes: number;
  };
  recentEvents: Array<{
    id: string;
    action: string;
    user: string;
    details: unknown;
    time: string;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  const days = Math.floor(hrs / 24);
  return `${days} hari lalu`;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function SDMSMonitor() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data, isLoading, refetch, isFetching } = useQuery<MonitorData>({
    queryKey: ['sdms-monitor'],
    queryFn: () => api<{ data: MonitorData }>('/sdms/monitor').then((r) => r.data),
    refetchInterval: autoRefresh ? 30_000 : false,
  });

  const testConnection = useMutation({
    mutationFn: async () => {
      const r = await api<{ success: boolean; message: string }>('/sdms/test', { method: 'POST' });
      return r;
    },
    onSuccess: (r) => toast('success', r.message),
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal test koneksi'),
  });

  const syncNow = useMutation({
    mutationFn: async () => {
      const r = await api<{ success: boolean; message: string; data: { students: number; teachers: number; classes: number } }>('/sdms/sync', { method: 'POST' });
      return r;
    },
    onSuccess: (r) => {
      toast('success', `Sinkronisasi selesai: ${r.data.students} siswa, ${r.data.teachers} guru, ${r.data.classes} kelas`);
      qc.invalidateQueries({ queryKey: ['sdms-monitor'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal sinkronisasi'),
  });

  const conn = data?.connection;
  const sync = data?.lastSync;
  const local = data?.local;
  const events = data?.recentEvents ?? [];

  const [unsyncedTab, setUnsyncedTab] = useState<'student' | 'teacher'>('student');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeactivateAll, setConfirmDeactivateAll] = useState(false);

  const { data: unsyncedData, isLoading: unsyncedLoading, refetch: refetchUnsynced } = useQuery<UnsyncedData>({
    queryKey: ['sdms-unsynced'],
    queryFn: () => api<{ data: UnsyncedData }>('/sdms/unsynced').then((r) => r.data),
  });

  const deactivateMutation = useMutation({
    mutationFn: (vars: { type: 'student' | 'teacher'; ids: string[] }) =>
      api<{ success: boolean; message: string; data: { deactivated: number } }>('/sdms/deactivate', {
        method: 'POST',
        body: vars,
      }),
    onSuccess: (r) => {
      toast('success', r.message);
      setSelectedIds(new Set());
      setConfirmDeactivateAll(false);
      refetchUnsynced();
      qc.invalidateQueries({ queryKey: ['sdms-monitor'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menonaktifkan'),
  });

  const currentList = unsyncedTab === 'student'
    ? (unsyncedData?.students ?? [])
    : (unsyncedData?.teachers ?? []);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === currentList.length && currentList.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentList.map((x) => x.id)));
    }
  };

  useEffect(() => { setSelectedIds(new Set()); }, [unsyncedTab]);

  return (
    <div>
      <PageHeader
        title="Monitor SDMS"
        subtitle="Pantau status koneksi antara server absen dan SDMS"
        action={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="accent-primary"
              />
              Auto-refresh (30s)
            </label>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        }
      />

      {/* Connection Status Banner */}
      <Card className={`mb-6 border-2 ${
        conn?.status === 'online' ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
        : conn?.status === 'offline' ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30'
        : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30'
      }`}>
        <div className="flex items-center gap-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
            conn?.status === 'online' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400'
            : conn?.status === 'offline' ? 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400'
            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }`}>
            {conn?.status === 'online' ? <Wifi className="h-7 w-7" />
              : conn?.status === 'offline' ? <WifiOff className="h-7 w-7" />
              : <Server className="h-7 w-7" />}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-ink">
              {conn?.status === 'online' ? '✅ SDMS Terhubung'
                : conn?.status === 'offline' ? '❌ SDMS Terputus'
                : '⚠️ Belum Dikonfigurasi'}
            </h2>
            <p className="text-sm text-muted">
              {conn?.status === 'online'
                ? `Latency: ${conn.latencyMs}ms · ${conn.sdmsStudentsCount?.toLocaleString()} siswa terdaftar di SDMS`
                : conn?.status === 'offline'
                ? conn.errorMessage || 'Tidak dapat terhubung ke server SDMS'
                : 'Isi konfigurasi SDMS di menu Pengaturan terlebih dahulu'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => testConnection.mutate()}
              disabled={testConnection.isPending}
            >
              {testConnection.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Test Koneksi
            </Button>
            <Button
              onClick={() => syncNow.mutate()}
              disabled={syncNow.isPending || conn?.status !== 'online'}
            >
              {syncNow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sinkronisasi
            </Button>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Last Sync Info */}
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <h3 className="font-bold text-ink">Sinkronisasi Terakhir</h3>
            </div>
            {sync?.time ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
                  <span className="text-sm text-muted">Terakhir pull</span>
                  <span className="text-sm font-semibold text-ink">{fmtDate(sync.time)} ({timeAgo(sync.time)})</span>
                </div>
                {sync.results && (
                  <div className="grid grid-cols-3 gap-2">
                    <StatMini label="Siswa" value={sync.results.students ?? 0} icon={<GraduationCap className="h-4 w-4" />} />
                    <StatMini label="Guru" value={sync.results.teachers ?? 0} icon={<Users className="h-4 w-4" />} />
                    <StatMini label="Kelas" value={sync.results.classes ?? 0} icon={<BookOpen className="h-4 w-4" />} />
                  </div>
                )}
                {sync.results?.errors && sync.results.errors.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <p className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      ⚠️ {sync.results.errors.length} error saat sync
                    </p>
                    <div className="max-h-24 space-y-1 overflow-y-auto text-xs text-amber-600 dark:text-amber-500">
                      {sync.results.errors.slice(0, 5).map((e, i) => (
                        <p key={i} className="truncate">• {e}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">Belum pernah sinkronisasi</p>
            )}

            {sync?.webhookTime && (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-blue-50 px-4 py-3 dark:bg-blue-950/30">
                <span className="text-sm text-blue-600 dark:text-blue-400">Webhook terakhir</span>
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  {sync.webhookEvent} · {fmtDate(sync.webhookTime)}
                </span>
              </div>
            )}
          </Card>

          {/* Local Data Stats */}
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <h3 className="font-bold text-ink">Data Lokal (Absen)</h3>
            </div>
            <div className="space-y-3">
              <DataBar label="Siswa" local={local?.students ?? 0} remote={conn?.sdmsStudentsCount ?? 0} icon={<GraduationCap className="h-4 w-4" />} />
              <DataBar label="Guru" local={local?.teachers ?? 0} remote={null} icon={<Users className="h-4 w-4" />} />
              <DataBar label="Kelas" local={local?.classes ?? 0} remote={null} icon={<BookOpen className="h-4 w-4" />} />
            </div>

            {/* Sync Comparison */}
            {conn?.sdmsStudentsCount != null && local?.students != null && (
              <div className="mt-4 rounded-xl border border-line p-3 dark:border-slate-700">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">SDMS</span>
                  <ArrowRight className="h-4 w-4 text-muted" />
                  <span className="text-muted">Absen</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-lg font-bold text-ink">{conn.sdmsStudentsCount.toLocaleString()}</span>
                  <span className="text-lg font-bold text-primary">{local.students.toLocaleString()}</span>
                </div>
                <div className="mt-1 text-center text-xs text-muted">
                  {conn.sdmsStudentsCount === local.students
                    ? '✅ Jumlah sama — sinkron'
                    : conn.sdmsStudentsCount > local.students
                    ? `⚠️ SDMS punya ${conn.sdmsStudentsCount - local.students} siswa lebih banyak`
                    : `ℹ️ Absen punya ${local.students - conn.sdmsStudentsCount} siswa lebih banyak`}
                </div>
              </div>
            )}
          </Card>

          {/* Recent Events Log */}
          <Card className="lg:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              <h3 className="font-bold text-ink">Riwayat Event</h3>
            </div>
            {events.length === 0 ? (
              <p className="text-sm text-muted">Belum ada riwayat event</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs font-semibold text-muted dark:border-slate-700">
                      <th className="pb-2 pr-4">Waktu</th>
                      <th className="pb-2 pr-4">Aksi</th>
                      <th className="pb-2 pr-4">Oleh</th>
                      <th className="pb-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id} className="border-b border-line/50 dark:border-slate-800">
                        <td className="py-2.5 pr-4 text-xs text-muted whitespace-nowrap">{fmtDate(ev.time)}</td>
                        <td className="py-2.5 pr-4">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            ev.action === 'SDMS_MANUAL_SYNC'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                              : ev.action === 'SDMS_DEACTIVATE_UNSYNCED'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                          }`}>
                            {ev.action === 'SDMS_MANUAL_SYNC' ? <RefreshCw className="h-3 w-3" />
                              : ev.action === 'SDMS_DEACTIVATE_UNSYNCED' ? <UserX className="h-3 w-3" />
                              : <CheckCircle2 className="h-3 w-3" />}
                            {ev.action === 'SDMS_MANUAL_SYNC' ? 'Sync Manual'
                              : ev.action === 'SDMS_DEACTIVATE_UNSYNCED' ? 'Nonaktifkan'
                              : 'Settings Update'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 text-xs font-medium text-ink">{ev.user}</td>
                        <td className="py-2.5 text-xs text-muted">
                          {ev.action === 'SDMS_MANUAL_SYNC' && ev.details && typeof ev.details === 'object' && 'students' in (ev.details as Record<string, unknown>) ? (
                            <span>
                              {String((ev.details as Record<string, unknown>).students ?? 0)} siswa · {String((ev.details as Record<string, unknown>).teachers ?? 0)} guru · {String((ev.details as Record<string, unknown>).classes ?? 0)} kelas
                              {Array.isArray((ev.details as Record<string, unknown>).errors) && ((ev.details as Record<string, unknown>).errors as string[]).length > 0 && (
                                <span className="ml-2 text-red-500">⚠ {((ev.details as Record<string, unknown>).errors as string[]).length} error</span>
                              )}
                            </span>
                          ) : ev.action === 'SDMS_DEACTIVATE_UNSYNCED' && ev.details && typeof ev.details === 'object' ? (
                            <span>{String((ev.details as Record<string, unknown>).count ?? 0)} {String((ev.details as Record<string, unknown>).type ?? '')} dinonaktifkan</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ── Data Tidak Tersinkron ── */}
          <Card className="lg:col-span-2">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                <h3 className="font-bold text-ink">Data Tidak Tersinkron SDMS</h3>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                  Hanya akun bukan dari SDMS
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchUnsynced()} disabled={unsyncedLoading}>
                <RefreshCw className={`h-3.5 w-3.5 ${unsyncedLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <p className="mb-4 text-sm text-muted">
              Siswa dan guru yang aktif di sistem Absen tapi <strong>tidak dikelola oleh SDMS</strong> (mungkin sudah keluar, pindah, atau dibuat manual). Periksa sebelum menonaktifkan.
            </p>

            {/* Tab Siswa / Guru */}
            <div className="mb-4 flex gap-2 border-b border-line dark:border-slate-700">
              {(['student', 'teacher'] as const).map((tab) => {
                const count = tab === 'student'
                  ? (unsyncedData?.students.length ?? 0)
                  : (unsyncedData?.teachers.length ?? 0);
                return (
                  <button
                    key={tab}
                    onClick={() => setUnsyncedTab(tab)}
                    className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold transition ${
                      unsyncedTab === tab
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted hover:text-ink'
                    }`}
                  >
                    {tab === 'student' ? <GraduationCap className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                    {tab === 'student' ? 'Siswa' : 'Guru'}
                    {count > 0 && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {unsyncedLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : currentList.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                <p className="font-semibold text-ink">Semua {unsyncedTab === 'student' ? 'siswa' : 'guru'} aktif tersinkron dengan SDMS</p>
              </div>
            ) : (
              <>
                {/* Toolbar aksi */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === currentList.length && currentList.length > 0}
                      onChange={toggleAll}
                      className="accent-primary"
                    />
                    Pilih semua ({currentList.length})
                  </label>
                  <div className="ml-auto flex gap-2">
                    {selectedIds.size > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!confirm(`Nonaktifkan ${selectedIds.size} ${unsyncedTab === 'student' ? 'siswa' : 'guru'} terpilih?`)) return;
                          deactivateMutation.mutate({ type: unsyncedTab, ids: Array.from(selectedIds) });
                        }}
                        disabled={deactivateMutation.isPending}
                        className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400"
                      >
                        {deactivateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                        Nonaktifkan Terpilih ({selectedIds.size})
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!confirm(`Nonaktifkan SEMUA ${currentList.length} ${unsyncedTab === 'student' ? 'siswa' : 'guru'} yang tidak tersinkron?\n\nTindakan ini tidak bisa dibatalkan.`)) return;
                        deactivateMutation.mutate({ type: unsyncedTab, ids: currentList.map((x) => x.id) });
                      }}
                      disabled={deactivateMutation.isPending || currentList.length === 0}
                      className="border-red-400 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-950/30 dark:text-red-400"
                    >
                      {deactivateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      Nonaktifkan Semua
                    </Button>
                  </div>
                </div>

                {/* Tabel */}
                <div className="overflow-x-auto rounded-xl border border-line dark:border-slate-700">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/50">
                      <tr className="text-left text-xs font-semibold text-muted">
                        <th className="px-3 py-2.5 w-8"></th>
                        <th className="px-3 py-2.5">Nama</th>
                        <th className="px-3 py-2.5">{unsyncedTab === 'student' ? 'NIS' : 'NIP'}</th>
                        {unsyncedTab === 'student' && <th className="px-3 py-2.5">Kelas</th>}
                        <th className="px-3 py-2.5">Dibuat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentList.map((item, i) => (
                        <tr
                          key={item.id}
                          onClick={() => toggleSelect(item.id)}
                          className={`cursor-pointer border-t border-line transition dark:border-slate-700 ${
                            selectedIds.has(item.id)
                              ? 'bg-red-50 dark:bg-red-950/20'
                              : i % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'
                          } hover:bg-amber-50/50 dark:hover:bg-amber-950/10`}
                        >
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleSelect(item.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="accent-red-500"
                            />
                          </td>
                          <td className="px-3 py-2.5 font-medium text-ink">{item.fullName}</td>
                          <td className="px-3 py-2.5 font-mono text-xs text-muted">
                            {'nis' in item ? item.nis : ('nip' in item ? (item as UnsyncedTeacher).nip ?? '-' : '-')}
                          </td>
                          {unsyncedTab === 'student' && (
                            <td className="px-3 py-2.5 text-muted">{'className' in item ? (item as UnsyncedStudent).className ?? '-' : '-'}</td>
                          )}
                          <td className="px-3 py-2.5 text-xs text-muted whitespace-nowrap">{fmtDate(item.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatMini({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 text-center dark:bg-slate-800/50">
      <div className="flex items-center justify-center gap-1 text-muted">{icon}</div>
      <p className="mt-1 text-lg font-bold text-ink">{value.toLocaleString()}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function DataBar({ label, local, remote, icon }: { label: string; local: number; remote: number | null; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
      <div className="text-muted">{icon}</div>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-ink">{label}</span>
          <span className="text-sm font-bold text-ink">{local.toLocaleString()}</span>
        </div>
        {remote != null && (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, remote > 0 ? (local / remote) * 100 : 0)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
