param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,
  [string]$OutputDirectory = "data\sets"
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path $SourceDirectory).Path
$output = Join-Path (Get-Location) $OutputDirectory
$partsOutput = Join-Path $output "parts"
$photosOutput = Join-Path $output "photos"

New-Item -ItemType Directory -Force -Path $output, $partsOutput, $photosOutput | Out-Null

# The inventory table maps a human set number to the numeric inventory key
# used by inventory_parts.csv. Prefer the newest inventory version.
$inventoryBySet = @{}
Import-Csv (Join-Path $source "inventories.csv") | ForEach-Object {
  $version = [int]$_.version
  $current = $inventoryBySet[$_.set_num]
  if ($null -eq $current -or $version -gt $current.version) {
    $inventoryBySet[$_.set_num] = @{
      id = [int]$_.id
      version = $version
    }
  }
}

$sets = @(Import-Csv (Join-Path $source "sets.csv") | ForEach-Object {
  $inventory = $inventoryBySet[$_.set_num]
  if ($null -ne $inventory) {
    ,@(
      $_.set_num,
      $_.name,
      [int]$_.year,
      [int]$_.num_parts,
      $_.img_url,
      $inventory.id
    )
  }
})

$index = @{
  schemaVersion = 1
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sets = $sets
}
$index | ConvertTo-Json -Depth 4 -Compress |
  Set-Content -Path (Join-Path $output "index.json") -Encoding utf8

# Ten-thousand-ID groups reduce file count while preserving on-demand loading.
$partShard = @{}
$photoShards = @{}
$currentShard = $null
Get-Content (Join-Path $source "inventory_parts.csv") | Select-Object -Skip 1 | ForEach-Object {
    $line = $_
    $columns = $line -split ",", 6
    if ($columns.Count -eq 6 -and $columns[4] -ne "True") {
      $inventoryId = [int]$columns[0]
      $shardNumber = [int](($inventoryId - ($inventoryId % 10000)) / 10000)
      $shard = "{0:00}" -f $shardNumber
      if ($null -ne $currentShard -and $shard -ne $currentShard) {
        $partShard | ConvertTo-Json -Depth 5 -Compress |
          Set-Content -Path (Join-Path $partsOutput "$currentShard.json") -Encoding utf8
        $partShard = @{}
      }
      $currentShard = $shard

      $key = "$inventoryId"
      if (-not $partShard.ContainsKey($key)) {
        $partShard[$key] = @()
      }
      $partShard[$key] += ,@($columns[1], $columns[2], [int]$columns[3])

      if ($columns[5]) {
        $normalizedPart = $columns[1].ToLower() -replace "[^a-z0-9]", "_"
        $photoShard = "$($normalizedPart[0])"
        if (-not $photoShards.ContainsKey($photoShard)) { $photoShards[$photoShard] = @{} }
        $photoKey = "$($columns[1].ToLower())|$($columns[2])"
        if (-not $photoShards[$photoShard].ContainsKey($photoKey)) {
          $photoShards[$photoShard][$photoKey] = $columns[5]
        }
      }
    }
}

if ($null -ne $currentShard) {
  $partShard | ConvertTo-Json -Depth 5 -Compress |
    Set-Content -Path (Join-Path $partsOutput "$currentShard.json") -Encoding utf8
}

foreach ($entry in $photoShards.GetEnumerator()) {
  $entry.Value | ConvertTo-Json -Compress |
    Set-Content -Path (Join-Path $photosOutput "$($entry.Key).json") -Encoding utf8
}

Write-Output "Generated $($sets.Count) sets, part shards and photo shards in $output"
