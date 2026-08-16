import { useEffect, useState } from 'react';
import { Smartphone, X, Download } from 'lucide-react';

const APK_URL = '/apk/PresensiKu.apk';
const STORAGE_KEY = 'presensiku_apk_dismissed_at';
const RE_SHOW_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // muncul lagi setelah 7 hari bila ditutup

function shouldOfferApk(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Hanya untuk HP Android
  if (!/Android/i.test(ua)) return false;
  // Sudah di dalam aplikasi APK WebView — ciri khas UA WebView adalah "Version/x.y"
  if (/Version\/[\d.]+/i.test(ua)) return false;
  // Sudah terpasang sebagai PWA / TWA (standalone)
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return false;
  } catch {
    /* abaikan */
  }
  return true;
}

export default function ApkDownloadBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!shouldOfferApk()) return;
    try {
      const last = localStorage.getItem(STORAGE_KEY);
      if (last && Date.now() - Number(last) < RE_SHOW_AFTER_MS) return;
    } catch {
      /* abaikan */
    }
    // Hanya tampil jika file APK benar-benar ada di server (hindari link rusak).
    // Catatan: nginx SPA fallback mengembalikan index.html (HTTP 200) untuk path
    // yang tidak ada — jadi cek tipe & ukuran, bukan hanya status 200.
    fetch(APK_URL, { method: 'HEAD' })
      .then((r) => {
        if (!r.ok) return;
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const len = Number(r.headers.get('content-length') || 0);
        const looksLikeApk = len > 500_000 || /vnd\.android|application\/octet-stream/.test(ct);
        if (looksLikeApk) setVisible(true);
      })
      .catch(() => {});
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* abaikan */
    }
  };

  return (
    <div className="fixed inset-x-0 top-0 z-[90] flex items-center justify-between gap-2 bg-primary px-3 py-2 text-white shadow-lg">
      <div className="flex min-w-0 items-center gap-2">
        <Smartphone className="h-4 w-4 shrink-0" />
        <p className="truncate text-xs font-medium sm:text-sm">
          Unduh aplikasi PresensiKu untuk Android — lebih cepat & fullscreen.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <a
          href={APK_URL}
          download
          className="flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-bold hover:bg-white/30"
        >
          <Download className="h-3.5 w-3.5" /> APK
        </a>
        <button onClick={dismiss} className="rounded-lg p-1 hover:bg-white/25" title="Tutup" aria-label="Tutup">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
