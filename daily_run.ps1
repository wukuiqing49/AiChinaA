[CmdletBinding()]
param(
    [ValidateRange(1, 16)]
    [int]$Workers = 2,
    [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Import-LocalEnvironment([string]$Path) {
    if (-not (Test-Path $Path)) {
        throw "Missing $Path. Copy .env.example to .env and set the publish values."
    }

    foreach ($line in Get-Content $Path) {
        if ($line -match '^\s*(#|$)') {
            continue
        }
        if ($line -notmatch '^\s*([^=\s]+)\s*=\s*(.*)\s*$') {
            throw "Invalid .env entry: $line"
        }
        Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
    }
}

function Invoke-PipelineStep([string]$Label, [string[]]$Arguments) {
    Write-Host "`n[$Label]"
    & $python @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

Import-LocalEnvironment (Join-Path $root ".env")
foreach ($name in "PUBLISH_URL", "PUBLISH_SECRET") {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
        throw "$name is required in .env."
    }
}

$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    throw "Python environment is missing: $python"
}

Invoke-PipelineStep "1/4 Refresh instrument names" @(
    "-m", "pipeline.jobs.download_history", "--data-dir", "data/historical", "--repair-names"
)

if (-not $SkipDownload) {
    Invoke-PipelineStep "2/4 Download incremental history" @(
        "-m", "pipeline.jobs.download_history", "--data-dir", "data/historical",
        "--incremental", "--workers", $Workers
    )
}

Invoke-PipelineStep "3/4 Build screener package" @(
    "-m", "pipeline.jobs.build_screener", "--data-dir", "data/historical",
    "--output", "reports/screener-publish.json", "--workers", $Workers
)

Invoke-PipelineStep "4/4 Publish to Worker" @(
    "-m", "pipeline.jobs.publish_screener", "--input", "reports/screener-publish.json"
)

Write-Host "`nDaily update and publish completed."
