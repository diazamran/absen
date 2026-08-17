const API_BASE = '/api';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const TOKEN_KEY = 'presensiku_access';
const REFRESH_KEY = 'presensiku_refresh';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

let refreshPromise: Promise<string | null> | null = null;

/**
 * Pulihkan sesi saat aplikasi dibuka kembali:
 * - Tidak ada refresh token → tidak ada sesi (harus login)
 * - Refresh token ada → selalu berusaha pulih (refresh ulang akses token bila perlu)
 * sehingga pengguna tidak perlu login ulang setiap membuka aplikasi.
 */
export async function restoreSession(): Promise<boolean> {
  if (!getRefreshToken()) return false;
  if (!getToken()) {
    const newToken = await tryRefresh();
    if (!newToken) return false;
  }
  return true;
}

async function tryRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const json = await res.json().catch(() => null);
  if (json?.success && json.data?.accessToken) {
    setTokens(json.data.accessToken, json.data.refreshToken);
    return json.data.accessToken;
  }
  clearTokens();
  return null;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const doFetch = (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined && !options.formData) headers['Content-Type'] = 'application/json';
    return fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  };

  let res = await doFetch(getToken());
  if (res.status === 401 && getRefreshToken()) {
    if (!refreshPromise) {
      refreshPromise = tryRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    const newToken = await refreshPromise;
    if (newToken) {
      res = await doFetch(newToken);
    }
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      json?.message || 'Data belum dapat disimpan. Silakan coba lagi.',
      json?.code || 'UNKNOWN',
      res.status,
    );
  }
  return json as T;
}

/** Response envelope umum. */
export interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

/** Unduh CSV dari endpoint export (dengan token). */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new ApiError(json?.message || 'Gagal mengunduh.', json?.code || 'UNKNOWN', res.status);
  }
  const text = await res.text();
  const blob = new Blob(['\uFEFF' + text.replace(/^\uFEFF/, '')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
