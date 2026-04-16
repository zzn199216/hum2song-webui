@echo off
setlocal
cd /d "%~dp0"

echo.
echo [Hum2Song] Optional Windows audio dependency installer
echo This helper tries to install FluidSynth and FFmpeg.
echo It only runs when you start this file manually.
echo.

set "PKG_MANAGER="
set "INSTALL_FAIL="

where winget >nul 2>&1
if not errorlevel 1 set "PKG_MANAGER=winget"

if not defined PKG_MANAGER (
  where choco >nul 2>&1
  if not errorlevel 1 set "PKG_MANAGER=choco"
)

if not defined PKG_MANAGER (
  echo [ERROR] Could not find winget or choco on PATH.
  echo         Install one of them first, then rerun this helper.
  echo.
  echo Next step:
  echo   - Open a new terminal/session after installing a package manager.
  echo   - Run this helper again: beginner_install_audio_deps.bat
  echo   - Then run: beginner_launch.bat
  echo.
  exit /b 1
)

echo [INFO] Using package manager: %PKG_MANAGER%
echo.

if /i "%PKG_MANAGER%"=="winget" (
  echo [INFO] winget install --name "FluidSynth" --exact
  call winget install --name "FluidSynth" --exact --accept-package-agreements --accept-source-agreements
  if errorlevel 1 set "INSTALL_FAIL=1"
  if errorlevel 1 echo [WARN] winget could not install "FluidSynth". Try: winget search FluidSynth
  echo [INFO] winget install --name "FFmpeg" --exact
  call winget install --name "FFmpeg" --exact --accept-package-agreements --accept-source-agreements
  if errorlevel 1 set "INSTALL_FAIL=1"
  if errorlevel 1 echo [WARN] winget could not install "FFmpeg". Try: winget search FFmpeg
) else (
  echo [INFO] choco install fluidsynth -y
  call choco install fluidsynth -y
  if errorlevel 1 set "INSTALL_FAIL=1"
  if errorlevel 1 echo [WARN] choco could not install "fluidsynth". Search Chocolatey and retry.
  echo [INFO] choco install ffmpeg -y
  call choco install ffmpeg -y
  if errorlevel 1 set "INSTALL_FAIL=1"
  if errorlevel 1 echo [WARN] choco could not install "ffmpeg". Search Chocolatey and retry.
)

echo.
if defined INSTALL_FAIL (
  echo [WARN] One or more install commands failed.
  echo        Review output above, then retry or install manually.
) else (
  echo [OK]   Install commands completed.
)

echo.
echo Next step:
echo   - You may need to open a NEW terminal/session so PATH updates apply.
echo   - Then rerun: beginner_launch.bat
echo.

if defined INSTALL_FAIL exit /b 1
exit /b 0
