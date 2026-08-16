import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, FileText } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Card, Badge, Button, Segmented, EmptyState, Modal, Field, Textarea } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, shortDate } from '../../lib/format';

interface LeaveRow {
  id: string; userName: string; nis: string | null; className: string | null; type: string;
  startDate: string; endDate: string; reason: string; status: string; rejectionReason?: string | null;
}

export default function LeaveAdmin() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [rejectId, setRejectId] = useState<string | null>(null);

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
                  {l.rejectionReason && <p className="mt-1 text-xs text-red-500">Alasan ditolak: {l.rejectionReason}</p>}
                </div>
              </div>
              <Badge status={l.status} label={LEAVE_STATUS_LABELS[l.status]} />
            </div>
            {l.status === 'PENDING' && (
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setRejectId(l.id)}><X className="h-4 w-4" /> Tolak</Button>
                <Button onClick={() => approve.mutate(l.id)}><Check className="h-4 w-4" /> Setujui</Button>
              </div>
            )}
          </Card>
        ))}
        {leaves?.length === 0 && <EmptyState icon={FileText} title="Tidak ada pengajuan" description="Pengajuan izin siswa/guru akan tampil di sini." />}
      </div>

      {rejectId && <RejectModal leaveId={rejectId} onClose={() => setRejectId(null)} onReject={(reason) => reject.mutate({ id: rejectId, reason })} />}
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
