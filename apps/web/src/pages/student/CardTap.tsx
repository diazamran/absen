import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, Smartphone, Keyboard, CheckCircle2, XCircle } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Input, Field, Segmented, Badge } from '../../lib/ui';
import { STATUS_LABELS } from '../../lib/format';

type Type = 'CHECK_IN' | 'CHECK_OUT';

export default function CardTap() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [type, setType] = useState<Type>('CHECK_IN');
  const [nfcSupported, setNfcSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [uid, setUid] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string; fullName?: string; time?: string; status?: string } | null>(null);
  const nfcRef = useRef<{ scan: () => Promise<void> } | null>(null);

  useEffect(() => {
    // Web NFC (Chrome Android)
    const NDEF = (window as unknown as { NDEFReader?: unknown }).NDEFReader;
    if (NDEF) {
      setNfcSupported(true);
    }
  }, []);

  const startListening = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const NDEF = (window as unknown as { NDEFReader: any }).NDEFReader;
      const reader = new NDEF();
      await reader.scan();
      setListening(true);
      reader.onreading = async (event: { message?: { records?: { id?: ArrayBuffer }[] } }) => {
        const id = event.message?.records?.find((r) => r.id)?.id;
        const uidHex = id ? [...new Uint8Array(id)].map((b) => b.toString(16).padStart(2, '0')).join(':').toUpperCase() : '';
        if (uidHex) {
          await submit(uidHex);
        } else {
          toast('warning', 'Kartu tidak terbaca. Coba lagi.');
        }
      };
      nfcRef.current = { scan: startListening };
      toast('success', 'Dekatkan kartu ke bagian belakang HP.');
    } catch {
      toast('error', 'Gagal mengaktifkan NFC. Gunakan input manual.');
      setManualMode(true);
    }
  };

  const submit = async (cardUid: string) => {
    try {
      const res = await api<{ success: boolean; message: string; data: { fullName: string; time: string; status: string } }>('/attendance/card', {
        method: 'POST',
        body: { cardUid, type, deviceId: 'web' },
      });
      setResult({ ok: true, message: res.message, ...res.data });
    } catch (e) {
      setResult({ ok: false, message: e instanceof ApiError ? e.message : 'Kartu tidak valid.' });
    }
    setTimeout(() => setResult(null), 3500);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-violet-950 via-slate-950 to-slate-950 text-white">
      <div className="flex items-center justify-between px-4 py-4">
        <button onClick={() => navigate(-1)} className="rounded-xl p-2 hover:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="font-bold">Kartu / NFC</h2>
        <div className="w-9" />
      </div>

      <div className="flex justify-center px-4 pb-4">
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'CHECK_IN', label: 'Datang' },
            { value: 'CHECK_OUT', label: 'Pulang' },
          ]}
        />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="relative">
          <div className={`flex h-44 w-44 items-center justify-center rounded-[2.5rem] border-2 ${listening ? 'border-emerald-400 shadow-[0_0_40px_rgba(52,211,153,.35)]' : 'border-white/20'}`}>
            <CreditCard className={`h-20 w-20 ${listening ? 'text-emerald-400' : 'text-white/40'}`} />
          </div>
          {listening && (
            <div className="absolute -inset-4 -z-10 animate-pulse rounded-[3rem] bg-emerald-400/10" />
          )}
        </div>

        {nfcSupported ? (
          <div className="text-center">
            <p className="text-lg font-bold">{listening ? 'Dekatkan kartu ke HP…' : 'Perangkat ini mendukung NFC'}</p>
            <p className="mt-1 max-w-xs text-sm text-white/60">
              {listening ? 'Menunggu kartu. Kartu yang terdaftar akan otomatis dicatat.' : 'Tekan tombol untuk mengaktifkan pembaca NFC.'}
            </p>
            {!listening && (
              <Button onClick={startListening} className="mt-4 bg-white/10 hover:bg-white/20" variant="secondary">
                <Smartphone className="h-4 w-4" /> Aktifkan NFC
              </Button>
            )}
          </div>
        ) : (
          <div className="text-center">
            <p className="text-lg font-bold">Perangkat ini tidak mendukung NFC.</p>
            <p className="mt-1 max-w-xs text-sm text-white/60">
              Gunakan QR Code, Absen Wajah, atau masukkan kode kartu secara manual.
            </p>
          </div>
        )}

        {/* Fallback manual */}
        <div className="w-full max-w-sm">
          {!manualMode ? (
            <button onClick={() => setManualMode(true)} className="mx-auto flex items-center gap-2 text-sm text-white/60 hover:text-white">
              <Keyboard className="h-4 w-4" /> Masukkan kode kartu manual
            </button>
          ) : (
            <div className="space-y-3 rounded-2xl bg-white/10 p-4 backdrop-blur">
              <Field label="Kode / UID Kartu">
                <Input
                  value={uid}
                  onChange={(e) => setUid(e.target.value)}
                  placeholder="contoh: 04:A2:3B:9F:11:55:80"
                  className="bg-white/10 text-white placeholder:text-white/40"
                  onKeyDown={(e) => e.key === 'Enter' && uid && submit(uid)}
                />
              </Field>
              <Button className="w-full" onClick={() => uid && submit(uid)} disabled={!uid}>
                Absen dengan Kartu
              </Button>
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          {result.ok ? (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center text-ink animate-pop dark:bg-slate-800 dark:text-white">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 animate-pulse-ring dark:bg-emerald-500/15 dark:text-emerald-300">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <p className="text-xl font-extrabold text-primary">✓ {result.message}</p>
              <p className="mt-1 text-lg font-bold">{result.fullName}</p>
              <p className="font-mono text-4xl font-extrabold">{result.time}</p>
              <div className="mt-2 flex justify-center">
                <Badge status={result.status || 'PRESENT'} label={STATUS_LABELS[result.status || 'PRESENT']} />
              </div>
            </div>
          ) : (
            <div className="mx-4 w-full max-w-sm rounded-3xl bg-surface p-6 text-center animate-pop dark:bg-slate-800">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-500 dark:bg-red-500/15">
                <XCircle className="h-9 w-9" />
              </div>
              <p className="font-bold text-ink">{result.message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
