param(
    [int]$TimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$stdoutPath = Join-Path $env:TEMP "cx-well-log-smoke-$PID.stdout.log"
$stderrPath = Join-Path $env:TEMP "cx-well-log-smoke-$PID.stderr.log"
$launcher = $null
$passed = $false

function Test-LocalUrl {
    param([string]$Url)

    & curl.exe --noproxy "*" --silent --fail --output NUL $Url
    return $LASTEXITCODE -eq 0
}

try {
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File (Join-Path $PSScriptRoot "check-dev-ports.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "Required development ports are unavailable."
    }

    $env:WELLLOG_NONINTERACTIVE = "1"
    $env:PYTHONNOUSERSITE = "1"
    $env:NO_PROXY = "127.0.0.1,localhost"

    $launcher = Start-Process `
        -FilePath "cmd.exe" `
        -ArgumentList "/d", "/c", "call start-dev.bat" `
        -WorkingDirectory $repositoryRoot `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $apiReady = $false
    $rendererReady = $false

    while ((Get-Date) -lt $deadline) {
        if ($launcher.HasExited) {
            throw "The development launcher exited before the services became ready."
        }

        $apiReady = Test-LocalUrl "http://127.0.0.1:8765/api/v1/health"
        $rendererReady = Test-LocalUrl "http://127.0.0.1:5174/"
        if ($apiReady -and $rendererReady) {
            break
        }
        Start-Sleep -Seconds 1
    }

    if (-not $apiReady -or -not $rendererReady) {
        throw "The API and renderer did not become ready within $TimeoutSeconds seconds."
    }

    $electronDeadline = (Get-Date).AddSeconds(60)
    $electronProcess = $null
    while ((Get-Date) -lt $electronDeadline -and -not $electronProcess) {
        $electronProcess = Get-CimInstance Win32_Process | Where-Object {
            $_.Name -eq "electron.exe" -and
            $_.CommandLine -like "*$repositoryRoot*"
        } | Select-Object -First 1
        if (-not $electronProcess) {
            Start-Sleep -Seconds 1
        }
    }

    if (-not $electronProcess) {
        throw "Electron did not start after the API and renderer became ready."
    }

    Write-Host "API health check passed on port 8765."
    Write-Host "Vite renderer check passed on port 5174."
    Write-Host "Electron process check passed."
    $passed = $true
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    if (Test-Path $stdoutPath) {
        Write-Host ""
        Write-Host "Launcher output:"
        Get-Content -Tail 80 $stdoutPath
    }
    if (Test-Path $stderrPath) {
        Write-Host ""
        Write-Host "Launcher errors:"
        Get-Content -Tail 80 $stderrPath
    }
    exit 1
}
finally {
    if ($launcher) {
        & taskkill.exe /PID $launcher.Id /T /F *> $null
    }
    if ($passed) {
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "Smoke-test logs were kept at:"
        Write-Host $stdoutPath
        Write-Host $stderrPath
    }
}
