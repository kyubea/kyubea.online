<#
  Build a clean "dist" folder containing only the whitelisted site files
  and create a zip (dist.zip) ready for upload to Nekoweb.

  Usage (PowerShell):
    ./tools/make-dist.ps1

  Requirements:
    - Windows PowerShell 5.1 or PowerShell 7+
    - No external modules required
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path "$PSScriptRoot\..\").Path
$distDir  = Join-Path $repoRoot 'dist'
$zipPath  = Join-Path $repoRoot 'dist.zip'
$whitelist = Get-Content (Join-Path $PSScriptRoot 'deploy_whitelist.txt') | Where-Object { $_ -and $_.Trim() -ne '' -and (-not $_.Trim().StartsWith('#')) }

Write-Host "Repo root: $repoRoot"
Write-Host "Dist dir : $distDir"

if (Test-Path $distDir) { Remove-Item -Recurse -Force $distDir }
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

function Copy-WhitelistItem {
  param(
    [string]$item
  )
  $srcPath = Join-Path $repoRoot $item
  if ($item.EndsWith('/')) {
    # folder
    $srcFolder = $srcPath.TrimEnd('/','\\')
    if (-not (Test-Path $srcFolder)) {
      Write-Warning "Missing folder: $item"
      return
    }
    $destFolder = Join-Path $distDir (Split-Path -NoQualifier $srcFolder)
    Copy-Item -Path $srcFolder -Destination $destFolder -Recurse -Force
  } else {
    # file
    if (-not (Test-Path $srcPath)) {
      Write-Warning "Missing file: $item"
      return
    }
    $destFile = Join-Path $distDir $item
    $destParent = Split-Path -Parent $destFile
    if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Force -Path $destParent | Out-Null }
    Copy-Item -Path $srcPath -Destination $destFile -Force
  }
}

foreach ($line in $whitelist) {
  Copy-WhitelistItem -item $line.Trim()
}

# write a simple VERSION stamp with date-time for quick identification
$versionStamp = (Get-Date).ToString('yyyy.MM.dd-HHmmss')
Set-Content -Path (Join-Path $distDir 'VERSION') -Value $versionStamp -Encoding UTF8

# create zip
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path (Join-Path $distDir '*') -DestinationPath $zipPath -Force

Write-Host "\nDist ready: $distDir"
Write-Host "Zip ready : $zipPath"
