@echo off
setlocal

title CX Well Log Processor - Setup
cd /d "%~dp0"
set "PYTHONNOUSERSITE=1"

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js was not found on PATH.
    goto :failed
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
    echo ERROR: Node.js 22 or newer is required.
    goto :failed
)

where corepack >nul 2>&1
if errorlevel 1 (
    echo ERROR: Corepack was not found on PATH.
    echo Install Node.js 22 with Corepack, then try again.
    goto :failed
)

set "pnpm_version="
for /f "delims=" %%V in ('corepack pnpm --version 2^>nul') do set "pnpm_version=%%V"
if not "%pnpm_version%"=="10.6.2" (
    echo ERROR: Expected pnpm 10.6.2 through Corepack, but found %pnpm_version%.
    goto :failed
)

where conda >nul 2>&1
if errorlevel 1 (
    echo ERROR: Conda was not found on PATH.
    goto :failed
)

call conda run -n cx_well_log_backend python --version >nul 2>&1
if errorlevel 1 (
    echo Creating Conda environment cx_well_log_backend...
    call conda env create --file environment.yml
    if errorlevel 1 goto :failed
)

call conda run -n cx_well_log_backend python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)" >nul 2>&1
if errorlevel 1 (
    echo ERROR: Existing Conda environment cx_well_log_backend is not using Python 3.11.
    echo Remove or rename that environment manually, then rerun setup-dev.bat.
    goto :failed
)

echo Installing frozen Python dependencies...
call conda run --no-capture-output -n cx_well_log_backend python -m pip install --requirement "python\requirements-dev.lock.txt"
if errorlevel 1 goto :failed

call conda run --no-capture-output -n cx_well_log_backend python -m pip install --no-deps --editable ".\python"
if errorlevel 1 goto :failed

echo Installing frozen JavaScript dependencies...
call corepack pnpm install --frozen-lockfile
if errorlevel 1 goto :failed

call conda run -n cx_well_log_backend welllog doctor --output json
if errorlevel 1 goto :failed

echo.
echo Development setup completed successfully.
echo Run verify-dev.bat to execute all local checks.
echo Run start-dev.bat to start the application.
exit /b 0

:failed
echo.
echo Development setup failed. Review the error above.
if not defined WELLLOG_NONINTERACTIVE pause
exit /b 1
