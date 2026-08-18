import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Palette, Building2, Clock3, Bell, Save, Check, Upload, Loader2, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { prepareLogoFile } from '../../lib/image';
import { useTheme } from '../../lib/theme';
import { useToast } from '../../lib/toast';
import { Card, Button, Input, Field } from '../../lib/ui';
import { PageHeader } from '../../components/AppShell';

const PRESETS = ['#0d9488', '#2563eb', '#16a34a', '#7c3aed', '#ea580c'];

/** Tampilkan jam/menit sebagai HH:MM (nilai tak valid seperti 7.1 → 07:00). */
function pad2(v: unknown): string {
  const n = Number(v);
  const t = Number.isFinite(n) ? Math.trunc(n) : 0;
  return String(Math.max(0, Math.min(59, t))).padStart(2, '0');
}

/** Parse "HH:MM" dari input type=time → [jam, menit] yang valid. */
function splitTime(v: string): [number, number] {
  const [h, m] = v.split(':').map(Number);
  const hh = Number.isFinite(h) ? Math.min(23, Math.max(0, Math.trunc(h))) : 0;
  const mm = Number.isFinite(m) ? Math.min(59, Math.max(0, Math.trunc(m))) : 0;
  return [hh, mm];
}

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
  const logoRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const b = (branding as Record<string, unknown> | null) ?? ((settings?.branding as Record<string, unknown>) || {});
  const r = (rules as Record<string, unknown> | null) ?? ((settings?.attendanceRules as Record<string, unknown>) || {});
  const s = (school as Record<string, unknown> | null) ?? ((settings?.school as Record<string, unknown>) || {});
  const notif = (settings?.notifications as Record<string, unknown>) || {};

  const setB = (k: string, v: unknown) => setBranding({ ...b, [k]: v });
  const setR = (k: string, v: unknown) => setRules({ ...r, [k]: v });
  const setS = (k: string, v: unknown) => setSchool({ ...s, [k]: v });

  const uploadLogo = async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('error', 'Format logo harus JPG, PNG, atau WEBP.');
      return;
    }
    setUploadingLogo(true);
    try {
      // Deteksi transparansi otomatis: logo transparan tetap PNG, tanpa transparansi → JPEG
      const { file: uploadFile, transparent } = await prepareLogoFile(file, 512, 0.88);
      const formData = new FormData();
      formData.append('file', uploadFile);
      const res = await api<{ success: boolean; data: { url: string } }>('/settings/logo', { method: 'POST', formData });
      setB('logoUrl', res.data.url);
      toast(transparent ? 'info' : 'success', transparent ? 'Logo transparan terdeteksi — disimpan sebagai PNG agar tetap bening di kartu QR.' : 'Logo sekolah berhasil diunggah.');
      qc.invalidateQueries({ queryKey: ['settings'] });
      localStorage.removeItem('presensiku_branding');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gagal mengunggah logo.');
    } finally {
      setUploadingLogo(false);
    }
  };

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
            <Field
              label="Logo Sekolah"
              hint="JPG/PNG/WEBP, maks 5 MB. Logo transparan otomatis dipertahankan (PNG) agar bening di kop kartu QR."
            >
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-slate-50 p-1 dark:bg-slate-900">
                  {b.logoUrl ? (
                    <img src={String(b.logoUrl)} alt="Logo sekolah" className="h-full w-full object-contain" />
                  ) : (
                    <Building2 className="h-8 w-8 text-muted" />
                  )}
                </div>
                <div className="flex flex-col items-start gap-2">
                  <input
                    ref={logoRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
                  />
                  <Button type="button" variant="outline" onClick={() => logoRef.current?.click()} disabled={uploadingLogo} className="px-3 py-2">
                    {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploadingLogo ? 'Mengunggah…' : 'Ubah Logo'}
                  </Button>
                  {b.logoUrl ? (
                    <button
                      type="button"
                      onClick={() => setB('logoUrl', null)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-red-500"
                    >
                      <X className="h-3.5 w-3.5" /> Hapus logo
                    </button>
                  ) : null}
                </div>
              </div>
            </Field>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Jam batas terlambat" hint="Setelah jam ini, absen datang dihitung Terlambat.">
              <Input type="time" value={`${pad2(r.lateAfterHour ?? 7)}:${pad2(r.lateAfterMinute ?? 0)}`} onChange={(e) => { const [h, m] = splitTime(e.target.value); setR('lateAfterHour', h); setR('lateAfterMinute', m); }} />
            </Field>
            <Field label="Batas akhir absen datang" hint="Setelah jam ini, siswa TIDAK BISA absen datang sendiri (dianggap tidak hadir — koreksi manual oleh petugas). 23:59 = tidak dibatasi.">
              <Input type="time" value={`${pad2(r.checkInDeadlineHour ?? 23)}:${pad2(r.checkInDeadlineMinute ?? 59)}`} onChange={(e) => { const [h, m] = splitTime(e.target.value); setR('checkInDeadlineHour', h); setR('checkInDeadlineMinute', m); }} />
            </Field>
            <Field label="Jam pulang sekolah" hint="Jam selesai kegiatan sekolah (dipakai di laporan).">
              <Input type="time" value={`${pad2(r.checkOutAfterHour ?? 15)}:${pad2(r.checkOutAfterMinute ?? 30)}`} onChange={(e) => { const [h, m] = splitTime(e.target.value); setR('checkOutAfterHour', h); setR('checkOutAfterMinute', m); }} />
            </Field>
            <Field label="Mulai dihitung Pulang Awal" hint={'Siswa yang absen pulang SEBELUM jam ini ditandai "Pulang Awal". Kosongkan = ikut jam pulang sekolah.'}>
              <Input type="time" value={`${pad2(r.earlyLeaveBeforeHour ?? r.checkOutAfterHour ?? 15)}:${pad2(r.earlyLeaveBeforeMinute ?? r.checkOutAfterMinute ?? 30)}`} onChange={(e) => { const [h, m] = splitTime(e.target.value); setR('earlyLeaveBeforeHour', h); setR('earlyLeaveBeforeMinute', m); }} />
            </Field>
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" checked={r.duplicatePrevention !== false} onChange={(e) => setR('duplicatePrevention', e.target.checked)} className="h-4 w-4 accent-teal-600" />
              Cegah absen ganda
            </label>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Contoh: batas terlambat <b>07:00</b>, batas akhir absen datang <b>12:00</b> → siswa yang datang 07:30 ditandai <b>Terlambat</b>, siswa yang mencoba absen datang setelah 12:00 ditolak (perlu koreksi manual petugas).
            Siswa yang absen pulang <b>sebelum jam "Mulai dihitung Pulang Awal"</b> otomatis ditandai <b>"Pulang Awal"</b> di riwayat absensi.
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
