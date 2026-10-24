param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$outputRoot = [IO.Path]::GetFullPath($Destination)
if ($outputRoot.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source export must be outside the application tree' }
if (Test-Path -LiteralPath $outputRoot) { throw 'Source export destination already exists' }
$targetRoot = Join-Path $outputRoot 'NetworkToolbox'
New-Item -ItemType Directory -Path $targetRoot | Out-Null
$excluded = @('node_modules','bin','obj','publish','.runtime','release','dist','.git','installer-files.nsh')
function Copy-SourceTree([string]$From, [string]$To) {
  foreach ($item in Get-ChildItem -LiteralPath $From -Force) {
    if ($excluded -contains $item.Name -or $item.Extension -eq '.user') { continue }
    $targetPath = Join-Path $To $item.Name
    if ($item.PSIsContainer) {
      New-Item -ItemType Directory -Path $targetPath | Out-Null
      Copy-SourceTree $item.FullName $targetPath
    } else { Copy-Item -LiteralPath $item.FullName -Destination $targetPath }
  }
}
Copy-SourceTree $sourceRoot $targetRoot
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($outputRoot, $outputRoot + '.zip', [IO.Compression.CompressionLevel]::Optimal, $false)
Get-Item -LiteralPath ($outputRoot + '.zip') | Select-Object Name, Length
