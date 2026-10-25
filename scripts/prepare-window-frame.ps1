$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$frameRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$frameWork=Join-Path $frameRoot ('.installer-build\frame-toolchain-'+[Guid]::NewGuid().ToString('N'))
& (Join-Path $frameRoot 'installer\inno\ui\build.ps1') -OutputDirectory $frameWork | Write-Host
$frameCompiler=if($env:CINNA_ZIG){$env:CINNA_ZIG}else{Join-Path $frameRoot '.deps\zig-x86_64-windows-0.15.2\zig.exe'}
$env:ZIG=$frameCompiler
& node (Join-Path $PSScriptRoot 'build-window-frame.mjs')
if($LASTEXITCODE -ne 0){throw 'Native window module build failed.'}
