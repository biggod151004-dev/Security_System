$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'test-frontend.ps1')
& (Join-Path $PSScriptRoot 'test-php.ps1')

Write-Host "All available checks passed."
