import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Home, ScanLine, Users, FileText, LayoutDashboard, GraduationCap, CalendarDays, BookOpen,
  ClipboardList, Smartphone, BarChart3, Bell, ScrollText, Settings, LogOut, Menu, X, ShieldCheck,
  ClipboardCheck, History, FilePlus2, UserRound, Baby, ScanFace, QrCode,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { api } from '../lib/api';
import { cn, greeting } from '../lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const ADMIN_MENU: NavItem[] = [
  { to: '/app/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { to: '/app/gate', label: 'Scan Gerbang', icon: <ScanLine className="h-5 w-5" /> },
  { to: '/app/attendance', label: 'Absensi', icon: <ScanLine className="h-5 w-5" /> },
  { to: '/app/history', label: 'Riwayat', icon: <History className="h-5 w-5" /> },
  { to: '/app/students', label: 'Siswa', icon: <GraduationCap className="h-5 w-5" /> },
  { to: '/app/face-register', label: 'Registrasi Wajah', icon: <ScanFace className="h-5 w-5" /> },
  { to: '/app/users', label: 'Guru & Staff', icon: <Users className="h-5 w-5" /> },
  { to: '/app/classes', label: 'Kelas', icon: <ClipboardList className="h-5 w-5" /> },
  { to: '/app/leave', label: 'Izin', icon: <FileText className="h-5 w-5" /> },
  { to: '/app/reports', label: 'Laporan', icon: <BarChart3 className="h-5 w-5" /> },
  { to: '/app/notifications', label: 'Notifikasi', icon: <Bell className="h-5 w-5" /> },
  { to: '/app/devices', label: 'Perangkat', icon: <Smartphone className="h-5 w-5" /> },
  { to: '/app/audit', label: 'Audit Log', icon: <ScrollText className="h-5 w-5" /> },
  { to: '/app/settings', label: 'Pengaturan', icon: <Settings className="h-5 w-5" /> },
];

/** Menu untuk role non-admin — sama untuk sidebar desktop & drawer mobile. */
function roleMenu(role?: string): NavItem[] {
  const items: NavItem[] = [{ to: '/app/home', label: 'Beranda', icon: <Home className="h-5 w-5" /> }];
  if (role === 'STUDENT') {
    items.push({ to: '/app/face-me', label: 'Registrasi Wajah', icon: <ScanFace className="h-5 w-5" /> });
  }
  items.push({ to: '/app/history', label: 'Riwayat', icon: <History className="h-5 w-5" /> });
  if (role === 'PIKET') {
    // Petugas Piket: menu izin hanya untuk persetujuan, bukan pengajuan
    items.push({ to: '/app/gate', label: 'Scan Gerbang', icon: <ScanLine className="h-5 w-5" /> });
    items.push({ to: '/app/attendance', label: 'Absensi Manual', icon: <ClipboardCheck className="h-5 w-5" /> });
    items.push({ to: '/app/qr-cards', label: 'Kartu QR', icon: <QrCode className="h-5 w-5" /> });
    items.push({ to: '/app/leave', label: 'Persetujuan Izin', icon: <FileText className="h-5 w-5" /> });
    items.push({ to: '/app/reports', label: 'Laporan & Cetak', icon: <BarChart3 className="h-5 w-5" /> });
  } else if (role === 'HOMEROOM_TEACHER') {
    // Wali kelas: persetujuan izin, laporan (kelasnya sendiri), tanpa Absen
    items.push({ to: '/app/qr-cards', label: 'Kartu QR', icon: <QrCode className="h-5 w-5" /> });
    items.push({ to: '/app/leave', label: 'Persetujuan Izin', icon: <FileText className="h-5 w-5" /> });
    items.push({ to: '/app/reports', label: 'Laporan', icon: <BarChart3 className="h-5 w-5" /> });
  } else {
    // Guru: tanpa menu Ajukan Izin & Absen
    if (role !== 'PARENT' && role !== 'TEACHER') {
      items.push({ to: '/app/leave/mine', label: 'Ajukan Izin', icon: <FilePlus2 className="h-5 w-5" /> });
    }
    if (role !== 'TEACHER') {
      items.push({ to: '/app/absent', label: 'Absen', icon: <ScanLine className="h-5 w-5" /> });
    }
  }
  items.push({ to: '/app/notifications', label: 'Notifikasi', icon: <Bell className="h-5 w-5" /> });
  items.push({ to: '/app/profile', label: 'Profil', icon: <UserRound className="h-5 w-5" /> });
  return items;
}

const BOTTOM_NAV: Record<string, NavItem[]> = {
  ADMIN: [
    { to: '/app/dashboard', label: 'Beranda', icon: <Home className="h-6 w-6" /> },
    { to: '/app/gate', label: 'Gerbang', icon: <ScanLine className="h-6 w-6" /> },
    { to: '/app/attendance', label: 'Absensi', icon: <ScanLine className="h-6 w-6" /> },
    { to: '/app/students', label: 'Data', icon: <Users className="h-6 w-6" /> },
    { to: '/app/history', label: 'Riwayat', icon: <History className="h-6 w-6" /> },
    { to: '/app/reports', label: 'Laporan', icon: <BarChart3 className="h-6 w-6" /> },
    { to: '/app/profile', label: 'Profil', icon: <UserRound className="h-6 w-6" /> },
  ],
  SUPER_ADMIN: [
    { to: '/app/dashboard', label: 'Beranda', icon: <Home className="h-6 w-6" /> },
    { to: '/app/gate', label: 'Gerbang', icon: <ScanLine className="h-6 w-6" /> },
    { to: '/app/attendance', label: 'Absensi', icon: <ScanLine className="h-6 w-6" /> },
    { to: '/app/students', label: 'Data', icon: <Users className="h-6 w-6" /> },
    { to: '/app/history', label: 'Riwayat', icon: <History className="h-6 w-6" /> },
    { to: '/app/reports', label: 'Laporan', icon: <BarChart3 className="h-6 w-6" /> },
    { to: '/app/profile', label: 'Profil', icon: <UserRound className="h-6 w-6" /> },
  ],
  TEACHER: [
    { to: '/app/home', label: 'Beranda', icon: <Home className="h-6 w-6" /> },
    { to: '/app/classes', label: 'Kelas', icon: <GraduationCap className="h-6 w-6" /> },
    { to: '/app/history', label: 'Riwayat', icon: <History className="h-6 w-6" /> },
    { to: '/app/profile', label: 'Profil', icon: <UserRound className="h-6 w-6" /> },
  ],
  HOMEROOM_TEACHER: [
    { to: '/app/home', label: 'Beranda', icon: <Home className="h-6 w-6" /> },
    { to: '/app/classes', label: 'Kelas', icon: <GraduationCap className="h-6 w-6" /> },
    { to: '/app/history', label: 'Riwayat', icon: <History className="h-6 w-6" /> },
    { to: '/app/reports', label: 'Laporan', icon: <BarChart3 className="h-6 w-6" /> },
    { to: '/app/profile', label: 'Profil', icon: <UserRound className="h-6 w-6" /> },
  ],
  STAFF: [
    { to: '/app/home', label: 'Beranda', icon: <Home className="h-6 w-6" /> },
    { to: '/app/absent', label: 'Absen', icon: <ScanLine className="h-6 w-6" /> },
    { to: '/app/history', label: 'Riwayat', icon: <History className="h-6 w-6" /> },
    { to: '/app/leave/mine', label: 'Izin', icon: <FilePlus2 className="h-6 w-6" /> },
    { to: '/app/profile', label: 'Profil', icon: <UserRound className="h-6 w-6" /> },
  ],
  PIKET: [
    { to: '/app/home', label: 'Beranda', icon: <Home className="h-6 w-6" /> },
    { to: '/app/gate', label: 'Absen', icon: <ScanLine className="h-6 w-6" /> },
    { to: '/app/history', label: 'Riwayat', icon: <History className="h-6 w-6" /> },
    { to: '/app/leave', label: 'Persetujuan', icon: <FilePlus2 className="h-6 w-6" /> },
    { to: '/app/profile', label: 'Profil', icon: <UserRound className="h-6 w-6" /> },
  ],
  STUDENT: [
    { to: '/app/home', label: 'Beranda', icon: <Home className="h-6 w-6" /> },
    { to: '/app/absent', label: 'Absen', icon: <ScanLine className="h-6 w-6" /> },
    { to: '/app/history', label: 'Riwayat', icon: <History className="h-6 w-6" /> },
    { to: '/app/leave/mine', label: 'Izin', icon: <FilePlus2 className="h-6 w-6" /> },
    { to: '/app/profile', label: 'Profil', icon: <UserRound className="h-6 w-6" /> },
  ],
  PARENT: [
    { to: '/app/home', label: 'Beranda', icon: <Home className="h-6 w-6" /> },
    { to: '/app/children', label: 'Anak', icon: <Baby className="h-6 w-6" /> },
    { to: '/app/history', label: 'Riwayat', icon: <History className="h-6 w-6" /> },
    { to: '/app/notifications', label: 'Notif', icon: <Bell className="h-6 w-6" /> },
    { to: '/app/profile', label: 'Profil', icon: <UserRound className="h-6 w-6" /> },
  ],
};

export function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Clock() {
  const now = useClock();
  return (
    <div className="text-right">
      <p className="font-mono text-lg font-bold leading-none text-ink tabular-nums">
        {now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta', hour12: false })} WIB
      </p>
      <p className="text-xs text-muted">
        {now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })}
      </p>
    </div>
  );
}

function LogoTile({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const { branding } = useTheme();
  const cls = size === 'lg' ? 'h-14 w-14 rounded-2xl' : size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl';
  return (
    <div className={cn(cls, 'flex items-center justify-center bg-primary text-white shadow-sm')}>
      <ShieldCheck className={size === 'sm' ? 'h-5 w-5' : 'h-7 w-7'} />
    </div>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const { user, logout } = useAuth();
  const { branding } = useTheme();
  const navigate = useNavigate();
  const isAdmin = user?.roleKey === 'ADMIN' || user?.roleKey === 'SUPER_ADMIN' || user?.roleKey === 'HEADMASTER';
  const menu = isAdmin ? ADMIN_MENU : roleMenu(user?.roleKey);

  const doLogout = async () => {
    onClose?.();
    await logout();
    navigate('/login');
  };

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex dark:bg-slate-800/50">
      <div className="flex items-center gap-3 px-5 py-5">
        <LogoTile />
        <div>
          <p className="font-bold leading-tight text-ink">{branding?.appName || 'PresensiKu'}</p>
          <p className="text-xs text-muted">{branding?.schoolName}</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {menu.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors',
                isActive ? 'bg-primary-soft text-primary-dark' : 'text-muted hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-ink',
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        )        )}
        {isAdmin && (
          <NavLink
            to="/app/profile"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors',
                isActive ? 'bg-primary-soft text-primary-dark' : 'text-muted hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-ink',
              )
            }
          >
            <UserRound className="h-5 w-5" />
            Profil
          </NavLink>
        )}
      </nav>
      <div className="border-t border-line p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
            {user?.fullName?.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{user?.fullName}</p>
            <p className="truncate text-xs text-muted">{user?.roleName}</p>
          </div>
          <button onClick={doLogout} className="text-muted hover:text-red-500" title="Keluar">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { branding } = useTheme();
  const navigate = useNavigate();
  const [mobileMenu, setMobileMenu] = useState(false);
  const isAdmin = user?.roleKey === 'ADMIN' || user?.roleKey === 'SUPER_ADMIN' || user?.roleKey === 'HEADMASTER';
  const bottomNav = BOTTOM_NAV[user?.roleKey || ''] || BOTTOM_NAV.STUDENT;

  // Badge notifikasi belum dibaca (sinkron dengan halaman Notifikasi via query key yang sama)
  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ success: boolean; data: { unread: number } }>('/notifications').then((r) => r.data),
    refetchInterval: 30_000,
  });
  const unreadCount = notifData?.unread ?? 0;

  const doLogout = async () => {
    setMobileMenu(false);
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-surface/80 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-xl p-2 text-ink hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800" onClick={() => setMobileMenu(true)}>
              <Menu className="h-6 w-6" />
            </button>
            <div>
              <p className="text-sm font-bold leading-tight text-ink lg:text-base">{branding?.schoolName}</p>
              <p className="text-xs text-muted">{greeting()}, {user?.fullName?.split(' ')[0]}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Clock />
            <button onClick={() => navigate('/app/notifications')} className="relative rounded-xl p-2 text-muted hover:bg-slate-100 dark:hover:bg-slate-800">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-4 pb-24 pt-5 lg:px-6 lg:pb-8">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>

        {/* Bottom nav (mobile) */}
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden dark:bg-slate-900/95" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="mx-auto flex max-w-md items-center justify-around py-1.5">
            {bottomNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn('flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px] font-medium', isActive ? 'text-primary' : 'text-muted')
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>

      {/* Mobile menu drawer */}
      {mobileMenu && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileMenu(false)} />
          <div className="absolute inset-y-0 left-0 w-72 animate-fade-in bg-surface p-4 dark:bg-slate-800">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <LogoTile size="sm" />
                <div>
                  <p className="font-bold text-ink">{user?.fullName}</p>
                  <p className="text-xs text-muted">{user?.roleName}</p>
                </div>
              </div>
              <button onClick={() => setMobileMenu(false)} className="rounded-full p-1.5 text-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="space-y-1">
              {isAdmin ? (
                ADMIN_MENU.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenu(false)}
                    className={({ isActive }) =>
                      cn('flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium', isActive ? 'bg-primary-soft text-primary-dark' : 'text-muted')
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))
              ) : (
                roleMenu(user?.roleKey).map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenu(false)}
                    className={({ isActive }) =>
                      cn('flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium', isActive ? 'bg-primary-soft text-primary-dark' : 'text-muted')
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))
              )}
              <button onClick={doLogout} className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-red-500">
                <LogOut className="h-5 w-5" />
                Keluar
              </button>
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-ink lg:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
