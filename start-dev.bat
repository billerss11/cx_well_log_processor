@echo off
setlocal

title CX Well Log Processor - Development
cd /d "%~dp0"
set "PYTHONNOUSERSITE=1"

if defined NO_PROXY (
    set "NO_PROXY=127.0.0.1,localhost,%NO_PROXY%"
) else (
    set "NO_PROXY=127.0.0.1,localhost"
)

where conda >nul 2>&1
if errorlevel 1 (
    echo ERROR: Conda was not found on PATH.
    echo Install or initialize Conda, then try again.
    if not defined WELLLOG_NONINTERACTIVE pause
    exit /b 1
)

where corepack >nul 2>&1
if errorlevel 1 (
    echo ERROR: Corepack was not found on PATH.
    echo Install Node.js 22 or newer with Corepack, then try again.
    if not defined WELLLOG_NONINTERACTIVE pause
    exit /b 1
)

if not exist "node_modules" (
    echo ERROR: JavaScript dependencies are not installed.
    echo Run setup-dev.bat, then try again.
    if not defined WELLLOG_NONINTERACTIVE pause
    exit /b 1
)

call conda run -n cx_well_log_backend python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)" >nul 2>&1
if errorlevel 1 (
    echo ERROR: Conda environment cx_well_log_backend is missing or is not using Python 3.11.
    echo Run setup-dev.bat, then try again.
    if not defined WELLLOG_NONINTERACTIVE pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\check-dev-ports.ps1"
if errorlevel 1 (
    if not defined WELLLOG_NONINTERACTIVE pause
    exit /b 1
)

echo Starting the Python API, Vite, and Electron...
echo Press Ctrl+C to stop everything.
echo.

call conda run --no-capture-output -n cx_well_log_backend corepack pnpm dev
set "dev_exit_code=%ERRORLEVEL%"

if not "%dev_exit_code%"=="0" (
    echo.
    echo Development services stopped with error code %dev_exit_code%.
    if not defined WELLLOG_NONINTERACTIVE pause
)

exit /b %dev_exit_code%
