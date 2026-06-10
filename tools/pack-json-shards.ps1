param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [ValidateSet("array", "object")]
  [string]$ContainerType,
  [ValidateRange(1, 3)]
  [int]$GroupLength
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path $SourceDirectory).Path
$output = Join-Path (Get-Location) $OutputDirectory
$groups = @{}

New-Item -ItemType Directory -Force -Path $output | Out-Null
Get-ChildItem -LiteralPath $output -Filter "*.json" -File | Remove-Item -Force

# Merge raw JSON fragments instead of parsing the entire reference database.
Get-ChildItem -LiteralPath $source -Filter "*.json" -File |
  Where-Object Name -ne "manifest.json" |
  ForEach-Object {
    $group = ($_.BaseName + "___").Substring(0, $GroupLength)
    $raw = ((Get-Content -LiteralPath $_.FullName -Raw) -replace "^\uFEFF", "").Trim()
    $fragment = if ($raw.Length -gt 2) {
      $raw.Substring(1, $raw.Length - 2)
    } else {
      ""
    }

    if ($fragment) {
      if (-not $groups.ContainsKey($group)) { $groups[$group] = @() }
      $groups[$group] += $fragment
    }
  }

$opening = if ($ContainerType -eq "array") { "[" } else { "{" }
$closing = if ($ContainerType -eq "array") { "]" } else { "}" }
foreach ($entry in $groups.GetEnumerator()) {
  Set-Content -LiteralPath (Join-Path $output "$($entry.Key).json") `
    -Value ($opening + ($entry.Value -join ",") + $closing) `
    -Encoding UTF8 -NoNewline
}

$manifestPath = Join-Path $source "manifest.json"
if (Test-Path $manifestPath) {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $packedManifest = [ordered]@{
    schemaVersion = $manifest.schemaVersion
    generatedAt = $manifest.generatedAt
    source = $manifest.source
    totalParts = $manifest.totalParts
    shardStrategy = "first-character"
    shards = @($groups.Keys | Sort-Object)
  }
  Set-Content -LiteralPath (Join-Path $output "manifest.json") `
    -Value ($packedManifest | ConvertTo-Json -Depth 3) -Encoding UTF8
}

Write-Output "Packed $SourceDirectory into $($groups.Count) files in $OutputDirectory"
