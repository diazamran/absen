# Folder APK

File APK yang bisa diunduh langsung dari website diletakkan di folder ini
dengan nama **`PresensiKu.apk`**:

```
https://absen.smkn1kras.sch.id/apk/PresensiKu.apk
```

## Cara menyediakan unduhan

1. Build APK di komputer: `bash deploy/android/build-apk-webview.sh`
   (script otomatis menyalin hasilnya ke folder ini).
2. Commit & push:
   ```bash
   git add apps/web/public/apk/PresensiKu.apk
   git commit -m "update APK"
   git push origin main
   ```
3. Di VPS: `cd /opt/presensiku && bash update.sh`

Setelah itu, pengunjung HP Android yang membuka website akan melihat
banner "Unduh aplikasi PresensiKu" di atas halaman (banner hanya muncul
di browser Android biasa — tidak muncul di dalam aplikasi/PWA yang
sudah terpasang).
