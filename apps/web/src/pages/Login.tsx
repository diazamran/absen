import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, Users, Baby, Lock, User as UserIcon, KeyRound, MessageCircle, ArrowLeft, Clock, Hash } from 'lucide-react';
import { useAuth, deviceId } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { useToast } from '../lib/toast';
import { api, ApiError } from '../lib/api';
import { Button, Input, Field, Segmented } from '../lib/ui';
import { cn } from '../lib/format';

type RoleTab = 'staff' | 'admin' | 'parent' | 'student';

export default function Login() {
  const { branding, primary } = useTheme();
  const { login, loginStudent, loginParentOtp, user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [role, setRole] = useState<RoleTab>('staff');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nis, setNis] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devHint, setDevHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname || '/';

  const doStudentLogin = async () => {
    if (!nis.trim() || !studentPassword) {
      toast('warning', 'NISN dan password wajib diisi.');
      return;
    }
    setLoading(true);
    try {
      await loginStudent(nis.trim(), studentPassword, deviceId());
      toast('success', 'Berhasil masuk.');
      navigate(from, { replace: true });
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gagal masuk. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  const doLogin = async () => {
    if (!username || !password) {
      toast('warning', 'Username dan password wajib diisi.');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password, deviceId());
      toast('success', 'Berhasil masuk.');
      navigate(from, { replace: true });
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gagal masuk. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  const requestOtp = async () => {
    if (phone.replace(/[^0-9]/g, '').length < 9) {
      toast('warning', 'Nomor WhatsApp tidak valid.');
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ success: boolean; data: { devCode?: string } }>('/auth/otp/request', {
        method: 'POST',
        body: { phone, purpose: forgot ? 'reset-password' : 'parent-login' },
      });
      setOtpSent(true);
      if (res.data.devCode) {
        setDevHint(`Kode uji (development): ${res.data.devCode}`);
      }
      toast('success', 'Kode WhatsApp telah dikirim.');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gagal mengirim kode.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (otpCode.length !== 6) {
      toast('warning', 'Masukkan kode 6 digit.');
      return;
    }
    setLoading(true);
    try {
      if (forgot) {
        // alur reset password sederhana: kode + password baru
        const newPass = prompt('Masukkan password baru (minimal 6 karakter):');
        if (!newPass || newPass.length < 6) {
          toast('warning', 'Password baru minimal 6 karakter.');
          return;
        }
        await api('/auth/otp/verify', {
          method: 'POST',
          body: { phone, code: otpCode, purpose: 'reset-password', newPassword: newPass },
        });
        toast('success', 'Password berhasil diubah. Silakan masuk.');
        setForgot(false);
        setOtpSent(false);
        setOtpCode('');
        setRole('staff');
        return;
      }
      await loginParentOtp(phone, otpCode, deviceId());
      toast('success', 'Berhasil masuk.');
      navigate(from, { replace: true });
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Kode salah atau kedaluwarsa.');
    } finally {
      setLoading(false);
    }
  };

  const appName = branding?.appName || 'PresensiKu';
  const schoolName = branding?.schoolName || 'SMA Negeri 1 Nusantara';

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-b from-primary-soft via-surface to-surface px-4 py-8 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
      <div className="w-full max-w-md animate-fade-in">
        {/* Header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary text-white shadow-float" style={{ backgroundColor: primary }}>
            <ShieldCheck className="h-9 w-9" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">{appName}</h1>
          <p className="mt-1 text-sm font-medium text-primary-dark">{schoolName}</p>
          <p className="text-xs text-muted">{branding?.tagline || 'Sistem Informasi Absensi Terintegrasi'}</p>
        </div>

        <div className="rounded-3xl border border-line/70 bg-surface p-6 shadow-card dark:bg-slate-800/80">
          {/* Pilihan role */}
          <Segmented
            value={role}
            onChange={(v) => {
              setRole(v);
              setForgot(false);
              setOtpSent(false);
              setDevHint('');
            }}
            options={[
              { value: 'staff', label: 'Guru & Staff' },
              { value: 'admin', label: 'Admin & TU' },
              { value: 'student', label: 'Siswa' },
              { value: 'parent', label: 'Orang Tua' },
            ]}
          />

          <div className="mt-6 space-y-4">
            {forgot ? (
              <>
                <p className="text-sm text-muted">
                  Masukkan nomor WhatsApp yang terdaftar untuk menerima kode reset password.
                </p>
                {!otpSent ? (
                  <>
                    <Field label="Nomor WhatsApp">
                      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="081234567890" inputMode="numeric" />
                    </Field>
                    <Button className="w-full" onClick={requestOtp} disabled={loading}>
                      <MessageCircle className="h-4 w-4" /> Kirim Kode WhatsApp
                    </Button>
                  </>
                ) : (
                  <>
                    <Field label="Kode OTP" hint={devHint}>
                      <Input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="6 digit" inputMode="numeric" maxLength={6} className="text-center text-lg font-bold tracking-[0.4em]" />
                    </Field>
                    <Button className="w-full" onClick={verifyOtp} disabled={loading}>
                      <KeyRound className="h-4 w-4" /> Verifikasi & Ganti Password
                    </Button>
                  </>
                )}
                <button className="flex w-full items-center justify-center gap-1 text-sm text-muted hover:text-ink" onClick={() => { setForgot(false); setOtpSent(false); }}>
                  <ArrowLeft className="h-4 w-4" /> Kembali ke login
                </button>
              </>
            ) : role === 'student' ? (
              <>
                <p className="text-sm text-muted">Login dengan NISN dan password.</p>
                <Field label="NISN">
                  <div className="relative">
                    <Hash className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <Input className="pl-10" value={nis} onChange={(e) => setNis(e.target.value)} placeholder="Nomor Induk Siswa Nasional" inputMode="numeric" autoCapitalize="none" />
                  </div>
                </Field>
                <Field label="Password" hint="Password awal: smkn1kras (bisa diubah oleh admin/TU).">
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <Input className="pl-10" type="password" value={studentPassword} onChange={(e) => setStudentPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doStudentLogin()} placeholder="••••••••" autoCapitalize="none" autoComplete="current-password" />
                  </div>
                </Field>
                <Button className="w-full py-3" onClick={doStudentLogin} disabled={loading}>
                  <UserIcon className="h-4 w-4" /> Masuk
                </Button>
              </>
            ) : role === 'parent' ? (
              <>
                <p className="text-sm text-muted">Login menggunakan nomor WhatsApp. Anda akan menerima kode OTP.</p>
                {!otpSent ? (
                  <>
                    <Field label="Nomor WhatsApp">
                      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="081234567890" inputMode="numeric" />
                    </Field>
                    <Button className="w-full" onClick={requestOtp} disabled={loading}>
                      <MessageCircle className="h-4 w-4" /> Kirim Kode WhatsApp
                    </Button>
                  </>
                ) : (
                  <>
                    <Field label="Kode OTP" hint={devHint}>
                      <Input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="6 digit" inputMode="numeric" maxLength={6} className="text-center text-lg font-bold tracking-[0.4em]" />
                    </Field>
                    <Button className="w-full" onClick={verifyOtp} disabled={loading}>
                      <KeyRound className="h-4 w-4" /> Masuk
                    </Button>
                    <button className="text-sm text-muted hover:text-ink" onClick={() => setOtpSent(false)}>
                      Kirim ulang kode
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <Field label="Username / NIP">
                  <div className="relative">
                    <UserIcon className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <Input className="pl-10" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={role === 'admin' ? 'admin' : 'guru / nip'} autoCapitalize="none" />
                  </div>
                </Field>
                <Field label="Password">
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <Input className="pl-10" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === 'Enter' && doLogin()} />
                  </div>
                </Field>
                <Button className="w-full py-3" onClick={doLogin} disabled={loading}>
                  <Lock className="h-4 w-4" /> Masuk
                </Button>
                <button className="w-full text-center text-sm text-muted hover:text-ink" onClick={() => { setForgot(true); setRole('parent'); }}>
                  Lupa password?
                </button>
              </>
            )}
          </div>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
          <Clock className="h-3.5 w-3.5" /> Zona waktu: WIB (Asia/Jakarta) · {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })}
        </p>
      </div>
    </div>
  );
}
