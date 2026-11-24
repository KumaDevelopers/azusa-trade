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
echo [CHECK] Sinkronkan package-lock.json lalu install dependency...
cd /d "%~dp0"
call npm install --package-lock-only --ignore-scripts --no-audit --no-fund
if errorlevel 1 (
  echo [GAGAL] package-lock.json gagal diperbarui.
  exit /b 1
)
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo [GAGAL] Dependency tidak berhasil di-install.
  exit /b 1
)
echo [CHECK] GoldGuard 180: verifikasi semua metode tidak berubah...
call npm run check:goldguard:180
if errorlevel 1 exit /b 1
call npm test
if errorlevel 1 exit /b 1
call npm run typecheck
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
echo [2/4] Salin source terbaru dengan Robocopy...
rem %%~dp0 ends with a backslash; remove it before quoting for Robocopy.
set "SOURCE=%~dp0"
if "%SOURCE:~-1%"=="\" set "SOURCE=%SOURCE:~0,-1%"
robocopy "%SOURCE%" "%TARGET%" /E /R:2 /W:2 /XD .git node_modules .next .vercel dist build download-history PINETS-BACKUP-BEFORE-PATCH BROWSER-FIX-BACKUP RENDERER-BACKUP-BEFORE-PATCH /XF .env .env.local .env.production .env.development goldguard-diagnosis.txt
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
git -C "%TARGET%" commit -m "Render native PineTS drawings and tables without changing GoldGuard"
if errorlevel 1 exit /b 1
echo [4/4] Push ke origin main...
git -C "%TARGET%" push origin main
if errorlevel 1 (
  echo [GAGAL] Push ditolak; jangan gunakan force.
  exit /b 1
)
echo [OK] Upload GitHub selesai. Periksa Deployments di Vercel.
exit /b 0
