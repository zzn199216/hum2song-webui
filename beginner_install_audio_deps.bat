@echo off
setlocal
cd /d "%~dp0"

echo.
echo [Hum2Song] Optional Windows audio dependency installer
echo This helper tries to install FluidSynth and FFmpeg.
echo It only runs when you start this file manually.
echo.

set "HAS_WINGET="
set "HAS_CHOCO="
set "INSTALL_FAIL="
set "FLUIDSYNTH_OK="
set "FFMPEG_OK="

where winget >nul 2>&1
if not errorlevel 1 set "HAS_WINGET=1"
where choco >nul 2>&1
if not errorlevel 1 set "HAS_CHOCO=1"

if not defined HAS_WINGET if not defined HAS_CHOCO (
  echo [ERROR] Could not find winget or choco on PATH.
  echo         Install one of them first, then rerun this helper.
  echo.
  echo Next step:
  echo   - Open a new terminal/session after installing a package manager.
  echo   - Run this helper again: beginner_install_audio_deps.bat
  echo   - Then run: beginner_launch.bat
  echo   - Manual steps: docs\BEGINNER_FIRST_RUN_CHECKLIST.md - heading Manual install SoundFont FluidSynth FFmpeg
  echo.
  exit /b 1
)

REM --- No choco but winget: bootstrap Chocolatey, then stop (new session needed for choco on PATH) ---
if not defined HAS_CHOCO if defined HAS_WINGET goto :bootstrap_choco

REM --- FluidSynth: prefer Chocolatey; winget often has no usable FluidSynth package ---
if defined HAS_CHOCO (
  echo [INFO] FluidSynth: choco install fluidsynth -y
  call choco install fluidsynth -y
  if errorlevel 1 (
    set "INSTALL_FAIL=1"
    echo [WARN] choco did not install fluidsynth. See output above.
  )
)

REM --- FFmpeg: winget Gyan.FFmpeg is reliable; else Chocolatey ---
if defined HAS_WINGET (
  echo [INFO] FFmpeg: winget install --id Gyan.FFmpeg -e
  call winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    set "INSTALL_FAIL=1"
    echo [WARN] winget did not install FFmpeg. Try: winget search ffmpeg
  )
) else (
  echo [INFO] FFmpeg: choco install ffmpeg -y
  call choco install ffmpeg -y
  if errorlevel 1 (
    set "INSTALL_FAIL=1"
    echo [WARN] choco did not install ffmpeg. See output above.
  )
)

echo.
echo [INFO] Post-check: verifying tools on PATH ...

where fluidsynth >nul 2>&1
if not errorlevel 1 (
  set "FLUIDSYNTH_OK=1"
  echo [PASS] FluidSynth found on PATH.
) else (
  where fluidsynth.exe >nul 2>&1
  if not errorlevel 1 (
    set "FLUIDSYNTH_OK=1"
    echo [PASS] FluidSynth found as fluidsynth.exe on PATH.
  ) else (
    echo [MISSING] FluidSynth still not found on PATH.
  )
)

where ffmpeg >nul 2>&1
if not errorlevel 1 (
  set "FFMPEG_OK=1"
  echo [PASS] FFmpeg found on PATH.
) else (
  where ffmpeg.exe >nul 2>&1
  if not errorlevel 1 (
    set "FFMPEG_OK=1"
    echo [PASS] FFmpeg found as ffmpeg.exe on PATH.
  ) else (
    echo [WARN] FFmpeg still not on PATH - MP3 and some conversions may fail. WAV may still work.
  )
)

echo.
if defined INSTALL_FAIL echo [WARN] One or more install steps reported an error above.

if defined FLUIDSYNTH_OK goto :check_ff_outcome
if defined FFMPEG_OK goto :partial_ffmpeg_only
echo [FAIL] FluidSynth and FFmpeg are still not available.
echo.
echo Next step:
echo   - Fix errors above, or install Chocolatey for FluidSynth, then re-run this helper.
echo   - Run: python scripts/beginner_preflight.py
echo   - Manual steps: docs\BEGINNER_FIRST_RUN_CHECKLIST.md - heading Manual install SoundFont FluidSynth FFmpeg
exit /b 1

:partial_ffmpeg_only
echo [PARTIAL] FFmpeg looks ready; FluidSynth is still missing.
echo.
echo Next step:
echo   - Install FluidSynth via Chocolatey or manually, then re-run this helper.
echo   - Run: python scripts/beginner_preflight.py
echo   - Manual steps: docs\BEGINNER_FIRST_RUN_CHECKLIST.md - heading Manual install SoundFont FluidSynth FFmpeg
exit /b 1

:bootstrap_choco
echo [INFO] Chocolatey is not on PATH in this session, but winget is available.
echo [INFO] Attempting: winget install Chocolatey (needed for a reliable FluidSynth install).
echo.
call winget install --id Chocolatey.Chocolatey -e --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo.
  echo [WARN] winget did not complete the Chocolatey install. See output above.
  echo         You may need an Administrator terminal, or install manually from https://chocolatey.org/install
)
echo.
echo [INFO] Stopping here on purpose: even after a successful install, choco may not work in THIS window.
echo [INFO] Next steps:
echo   1. Close this window or open a NEW Command Prompt or PowerShell.
echo   2. Run beginner_install_audio_deps.bat again from this project folder.
echo   3. Then run beginner_launch.bat (or python scripts/beginner_preflight.py) as usual.
echo.
echo [INFO] This run did not install FluidSynth or FFmpeg yet, and did not run the final PATH checks.
exit /b 1

:check_ff_outcome
if not defined FFMPEG_OK goto :partial_fs_only
echo [OK] FluidSynth and FFmpeg look ready.
echo.
echo Next step:
echo   - You may need a NEW terminal so PATH updates apply.
echo   - Then rerun: beginner_launch.bat
echo   - Manual steps if anything still fails: docs\BEGINNER_FIRST_RUN_CHECKLIST.md
exit /b 0

:partial_fs_only
echo [PARTIAL] FluidSynth looks ready; FFmpeg is still missing.
echo.
echo Next step:
echo   - You may need a NEW terminal so PATH updates apply.
echo   - Rerun beginner_launch.bat. WAV may work; MP3 may fail without FFmpeg.
echo   - Manual steps: docs\BEGINNER_FIRST_RUN_CHECKLIST.md - heading Manual install SoundFont FluidSynth FFmpeg
exit /b 1
