import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setTokens, clearTokens } from './api';

export interface MeData {
  id: string;
  username: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  roleKey: string;
  roleName: string;
  preferences?: Record<string, unknown> | null;
  student?: { id: string; nis: string; className?: string | null; grade?: string | null; major?: string | null } | null;
  teacher?: { id: string; nip?: string | null; position?: string | null; isPiket?: boolean } | null;
  staff?: { id: string; nip?: string | null; position?: string | null } | null;
  parent?: {
    id: string;
    name: string;
    phone: string;
    children: { studentId: string; name: string; nis: string; className?: string | null; relation?: string | null }[];
  } | null;
}

interface AuthCtx {
  user: MeData | null;
  loading: boolean;
  login: (username: string, password: string, deviceId?: string) => Promise<void>;
  loginStudent: (nis: string, password: string, deviceId?: string) => Promise<void>;
  loginParentOtp: (phone: string, code: string, deviceId?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as never);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = async () => {
    try {
      const res = await api<{ success: boolean; data: MeData }>('/auth/me');
      setUser(res.data);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    (async () => {
      if (localStorage.getItem('presensiku_access')) {
        await refreshMe();
      }
      setLoading(false);
    })();
  }, []);

  const storeLogin = (access: string, refresh: string, u: MeData) => {
    setTokens(access, refresh);
    setUser(u);
  };

  const login = async (username: string, password: string, deviceId?: string) => {
    const res = await api<{ success: boolean; data: { accessToken: string; refreshToken: string; user: MeData } }>(
      '/auth/login',
      { method: 'POST', body: { username, password, deviceId } },
    );
    storeLogin(res.data.accessToken, res.data.refreshToken, res.data.user);
    registerDevice(deviceId);
  };

  const loginStudent = async (nis: string, password: string, deviceId?: string) => {
    const res = await api<{ success: boolean; data: { accessToken: string; refreshToken: string; user: MeData } }>(
      '/auth/login-student',
      { method: 'POST', body: { nis, password, deviceId } },
    );
    storeLogin(res.data.accessToken, res.data.refreshToken, res.data.user);
    registerDevice(deviceId);
  };

  const loginParentOtp = async (phone: string, code: string, deviceId?: string) => {
    const res = await api<{ success: boolean; data: { accessToken: string; refreshToken: string; user: MeData } }>(
      '/auth/otp/verify',
      { method: 'POST', body: { phone, code, purpose: 'parent-login', deviceId } },
    );
    storeLogin(res.data.accessToken, res.data.refreshToken, res.data.user);
    registerDevice(deviceId);
  };

  const logout = async () => {
    try {
      const refresh = localStorage.getItem('presensiku_refresh');
      if (refresh) {
        await api('/auth/logout', { method: 'POST', body: { refreshToken: refresh } });
      }
    } catch {
      // abaikan
    }
    clearTokens();
    setUser(null);
    localStorage.removeItem('presensiku_device_id');
  };

  return <Ctx.Provider value={{ user, loading, login, loginStudent, loginParentOtp, logout, refreshMe }}>{children}</Ctx.Provider>;
}

export function deviceId(): string {
  let id = localStorage.getItem('presensiku_device_id');
  if (!id) {
    id = `web_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem('presensiku_device_id', id);
  }
  return id;
}

export async function registerDevice(deviceIdStr?: string): Promise<void> {
  try {
    const id = deviceIdStr || deviceId();
    const ua = navigator.userAgent;
    await api('/devices/register', {
      method: 'POST',
      body: {
        deviceId: id,
        name: `Perangkat ${(navigator.platform || '')}`,
        browser: ua.includes('Edg/') ? 'Edge' : ua.includes('Chrome/') ? 'Chrome' : ua.includes('Firefox/') ? 'Firefox' : ua.includes('Safari/') ? 'Safari' : 'Lainnya',
        os: ua.includes('Windows') ? 'Windows' : ua.includes('Android') ? 'Android' : ua.includes('iPhone') ? 'iOS' : ua.includes('Mac') ? 'macOS' : 'Lainnya',
      },
    });
  } catch {
    // perangkat diblokir akan ditangani endpoint lain
  }
}
