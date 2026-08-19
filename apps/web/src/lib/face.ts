/**
 * PENGENALAN WAJAH DI BROWSER (face-api.js + TensorFlow.js)
 * ---------------------------------------------------------
 * Deteksi wajah & ekstraksi descriptor (128 dimensi) dilakukan di HP/PC siswa,
 * BUKAN di server. Hanya descriptor (angka matematis) yang dikirim ke server —
 * foto mentah tidak pernah dikirim & tidak disimpan.
 *
 * Model di-serve dari /models (folder public). Dimuat sekali lalu di-cache.
 */
import * as tf from '@tensorflow/tfjs';
import * as faceapi from '@vladmandic/face-api';

export const FACE_DESCRIPTOR_SIZE = 128;

let modelsReady = false;
let loadingPromise: Promise<void> | null = null;

/** Muat model wajah (sekali saja, lalu di-cache). Aman dipanggil berkali-kali. */
export async function initFaceModels(): Promise<void> {
  if (modelsReady) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    // Pastikan ada backend komputasi: WebGL (cepat) atau CPU (fallback)
    await tf.ready();
    const backend = tf.getBackend();
    if (backend !== 'webgl' && backend !== 'cpu') {
      try {
        await tf.setBackend('webgl');
      } catch {
        await tf.setBackend('cpu');
      }
    }

    const modelUrl = `${import.meta.env.BASE_URL || '/'}models`;
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
    ]);
    modelsReady = true;
  })().finally(() => {
    loadingPromise = null;
  });

  return loadingPromise;
}

export function isFaceModelReady(): boolean {
  return modelsReady;
}

/**
 * Deteksi satu wajah dari video/canvas/gambar → descriptor 128-d.
 * Mengembalikan null bila wajah tidak terdeteksi dengan cukup yakin.
 */
export async function detectFaceDescriptor(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): Promise<Float32Array | null> {
  await initFaceModels();
  const detection = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection || !detection.descriptor || detection.descriptor.length !== FACE_DESCRIPTOR_SIZE) {
    return null;
  }
  return detection.descriptor;
}

/**
 * Liveness ringan: bandingkan 2 frame JPEG (diambil berjarak ~0,3 detik).
 * Frame yang nyaris identik (foto diam / layar HP) → dianggap bukan orang asli.
 * Sedikit pergerakan alami wajah → lolos.
 */
export async function framesHaveMotion(frameA: string, frameB: string, minDiff = 0.008): Promise<boolean> {
  const diff = await frameDifference(frameA, frameB);
  return diff > minDiff;
}

async function frameDifference(a: string, b: string): Promise<number> {
  try {
    const load = async (src: string) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return img;
    };
    const [imgA, imgB] = await Promise.all([load(a), load(b)]);
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 1;
    ctx.drawImage(imgA, 0, 0, size, size);
    const dataA = ctx.getImageData(0, 0, size, size).data;
    ctx.drawImage(imgB, 0, 0, size, size);
    const dataB = ctx.getImageData(0, 0, size, size).data;
    let sum = 0;
    for (let i = 0; i < dataA.length; i += 4) {
      const lumA = 0.299 * dataA[i] + 0.587 * dataA[i + 1] + 0.114 * dataA[i + 2];
      const lumB = 0.299 * dataB[i] + 0.587 * dataB[i + 1] + 0.114 * dataB[i + 2];
      sum += Math.abs(lumA - lumB) / 255;
    }
    return sum / (dataA.length / 4);
  } catch {
    return 1; // gagal membandingkan → anggap ada gerakan (tidak memblokir)
  }
}
