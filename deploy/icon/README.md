# Ikon Aplikasi (Logo)

Sumber logo aplikasi PresensiKu — desain terinspirasi emblem SMKN 1 Kras
(perisai biru, bingkai emas, aksen magenta, bintang putih, tanda centang
absen, dan buku terbuka).

## File sumber

- `logo-main.svg` — ikon utama (latar biru, sudut membulat)
- `logo-maskable.svg` — ikon maskable (latar penuh, aman untuk mask Android)
- `render.mjs` — script render semua ukuran PNG

## Cara regenerate semua ikon

```bash
cd deploy/icon
npm install        # sekali saja (membutuhkan sharp)
npm run render
```

Script menulis ulang semua file ikon:

- PWA: `apps/web/public/icons/*.png` + `apps/web/public/favicon.png`
- Android TWA: `deploy/android/twa/app/src/main/res/mipmap-*/`
- Android WebView: `deploy/android/webview/app/src/main/res/mipmap-*/`

Ubah warna/desain di SVG, jalankan ulang `npm run render`, lalu
commit hasil PNG-nya.
