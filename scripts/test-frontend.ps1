$ErrorActionPreference = 'Stop'

$frontendDir = Join-Path $PSScriptRoot '..\frontend'
Push-Location $frontendDir

try {
    node --check "js/app.js"
    node --check "js/jarvis.js"
    node --check "js/realtime.js"
    node --check "js/voice.js"
    node --check "js/pages.js"
    node --check "server.js"
    Write-Host "Frontend syntax checks passed."
}
finally {
    Pop-Location
}
