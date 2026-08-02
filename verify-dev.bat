@echo off
setlocal

title CX Well Log Processor - Verification
cd /d "%~dp0"
set "PYTHONNOUSERSITE=1"
set "WELLLOG_NONINTERACTIVE=1"

if defined NO_PROXY (
    set "NO_PROXY=127.0.0.1,localhost,%NO_PROXY%"
) else (
    set "NO_PROXY=127.0.0.1,localhost"
)

call conda run -n cx_well_log_backend python -c "import fastapi, lasio, numpy, welllog_engine, sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)"
if errorlevel 1 goto :failed

call conda run -n cx_well_log_backend python -m pip check
if errorlevel 1 goto :failed

call conda run --no-capture-output -n cx_well_log_backend corepack pnpm check
if errorlevel 1 goto :failed

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\smoke-test-dev.ps1"
if errorlevel 1 goto :failed

echo.
echo All development-environment checks passed.
exit /b 0

:failed
echo.
echo Development-environment verification failed.
if not defined WELLLOG_NONINTERACTIVE pause
exit /b 1
