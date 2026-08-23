import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, FileText, Paperclip, Eye, Download, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { Card, Badge, Button, Segmented, EmptyState, Modal, Field, Textarea } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, shortDate } from '../../lib/format';

interface LeaveRow {
  id: string; userName: string; nis: string | null; className: string | null; type: string;
  startDate: string; endDate: string; reason: string; status: string; rejectionReason?: string | null; attachmentUrl?: string | null;
}

export default function LeaveAdmin() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = user?.roles?.includes('SUPER_ADMIN') || user?.roleKey === 'SUPER_ADMIN';
  const [tab, setTab] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [detailLeave, setDetailLeave] = useState<LeaveRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: leaves } = useQuery({
    queryKey: ['leave-all', tab],
    queryFn: () => api<{ success: boolean; data: LeaveRow[] }>(`/leave?status=${tab === 'ALL' ? '' : tab}`).then((r) => r.data),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api(`/leave/${id}/approve`, { method: 'POST' }),
    onSuccess: () => { toast('success', 'Pengajuan disetujui.'); qc.invalidateQueries({ queryKey: ['leave-all'] }); },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });
  const reject = useMutation({
    mutationFn: (payload: { id: string; reason: string }) => api(`/leave/${payload.id}/reject`, { method: 'POST', body: { reason: payload.reason } }),
    onSuccess: () => { toast('success', 'Pengajuan ditolak.'); qc.invalidateQueries({ queryKey: ['leave-all'] }); setRejectId(null); },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal.'),
  });
  const deleteLeave = useMutation({
    mutationFn: (id: string) => api(`/leave/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('success', 'Pengajuan izin berhasil dihapus.'); qc.invalidateQueries({ queryKey: ['leave-all'] }); setDeleteId(null); },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menghapus.'),
  });

  return (
    <div>
      <PageHeader title="Pengajuan Izin" subtitle="Kelola izin, sakit, dan dinas" />
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'PENDING', label: 'Menunggu' },
            { value: 'APPROVED', label: 'Disetujui' },
            { value: 'REJECTED', label: 'Ditolak' },
            { value: 'ALL', label: 'Semua' },
          ]}
        />
      </div>

      <div className="space-y-3">
        {leaves?.map((l) => (
          <Card key={l.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-primary-soft p-2.5 text-primary"><FileText className="h-5 w-5" /></div>
                <div>
                  <p className="font-bold text-ink">{l.userName} <span className="font-normal text-muted">· {l.className}</span></p>
                  <p className="text-xs text-muted">{l.nis} · {LEAVE_TYPE_LABELS[l.type] || l.type}</p>
                  <p className="mt-1 text-sm text-ink">{l.reason}</p>
                  <p className="mt-0.5 text-xs text-muted">{shortDate(l.startDate)} — {shortDate(l.endDate)}</p>
                  {l.attachmentUrl && (
                    <div className="mt-2 flex items-center gap-2">
                      {l.attachmentUrl.match(/\.(jpg|jpeg|png|webp|gif)/i) ? (
                        <button onClick={() => setDetailLeave(l)} className="group relative">
                          <img
                            src={l.attachmentUrl}
                            alt="Bukti izin"
                            className="h-16 w-16 rounded-xl border border-line object-cover transition group-hover:ring-2 group-hover:ring-primary"
                          />
                          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 transition group-hover:bg-black/30">
                            <Eye className="h-5 w-5 text-white opacity-0 transition group-hover:opacity-100" />
                          </div>
                        </button>
                      ) : (
                        <a
                          href={l.attachmentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary-dark hover:brightness-95"
                        >
                          <Paperclip className="h-3.5 w-3.5" /> Lihat Lampiran
                        </a>
                      )}
                    </div>
                  )}
                  {l.rejectionReason && <p className="mt-1 text-xs text-red-500">Alasan ditolak: {l.rejectionReason}</p>}
                </div>
              </div>
              <Badge status={l.status} label={LEAVE_STATUS_LABELS[l.status]} />
            </div>
            <div className="mt-3 flex items-center justify-between">
              {isSuperAdmin && (
                <button
                  onClick={() => setDeleteId(l.id)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                  title="Hapus pengajuan izin"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Hapus
                </button>
              )}
              {l.status === 'PENDING' && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setRejectId(l.id)}><X className="h-4 w-4" /> Tolak</Button>
                  <Button onClick={() => approve.mutate(l.id)}><Check className="h-4 w-4" /> Setujui</Button>
                </div>
              )}
            </div>
          </Card>
        ))}
        {leaves?.length === 0 && <EmptyState icon={FileText} title="Tidak ada pengajuan" description="Pengajuan izin siswa/guru akan tampil di sini." />}
      </div>

      {rejectId && <RejectModal leaveId={rejectId} onClose={() => setRejectId(null)} onReject={(reason) => reject.mutate({ id: rejectId, reason })} />}

      {detailLeave && (
        <Modal open onClose={() => setDetailLeave(null)} title="Detail Pengajuan Izin">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-primary-soft p-2.5 text-primary"><FileText className="h-5 w-5" /></div>
              <div>
                <p className="font-bold text-ink">{detailLeave.userName}</p>
                <p className="text-xs text-muted">{detailLeave.nis} · {detailLeave.className}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted">Jenis:</span> <span className="font-medium text-ink">{LEAVE_TYPE_LABELS[detailLeave.type]}</span></div>
              <div><span className="text-muted">Status:</span> <Badge status={detailLeave.status} label={LEAVE_STATUS_LABELS[detailLeave.status]} /></div>
              <div><span className="text-muted">Dari:</span> <span className="font-medium text-ink">{shortDate(detailLeave.startDate)}</span></div>
              <div><span className="text-muted">Sampai:</span> <span className="font-medium text-ink">{shortDate(detailLeave.endDate)}</span></div>
            </div>
            <div>
              <p className="text-xs text-muted">Keterangan:</p>
              <p className="mt-0.5 rounded-xl bg-slate-50 p-3 text-sm text-ink dark:bg-slate-800">{detailLeave.reason}</p>
            </div>
            {detailLeave.attachmentUrl && (
              <div>
                <p className="mb-1 text-xs text-muted">Bukti / Lampiran:</p>
                {detailLeave.attachmentUrl.match(/\.(jpg|jpeg|png|webp|gif)/i) ? (
                  <div className="overflow-hidden rounded-xl border border-line">
                    <img
                      src={detailLeave.attachmentUrl}
                      alt="Bukti izin"
                      className="w-full max-h-80 object-contain bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                ) : (
                  <a
                    href={detailLeave.attachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-soft px-3 py-2 text-sm font-semibold text-primary-dark hover:brightness-95"
                  >
                    <Download className="h-4 w-4" /> Unduh Lampiran
                  </a>
                )}
              </div>
            )}
            {detailLeave.rejectionReason && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:bg-red-500/10">
                <p className="text-xs font-semibold text-red-600">Alasan ditolak:</p>
                <p className="mt-0.5 text-sm text-red-700 dark:text-red-400">{detailLeave.rejectionReason}</p>
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={() => setDetailLeave(null)}>Tutup</Button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <DeleteConfirmModal
          onClose={() => setDeleteId(null)}
          onConfirm={() => deleteLeave.mutate(deleteId)}
        />
      )}
    </div>
  );
}

function RejectModal({ leaveId, onClose, onReject }: { leaveId: string; onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title="Tolak Pengajuan">
      <Field label="Alasan penolakan">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wajib diisi…" />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button variant="danger" onClick={() => reason.trim() && onReject(reason.trim())} disabled={!reason.trim()}>Tolak</Button>
      </div>
    </Modal>
  );
}

function DeleteConfirmModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal open onClose={onClose} title="Hapus Pengajuan Izin">
      <p className="text-sm text-ink">Apakah Anda yakin ingin menghapus pengajuan izin ini? Tindakan ini tidak dapat dibatalkan.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button variant="danger" onClick={onConfirm}><Trash2 className="h-4 w-4" /> Hapus</Button>
      </div>
    </Modal>
  );
}
