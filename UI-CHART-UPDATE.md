> Catatan 24-11-2026: dokumen ini mencatat versi sebelumnya. Pada paket **GoldGuard 180 Candle**, parameter histori telah dipendekkan; rumus metode trading dan reverse signal tetap sama. Lihat `BACA-INI-GOLDGUARD-180.txt`.

# AzusaTrade — Perbaikan chart dan indikator (24 November 2026)

## Perubahan

1. Memperbaiki jalur timeframe kosong PineTS. Worker sekarang menerima timeframe chart yang sebenarnya (`15m`, `1h`, dll.), serta adapter menerima format Pine `15`, `60`, `240`, `D`, `W` dan format native.
2. Legenda indikator di chart sekarang memiliki tombol show/hide, pengaturan, edit kode script, dan hapus per indikator.
3. Drawing dua titik dapat dibuat dengan dua klik atau pointer drag. Garis horizontal/vertikal dibuat satu klik. Klik gambar yang sudah ada untuk opsi `Sembunyikan` dan `Hapus`.
4. Tombol toolbar untuk sembunyikan/tampilkan semua indikator dan semua drawing; menu daftar drawing memungkinkan mengembalikan objek tersembunyi. Preferensi disimpan lokal.
5. GoldGuard.pine **tidak dimodifikasi**, termasuk metode trading/reverse signal.

## Status validasi

- Pine adapter regression tests: lulus dengan fake PineTS runtime.
- Lulus parser sintaks TypeScript/TSX untuk semua file yang diubah.
- Tidak ada browser production/visual QA atau build penuh di lingkungan pengemasan karena npm dependency tidak dapat diunduh. Jalankan `npm ci`, `npm test`, `npm run typecheck`, dan `npm run build` secara lokal sebelum push.
- Ini bukan klaim bahwa GoldGuard v6 kompatibel penuh; masih dibutuhkan kemampuan runtime dan histori real-market multi-timeframe.

## Cara pakai

- Pilih alat di toolbar kiri. Klik dua titik di chart atau klik kiri tahan lalu geser, dan lepaskan.
- Kembali ke kursor, pilih garis/kotak dengan klik, lalu `Sembunyikan` atau `Hapus`.
- Klik ikon layer di toolbar kiri untuk memulihkan drawing yang tersembunyi.
- Klik ikon indikator/drawing di toolbar atas untuk toggle semua.
- Di legenda indikator (atas kiri chart), gunakan mata untuk hide, roda gigi untuk settings, ikon kode untuk mengedit Pine, X untuk menghapus.
