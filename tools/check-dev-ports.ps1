$requiredPorts = 8765, 5174
$blockedPorts = @()

foreach ($port in $requiredPorts) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        $blockedPorts += [pscustomobject]@{
            Port = $port
            ProcessId = $listener.OwningProcess
            ProcessName = $process.Name
            CommandLine = $process.CommandLine
        }
    }
}

if ($blockedPorts.Count -eq 0) {
    exit 0
}

Write-Host "ERROR: Required development ports are already in use."
foreach ($blockedPort in $blockedPorts) {
    Write-Host ""
    Write-Host "Port $($blockedPort.Port): $($blockedPort.ProcessName) (PID $($blockedPort.ProcessId))"
    Write-Host $blockedPort.CommandLine
}
exit 1
