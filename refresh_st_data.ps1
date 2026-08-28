[CmdletBinding()]
param(
    [ValidateRange(1, 16)]
    [int]$Workers = 4,
    [switch]$SkipDeploy
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

function Invoke-Step([string]$Label, [scriptblock]$Action) {
    Write-Host "`n[$Label]"
    & $Action
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

if (-not $SkipDeploy) {
    Invoke-Step "Apply D1 schema and deploy searchable ST support" {
        Push-Location (Join-Path $root "worker")
        try {
            npx wrangler d1 migrations apply quant-core --remote
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            npx wrangler deploy
        } finally {
            Pop-Location
        }
    }
}

Invoke-Step "Repair instrument names" {
    & $python -m pipeline.jobs.download_history --data-dir data/historical --repair-names
}

Invoke-Step "Download incremental history including ST stocks" {
    & $python -m pipeline.jobs.download_history --data-dir data/historical --incremental --st-only --workers $Workers
}

Invoke-Step "Fetch realtime quotes with Tencent/Sina fallback" {
    & $python -m pipeline.jobs.fetch_realtime_quotes --data-dir data/historical
}

Invoke-Step "Build screener and analysis package" {
    & $python -m pipeline.jobs.build_screener --data-dir data/historical --output reports/screener-publish.json --workers $Workers
}

Invoke-Step "Publish searchable ST data" {
    & $python -m pipeline.jobs.publish_screener --input reports/screener-publish.json --run-kind supplemental_st
}

Write-Host "`nST data refresh completed. Default screening hides ST; code/name search includes ST."
