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
  // Beberapa WebView/browser menahan video.play() sampai ada sentuhan pertama di layar.
  // Jangan gagalkan startup — simpan stream dan coba play lagi begitu layar disentuh.
  const tryPlay = async () => {
    try {
      await video.play();
    } catch {
      // masih ditahan — coba lagi pada sentuhan berikutnya
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

/** Decode QR dari frame video (jsqr). */
export async function decodeQrFromVideo(video: HTMLVideoElement): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const jsQR = (await import('jsqr')).default;
  const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
  return result?.data ?? null;
}

export async function hasCameraPermission(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}
