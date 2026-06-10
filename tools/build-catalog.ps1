param(
  [string]$SourceDirectory = ".cache\brick-db",
  [string]$OutputDirectory = "data\catalog"
)

$ErrorActionPreference = "Stop"

$categoryGroups = @{
  bricks = @(4, 5, 6, 11, 16, 20, 23, 37, 47)
  plates = @(1, 9, 14, 21, 49)
  tiles = @(15, 19, 67)
  slopes = @(3)
  technic = @(8, 12, 17, 22, 25, 26, 40, 44, 45, 46, 51, 52, 53, 54, 55)
  minifigures = @(13, 27, 59, 60, 61, 62, 63, 64, 65, 70, 71, 72, 73)
}

$categoryNames = @{}
Import-Csv (Join-Path $SourceDirectory "part_categories.csv") | ForEach-Object {
  $categoryNames[[int]$_.id] = $_.name
}

function Get-CategoryGroup([int]$CategoryId) {
  foreach ($entry in $categoryGroups.GetEnumerator()) {
    if ($entry.Value -contains $CategoryId) {
      return $entry.Key
    }
  }
  return "special"
}

function Get-Shard([string]$PartNumber) {
  $normalized = $PartNumber.ToLowerInvariant() -replace "[^a-z0-9]", "_"
  return ($normalized + "___").Substring(0, 3)
}

$shards = @{}
$totalParts = 0

Import-Csv (Join-Path $SourceDirectory "parts.csv") | ForEach-Object {
  if (-not $_.part_num -or -not $_.name) {
    return
  }

  $categoryId = [int]$_.part_cat_id
  $shard = Get-Shard $_.part_num
  if (-not $shards.ContainsKey($shard)) {
    $shards[$shard] = @()
  }

  $shards[$shard] += ,@(
    $_.part_num,
    $_.name,
    (Get-CategoryGroup $categoryId),
    $(if ($categoryNames.ContainsKey($categoryId)) { $categoryNames[$categoryId] } else { "Other" }),
    $(if ($_.part_material) { $_.part_material } else { "Unknown" })
  )
  $totalParts += 1
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

foreach ($entry in $shards.GetEnumerator()) {
  $json = ConvertTo-Json -InputObject @($entry.Value) -Depth 4 -Compress
  Set-Content -LiteralPath (Join-Path $OutputDirectory "$($entry.Key).json") -Value $json -Encoding UTF8
}

$manifest = [ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString("o")
  source = "BrickKeeper_DB/parts.csv"
  totalParts = $totalParts
  shards = @($shards.Keys | Sort-Object)
}

Set-Content -LiteralPath (Join-Path $OutputDirectory "manifest.json") `
  -Value (ConvertTo-Json $manifest -Depth 3) -Encoding UTF8

Write-Output "Built $($shards.Count) shards with $totalParts parts."
