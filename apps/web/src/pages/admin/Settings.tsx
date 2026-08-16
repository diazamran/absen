import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Palette, Building2, Clock3, Bell, Save, Check } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useTheme } from '../../lib/theme';
import { useToast } from '../../lib/toast';
import { Card, Button, Input, Field } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';

const PRESETS = ['#0d9488', '#2563eb', '#16a34a', '#7c3aed', '#ea580c'];

export default function Settings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { primary, setPrimary } = useTheme();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ success: boolean; data: Record<string, unknown> }>('/settings').then((r) => r.data),
  });

  const [branding, setBranding] = useState<Record<string, unknown> | null>(null);
  const [rules, setRules] = useState<Record<string, unknown> | null>(null);
  const [school, setSchool] = useState<Record<string, unknown> | null>(null);

  const b = (branding as Record<string, unknown> | null) ?? ((settings?.branding as Record<string, unknown>) || {});
  const r = (rules as Record<string, unknown> | null) ?? ((settings?.attendanceRules as Record<string, unknown>) || {});
  const s = (school as Record<string, unknown> | null) ?? ((settings?.school as Record<string, unknown>) || {});
  const notif = (settings?.notifications as Record<string, unknown>) || {};

  const setB = (k: string, v: unknown) => setBranding({ ...b, [k]: v });
  const setR = (k: string, v: unknown) => setRules({ ...r, [k]: v });
  const setS = (k: string, v: unknown) => setSchool({ ...s, [k]: v });

  const mutation = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          branding: branding ? { ...b } : undefined,
          attendanceRules: rules ? { ...r } : undefined,
          school: school ? { latitude: Number(s.latitude), longitude: Number(s.longitude) } : undefined,
        },
      }),
    onSuccess: () => {
      toast('success', 'Pengaturan disimpan.');
      qc.invalidateQueries({ queryKey: ['settings'] });
      localStorage.removeItem('presensiku_branding');
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  return (
    <div>
      <PageHeader title="Pengaturan" subtitle="Sekolah, tampilan, dan aturan absensi" />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Branding */}
        <Card>
          <h3 className="mb-3 flex items-center gap-2 font-bold text-ink"><Building2 className="h-4 w-4" /> Identitas Aplikasi</h3>
          <div className="space-y-3">
            <Field label="Nama Aplikasi"><Input value={String(b.appName || '')} onChange={(e) => setB('appName', e.target.value)} /></Field>
            <Field label="Nama Sekolah"><Input value={String(b.schoolName || '')} onChange={(e) => setB('schoolName', e.target.value)} /></Field>
            <Field label="Tagline"><Input value={String(b.tagline || '')} onChange={(e) => setB('tagline', e.target.value)} /></Field>
          </div>
        </Card>

        {/* Tema */}
        <Card>
          <h3 className="mb-3 flex items-center gap-2 font-bold text-ink"><Palette className="h-4 w-4" /> Tampilan & Tema</h3>
          <p className="mb-3 text-sm text-muted">Warna utama berlaku untuk seluruh aplikasi (frontend & PWA).</p>
          <div className="flex flex-wrap items-center gap-3">
            {PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setPrimary(c);
                  setB('primaryColor', c);
                }}
                className="flex h-11 w-11 items-center justify-center rounded-2xl transition-transform active:scale-90"
                style={{ backgroundColor: c }}
              >
                {(primary === c || b.primaryColor === c) && <Check className="h-5 w-5 text-white" />}
              </button>
            ))}
            <input type="color" value={String(b.primaryColor || primary)} onChange={(e) => { setPrimary(e.target.value); setB('primaryColor', e.target.value); }} className="h-11 w-11 cursor-pointer rounded-2xl border border-line" />
          </div>
        </Card>

        {/* Aturan absensi + lokasi */}
        <Card>
          <h3 className="mb-3 flex items-center gap-2 font-bold text-ink"><Clock3 className="h-4 w-4" /> Aturan Absensi & Lokasi</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jam batas terlambat"><Input type="number" value={Number(r.lateAfterHour ?? 7)} onChange={(e) => setR('lateAfterHour', Number(e.target.value))} /></Field>
            <Field label="Menit"><Input type="number" value={Number(r.lateAfterMinute ?? 0)} onChange={(e) => setR('lateAfterMinute', Number(e.target.value))} /></Field>
            <Field label="Jam pulang sekolah"><Input type="number" value={Number(r.checkOutAfterHour ?? 15)} onChange={(e) => setR('checkOutAfterHour', Number(e.target.value))} /></Field>
            <Field label="Menit"><Input type="number" value={Number(r.checkOutAfterMinute ?? 30)} onChange={(e) => setR('checkOutAfterMinute', Number(e.target.value))} /></Field>
            <label className="flex items-center gap-2 pt-5 text-sm font-medium text-ink">
              <input type="checkbox" checked={r.duplicatePrevention !== false} onChange={(e) => setR('duplicatePrevention', e.target.checked)} className="h-4 w-4 accent-teal-600" />
              Cegah absen ganda
            </label>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Siswa yang absen pulang <b>sebelum jam pulang sekolah</b> otomatis ditandai <b>"Pulang Awal"</b> di riwayat absensi (mis. izin lebih awal).
          </p>
          <div className="mt-4 rounded-2xl border border-line/70 bg-slate-50/60 p-3 dark:bg-slate-900/40">
            <p className="mb-2 text-sm font-semibold text-ink">📍 Titik Absensi (GPS)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude"><Input type="number" step="any" value={Number(s.latitude) || ''} onChange={(e) => setS('latitude', e.target.value)} placeholder="-7.9659" /></Field>
              <Field label="Longitude"><Input type="number" step="any" value={Number(s.longitude) || ''} onChange={(e) => setS('longitude', e.target.value)} placeholder="111.9926" /></Field>
              <Field label="Radius (meter)"><Input type="number" value={Number(r.radiusMeters ?? 100)} onChange={(e) => setR('radiusMeters', Number(e.target.value))} /></Field>
              <label className="flex items-center gap-2 pt-5 text-sm font-medium text-ink">
                <input type="checkbox" checked={r.locationEnabled === true} onChange={(e) => setR('locationEnabled', e.target.checked)} className="h-4 w-4 accent-teal-600" />
                Wajib GPS di area sekolah
              </label>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Cara ambil koordinat: buka Google Maps → klik kanan lokasi sekolah → salin angka dari kotak pencarian (contoh: <code>-7.965900, 111.992600</code>).
              Jika diaktifkan, siswa hanya bisa absen dalam radius ini dari titik sekolah.
            </p>
          </div>
        </Card>

        {/* Notifikasi */}
        <Card>
          <h3 className="mb-3 flex items-center gap-2 font-bold text-ink"><Bell className="h-4 w-4" /> Notifikasi</h3>
          <div className="space-y-2">
            {([
              ['whatsappEnabled', 'WhatsApp (orang tua)', Boolean(notif.whatsappEnabled)],
              ['pushEnabled', 'Push Notification (browser)', Boolean(notif.pushEnabled)],
              ['emailEnabled', 'Email', Boolean(notif.emailEnabled)],
            ] as [string, string, boolean][]).map(([k, label, v]) => (
              <label key={String(k)} className="flex items-center justify-between rounded-xl border border-line px-3.5 py-3">
                <span className="text-sm font-medium text-ink">{label}</span>
                <input
                  type="checkbox"
                  defaultChecked={v as boolean}
                  onChange={async (e) => {
                    await api('/settings', {
                      method: 'PUT',
                      body: { notifications: { ...notif, [k]: e.target.checked } },
                    }).catch(() => toast('error', 'Gagal menyimpan.'));
                    qc.invalidateQueries({ queryKey: ['settings'] });
                    toast('success', 'Pengaturan notifikasi disimpan.');
                  }}
                  className="h-4 w-4 accent-teal-600"
                />
              </label>
            ))}
            <p className="text-xs text-muted">Provider WhatsApp/SMTP dikonfigurasi melalui environment variable (WHATSAPP_API_KEY, SMTP_*).</p>
          </div>
        </Card>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          <Save className="h-4 w-4" /> Simpan Perubahan
        </Button>
      </div>
    </div>
  );
}
