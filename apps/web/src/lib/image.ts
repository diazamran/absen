/**
 * Kompresi gambar OTOMATIS sebelum upload (bukti izin, dokumen, dll).
 * - Resize ke maks ~1280px (lebih dari cukup untuk bukti/surat yang dibaca layar)
 * - Re-encode ke JPEG kualitas 0.72
 * - Hasil kompresi dipakai HANYA jika lebih kecil dari file asli
 * - File non-gambar (PDF, CSV) dikembalikan apa adanya
 * Tujuan: beban upload & penyimpanan server tetap kecil walau banyak pengguna.
 */
export async function compressImageFile(file: File, maxSize = 1280, quality = 0.72): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    // Gagal kompres (browser lama, format aneh) → kirim file asli (masih di bawah 5 MB)
    return file;
  }
}

/**
 * Siapkan file logo sekolah SEBELUM upload (halaman Pengaturan).
 * - Deteksi OTOMATIS background transparan: jika ada piksel dengan alpha < 250
 *   (termasuk pinggiran anti-alias), logo disimpan sebagai **PNG** supaya
 *   transparansinya tetap bening — tidak berubah jadi kotak putih di kop kartu QR.
 * - Logo tanpa transparansi → dikompresi ke JPEG kualitas 0.88 (lebih kecil).
 * - Resize ke maks ~512 px (lebih dari cukup untuk kop kartu QR, login, PWA).
 * - Hasil re-encode dipakai HANYA jika lebih kecil dari file asli.
 */
export async function prepareLogoFile(
  file: File,
  maxSize = 512,
  quality = 0.88,
): Promise<{ file: File; transparent: boolean }> {
  if (!file.type.startsWith('image/')) return { file, transparent: false };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return { file, transparent: false };
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    // Deteksi transparansi dengan membaca saluran alpha
    let transparent = false;
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 250) {
          transparent = true;
          break;
        }
      }
    } catch {
      // Canvas tidak bisa dibaca → anggap tidak transparan
    }

    const mime = transparent ? 'image/png' : 'image/jpeg';
    const ext = transparent ? 'png' : 'jpg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    // Pakai hasil re-encode hanya jika lebih kecil dari file asli
    if (!blob || blob.size >= file.size) return { file, transparent };
    const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
    return { file: new File([blob], name, { type: mime }), transparent };
  } catch {
    // Gagal proses (browser lama, format aneh) → kirim file asli
    return { file, transparent: false };
  }
}
