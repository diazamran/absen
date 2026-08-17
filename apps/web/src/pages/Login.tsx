import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, Lock, User as UserIcon, KeyRound, MessageCircle, ArrowLeft, Clock, Hash, Check, Eye, EyeOff } from 'lucide-react';
import { useAuth, deviceId } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { useToast } from '../lib/toast';
import { api, ApiError } from '../lib/api';
import { Button, Input, Field } from '../lib/ui';
import { cn } from '../lib/format';

type RoleTab = 'staff' | 'admin' | 'student' | 'parent';

const ROLE_TABS: { value: RoleTab; label: string }[] = [
  { value: 'staff', label: 'Guru & Staff' },
  { value: 'admin', label: 'Admin & TU' },
  { value: 'student', label: 'Siswa' },
  { value: 'parent', label: 'Orang Tua' },
];

/** Gelapkan warna hex (mis. untuk panel branding). */
function darken(hex: string, amt: number): string {
  const h = (hex || '#0d9488').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const num = parseInt(full.slice(0, 6), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const f = (c: number) => Math.max(0, Math.round(c * (1 - amt)));
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

const FEATURES = [
  'Akses berbasis peran (RBAC) untuk setiap akun',
  'Absensi QR, wajah, kartu & gerbang secara realtime',
  'Laporan per kelas & rekap otomatis (PDF / Excel)',
  'Sesi terenkripsi & audit log setiap aktivitas',
];

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
  const [showPass, setShowPass] = useState(false);
  const [showStudentPass, setShowStudentPass] = useState(false);

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
  const logoUrl = branding?.logoUrl || null;
  const loginBackground = branding?.loginBackground || null;

  return (
    <div className="flex min-h-full flex-col bg-gradient-to-b from-primary-soft via-surface to-surface dark:from-slate-900 dark:via-slate-950 dark:to-slate-950 lg:flex-row lg:bg-none lg:bg-surface dark:lg:bg-slate-950">
      {/* ===== Panel branding (desktop) ===== */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex lg:w-[45%] xl:w-[42%] xl:p-14"
        style={{
          background: loginBackground
            ? `linear-gradient(rgba(3, 45, 43, 0.86), rgba(3, 45, 43, 0.86)), url(${loginBackground}) center/cover`
            : `linear-gradient(155deg, ${darken(primary, 0.4)} 0%, ${darken(primary, 0.18)} 55%, ${primary} 100%)`,
        }}
      >
        {/* ornamen dekoratif */}
        <div className="pointer-events-none absolute -right-28 -top-28 h-96 w-96 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-36 -left-20 h-96 w-96 rounded-full bg-white/[0.06]" />
        <div className="pointer-events-none absolute bottom-44 right-28 h-44 w-44 rounded-full border border-white/15" />

        {/* logo + nama aplikasi */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-white/15 backdrop-blur-sm">
            {logoUrl ? <img src={logoUrl} alt="Logo" className="h-9 w-9 rounded object-contain" /> : <ShieldCheck className="h-7 w-7" />}
          </div>
          <div>
            <p className="text-xl font-extrabold tracking-tight">{appName}</p>
            <p className="text-xs text-white/70">{branding?.tagline || 'Sistem Informasi Absensi Terintegrasi'}</p>
          </div>
        </div>

        {/* headline + fitur */}
        <div className="relative max-w-md">
          <h2 className="text-3xl font-extrabold leading-tight">Satu aplikasi untuk semua peran.</h2>
          <p className="mt-3 text-sm leading-relaxed text-white/75">
            Setiap pengguna hanya melihat data dan menu sesuai wewenangnya — dari kepala sekolah, admin, guru, wali kelas,
            petugas piket, hingga siswa dan orang tua.
          </p>
          <ul className="mt-7 space-y-3.5">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm text-white/90">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Check className="h-3 w-3" />
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* footer */}
        <p className="relative text-xs text-white/60">
          {appName} · {schoolName} — {new Date().getFullYear()}
        </p>
      </aside>

      {/* ===== Panel form ===== */}
      <main className="flex w-full flex-1 items-center justify-center px-4 py-8 lg:py-10">
        <div className="w-full max-w-md animate-fade-in">
          {/* Header versi mobile */}
          <div className="mb-6 flex flex-col items-center text-center lg:hidden">
            <div
              className="mb-3 flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl bg-primary text-white shadow-float"
              style={{ backgroundColor: primary }}
            >
              {logoUrl ? <img src={logoUrl} alt="Logo" className="h-11 w-11 rounded object-contain" /> : <ShieldCheck className="h-9 w-9" />}
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">{appName}</h1>
            <p className="mt-1 text-sm font-medium text-primary-dark">{schoolName}</p>
            <p className="text-xs text-muted">{branding?.tagline || 'Sistem Informasi Absensi Terintegrasi'}</p>
          </div>

          <div className="rounded-3xl border border-line/70 bg-surface p-6 shadow-card dark:bg-slate-800/80">
            {/* Heading versi desktop */}
            <div className="mb-5 hidden lg:block">
              <h2 className="text-2xl font-extrabold tracking-tight text-ink">Masuk ke Panel</h2>
              <p className="mt-1 text-sm text-muted">Masuk dengan akun Anda — hak akses menyesuaikan peran secara otomatis.</p>
            </div>

            {/* Pilihan role */}
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800 sm:grid-cols-4">
              {ROLE_TABS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => {
                    setRole(t.value);
                    setForgot(false);
                    setOtpSent(false);
                    setDevHint('');
                  }}
                  className={cn(
                    'rounded-xl px-2 py-2 text-xs font-semibold transition-all sm:text-sm',
                    role === t.value ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-ink',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

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
                      <Input
                        className="pl-10 pr-10"
                        type={showStudentPass ? 'text' : 'password'}
                        value={studentPassword}
                        onChange={(e) => setStudentPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && doStudentLogin()}
                        placeholder="••••••••"
                        autoCapitalize="none"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowStudentPass(!showStudentPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                        aria-label={showStudentPass ? 'Sembunyikan password' : 'Tampilkan password'}
                      >
                        {showStudentPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
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
                      <Input
                        className="pl-10 pr-10"
                        type={showPass ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        onKeyDown={(e) => e.key === 'Enter' && doLogin()}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                        aria-label={showPass ? 'Sembunyikan password' : 'Tampilkan password'}
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
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

            {/* catatan keamanan */}
            <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Sesi aman terenkripsi · audit log aktif
            </p>
          </div>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <Clock className="h-3.5 w-3.5" /> Zona waktu: WIB (Asia/Jakarta) · {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })}
          </p>
        </div>
      </main>
    </div>
  );
}
