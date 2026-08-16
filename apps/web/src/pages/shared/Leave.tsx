import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, Send, Paperclip, X, Loader2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Card, Button, Input, Field, Select, Textarea, Badge, Segmented, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, shortDate, todayJakartaKey } from '../../lib/format';

interface LeaveRow {
  id: string; type: string; startDate: string; endDate: string; reason: string; status: string; rejectionReason?: string | null; createdAt: string;
}

export default function Leave() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'new' | 'mine'>('new');
  const [form, setForm] = useState({ type: 'PERSONAL', startDate: todayJakartaKey(), endDate: todayJakartaKey(), reason: '', attachmentUrl: '' });
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);

  const { data: mine } = useQuery({
    queryKey: ['leave-mine'],
    queryFn: () => api<{ success: boolean; data: LeaveRow[] }>('/leave/mine').then((r) => r.data),
  });

  const uploadAttachment = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast('error', 'Ukuran file maksimal 5 MB.');
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      toast('error', 'Format harus JPG/PNG/WEBP/PDF.');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api<{ success: boolean; data: { url: string } }>('/upload', { method: 'POST', formData });
      setForm((f) => ({ ...f, attachmentUrl: res.data.url }));
      setFileName(file.name);
      toast('success', 'Bukti berhasil diunggah.');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gagal mengunggah bukti.');
    } finally {
      setUploading(false);
    }
  };

  const mutation = useMutation({
    mutationFn: () => api('/leave', { method: 'POST', body: form }),
    onSuccess: () => {
      toast('success', 'Pengajuan izin berhasil dikirim.');
      qc.invalidateQueries({ queryKey: ['leave-mine'] });
      setForm({ type: 'PERSONAL', startDate: todayJakartaKey(), endDate: todayJakartaKey(), reason: '', attachmentUrl: '' });
      setFileName('');
      setTab('mine');
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal mengirim.'),
  });

  return (
    <div>
      <PageHeader title="Izin & Sakit" subtitle="Ajukan izin, sakit, cuti, atau dinas luar" />
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'new', label: 'Ajukan Baru' },
            { value: 'mine', label: 'Pengajuan Saya' },
          ]}
        />
      </div>

      {tab === 'new' ? (
        <Card className="max-w-xl">
          <h3 className="mb-4 flex items-center gap-2 font-bold text-ink"><FilePlus2 className="h-4 w-4" /> Form Pengajuan</h3>
          <div className="space-y-3">
            <Field label="Jenis">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mulai"><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink dark:bg-slate-900" /></Field>
              <Field label="Selesai"><input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink dark:bg-slate-900" /></Field>
            </div>
            <Field label="Alasan / Keterangan">
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Tuliskan alasan…" />
            </Field>
            <Field label="Bukti / Lampiran (opsional)" hint="Surat izin / keterangan dokter — JPG, PNG, WEBP, atau PDF, maks 5 MB.">
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAttachment(e.target.files[0])} />
              {form.attachmentUrl ? (
                <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 dark:bg-emerald-500/10">
                  <div className="flex min-w-0 items-center gap-2">
                    <Paperclip className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span className="truncate text-sm text-ink">{fileName}</span>
                  </div>
                  <button
                    onClick={() => {
                      setForm((f) => ({ ...f, attachmentUrl: '' }));
                      setFileName('');
                    }}
                    className="rounded-full p-1 text-muted hover:text-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-3 text-sm font-medium text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  {uploading ? 'Mengunggah…' : 'Unggah bukti izin'}
                </button>
              )}
            </Field>
            <Button className="w-full" onClick={() => mutation.mutate()} disabled={form.reason.length < 5 || mutation.isPending}>
              <Send className="h-4 w-4" /> Kirim Pengajuan
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {mine?.map((l) => (
            <Card key={l.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-ink">{LEAVE_TYPE_LABELS[l.type]} · {shortDate(l.startDate)} — {shortDate(l.endDate)}</p>
                <p className="text-sm text-muted">{l.reason}</p>
                {l.rejectionReason && <p className="text-xs text-red-500">Ditolak: {l.rejectionReason}</p>}
              </div>
              <Badge status={l.status} label={LEAVE_STATUS_LABELS[l.status]} />
            </Card>
          ))}
          {mine?.length === 0 && <EmptyState icon={FilePlus2} title="Belum ada pengajuan" />}
        </div>
      )}
    </div>
  );
}
