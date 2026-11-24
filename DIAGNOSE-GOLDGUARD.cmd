@echo off
setlocal
cd /d "%~dp0"
if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [GAGAL] Node.js tidak ditemukan di PATH.
  exit /b 1
)
if not exist "node_modules\pinets\package.json" (
  echo [INFO] Dependency belum ada. Menginstall melalui npm ci...
  call npm ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
echo [INFO] Diagnosis GoldGuard asli dengan OHLC nyata dari AzusaTrade.
echo [INFO] Tidak mengubah metode, reverse signal, atau melakukan trading.
node --max-old-space-size=4096 scripts\diagnose-goldguard.mjs %*
if errorlevel 1 (
  echo [BELUM BERHASIL] Buka goldguard-diagnosis.txt untuk mengetahui error aslinya.
  exit /b 1
)
echo [OK] Runtime selesai, tetapi output harus dibandingkan dengan TradingView.
exit /b 0
