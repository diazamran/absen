/**
 * SsoCallback — halaman perantara SSO dari SDMS
 * URL: /sso#access=<token>&role=<role>
 * Simpan token ke localStorage lalu redirect ke /app sesuai role.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setTokens } from '../lib/api';

export default function SsoCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Ambil token dari URL fragment (#access=xxx&role=yyy)
    const hash   = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const access = params.get('access');
    const role   = params.get('role');

    // Cek error dari query string (redirect dari backend saat gagal)
    const qError = new URLSearchParams(window.location.search).get('error');
    if (qError) {
      const messages: Record<string, string> = {
        sso_no_token: 'Token SSO tidak ditemukan.',
        sso_expired:  'Token SSO sudah kadaluarsa. Buka ulang dari SDMS.',
        sso_invalid:  'Token SSO tidak valid.',
        sso_inactive: 'Akun tidak aktif. Hubungi administrator.',
        sso_error:    'Terjadi kesalahan SSO.',
      };
      setError(messages[qError] || 'Terjadi kesalahan tidak diketahui.');
      return;
    }

    if (!access) {
      setError('Token tidak ditemukan. Silakan buka kembali dari SDMS.');
      return;
    }

    // Simpan access token (refresh token tidak ada untuk SSO — session pendek)
    setTokens(access, '');

    // Bersihkan hash dari URL
    history.replaceState(null, '', '/sso');

    // Redirect ke halaman sesuai role
    const dest = role === 'STUDENT' ? '/app/absent'
               : role === 'PARENT'  ? '/app/parent'
               : '/app';
    navigate(dest, { replace: true });
  }, [navigate]);

  if (error) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)',
        fontFamily: 'system-ui,sans-serif',
      }}>
        <div style={{
          background: 'white', borderRadius: 20, padding: '48px 40px',
          textAlign: 'center', maxWidth: 360, width: '90%',
          boxShadow: '0 25px 60px rgba(0,0,0,0.15)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ margin: '0 0 12px', color: '#1e293b' }}>Login SSO Gagal</h2>
          <p style={{ color: '#64748b', marginBottom: 24, fontSize: 14 }}>{error}</p>
          <a href="/login" style={{
            display: 'inline-block', padding: '12px 28px',
            background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)',
            color: 'white', borderRadius: 12, textDecoration: 'none',
            fontWeight: 600, fontSize: 14,
          }}>Login Manual</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)',
      fontFamily: 'system-ui,sans-serif',
    }}>
      <div style={{
        background: 'white', borderRadius: 20, padding: '48px 40px',
        textAlign: 'center', maxWidth: 360, width: '90%',
        boxShadow: '0 25px 60px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔑</div>
        <h2 style={{ margin: '0 0 8px', color: '#1e293b' }}>Masuk via SDMS</h2>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>
          Memverifikasi sesi…
        </p>
        <div style={{
          width: 36, height: 36, border: '4px solid #e2e8f0',
          borderTopColor: '#3b82f6', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite', margin: '0 auto',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
