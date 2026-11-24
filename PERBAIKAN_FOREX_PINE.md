# AzusaTrade — biquote Forex / Metals + Pine subset

## Implementasi

- Twelve Data diganti menjadi **biquote** untuk Forex/Metals, termasuk XAUUSD dan XAGUSD.
- REST backend: `/api/history`, `/api/price`, `/api/quotes`, `/api/config` tanpa API key.
- OHLC biquote dengan `openTime` ISO disortir sebelum masuk chart; tidak membuat 420 candle semu ketika penyedia hanya punya rentang lebih pendek.
- SignalR JSON WebSocket langsung dari browser untuk menerima tick, dengan negosiasi, Subscribe, heartbeat, dan reconnect bertahap. Tidak memakai relay Node di Vercel.
- REST snapshot fallback 15 detik hanya saat streaming tidak mengirim tick (tidak diberi label live). Harga dan timestamp berasal dari sumber, bukan dari refresh browser.
- Watchlist Forex/Metals diambil secara batch menggunakan `/api/latest`.
- Crypto tetap Binance/OKX. US10Y tetap FRED; DXY tergantung cakupan simbol penyedia.

## Perlu diketahui

1. Data **bergantung kepada feed MT5 biquote** dan berpotensi berbeda dari broker lain. Timestamp, status `stale` dan `marketState` dipakai untuk menghindari klaim harga live palsu.
2. Histori OHLC biquote native 1m hingga 1d dengan rolling window terbatas; 3m/45m/2h/dll diagregasi dari timeframe lebih kecil. Forex di bawah 1 menit belum disediakan di aplikasi.
3. Ketahanan stream real-world tetap perlu diuji setelah deploy. Di lingkungan penyusunan, koneksi internet ke `biquote.io` tidak tersedia; tes memakai data simulasi. Kebijakan CORS dan integrasi SignalR diasumsikan sesuai dokumentasi provider dan harus dicek di browser produksi.
4. **GoldGuard belum kompatibel penuh.** Perbaikan Pine sebelumnya hanya memperluas subset (ATR, standard deviation, sum, change, mom, dll.). Sumber GoldGuard dan reverse-signal dipertahankan tanpa perubahan. Jangan jadikan sinyal yang belum cocok sebagai dasar keputusan trading.
5. Hak penggunaan data publik dan kebijakan provider harus diperiksa sebelum dipakai secara komersial.

## QA

- Tes mock REST, quote, SignalR handshake/subscription, dan decode tick lulus.
- Build penuh dan koneksi live XAUUSD produksi **belum diverifikasi**, karena npm registry/endpoint provider tidak dapat dihubungi di lingkungan ini.

## Instalasi

1. Ekstrak ZIP ke folder baru.
2. Jalankan `UPDATE-GITHUB.cmd` atau pakai perintah Robocopy + Git di panduan.
3. Di Vercel, hapus environment variables Twelve Data yang tidak digunakan (`TWELVE_DATA_*`, `TWELVE_STREAM_URL`) dan redeploy.
4. Periksa `https://azusa-trade.vercel.app/api/config`, `/api/history?symbol=XAUUSD&frame=5m&limit=10`, dan chart XAUUSD. Buka console browser jika stream gagal.
