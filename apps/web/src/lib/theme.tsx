import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface LoginTexts {
  headline: string;
  description: string;
  loginHeading: string;
  loginSubtitle: string;
  features: string[];
}

export interface Branding {
  appName: string;
  schoolName: string;
  tagline: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  loginBackground: string | null;
  loginTexts: LoginTexts;
}

const PALETTES: Record<string, { light: string; dark: string; soft: string }> = {
  '#0d9488': { light: '13 148 136', dark: '45 212 191', soft: '204 251 241' },
  '#2563eb': { light: '37 99 235', dark: '96 165 250', soft: '219 234 254' },
  '#16a34a': { light: '22 163 74', dark: '74 222 128', soft: '220 252 231' },
  '#7c3aed': { light: '124 58 237', dark: '167 139 250', soft: '237 233 254' },
  '#ea580c': { light: '234 88 12', dark: '251 146 60', soft: '255 237 213' },
};

interface ThemeCtx {
  branding: Branding | null;
  primary: string;
  setPrimary: (hex: string) => void;
  mode: 'light' | 'dark' | 'system';
  setMode: (m: 'light' | 'dark' | 'system') => void;
  resolvedDark: boolean;
}

const Ctx = createContext<ThemeCtx>(null as never);
export const useTheme = () => useContext(Ctx);

const BRANDING_KEY = 'presensiku_branding';
const PRIMARY_KEY = 'presensiku_primary';
const MODE_KEY = 'presensiku_mode';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(BRANDING_KEY) || 'null');
    } catch {
      return null;
    }
  });
  const [primary, setPrimaryState] = useState<string>(() => localStorage.getItem(PRIMARY_KEY) || '#0d9488');
  const [mode, setModeState] = useState<'light' | 'dark' | 'system'>(() => (localStorage.getItem(MODE_KEY) as 'light' | 'dark' | 'system') || 'system');
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api<{ success: boolean; data: { branding: Branding } }>('/settings/public');
        const b = res.data.branding;
        setBranding(b);
        localStorage.setItem(BRANDING_KEY, JSON.stringify(b));
        if (!localStorage.getItem(PRIMARY_KEY)) setPrimaryState(b.primaryColor || '#0d9488');
      } catch {
        // offline — pakai cache
      }
    };
    load();
  }, []);

  const setPrimary = (hex: string) => {
    setPrimaryState(hex);
    localStorage.setItem(PRIMARY_KEY, hex);
  };
  const setMode = (m: 'light' | 'dark' | 'system') => {
    setModeState(m);
    localStorage.setItem(MODE_KEY, m);
  };

  const resolvedDark = mode === 'dark' || (mode === 'system' && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedDark);
    const palette = PALETTES[primary] || PALETTES['#0d9488'];
    const root = document.documentElement.style;
    root.setProperty('--primary', palette.light);
    root.setProperty('--primary-dark', palette.dark);
    root.setProperty('--primary-soft', palette.soft);
    // Warna semantik
    root.setProperty('--surface', resolvedDark ? '15 23 42' : '255 255 255');
    root.setProperty('--ink', resolvedDark ? '241 245 249' : '15 23 42');
    root.setProperty('--muted', resolvedDark ? '148 163 184' : '100 116 139');
    root.setProperty('--line', resolvedDark ? '51 65 85' : '226 232 240');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', primary);
  }, [resolvedDark, primary]);

  return (
    <Ctx.Provider value={{ branding, primary, setPrimary, mode, setMode, resolvedDark }}>
      {children}
    </Ctx.Provider>
  );
}
