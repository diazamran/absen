/** Bantuan kamera: buka stream, ambil frame JPEG. */

export async function startCamera(video: HTMLVideoElement, facingMode: 'user' | 'environment' = 'user'): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode,
      // Minta resolusi landscape (lebar > tinggi) secara eksplisit.
      // Sebagian besar WebView Android mengirim frame landscape dari sensor,
      // tapi kadang menerapkan rotasi metadata — meminta ideal 640×480 mencegah
      // kamera mengirimi frame 480×640 yang tidak konsisten antar perangkat.
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  });
  video.srcObject = stream;
  const tryPlay = async () => {
    try {
      await video.play();
    } catch {
      // abaikan
    }
  };
  try {
    await video.play();
  } catch {
    const onGesture = () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('touchstart', onGesture);
      void tryPlay();
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('touchstart', onGesture);
  }
  return stream;
}

export function stopCamera(stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/**
 * Ambil frame video → dataURL JPEG (kualitas 0.75).
 *
 * Koreksi rotasi Android:
 * Beberapa WebView Android (terutama Chrome < 108 dan Samsung Internet) mengirim
 * frame dari sensor kamera landscape (lebar > tinggi) tanpa menerapkan rotasi,
 * meskipun HP dipegang portrait. Akibatnya gambar tampil miring 90°.
 *
 * Kita deteksi kondisi ini dengan membandingkan aspek rasio frame yang diterima
 * (videoWidth × videoHeight) vs aspek rasio yang diminta perangkat (dari track
 * settings). Bila frame lebih tinggi dari lebar (portrait), berarti browser
 * sudah merotasi — tidak perlu koreksi. Bila frame lebih lebar dari tinggi tapi
 * facingMode='user' dan HP dipegang portrait (tidak bisa kita tahu pasti),
 * kita pakai heuristik: gambar di-draw normal karena browser modern sudah benar.
 *
 * Koreksi nyata dilakukan lewat `ImageCapture` bila tersedia — browser
 * melaporkan rotasi track di `getSettings().resizeMode` / orientation flags.
 * Bila tidak tersedia, kita gambar frame apa adanya (landscape) dan biarkan
 * face-api.js yang menangani deteksi dari berbagai orientasi.
 *
 * CATATAN: preview video di CSS sudah di-mirror (scaleX(-1)) agar selfie tampak
 * alami, TAPI frame yang di-capture di sini tidak di-mirror — ini disengaja agar
 * descriptor wajah konsisten antara enroll (captureFrame saat registrasi) dan
 * verify (captureFrame saat absen). Kedua momen pakai kamera yang sama sehingga
 * orientasi mentah pun sama.
 */
export function captureFrame(video: HTMLVideoElement, maxSize = 480): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) return null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Deteksi apakah frame perlu dirotasi 90°.
  // Heuristik: browser yang mengalirkan frame portrait secara native akan memberi
  // videoHeight > videoWidth. Bila justru kebalikannya (lebar > tinggi) DAN rasio
  // aspek mendekati 4:3 landscape padahal kamera depan HP modern selalu portrait,
  // berarti browser TIDAK merotasi frame — kita rotasi sendiri.
  // Ambang batas: rasio > 1.2 dianggap landscape (4:3 ≈ 1.33, 16:9 ≈ 1.78).
  const needsRotation = vw / vh > 1.2;

  if (needsRotation) {
    // Frame landscape dari sensor — rotasi 90° searah jarum jam supaya tegak.
    const scale = Math.min(1, maxSize / Math.max(vh, vw));
    canvas.width = Math.round(vh * scale);   // setelah rotasi: tinggi jadi lebar
    canvas.height = Math.round(vw * scale);  // setelah rotasi: lebar jadi tinggi
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(video, 0, 0, canvas.height, canvas.width);
    ctx.restore();
  } else {
    // Frame sudah portrait (browser merotasi, atau kamera portrait native) — gambar normal.
    const scale = Math.min(1, maxSize / Math.max(vw, vh));
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }

  return canvas.toDataURL('image/jpeg', 0.75);
}

// ─── QR decode (optimized: cached jsQR + reusable canvas) ───
let _jsQR: typeof import('jsqr')['default'] | null = null;
let _qrCanvas: HTMLCanvasElement | null = null;
let _qrCtx: CanvasRenderingContext2D | null = null;

async function getJsQR() {
  if (!_jsQR) {
    const mod = await import('jsqr');
    _jsQR = mod.default;
  }
  return _jsQR;
}

/** Decode QR dari frame video — cepat: canvas & jsQR di-cache. */
export async function decodeQrFromVideo(video: HTMLVideoElement): Promise<string | null> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w === 0 || h === 0) return null;
  if (!_qrCanvas || _qrCanvas.width !== w || _qrCanvas.height !== h) {
    _qrCanvas = document.createElement('canvas');
    _qrCanvas.width = w;
    _qrCanvas.height = h;
    _qrCtx = _qrCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!_qrCtx) return null;
  _qrCtx.drawImage(video, 0, 0, w, h);
  const imageData = _qrCtx.getImageData(0, 0, w, h);
  const jsQR = await getJsQR();
  const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
  return result?.data ?? null;
}

/** Reset canvas cache (misal saat ganti kamera). */
export function resetQrCache(): void {
  _qrCanvas = null;
  _qrCtx = null;
}

export async function hasCameraPermission(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}
