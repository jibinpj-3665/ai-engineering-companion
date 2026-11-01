param(
    [int]$Port = 8901,
    [string]$EvidencePath = "",
    [string]$VerifyScript = "",
    [string]$Python = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "dist-backend\ai-engineering-companion-backend.exe"

if (-not $EvidencePath) {
    $EvidencePath = Join-Path $root "release\v1.3.0-evidence\packaged-runtime-http-verification.json"
}
if (-not $VerifyScript) {
    $VerifyScript = Join-Path $env:TEMP "opencode\release_runtime_http_verify.py"
}
if (-not $Python) {
    $Python = Join-Path $root "backend\.venv\Scripts\python.exe"
}

foreach ($path in @($exe, $VerifyScript, $Python)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required file not found: $path"
    }
}

$runDir = Join-Path $env:TEMP ("aec-packaged-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
$stdoutPath = Join-Path $runDir "backend.stdout.log"
$stderrPath = Join-Path $runDir "backend.stderr.log"
$baseUrl = "http://127.0.0.1:$Port"

$env:AEC_REQUIRE_AUTH = "1"
$env:AEC_ALLOW_REGISTRATION = "1"
$env:AIEC_DATA_DIR = $runDir
$env:AEC_PORT = [string]$Port
$env:AEC_RUNTIME_BASE = $baseUrl
$env:AEC_RUNTIME_EVIDENCE = $EvidencePath
Remove-Item Env:AEC_STATIC_DIR -ErrorAction SilentlyContinue
Remove-Item Env:AEC_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:AEC_WEB_PASSWORD -ErrorAction SilentlyContinue

$process = $null
$verifyExit = 1
try {
    $process = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

    $ready = $false
    $health = $null
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if ($process.HasExited) {
            throw "Packaged backend exited before becoming ready with code $($process.ExitCode)."
        }
        try {
            $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2
            if ($health.status -eq "ok") {
                $ready = $true
                break
            }
        } catch {
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not $ready) {
        throw "Packaged backend did not become ready at $baseUrl."
    }
    if ($health.auth_required -ne $true) {
        throw "Packaged backend started in local mode. Refusing to run account-security smoke tests."
    }

    & $Python $VerifyScript
    $verifyExit = $LASTEXITCODE
} catch {
    Write-Host "SMOKE ERROR: $($_.Exception.Message)" -ForegroundColor Red
    $verifyExit = 1
} finally {
    $backendIds = @()
    if ($process -and -not $process.HasExited) {
        $backendIds += $process.Id
    }
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        $backendIds += @($listener | Select-Object -ExpandProperty OwningProcess)
    }
    foreach ($backendId in ($backendIds | Sort-Object -Unique)) {
        try {
            & taskkill /PID $backendId /T /F 2>$null | Out-Null
        } catch {
            Write-Host "WARNING: Failed to stop packaged backend process $backendId : $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    if ($process) {
        try {
            $process.WaitForExit(5000) | Out-Null
        } catch {
        }
    }

    Write-Host "Smoke run data and diagnostics: $runDir"
    if (Test-Path -LiteralPath $stderrPath) {
        $stderr = Get-Content -LiteralPath $stderrPath
        if ($stderr) {
            Write-Host "--- backend stderr (tail) ---"
            $stderr | Select-Object -Last 20
        }
    }
    if (Test-Path -LiteralPath $stdoutPath) {
        $stdout = Get-Content -LiteralPath $stdoutPath
        if ($stdout) {
            Write-Host "--- backend stdout (tail) ---"
            $stdout | Select-Object -Last 20
        }
    }
    Write-Host "Evidence: $EvidencePath"
}

exit $verifyExit
