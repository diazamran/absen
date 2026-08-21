/** Bantuan kamera: buka stream, ambil frame JPEG. */

export async function startCamera(video: HTMLVideoElement, facingMode: 'user' | 'environment' = 'user'): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode,
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

/** Ambil frame video → dataURL JPEG (kualitas 0.75). */
export function captureFrame(video: HTMLVideoElement, maxSize = 480): string | null {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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
