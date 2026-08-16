import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Send } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Card, Button, Input, Field, Select, Textarea, Badge, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { todayJakartaKey } from '../../lib/format';

interface JournalRow {
  id: string; className: string; subjectName: string; date: string; period?: string | null;
  material: string; notes?: string | null;
}

export default function Journal() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ classId: '', subjectId: '', period: '', material: '', notes: '', date: todayJakartaKey() });

  const { data: journals } = useQuery({
    queryKey: ['journals'],
    queryFn: () => api<{ success: boolean; data: JournalRow[] }>('/journals').then((r) => r.data),
  });
  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data) });
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/subjects').then((r) => r.data) });

  const mutation = useMutation({
    mutationFn: () => api('/journals', { method: 'POST', body: form }),
    onSuccess: () => {
      toast('success', 'Jurnal tersimpan.');
      qc.invalidateQueries({ queryKey: ['journals'] });
      setForm({ ...form, material: '', notes: '' });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  return (
    <div>
      <PageHeader title="Jurnal Mengajar" subtitle="Catat materi dan kehadiran tiap sesi" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 flex items-center gap-2 font-bold text-ink"><BookOpen className="h-4 w-4" /> Isi Jurnal</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kelas">
                <Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                  <option value="">Pilih</option>
                  {classes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Mata Pelajaran">
                <Select value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
                  <option value="">Pilih</option>
                  {subjects?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Tanggal"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink dark:bg-slate-900" /></Field>
            <Field label="Jam"><Input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="Jam 1" /></Field>
            <Field label="Materi *"><Input value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} placeholder="Persamaan Kuadrat" /></Field>
            <Field label="Catatan"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Opsional" /></Field>
            <Button className="w-full" onClick={() => mutation.mutate()} disabled={!form.classId || !form.subjectId || !form.material}>
              <Send className="h-4 w-4" /> Simpan Jurnal
            </Button>
          </div>
        </Card>

        <div>
          <h3 className="mb-3 font-bold text-ink">Riwayat Jurnal</h3>
          <div className="space-y-2">
            {journals?.map((j) => (
              <Card key={j.id}>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-ink">{j.subjectName} · {j.className}</p>
                  <Badge status="APPROVED" label="JURNAL TERISI" />
                </div>
                <p className="mt-1 text-sm text-muted">{new Date(j.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' })}{j.period ? ` · ${j.period}` : ''}</p>
                <p className="mt-2 text-sm font-medium text-ink">{j.material}</p>
                {j.notes && <p className="mt-1 text-xs text-muted">{j.notes}</p>}
              </Card>
            ))}
            {journals?.length === 0 && <EmptyState icon={BookOpen} title="Belum ada jurnal" description="Isi jurnal pertama Anda hari ini." />}
          </div>
        </div>
      </div>
    </div>
  );
}
