# Verifikasi AzusaTrade

Pengujian dilakukan pada 24 November 2026 WIB dengan Node.js 24.22.3 dan Chromium Headless 153.

| Skenario | Median | P95 |
| --- | ---: | ---: |
| 10 indikator bawaan, 12.000 candle | 11,98 ms | 54,73 ms |
| Pine subset, dua plot, 12.000 candle | 3,55 ms | 4,59 ms |
| Backtest EMA crossover, 12.000 candle | 1,63 ms | 2,55 ms |

`npm run benchmark` menjalankan perhitungan engine dengan 5 putaran pemanasan, 24 pengukuran, dan dataset sintetis. Heap Node di akhir pengujian 36,81 MiB. Pengukuran ini mencakup komputasi indikator dan backtest.

Pada viewport 1440 × 900, chart dengan 10 indikator aktif dan replay pesan WebSocket di browser mencatat 60 FPS, interval frame P95 16,8 ms, dan 0 tugas utama di atas 50 ms selama sampel 160 frame. Pengukuran dilakukan pada Chromium Headless dan belum mencakup ponsel fisik atau sesi panjang. Pada viewport 390 × 844, chart tampil, pergantian simbol dan timeframe bekerja, dan lebar dokumen tetap 390 px.

Build produksi, pemeriksaan TypeScript, dan 16 tes otomatis lulus. Tes mencakup validasi feed, fallback cache, batas sandbox, data OHLCV, MTF, 21 indikator, integritas sumber GoldGuard, dan fill backtest. Pemeriksaan browser mencakup mode dua chart, Compile TypeScript, penyimpanan script setelah reload, dan formulir indicator alert.

URL Vercel mengembalikan halaman AzusaTrade, histori Binance, berita, dan kalender. Browser pada deployment Vercel mengonfirmasi status LIVE dari Binance Spot untuk BTCUSDT dengan 420 candle. Chromium Headless dalam lingkungan lokal tidak mendapat koneksi WebSocket eksternal. Angka FPS menggunakan replay dalam pengujian lokal, sedangkan pengujian API memakai data provider asli. Twelve Data live, kalender Trading Economics, Neon, dan Judge0 belum diuji pada layanan berautentikasi karena deployment sementara belum memiliki kredensial.

Kode GoldGuard identik dengan lampiran. Engine Pine subset belum dapat menjalankannya dan belum tersedia hasil pembanding untuk menyatakan kesetaraan sinyal.
