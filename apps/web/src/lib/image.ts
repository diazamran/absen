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
