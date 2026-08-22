import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, Save, RefreshCw, Check, AlertCircle, Loader2, Database, Server } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Card, Button, Input, Field } from '../../lib/ui';

export default function SDMSIntegration() {
  const { toast } = useToast();
  const qc = useQueryClient();
  
  const { data: settings, isLoading } = useQuery({
    queryKey: ['sdms-settings'],
    queryFn: () => api<{ success: boolean; data: {
      apiKey: string;
      apiSecret: string;
      webhookUrl: string;
      syncEnabled: boolean;
      lastSync: Record<string, unknown> | null;
    }}>('/sdms/settings').then((r) => r.data),
  });

  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // Initialize form when data loads
  if (settings && !initialized) {
    setApiKey(settings.apiKey || '');
    setApiSecret(settings.apiSecret || '');
    setWebhookUrl(settings.webhookUrl || `https://absen.smkn1kras.sch.id/`);
    setSyncEnabled(settings.syncEnabled ?? true);
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => api('/sdms/settings', {
      method: 'PUT',
      body: { apiKey, apiSecret, webhookUrl, syncEnabled },
    }),
    onSuccess: () => {
      toast('success', 'Pengaturan SDMS disimpan.');
      qc.invalidateQueries({ queryKey: ['sdms-settings'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  const syncMutation = useMutation({
    mutationFn: () => api<{ success: boolean; message: string; data: Record<string, unknown> }>('/sdms/sync', { method: 'POST' }),
    onSuccess: (res) => {
      toast('success', `Sinkronisasi berhasil! ${res.message}`);
      qc.invalidateQueries({ queryKey: ['sdms-settings'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal sinkronisasi.'),
  });

  const testMutation = useMutation({
    mutationFn: () => api<{ success: boolean; message: string }>('/sdms/test', { method: 'POST' }),
    onSuccess: (res) => toast('success', res.message),
    onError: (e) => toast('error', e instanceof ApiError ? e.message : 'Gagal koneksi.'),
  });

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat pengaturan SDMS...
        </div>
      </Card>
    );
  }

  const lastSyncData = settings?.lastSync as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
            <Link2 className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-ink">Integrasi SDMS</h3>
            <p className="text-sm text-muted mt-1">
              Sambungkan dengan Sistem Data Manajemen Sekolah (SDMS) untuk sinkronisasi otomatis data siswa, guru, dan kelas.
            </p>
            
            <div className="mt-4 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded-full ${syncEnabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="text-sm font-medium">{syncEnabled ? 'Sinkronisasi Aktif' : 'Sinkronisasi Nonaktif'}</span>
              </div>
              {lastSyncData?.lastPull && (
                <span className="text-xs text-muted">
                  Terakhir sync: {new Date(lastSyncData.lastPull as string).toLocaleString('id-ID')}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Configuration Form */}
      <Card className="p-6">
        <h4 className="text-sm font-bold text-ink mb-4">Konfigurasi Koneksi</h4>
        
        <div className="space-y-4">
          <Field label="API Key SDMS">
            <Input
              id="apiKey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sdms_xxxxxxxxxxxx"
            />
          </Field>

          <Field label="API Secret SDMS">
            <Input
              id="apiSecret"
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Masukkan API Secret"
            />
          </Field>

          <Field label="Webhook URL (untuk diberikan ke SDMS)">
            <Input
              id="webhookUrl"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://absen.smkn1kras.sch.id/api/webhooks/sdms"
            />
          </Field>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="syncEnabled"
              checked={syncEnabled}
              onChange={(e) => setSyncEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="syncEnabled" className="text-sm text-ink">
              Aktifkan sinkronisasi otomatis via Webhook
            </label>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Simpan Pengaturan
          </Button>
          
          <Button
            variant="secondary"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || !apiKey || !apiSecret}
          >
            {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
            Test Koneksi
          </Button>
          
          <Button
            variant="secondary"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !apiKey || !apiSecret}
          >
            {syncMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Sinkronisasi Sekarang
          </Button>
        </div>
      </Card>

      {/* Sync Results */}
      {lastSyncData?.results && (() => {
        const res = lastSyncData.results as { students?: number; teachers?: number; classes?: number; errors?: string[] };
        return (
          <Card className="p-6">
            <h4 className="text-sm font-bold text-ink mb-4">Hasil Sinkronisasi Terakhir</h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{res.students || 0}</div>
                <div className="text-xs text-green-700">Siswa</div>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{res.teachers || 0}</div>
                <div className="text-xs text-blue-700">Guru</div>
              </div>
              <div className="text-center p-3 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">{res.classes || 0}</div>
                <div className="text-xs text-purple-700">Kelas</div>
              </div>
            </div>
            
            {res.errors && res.errors.length > 0 && (
              <div className="mt-4 p-3 bg-red-50 rounded-lg">
                <div className="flex items-center gap-2 text-red-700 text-sm font-medium mb-2">
                  <AlertCircle className="h-4 w-4" />
                  Error ({res.errors.length})
                </div>
                <ul className="text-xs text-red-600 space-y-1">
                  {res.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>• {err}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        );
      })()}

      {/* Help */}
      <Card className="p-6 bg-amber-50 border-amber-200">
        <h4 className="text-sm font-bold text-amber-800 mb-2">📖 Cara Menghubungkan ke SDMS</h4>
        <ol className="text-sm text-amber-700 space-y-2 list-decimal list-inside">
          <li>Masukkan <strong>API Key</strong> dan <strong>API Secret</strong> dari SDMS ke kolom di atas.</li>
          <li>Klik <strong>Simpan Pengaturan</strong>.</li>
          <li>Klik <strong>Test Koneksi</strong> untuk memastikan koneksi berhasil.</li>
          <li>Salin <strong>Webhook URL</strong> dan masukkan ke pengaturan SDMS.</li>
          <li>Klik <strong>Sinkronisasi Sekarang</strong> untuk ambil data dari SDMS sekarang.</li>
          <li>Setelah webhook aktif, data akan otomatis terupdate saat ada perubahan di SDMS.</li>
        </ol>
      </Card>
    </div>
  );
}
