import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { History as HistoryIcon, Search, Trash2, CheckSquare, Square, X, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Card, Badge, EmptyState, Select, Button } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { STATUS_LABELS, STATUS_COLORS, currentMonthKey, timeLabel } from '../../lib/format';

interface AttRow {
  id?: string; nis?: string | null; date: string; dayKey: string; checkIn?: string | null; checkOut?: string | null;
  status: string; method: string; lateMinutes: number; earlyLeave?: boolean; className?: string | null; name?: string | null;
}

function timeStr(v?: string | null): string {
  if (v && /^\d{2}:\d{2}$/.test(v)) return v;
  return timeLabel(v);
}

export default function History() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonthKey());

  // Hanya Super Admin & Admin bisa menghapus bersih catatan absensi siswa
  const canDelete = (user?.roles || [user?.roleKey || '']).some((r) =>
    ['SUPER_ADMIN', 'ADMIN'].includes(r)
  );

  // ===== Hapus satu =====
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/attendance/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('success', 'Catatan absensi dihapus dari database.');
      qc.invalidateQueries({ queryKey: ['attendance-history'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus catatan.'),
  });

  // ===== Hapus massal =====
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      api('/attendance/bulk-delete', { method: 'POST', body: { ids } }),
    onSuccess: (_, ids) => {
      toast('success', `${ids.length} catatan absensi dihapus.`);
      setSelected(new Set());
      setSelectMode(false);
      qc.invalidateQueries({ queryKey: ['attendance-history'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus catatan.'),
  });

  // ===== Mode seleksi =====
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelected(new Set());
  };
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = (ids: string[]) =>
    setSelected((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));

  // Orang tua melihat riwayat anak
  const isParent = user?.roles?.includes('PARENT') || user?.roleKey === 'PARENT';
  const { data: children } = useQuery({
    queryKey: ['dashboard-parent'],
    queryFn: () => api<{ success: boolean; data: { children: { studentId: string; name: string }[] } }>('/dashboard').then((r) => r.data),
    enabled: isParent,
  });
  const [childId, setChildId] = useState('');

  // Filter kelas
  const canFilterClass = !isParent && (user?.roles || [user?.roleKey || '']).some((r) =>
    ['ADMIN', 'SUPER_ADMIN', 'HEADMASTER', 'HOMEROOM_TEACHER', 'PIKET'].includes(r)
  );
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data),
    enabled: canFilterClass,
  });
  const [classId, setClassId] = useState('');

  const studentId = isParent ? childId : undefined;
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 10;

  const { data: rows } = useQuery({
    queryKey: ['attendance-history', month, studentId, classId],
    queryFn: async () => {
      if (isParent && !studentId) return [];
      if (isParent) {
        const res = await api<{ success: boolean; data: AttRow[] }>(`/attendance/student/${studentId}?month=${month}`);
        return res.data;
      }
      const me = await api<{ success: boolean; data: { student?: { id: string } | null } }>('/auth/me');
      if (!me.data.student) {
        const res = await api<{ success: boolean; data: { rows: { id?: string; name: string; nis?: string | null; className?: string | null; date: string; time?: string | null; checkOut?: string | null; earlyLeave?: boolean; status: string; method: string; lateMinutes: number }[] } }>(
          `/reports/monthly?month=${month}${classId ? `&classId=${classId}` : ''}`,
        );
        return res.data.rows.map((r, i) => ({
          id: r.id ?? `${r.date}-${r.nis || r.name || i}`,
          nis: r.nis ?? null,
          date: r.date,
          dayKey: r.date,
          checkIn: r.time ?? null,
          checkOut: r.checkOut ?? null,
          status: r.status,
          method: r.method,
          lateMinutes: r.lateMinutes,
          earlyLeave: r.earlyLeave ?? false,
          className: r.className ?? null,
          name: r.name,
        }));
      }
      const res = await api<{ success: boolean; data: AttRow[] }>(`/attendance/student/${me.data.student.id}?month=${month}`);
      return res.data;
    },
  });

  const stats = (rows || []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = rows || [];
    const matched = q ? base.filter((r) => `${r.name || ''} ${r.nis || ''} ${r.className || ''}`.toLowerCase().includes(q)) : base;
    return { matched, visible: showAll ? matched : matched.slice(0, LIMIT) };
  }, [rows, search, showAll]);

  // ID yang bisa dihapus dari yang tampil (harus punya id valid)
  const selectableIds = useMemo(
    () => filtered.visible.filter((r) => r.id && !r.id.includes('-')).map((r) => r.id as string),
    [filtered.visible],
  );

  const handleBulkDelete = () => {
    if (selected.size === 0) return;
    setConfirmOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Riwayat Absensi"
        subtitle={month.replace('-', ' ')}
        action={
          <div className="flex items-center gap-2">
            {canDelete && !selectMode && (
              <Button
                variant="outline"
                onClick={toggleSelectMode}
                className="text-sm"
              >
                <CheckSquare className="h-4 w-4" /> Pilih
              </Button>
            )}
            {canDelete && selectMode && (
              <Button
                variant="outline"
                onClick={toggleSelectMode}
                className="text-sm"
              >
                <X className="h-4 w-4" /> Batal
              </Button>
            )}
            <input
              type="month"
              value={month}
              onChange={(e) => { setMonth(e.target.value); setSelected(new Set()); setSelectMode(false); }}
              className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink dark:bg-slate-900"
            />
          </div>
        }
      />

      {isParent && (
        <div className="mb-4">
          <select value={childId} onChange={(e) => setChildId(e.target.value)} className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink dark:bg-slate-900 sm:w-64">
            <option value="">Pilih anak…</option>
            {children?.children.map((c) => <option key={c.studentId} value={c.studentId}>{c.name}</option>)}
          </select>
        </div>
      )}

      {canFilterClass && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full sm:w-64">
            <option value="">Semua kelas</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama / NIS / kelas…"
              className="w-full rounded-xl border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink dark:bg-slate-900"
            />
          </div>
        </div>
      )}

      {!isParent || childId ? (
        <>
          {/* Rekap bulan */}
          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <Card key={k} className="p-3 text-center">
                <p className="text-xl font-extrabold" style={{ color: STATUS_COLORS[k] }}>{stats[k] || 0}</p>
                <p className="text-[11px] text-muted">{label}</p>
              </Card>
            ))}
          </div>

          {/* ===== Toolbar seleksi ===== */}
          {canDelete && selectMode && (
            <div className="mb-3 flex items-center justify-between rounded-2xl border border-primary/30 bg-primary-soft/30 px-4 py-2.5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleAll(selectableIds)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-primary"
                >
                  {selected.size === selectableIds.length && selectableIds.length > 0
                    ? <CheckSquare className="h-4 w-4" />
                    : <Square className="h-4 w-4" />}
                  {selected.size === selectableIds.length && selectableIds.length > 0
                    ? 'Batal Pilih Semua'
                    : 'Pilih Semua'}
                </button>
                {selected.size > 0 && (
                  <span className="text-sm text-muted">{selected.size} dipilih</span>
                )}
              </div>
              <Button
                onClick={handleBulkDelete}
                disabled={selected.size === 0 || bulkDeleteMutation.isPending}
                className="!bg-red-500 !text-white hover:!bg-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Hapus {selected.size > 0 ? `(${selected.size})` : ''}
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {filtered.visible.map((r) => {
              const delId = canDelete && r.id && !r.id.includes('-') ? r.id : undefined;
              const isSelected = delId ? selected.has(delId) : false;

              return (
                <Card
                  key={r.id || `${r.date}-${r.nis || r.name || 0}`}
                  className={`flex items-center gap-3 p-3.5 transition-colors ${selectMode && delId ? 'cursor-pointer' : ''} ${isSelected ? 'border-primary/50 bg-primary-soft/20' : ''}`}
                  onClick={selectMode && delId ? () => toggleOne(delId) : undefined}
                >
                  {/* Checkbox di mode seleksi */}
                  {canDelete && selectMode && (
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {delId ? (
                        <button
                          onClick={() => toggleOne(delId)}
                          className={`flex h-5 w-5 items-center justify-center rounded ${isSelected ? 'text-primary' : 'text-muted'}`}
                        >
                          {isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                        </button>
                      ) : (
                        <div className="h-5 w-5" />
                      )}
                    </div>
                  )}

                  <div className="flex flex-col items-center rounded-xl bg-slate-50 px-3 py-1.5 dark:bg-slate-900">
                    <span className="text-sm font-bold text-ink">{(r.dayKey || r.date || '').slice(8)}</span>
                    <span className="text-[10px] uppercase text-muted">{(r.dayKey || r.date || '').slice(5, 7)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    {r.name && <p className="truncate text-sm font-bold text-ink">{r.name}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-ink">Masuk {timeStr(r.checkIn)}</span>
                      {r.checkOut && <span className="text-xs text-muted">Pulang {timeStr(r.checkOut)}</span>}
                      {r.earlyLeave && <Badge status="LATE" label="Pulang Awal" />}
                    </div>
                    <p className="text-xs text-muted">{r.className ? `Kelas ${r.className} · ` : ''}Metode: {r.method}</p>
                  </div>
                  <Badge status={r.status} label={r.status === 'LATE' && r.lateMinutes ? `Terlambat ${r.lateMinutes}m` : STATUS_LABELS[r.status]} />

                  {/* Tombol hapus per-item (hanya di luar mode seleksi) */}
                  {!selectMode && delId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Hapus PERMANEN catatan absen ${r.name || ''} (${(r.dayKey || r.date || '').slice(8)}/${(r.dayKey || r.date || '').slice(5, 7)}, Masuk ${timeStr(r.checkIn)})?\n\nData tidak bisa dikembalikan.`)) {
                          deleteMutation.mutate(delId);
                        }
                      }}
                      className="shrink-0 rounded-xl p-2 text-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                      title="Hapus catatan absen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </Card>
              );
            })}
            {filtered.visible.length === 0 && (
              <EmptyState
                icon={HistoryIcon}
                title={search ? 'Tidak ditemukan' : 'Belum ada riwayat'}
                description={search ? `Tidak ada catatan yang cocok dengan "${search}".` : 'Belum ada data absensi pada bulan ini.'}
              />
            )}
            {!search && (rows?.length || 0) > LIMIT && (
              <div className="pt-1 text-center">
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  {showAll
                    ? `Tampilkan lebih sedikit (${filtered.matched.length})`
                    : `Tampilkan semua (${filtered.matched.length} catatan)`}
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <EmptyState icon={HistoryIcon} title="Pilih anak" description="Pilih anak Anda untuk melihat riwayat kehadiran." />
      )}

      {/* ===== Konfirmasi hapus massal ===== */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmOpen(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-500 mx-auto">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h3 className="text-center text-lg font-bold text-ink">Hapus {selected.size} Catatan?</h3>
            <p className="mt-2 text-center text-sm text-muted">
              {selected.size} catatan absensi akan dihapus permanen dari database.
              <br /><strong>Tindakan ini tidak bisa dibatalkan.</strong>
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="flex-1 rounded-2xl border border-line py-2.5 text-sm font-semibold text-ink hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  bulkDeleteMutation.mutate([...selected]);
                }}
                disabled={bulkDeleteMutation.isPending}
                className="flex-1 rounded-2xl bg-red-500 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60"
              >
                {bulkDeleteMutation.isPending ? 'Menghapus…' : `Ya, Hapus ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
