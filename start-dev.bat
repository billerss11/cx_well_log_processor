@echo off
setlocal

title CX Well Log Processor - Development
cd /d "%~dp0"

where conda >nul 2>&1
if errorlevel 1 (
    echo ERROR: Conda was not found on PATH.
    echo Install or initialize Conda, then try again.
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
    echo ERROR: pnpm was not found on PATH.
    echo Install pnpm, then try again.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo ERROR: JavaScript dependencies are not installed.
    echo Run "pnpm install" in this folder, then try again.
    pause
    exit /b 1
)

echo Starting the Python API, Vite, and Electron...
echo Press Ctrl+C to stop everything.
echo.

call conda run --no-capture-output -n cx_well_log_backend pnpm dev
set "dev_exit_code=%ERRORLEVEL%"

if not "%dev_exit_code%"=="0" (
    echo.
    echo Development services stopped with error code %dev_exit_code%.
    pause
)

exit /b %dev_exit_code%
