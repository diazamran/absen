/**
 * UMPAN BALIK GETAR + SUARA
 * Dipakai scan gerbang / absen wajah otomatis agar petugas & siswa langsung tahu
 * hasilnya TANPA perlu melihat layar.
 */

/** Getar HP (Android). Tidak berfungsi / aman diabaikan di desktop & iOS. */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {
    // abaikan
  }
}

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/** Bunyi bip pendek (nada tunggal). */
export function beep(freq = 880, duration = 0.12, when = 0): void {
  const c = ctx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = c.currentTime + when;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  } catch {
    // abaikan
  }
}

/** Absen berhasil — getar dua kali + bunyi naik (ding-dong pendek). */
export function feedbackSuccess(): void {
  vibrate([60, 40, 120]);
  beep(880, 0.12);
  beep(1175, 0.18, 0.12);
}

/** Info (mis. sudah absen) — getar sebentar + bunyi satu nada. */
export function feedbackInfo(): void {
  vibrate(80);
  beep(660, 0.16);
}

/** Gagal — getar panjang + bunyi rendah. */
export function feedbackError(): void {
  vibrate([120, 60, 120]);
  beep(240, 0.2);
  beep(180, 0.25, 0.18);
}
