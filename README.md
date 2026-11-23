# AzusaTrade

Terminal analisis pasar dengan Next.js, TypeScript, Tailwind CSS, dan Lightweight Charts. Workspace mendukung chart utama, chart pembanding kripto, analisis lintas timeframe, indikator, gambar chart, berita, kalender, paper trading, dan backtest EMA/SMA.

## Pengembangan

Gunakan Node.js 24.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Buka http://localhost:3000. Jalankan `npm run build` dan `npm start` untuk menguji hasil build produksi. Gunakan `npm test` dan `npm run benchmark` untuk memeriksa engine. Hasil pengukuran tercatat di [BENCHMARK.md](BENCHMARK.md).

## Deploy ke Vercel

Impor direktori ini sebagai proyek Next.js atau jalankan Vercel CLI dari root. Build menggunakan `npm run build`. Simpan konfigurasi server sebagai Environment Variables pada proyek.

```bash
npx vercel login
npx vercel
npx vercel --prod
```

| Konfigurasi | Kegunaan |
| --- | --- |
| Tanpa API key | Histori dan streaming spot kripto Binance/OKX, berita RSS Federal Reserve, BEA dan CoinDesk, jadwal resmi BLS/Fed, serta observasi FRED US10Y. |
| `TWELVE_DATA_API_KEY` | Histori Forex, metals, dan DXY sesuai cakupan paket. Gunakan paket dengan izin redistribusi yang sesuai. |
| `TWELVE_STREAM_URL` | URL HTTPS relay yang mengirim tick Forex dan metals. Gunakan `TWELVE_DATA_DELAY_SECONDS` untuk menandai feed yang memiliki jeda. |
| `TRADING_ECONOMICS_API_KEY` | Berita pasar dan kalender berlisensi. Kolom actual, forecast, previous, dan impact mengikuti data penyedia. Refresh berita dan kalender berlangsung berkala. |
| `DATABASE_URL` | Pasang Neon untuk proyek ini melalui Vercel Marketplace. Jalankan `db/schema.sql` di Neon untuk mengaktifkan backup dan pemulihan dari menu Pengaturan. |
| `JUDGE0_URL`, `JUDGE0_AUTH_TOKEN`, `JUDGE0_C_LANGUAGE_ID`, `JUDGE0_JAVA_LANGUAGE_ID`, `RUNNER_ACCESS_KEY` | Compiler C dan Java opsional. Gunakan URL HTTPS, token API, dan ID bahasa dari instans Judge0 terisolasi. |

Anggap kunci pemulihan Neon sebagai kredensial. Backup dipicu dari menu Pengaturan. Setiap simpan memeriksa revisi sehingga satu perangkat tidak menimpa backup yang telah diperbarui perangkat lain. Library script lokal memakai IndexedDB tanpa batas jumlah dari aplikasi. Ukuran transfer snapshot mengikuti batas HTTP Vercel.

### Relay harga Forex dan metals

Jalankan `Dockerfile` pada container terkelola yang terus berjalan dengan satu replika. Set `TWELVE_DATA_API_KEY`, `TERMINAL_ORIGIN` sesuai origin frontend Vercel, dan `PORT` jika penyedia host menentukannya. Arahkan `TWELVE_STREAM_URL` di Vercel ke `https://<relay>/api/stream`. Relay berbagi langganan Twelve Data dan meneruskan tick melalui SSE. Kunci provider hanya berada di backend. Saat stream belum tersedia, UI menampilkan status riwayat, delayed, market tutup, atau perlu konfigurasi sesuai feed. Saat WebSocket kripto terputus, chart memuat candle berkala dan menampilkan status polling jika data REST masih segar. Snapshot cadangan diberi label riwayat.

## Runtime indikator

- Maksimal 10 indikator aktif pada chart utama. Indikator dapat dibuka pada timeframe berbeda. Dasbor editor menampilkan hasil compile dan runtime serta menyediakan impor dan ekspor kode sumber.
- JavaScript/TypeScript dapat memakai `function calculate(candles)` dengan hasil array plot `{ name, values, color?, type? }`. Satu nilai angka atau `null` per candle. Opsional gunakan `const title` dan `const overlay`. QuickJS/Wasm berjalan di Web Worker dengan batas waktu dan memori. Formula deklaratif `plot()` yang sudah disimpan tetap didukung.
- Pine v6 mendukung subset deklaratif dengan input numerik/boolean, ekspresi seri, TA dasar, dan plot. Sintaks di luar subset diberi diagnostik.
- C dan Java memiliki mode formula lokal dan opsi compiler Judge0. Opsi compiler menjalankan program dari editor pada instans Judge0. Contoh input stdin dan format output tersedia sebagai template. Setiap baris stdin berisi `time,open,high,low,close,volume`, setiap baris stdout berisi satu angka atau `null`. Operator memasukkan `RUNNER_ACCESS_KEY` di editor. Runner harus mengaktifkan mode sinkron `wait=true`, menolak jaringan dari program, dan menjalankan sandbox proses sesuai konfigurasi Judge0. Script native diperbarui pada candle baru atau terkonfirmasi, dengan jeda minimal antareksekusi.
- Price alert dan indicator alert berjalan pada pasar dan timeframe chart aktif saat workspace terbuka. Indicator alert memakai nilai candle terkonfirmasi. Paper trading adalah simulasi berdasarkan harga stream chart aktif. Backtest menggunakan candle tertutup dan fill pada pembukaan berikutnya.

## GoldGuard

Lampiran asli tersedia di pustaka dengan nama **AzusaTrade — Advanced Indicator**. File `indicators/GoldGuard.pine` memiliki SHA-256:

```
1a241de8c54ae2695af94c526f5af92a67dbc8f84179ca72b79e7dd4c4567e1c
```

Editor dapat memuat sumber asli dan menampilkan diagnostik saat pengembangan. Pada deployment, sumber dapat diunduh dari editor jika operator mengaktifkan `GOLDGUARD_SOURCE_PUBLIC=1`. Eksekusi GoldGuard belum kompatibel dengan engine saat ini. Script menggunakan state persisten, custom types, request MTF, lower-timeframe arrays, objek visual, dan perilaku intrabar yang perlu diverifikasi sebelum mengaktifkan sinyal.

Setelah ada runtime yang bisa menghasilkan ledger, ekspor OHLC dan kolom audit `GG_*` TradingView dengan simbol, sumber, rentang, dan pengaturan yang sama. Bandingkan keduanya melalui:

```bash
node scripts/goldguard-parity.mjs tradingview.csv candidate.csv
```

Uji mencocokkan OHLC per timestamp, metode, sisi, entry, TP, SL, skor dan exit. Pengujian intrabar juga memerlukan rangkaian tick atau lower-timeframe yang identik untuk kedua eksekusi.
