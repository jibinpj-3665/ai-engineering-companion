$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$frontendDist = Join-Path $root "frontend\dist"
$venvPython = Join-Path $backend ".venv\Scripts\python.exe"
$output = Join-Path $root "dist-backend"
$work = Join-Path $root "build\pyinstaller"
$spec = Join-Path $root "build"

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Python virtual environment not found at $venvPython. Create it with: python -m venv backend\.venv"
}

if (-not (Test-Path -LiteralPath (Join-Path $frontendDist "index.html"))) {
    Write-Host "Frontend build not found. Building the frontend first..." -ForegroundColor Yellow
    Push-Location $root
    try {
        & npm --prefix frontend run build
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
    } finally {
        Pop-Location
    }
}

if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Path $output -Force | Out-Null
New-Item -ItemType Directory -Path $work -Force | Out-Null

Write-Host "Building self-contained backend executable with PyInstaller..." -ForegroundColor Cyan
$arguments = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onefile",
    "--name", "ai-engineering-companion-backend",
    "--distpath", $output,
    "--workpath", $work,
    "--specpath", $spec,
    "--paths", $backend,
    "--add-data", "$frontendDist;frontend/dist",
    "--icon", (Join-Path $root "assets\icon.ico"),
    "--collect-all", "uvicorn",
    "--collect-all", "pymupdf",
    "--collect-all", "docx",
    "--collect-all", "pptx",
    "--collect-all", "pytesseract",
    "--collect-submodules", "app",
    "--hidden-import", "PIL._tkinter_finder",
    "--hidden-import", "uvicorn.logging",
    "--hidden-import", "uvicorn.loops.auto",
    "--hidden-import", "uvicorn.protocols.http.auto",
    "--hidden-import", "uvicorn.protocols.websockets.auto",
    "--hidden-import", "uvicorn.lifespan.on",
    (Join-Path $backend "run.py")
)

Push-Location $root
try {
    & $venvPython @arguments
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed with exit code $LASTEXITCODE." }
} finally {
    Pop-Location
}

$executable = Join-Path $output "ai-engineering-companion-backend.exe"
if (-not (Test-Path -LiteralPath $executable)) {
    throw "Expected executable was not produced: $executable"
}

$sizeMb = [math]::Round((Get-Item -LiteralPath $executable).Length / 1MB, 1)
Write-Host "Backend built successfully: $executable ($sizeMb MB)" -ForegroundColor Green
