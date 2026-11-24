> Catatan 24-11-2026: dokumen ini mencatat versi sebelumnya. Pada paket **GoldGuard 180 Candle**, parameter histori telah dipendekkan; rumus metode trading dan reverse signal tetap sama. Lihat `BACA-INI-GOLDGUARD-180.txt`.

# AzusaTrade — Update Pine diagnostics + Drawing UX

Perubahan pada rilis ini:

- Preview drawing: saat tool aktif dan pointer digeser, bentuk sebenarnya (rectangle, trendline, fibonacci, risk/reward, dll.) muncul sebelum tombol mouse dilepas. Mendukung dua klik serta drag.
- Seleksi drawing: klik objek dengan tool Cursor untuk menampilkan toolbar ikon tepat di atas bentuk terpilih.
- Toolbar: ikon pensil mengaktifkan edit titik pegangan, mata men-sembunyikan drawing, tempat sampah menghapus, X menutup toolbar.
- Keyboard: Delete/Backspace menghapus drawing terpilih; Escape membatalkan seleksi. Keyboard di editor/input diabaikan.
- PineTS: mencoba mengambil candle historis yang benar-benar tersedia dari endpoint AzusaTrade jika `calc_bars_count` lebih panjang daripada chart. Cache lima menit mengurangi permintaan berulang. Tidak membuat candle sintetis.
- Error `Cannot read properties of undefined (reading '384')`: jika masih muncul, sekarang dijelaskan sebagai kegagalan runtime/seri dengan jumlah candle yang berhasil disediakan, bukan menganggap indikator menghasilkan sinyal valid.
- MTF: per-request secondary history dapat sampai 1.000 candle jika sumber mendukung, tidak lagi dipotong ke 420.
- `comparison-chart.tsx`: callback drawing yang hilang ditambahkan agar typecheck dapat berjalan.
- `UPDATE-GITHUB.cmd`: perbaikan path Robocopy yang sebelumnya salah akibat backslash penutup, dan sinkronisasi package-lock sebelum npm ci.

## Status/limitasi

- 19 pengujian API/biquote/Pine adapter lulus di lingkungan pengujian, plus TypeScript TSX syntax parse tanpa error.
- npm test total, `npm run typecheck`, dan `npm run build` **belum bisa diverifikasi di lingkungan ini** karena registri npm tak bisa dijangkau. Jalankan di komputer pengguna dengan Node.js dan dependencies terpasang.
- **Belum ada bukti GoldGuard Pine v6 berfungsi penuh**. PineTS 0.13.1 mungkin masih bermasalah pada script kompleks seperti `request.security_lower_tf`, state, array, dan objek visual. Source indikator GoldGuard tidak diubah; metode trading/reverse signal identik.
- Chart Forex mungkin memiliki sejarah jauh lebih sedikit dari `calc_bars_count = 12000` yang diminta GoldGuard. Backfill hanya mengambil data nyata yang tersedia di penyedia.

## Windows CMD

Ekstrak ZIP ke `C:\Users\funka\OneDrive - Document Office\Downloads\AzusaTrade-Pine-Drawing-Update`, buka CMD dan jalankan:

```
cd /d "C:\Users\funka\OneDrive - Document Office\Downloads\AzusaTrade-Pine-Drawing-Update\azusatrade"
UPDATE-GITHUB.cmd
```

Script akan pull --rebase; menyamakan lockfile; menginstal dependensi; npm test; typecheck; build; Robocopy dengan eksklusi folder, lalu commit/push biasa (tanpa force). Jangan lanjutkan jika muncul error.
