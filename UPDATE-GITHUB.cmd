@echo off
setlocal
if exist "C:\Program Files\nodejs\npm.cmd" set "PATH=C:\Program Files\nodejs;%PATH%"
set "TARGET=C:\Users\funka\Downloads\azusa-trade-github"
if not exist "%TARGET%\.git" (
  echo [GAGAL] Folder repo GitHub belum ada: %TARGET%
  exit /b 1
)
echo [1/4] Sinkronisasi branch main GitHub...
git -C "%TARGET%" pull --rebase origin main
if errorlevel 1 (
  echo [GAGAL] Git pull gagal. Periksa konflik terlebih dahulu.
  exit /b 1
)
echo [CHECK] Install dependency dari package-lock.json...
cd /d "%~dp0"
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo [GAGAL] Dependency tidak berhasil di-install.
  exit /b 1
)
echo [CHECK] Verifikasi paket dan test...
cd /d "%~dp0"
call npm test
if errorlevel 1 exit /b 1
call npm run typecheck
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
echo [2/4] Salin source terbaru dengan Robocopy...
robocopy "%~dp0" "%TARGET%" /E /R:2 /W:2 /XD .git node_modules .next .vercel dist build /XF .env .env.local .env.production .env.development
if errorlevel 8 (
  echo [GAGAL] Robocopy mengalami error.
  exit /b 1
)
echo [3/4] Commit perubahan...
rem File relay Twelve Data lama sudah tidak dipakai.
git -C "%TARGET%" rm -f --ignore-unmatch -- server/relay.mjs server/twelve-stream.mjs Dockerfile .dockerignore
if errorlevel 1 exit /b 1
git -C "%TARGET%" add -A
if errorlevel 1 exit /b 1
git -C "%TARGET%" diff --cached --quiet
if not errorlevel 1 (
  echo Tidak ada perubahan baru yang perlu di-push.
  exit /b 0
)
git -C "%TARGET%" commit -m "Fix Pine timeframe and add indicator drawing controls"
if errorlevel 1 exit /b 1
echo [4/4] Push ke origin main...
git -C "%TARGET%" push origin main
if errorlevel 1 (
  echo [GAGAL] Push ditolak; jangan gunakan force.
  exit /b 1
)
echo [OK] Upload GitHub selesai. Periksa Deployments di Vercel.
exit /b 0
