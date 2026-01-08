<#
  Generate a manifest.json with SHA256 hashes for all files in the dist folder.
  Upload manifest.json alongside your site to verify the live version later.

  Usage:
    ./tools/make-manifest.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path "$PSScriptRoot\..\").Path
$distDir  = Join-Path $repoRoot 'dist'
$manifestPath = Join-Path $distDir 'manifest.json'

if (-not (Test-Path $distDir)) {
  Write-Error "dist folder not found. Run tools/make-dist.ps1 first."
}

$files = Get-ChildItem -Path $distDir -Recurse -File
$entries = @()
foreach ($f in $files) {
  $rel = Resolve-Path $f.FullName -Relative | ForEach-Object { $_.Replace('.\','') }
  $hash = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower()
  $entries += [PSCustomObject]@{ path = $rel; sha256 = $hash }
}

$json = $entries | ConvertTo-Json -Depth 3
Set-Content -Path $manifestPath -Value $json -Encoding UTF8

Write-Host "Manifest written: $manifestPath"
