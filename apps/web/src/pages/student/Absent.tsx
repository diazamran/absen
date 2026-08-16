import { useNavigate } from 'react-router-dom';
import { Camera, QrCode, CreditCard, ListChecks } from 'lucide-react';
import { Card } from '../../lib/ui';
import { useAuth } from '../../lib/auth';

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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">ABSEN</h1>
        <p className="text-sm text-muted">Pilih metode absensi yang tersedia.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {METHODS.map((m) => (
          <button key={m.key} onClick={() => m.to !== '/app/absent' && navigate(m.to)} disabled={m.key === 'manual' && !isStaff}>
            <Card className={`h-full text-left transition-transform active:scale-[.98] ${m.key === 'manual' && !isStaff ? 'opacity-50' : ''}`}>
              <div className={`mb-3 inline-flex rounded-2xl bg-gradient-to-br ${m.color} p-3 text-white`}>{m.icon}</div>
              <p className="font-bold text-ink">{m.label}</p>
              <p className="mt-0.5 text-xs text-muted">{m.desc}</p>
            </Card>
          </button>
        ))}
      </div>

      {user?.roleKey === 'STUDENT' && (
        <Card className="border-amber-200 bg-amber-50/60 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          Absensi manual hanya dapat dilakukan oleh guru atau petugas sekolah. Gunakan Wajah, QR, atau Kartu.
        </Card>
      )}
    </div>
  );
}
