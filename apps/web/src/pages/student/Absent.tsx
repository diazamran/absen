import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Camera, QrCode, CreditCard, ListChecks, ScanFace, Clock, RefreshCw } from 'lucide-react';
import { Card, Button } from '../../lib/ui';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';

const METHODS = [
  { key: 'face', label: 'Absen Wajah', desc: 'Kamera depan + deteksi liveness', icon: <Camera className="h-7 w-7" />, to: '/app/absent/face', color: 'from-teal-500 to-emerald-500' },
  { key: 'qr', label: 'QR Code', desc: 'Pindai QR dinamis atau kartu', icon: <QrCode className="h-7 w-7" />, to: '/app/absent/qr', color: 'from-sky-500 to-cyan-500' },
  { key: 'card', label: 'Kartu / NFC', desc: 'Tap kartu RFID / NFC', icon: <CreditCard className="h-7 w-7" />, to: '/app/absent/card', color: 'from-violet-500 to-purple-500' },
  { key: 'manual', label: 'Manual', desc: 'Dilakukan petugas/guru', icon: <ListChecks className="h-7 w-7" />, to: '/app/absent', color: 'from-slate-500 to-slate-600' },
];

export default function Absent() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isStaff = user?.roleKey !== 'STUDENT' && user?.roleKey !== 'PARENT';
  const isStudent = user?.roles?.includes('STUDENT') || user?.roleKey === 'STUDENT';

  // Siswa: tanpa Kartu/NFC, dan QR hanya untuk ditunjukkan ke gerbang (bukan memindai)
  const methods = isStudent
    ? METHODS.filter((m) => m.key !== 'card').map((m) =>
        m.key === 'qr' ? { ...m, label: 'QR Saya', desc: 'QR pribadi untuk absen di gerbang' } : m,
      )
    : METHODS;

  // Status registrasi wajah (khusus siswa)
  const { data: faceStatus } = useQuery({
    queryKey: ['face-status', user?.id],
    queryFn: () => api<{ success: boolean; data: { registered: boolean; pending: boolean } }>(`/face/status/${user!.id}`).then((r) => r.data),
    enabled: isStudent,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">ABSEN</h1>
        <p className="text-sm text-muted">Pilih metode absensi yang tersedia.</p>
      </div>

      {isStudent && faceStatus && !faceStatus.registered && !faceStatus.pending && (
        <Card className="border-primary/30 bg-primary-soft/40">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-white">
              <ScanFace className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink">Wajah belum terdaftar</p>
              <p className="text-xs text-muted">Daftarkan wajahmu dulu agar bisa absen menggunakan Face Recognition.</p>
            </div>
            <Button onClick={() => navigate('/app/face-me')} className="shrink-0">Daftar</Button>
          </div>
        </Card>
      )}

      {isStudent && faceStatus?.registered && (
        <Card className="border-amber-200 bg-amber-50/60 dark:bg-amber-500/10">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
              <RefreshCw className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink">Wajah tidak dikenali?</p>
              <p className="text-xs text-muted">Perbarui data wajahmu agar absen wajah selalu berhasil. Perlu persetujuan admin lagi.</p>
            </div>
            <Button variant="outline" onClick={() => navigate('/app/face-me')} className="shrink-0">Perbarui</Button>
          </div>
        </Card>
      )}

      {isStudent && faceStatus?.pending && (
        <Card className="border-amber-200 bg-amber-50/60 dark:bg-amber-500/10">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink">Menunggu persetujuan admin</p>
              <p className="text-xs text-muted">Registrasi wajahmu sedang diproses oleh admin / TU.</p>
            </div>
            <Button variant="outline" onClick={() => navigate('/app/face-me')} className="shrink-0">Cek Status</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {methods.map((m) => (
          <button key={m.key} onClick={() => m.to !== '/app/absent' && navigate(m.to)} disabled={m.key === 'manual' && !isStaff}>
            <Card className={`h-full text-left transition-transform active:scale-[.98] ${m.key === 'manual' && !isStaff ? 'opacity-50' : ''}`}>
              <div className={`mb-3 inline-flex rounded-2xl bg-gradient-to-br ${m.color} p-3 text-white`}>{m.icon}</div>
              <p className="font-bold text-ink">{m.label}</p>
              <p className="mt-0.5 text-xs text-muted">{m.desc}</p>
            </Card>
          </button>
        ))}
      </div>

      {isStudent && (
        <Card className="border-amber-200 bg-amber-50/60 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          Absensi manual hanya dapat dilakukan oleh guru atau petugas sekolah. Gunakan Wajah atau tunjukkan QR Saya ke petugas gerbang.
        </Card>
      )}
    </div>
  );
}
