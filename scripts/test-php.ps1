$ErrorActionPreference = 'Stop'

function Get-PhpExecutable {
    $candidates = @(
        $env:PHP_EXE,
        'C:\xampp\php\php.exe',
        'C:\php\php.exe'
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    $command = Get-Command php -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw 'PHP executable not found. Install XAMPP or set PHP_EXE.'
}

$phpExe = Get-PhpExecutable
$phpFiles = Get-ChildItem (Join-Path $PSScriptRoot '..\backend\php') -Recurse -Filter *.php | Sort-Object FullName

foreach ($file in $phpFiles) {
    & $phpExe -l $file.FullName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "PHP lint failed for $($file.FullName)"
    }
}

Write-Host "PHP lint checks passed."
