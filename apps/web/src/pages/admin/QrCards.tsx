import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Printer, QrCode, Loader2, School } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../../lib/api';
import { Button, Select, EmptyState, Segmented } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';

interface QrStudent {
  studentId: string;
  nis: string;
  fullName: string;
  className: string;
  token: string;
  dataUrl?: string;
}

type Layout = 'big' | 'small';

export default function QrCards() {
  const [params, setParams] = useSearchParams();
  const classId = params.get('classId') || '';
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [layout, setLayout] = useState<Layout>('big');

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api<{ success: boolean; data: { id: string; name: string }[] }>('/classes').then((r) => r.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['qr-class', classId],
    queryFn: async () => {
      const res = await api<{ success: boolean; data: { className: string; students: QrStudent[] } }>(`/qr/class/${classId}`);
      return res.data;
    },
    enabled: !!classId,
  });

  // Render QR satu kali per token (reuse kalau token sama)
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      const map: Record<string, string> = { ...qrMap };
      await Promise.all(
        data.students.map(async (s) => {
          if (map[s.token]) return;
          try {
            map[s.token] = await QRCode.toDataURL(s.token, { width: 240, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });
          } catch {
            // token gagal di-render → kartu tanpa gambar
          }
        }),
      );
      if (!cancelled) setQrMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  const selectClass = (id: string) => {
    if (id) setParams({ classId: id });
    else setParams({});
  };

  const students = (data?.students || []).map((s) => ({ ...s, dataUrl: s.token ? qrMap[s.token] : undefined }));

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="Cetak Kartu QR Absen"
          subtitle="Pilih kelas & ukuran kartu → siap diprint & ditempel di kartu siswa"
          action={
            <Button onClick={() => window.print()} disabled={!students.length}>
              <Printer className="h-4 w-4" /> Cetak ({students.length})
            </Button>
          }
        />
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Segmented
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'big', label: 'Kartu Besar' },
              { value: 'small', label: 'Kecil ID (2×3,5 cm)' },
            ]}
          />
          <Select value={classId} onChange={(e) => selectClass(e.target.value)} className="sm:w-56">
            <option value="">Pilih kelas…</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {classId && data && (
            <p className="text-sm text-muted">
              <School className="mr-1 inline h-4 w-4" />
              {data.className} · {students.length} siswa · QR berlaku ±1 tahun
            </p>
          )}
        </div>
      </div>

      {!classId ? (
        <EmptyState icon={QrCode} title="Pilih kelas" description="Pilih kelas untuk mencetak kartu QR absen semua siswanya." />
      ) : isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : students.length === 0 ? (
        <EmptyState icon={QrCode} title="Tidak ada siswa" description="Belum ada siswa aktif di kelas ini." />
      ) : layout === 'big' ? (
        <div id="qr-print-area" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {students.map((s) => (
            <div key={s.studentId} className="qr-card flex flex-col items-center rounded-2xl border border-line bg-white p-3 text-center shadow-card">
              {s.dataUrl ? (
                <img src={s.dataUrl} alt={`QR ${s.fullName}`} className="h-28 w-28 rounded-lg bg-white" />
              ) : (
                <div className="flex h-28 w-28 items-center justify-center rounded-lg bg-slate-100 text-slate-300">
                  <QrCode className="h-10 w-10" />
                </div>
              )}
              <p className="mt-2 w-full truncate text-sm font-extrabold text-slate-900" title={s.fullName}>{s.fullName}</p>
              <p className="text-xs font-semibold text-slate-500">NISN {s.nis}</p>
              <p className="text-xs text-slate-400">{s.className}</p>
            </div>
          ))}
        </div>
      ) : (
        <div id="qr-print-area" className="qr-small-grid">
          {students.map((s) => (
            <div key={s.studentId} className="qr-card-small">
              {s.dataUrl ? (
                <img src={s.dataUrl} alt={`QR ${s.fullName}`} />
              ) : (
                <div className="qr-small-img-placeholder"><QrCode className="h-6 w-6" /></div>
              )}
              <div className="qr-small-text">
                <p className="qr-small-nis">{s.nis}</p>
                <p className="qr-small-name" title={s.fullName}>{s.fullName}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {classId && students.length > 0 && (
        <div className="no-print mt-6 rounded-2xl border border-line bg-primary-soft/50 p-4 text-sm text-muted dark:bg-primary-500/10">
          <p className="font-semibold text-ink">Tips cetak:</p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            <li>Klik <b>Cetak</b> → di dialog printer pilih <b>A4</b> dan margin <b>Default/Minimal</b>.</li>
            {layout === 'small' ? (
              <>
                <li>Kartu <b>kecil 2×3,5 cm</b> dicetak rapat di kertas label/kartu A4 — QR kiri, <b>NISN</b> & nama kanan. Potong sesuai garis/garis putus kertas.</li>
                <li>Ukuran QR ±1,7 cm — tetap terbaca kamera gerbang dari jarak dekat (5–20 cm).</li>
              </>
            ) : (
              <li>Kartu besar diatur agar tidak terpotong di tengah halaman (anti pecah antar halaman).</li>
            )}
            <li>QR berlaku ±1 tahun; siswa bisa absen dengan menunjukkan kartu ini ke kamera gerbang. Cetak ulang kapan saja tanpa perlu daftar ulang.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
