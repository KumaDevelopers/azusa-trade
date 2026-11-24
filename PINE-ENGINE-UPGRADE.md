# Pine Engine Upgrade — status dan batasan

## Yang sudah disiapkan

- Adapter PineTS v0.13.1 untuk sintaks Pine v5/v6 di `lib/pine-advanced.mjs`.
- Indikator sederhana tetap memakai engine lama; skrip kompleks beralih ke PineTS, bukan diblokir berdasarkan nama GoldGuard.
- Pasar dasar mengambil candle dari worker, permintaan `request.security*` diteruskan ke `/api/history` sesuai ticker/timeframe. Data MTF kosong akan menghasilkan error, BUKAN harga palsu.
- GoldGuard asli tetap utuh, termasuk seluruh metode trading dan reverse signal (checksum diuji).
- Tes adapter menggunakan runtime mock, sehingga jalur data/validasi bisa diuji tanpa paket npm.

## Yang BELUM boleh diklaim selesai

- **Belum ada uji GoldGuard end-to-end dengan runtime PineTS nyata.** Paket npm tidak tersedia dari mesin pembuatan ini. Jalankan `npm install pinets@0.13.1 --save-exact` di komputer dengan internet.
- Vercel perlu berhasil membangun bundle worker. `npm test`, `npm run typecheck` dan `npm run build` wajib dijalankan setelah instalasi sebelum push.
- `request.security_lower_tf` dan `request.security` butuh candle asli multi-timeframe, termasuk DXY dan US10Y; provider biquote belum tentu menyediakan seluruh kombinasi timeframe.
- GoldGuard `calc_bars_count=12000`, sedangkan sebagian chart AzusaTrade masih memiliki sekitar 193–420 candle.
- Visual `line`, `label`, `box`, `table`, plotshape dan alerts dari PineTS **belum dikonversi penuh** ke renderer chart AzusaTrade. Adapter saat ini meneruskan plot numerik saja. Tidak boleh dianggap GoldGuard telah bekerja sama seperti TradingView.
- Output sinyal harus dibandingkan dengan ekspor ledger TradingView menggunakan `scripts/goldguard-parity.mjs` sebelum dipakai untuk trading.

## LISENSI

PineTS (https://github.com/LuxAlgo/PineTS) menggunakan AGPL-3.0-only. Jika ingin menyebarkan versi modifikasi atau mengoperasikan aplikasi jaringan yang menggabungkan PineTS, pahami kewajiban sumber kode dan atribusi lisensi terlebih dahulu; gunakan lisensi komersial resmi bila skenario penggunaan membutuhkan.

## Cara mencoba di Windows

1. Ekstrak paket, buka CMD dalam folder `azusatrade`.
2. `npm install pinets@0.13.1 --save-exact`
3. `npm test`
4. `npm run typecheck`
5. `npm run build`
6. Baru jalankan `UPDATE-GITHUB.cmd` jika semua tes dan build selesai tanpa error.

Jangan gunakan produk ini untuk sinyal otomatis hingga parity GoldGuard teruji.
