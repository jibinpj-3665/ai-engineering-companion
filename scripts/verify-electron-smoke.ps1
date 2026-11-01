param(
    [string]$AppPath = "",
    [string]$EvidencePath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $AppPath) {
    $AppPath = Join-Path $root "release\win-unpacked\AI Engineering Companion.exe"
}
if (-not $EvidencePath) {
    $EvidencePath = Join-Path $root "release\v1.3.0-evidence\electron-smoke-verification.json"
}
$screenshot = Join-Path $root "release\v1.3.0-evidence\electron-packaged-dashboard.png"
$electron = Join-Path $root "node_modules\.bin\electron.cmd"
$captureScript = Join-Path $root "scripts\screenshot.js"

foreach ($path in @($AppPath, $electron, $captureScript)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required file not found: $path"
    }
}

$runDir = Join-Path $env:TEMP ("aec-electron-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
$logPath = Join-Path $runDir "logs\electron.log"

$env:AIEC_DATA_DIR = $runDir
Remove-Item Env:AEC_REQUIRE_AUTH -ErrorAction SilentlyContinue
Remove-Item Env:AEC_ALLOW_REGISTRATION -ErrorAction SilentlyContinue
Remove-Item Env:AEC_STATIC_DIR -ErrorAction SilentlyContinue
Remove-Item Env:AEC_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:AEC_WEB_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:AEC_PORT -ErrorAction SilentlyContinue

$process = $null
$backendPort = 0
$health = $null
$ok = $false
$failure = ""
try {
    $process = Start-Process -FilePath $AppPath -PassThru

    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        if ($process.HasExited) {
            throw "Packaged Electron app exited early with code $($process.ExitCode)."
        }
        if (Test-Path -LiteralPath $logPath) {
            $log = Get-Content -LiteralPath $logPath -Raw
            if ($log -match "Startup failure:\s*(.+)") {
                throw "Electron reported a startup failure: $($Matches[1])"
            }
            $match = [regex]::Match($log, "Loading interface: http://127\.0\.0\.1:(\d+)")
            if ($match.Success) {
                $backendPort = [int]$match.Groups[1].Value
                break
            }
            $match = [regex]::Match($log, "Starting backend: .+ on port (\d+)")
            if ($match.Success) {
                $backendPort = [int]$match.Groups[1].Value
            }
        }
        Start-Sleep -Milliseconds 500
    }
    if ($backendPort -le 0) {
        throw "Could not determine the Electron backend port from $logPath."
    }

    $healthDeadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $healthDeadline) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$backendPort/api/health" -TimeoutSec 2
            if ($health.status -eq "ok") {
                break
            }
        } catch {
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $health -or $health.status -ne "ok") {
        throw "Electron backend did not become healthy on port $backendPort."
    }
    if ($health.mode -ne "desktop") {
        throw "Electron backend did not serve the embedded desktop interface."
    }

    $env:AEC_SCREENSHOT_URL = "http://127.0.0.1:$backendPort"
    $env:AEC_SCREENSHOT_OUT = $screenshot
    $env:AEC_SCREENSHOT_WIDTH = "1440"
    $env:AEC_SCREENSHOT_HEIGHT = "920"
    & $electron $captureScript
    if ($LASTEXITCODE -ne 0) {
        throw "Electron screenshot verification failed with exit code $LASTEXITCODE."
    }
    if (-not (Test-Path -LiteralPath $screenshot)) {
        throw "Screenshot was not produced: $screenshot"
    }
    $screenshotBytes = (Get-Item -LiteralPath $screenshot).Length
    if ($screenshotBytes -lt 20000) {
        throw "Screenshot is unexpectedly small ($screenshotBytes bytes)."
    }
    $ok = $true
} catch {
    $failure = $_.Exception.Message
    Write-Host "ELECTRON SMOKE ERROR: $failure" -ForegroundColor Red
} finally {
    $backendIds = @()
    if ($process -and -not $process.HasExited) {
        $backendIds += $process.Id
    }
    if ($backendPort -gt 0) {
        $listener = Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue
        if ($listener) {
            $backendIds += @($listener | Select-Object -ExpandProperty OwningProcess)
        }
    }
    foreach ($backendId in ($backendIds | Sort-Object -Unique)) {
        try {
            & taskkill /PID $backendId /T /F 2>$null | Out-Null
        } catch {
        }
    }
    if ($process) {
        try {
            $process.WaitForExit(10000) | Out-Null
        } catch {
        }
    }
    Start-Sleep -Seconds 1

    $remaining = @()
    if ($backendPort -gt 0) {
        $listener = Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue
        if ($listener) {
            $remaining = @($listener | Select-Object -ExpandProperty OwningProcess)
        }
    }
    if ($remaining.Count -gt 0) {
        $ok = $false
        $failure = "Backend listener remained after Electron shutdown: $($remaining -join ', ')"
    }

    $payload = [ordered]@{
        ok = $ok
        app_path = $AppPath
        data_dir = $runDir
        electron_log = $logPath
        backend_port = $backendPort
        health = $health
        screenshot = $screenshot
        screenshot_bytes = if (Test-Path -LiteralPath $screenshot) { (Get-Item -LiteralPath $screenshot).Length } else { 0 }
        failure = $failure
    }
    $EvidencePathParent = Split-Path -Parent $EvidencePath
    if ($EvidencePathParent) {
        New-Item -ItemType Directory -Path $EvidencePathParent -Force | Out-Null
    }
    $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8

    Write-Host "Electron smoke data and diagnostics: $runDir"
    if (Test-Path -LiteralPath $logPath) {
        Write-Host "--- electron.log (tail) ---"
        Get-Content -LiteralPath $logPath | Select-Object -Last 30
    }
    Write-Host "Evidence: $EvidencePath"
}

if ($ok) {
    exit 0
}
exit 1
