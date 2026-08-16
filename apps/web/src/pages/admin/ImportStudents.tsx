import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileSpreadsheet, Download, CheckCircle2, XCircle } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Card, Field, EmptyState } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';

interface PreviewRow {
  line: number; nis: string; nama: string; kelas: string; errors: string[]; valid: boolean;
}

const TEMPLATE_HEADERS = ['NIS', 'Nama', 'Kelas', 'Jurusan', 'Jenis Kelamin', 'Tanggal Lahir', 'No HP', 'Nama Orang Tua', 'No WhatsApp Orang Tua', 'Card UID'];
const TEMPLATE_SAMPLE = ['121217', 'CONTOH SISWA', 'X-TKJ-1', 'TKJ', 'L', '2009-01-15', '081234567899', 'Bapak Contoh', '081234567899', ''];

function downloadTemplate() {
  const csv = [TEMPLATE_HEADERS.join(','), TEMPLATE_SAMPLE.join(',')].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'template-import-siswa.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportStudents() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; valid: number; invalid: number } | null>(null);

  const doPreview = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await api<{ success: boolean; data: { total: number; valid: number; invalid: number; rows: PreviewRow[] } }>('/import/students/preview', { method: 'POST', formData: form });
      return res.data;
    },
    onSuccess: (data) => {
      setPreview(data.rows);
      setMeta({ total: data.total, valid: data.valid, invalid: data.invalid });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal membaca file.'),
  });

  const doConfirm = useMutation({
    mutationFn: () =>
      api<{ success: boolean; message: string; data: { created: number; errors: { nis: string; error: string }[] } }>('/import/students/confirm', {
        method: 'POST',
        body: { rows: (preview || []).filter((r) => r.valid).map((r) => ({ nis: r.nis, nama: r.nama, kelas: r.kelas })) },
      }),
    onSuccess: (res: { success: boolean; message: string; data: { created: number; errors: { nis: string; error: string }[] } }) => {
      toast('success', res.message);
      qc.invalidateQueries({ queryKey: ['students'] });
      setPreview(null);
      setMeta(null);
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal import.'),
  });

  return (
    <div>
      <PageHeader
        title="Import Siswa"
        subtitle="Upload CSV: NIS, Nama, Kelas, Jurusan, Jenis Kelamin, Tanggal Lahir, No HP, Nama Orang Tua, No WhatsApp Orang Tua, Card UID"
        action={
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Template CSV
          </Button>
        }
      />
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && doPreview.mutate(e.target.files[0])} />

      {!preview && (
        <button
          onClick={() => fileRef.current?.click()}
          className="flex w-full max-w-2xl flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-line py-14 transition-colors hover:border-primary"
        >
          <div className="rounded-2xl bg-primary-soft p-4 text-primary"><Upload className="h-8 w-8" /></div>
          <p className="font-bold text-ink">Pilih file CSV</p>
          <p className="max-w-sm text-center text-sm text-muted">Sistem akan menampilkan pratinjau dan validasi per baris sebelum data disimpan.</p>
        </button>
      )}

      {preview && meta && (
        <div className="space-y-4">
          <Card className="flex items-center justify-between">
            <div className="flex gap-6 text-sm">
              <span className="text-muted">Total: <b className="text-ink">{meta.total}</b></span>
              <span className="text-emerald-600">Valid: <b>{meta.valid}</b></span>
              <span className="text-red-500">Error: <b>{meta.invalid}</b></span>
            </div>
            <Button variant="outline" onClick={() => { setPreview(null); setMeta(null); }}>Pilih file lain</Button>
          </Card>

          <Card>
            <h3 className="mb-3 font-bold text-ink">Pratinjau</h3>
            <div className="max-h-96 space-y-1.5 overflow-y-auto">
              {preview.map((r) => (
                <div key={r.line} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${r.valid ? 'bg-emerald-50/60 dark:bg-emerald-500/10' : 'bg-red-50/60 dark:bg-red-500/10'}`}>
                  {r.valid ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                  <span className="w-10 text-xs text-muted">#{r.line}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.nama || '—'}</span>
                  <span className="text-xs text-muted">{r.nis}</span>
                  {r.errors.length > 0 && <span className="text-xs text-red-500">{r.errors.join('; ')}</span>}
                </div>
              ))}
            </div>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setPreview(null); setMeta(null); }}>Batal</Button>
            <Button onClick={() => doConfirm.mutate()} disabled={meta.valid === 0 || doConfirm.isPending}>
              Import {meta.valid} Siswa
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
