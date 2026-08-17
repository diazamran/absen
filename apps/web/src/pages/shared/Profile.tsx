import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRound, Palette, Lock, LogOut, Sun, Moon, MonitorSmartphone } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useToast } from '../../lib/toast';
import { Card, Button, Input, Field, Modal } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';
import { cn } from '../../lib/format';

export default function Profile() {
  const { user, logout } = useAuth();
  const { branding, primary, setPrimary, mode, setMode } = useTheme();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [pwd, setPwd] = useState({ current: '', next: '' });

  const changePassword = async () => {
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: pwd.current, newPassword: pwd.next } });
      toast('success', 'Password berhasil diganti.');
      setShowPassword(false);
      setPwd({ current: '', next: '' });
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gagal mengganti password.');
    }
  };

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Profil" />

      {/* Info user */}
      <Card className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary text-2xl font-extrabold text-white">
          {user?.fullName?.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-extrabold text-ink">{user?.fullName}</p>
          <p className="text-sm text-muted">{user?.roleName}</p>
          {(user?.teacher?.nip || user?.staff?.nip) && (
            <p className="text-xs text-muted">@{user?.username} · NIP {user?.teacher?.nip ?? user?.staff?.nip}</p>
          )}
          {user?.student?.className && <p className="text-xs text-muted">Kelas {user.student.className}</p>}
        </div>
      </Card>

      {/* Tema */}
      <Card>
        <h3 className="mb-3 flex items-center gap-2 font-bold text-ink"><Palette className="h-4 w-4" /> Tampilan</h3>
        <div className="mb-3 grid grid-cols-3 gap-2">
          {[
            { key: 'light' as const, label: 'Terang', icon: <Sun className="h-4 w-4" /> },
            { key: 'dark' as const, label: 'Gelap', icon: <Moon className="h-4 w-4" /> },
            { key: 'system' as const, label: 'Sistem', icon: <MonitorSmartphone className="h-4 w-4" /> },
          ].map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={cn('flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold', mode === m.key ? 'border-primary bg-primary-soft text-primary-dark' : 'border-line text-muted')}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
        <p className="mb-2 text-sm font-medium text-ink">Warna utama</p>
        <div className="flex flex-wrap gap-2">
          {['#0d9488', '#2563eb', '#16a34a', '#7c3aed', '#ea580c'].map((c) => (
            <button key={c} onClick={() => setPrimary(c)} className={cn('h-9 w-9 rounded-xl transition-transform active:scale-90', primary === c && 'ring-2 ring-offset-2 ring-primary')} style={{ backgroundColor: c }} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Aplikasi: {branding?.appName} · {branding?.schoolName}</p>
      </Card>

      {/* Keamanan */}
      <Card>
        <h3 className="mb-3 flex items-center gap-2 font-bold text-ink"><Lock className="h-4 w-4" /> Keamanan</h3>
        <Button variant="outline" onClick={() => setShowPassword(true)}>Ganti Password</Button>
      </Card>

      {/* Keluar */}
      <Button variant="danger" className="w-full" onClick={doLogout}>
        <LogOut className="h-4 w-4" /> Keluar
      </Button>

      {showPassword && (
        <Modal open onClose={() => setShowPassword(false)} title="Ganti Password">
          <div className="space-y-3">
            <Field label="Password saat ini"><Input type="password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} /></Field>
            <Field label="Password baru" hint="Minimal 6 karakter"><Input type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowPassword(false)}>Batal</Button>
            <Button onClick={changePassword} disabled={!pwd.current || pwd.next.length < 6}>Simpan</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
