param(
  [string]$CompilerPath = $env:INNOSETUP_ISCC,
  [string]$QaRoot,
  [string]$OutputFile
)
$ErrorActionPreference = 'Stop'
$toolboxRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolboxVersion = (Get-Content -LiteralPath (Join-Path $toolboxRoot 'package.json') -Raw | ConvertFrom-Json).version
if(-not $OutputFile){
  $OutputFile = if($QaRoot){Join-Path $QaRoot 'NetworkToolbox-inno-qa.exe'}else{Join-Path $toolboxRoot ('release\NetworkToolbox-Setup-'+$toolboxVersion+'.exe')}
}
& (Join-Path $toolboxRoot 'installer\inno\build.ps1') -PayloadDirectory (Join-Path $toolboxRoot 'release\win-unpacked') -Version $toolboxVersion -OutputFile $OutputFile -CompilerPath $CompilerPath -QaRoot $QaRoot
