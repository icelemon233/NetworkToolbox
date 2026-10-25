param([string]$Dotnet = 'dotnet', [switch]$Package)
$ErrorActionPreference = 'Stop'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
if (-not $env:HTTPS_PROXY) {
  $currentProxy = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
  if ($currentProxy.ProxyEnable -eq 1 -and $currentProxy.ProxyServer -match '^(127\.0\.0\.1|localhost):[0-9]+$') {
    $env:HTTPS_PROXY = 'http://' + $currentProxy.ProxyServer
    $env:HTTP_PROXY = $env:HTTPS_PROXY
    $env:NODE_USE_ENV_PROXY = '1'
  }
}
if ($env:HTTPS_PROXY -or $env:HTTP_PROXY) { $env:NODE_USE_ENV_PROXY = '1' }
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
  pnpm exec install-electron
  if ($LASTEXITCODE -ne 0) { throw 'Electron installation failed' }
  & (Join-Path $PSScriptRoot 'prepare-window-frame.ps1')
  pnpm lint
  if ($LASTEXITCODE -ne 0) { throw 'Lint failed' }
  pnpm test
  if ($LASTEXITCODE -ne 0) { throw 'Renderer tests failed' }
  pnpm build
  if ($LASTEXITCODE -ne 0) { throw 'Renderer build failed' }
  & $Dotnet restore native/NetworkToolbox.Native.csproj --locked-mode
  if ($LASTEXITCODE -ne 0) { throw 'Native restore failed' }
  & $Dotnet publish native/NetworkToolbox.Native.csproj -c Release --no-restore -o native/publish -p:DebugType=None -p:DebugSymbols=false
  if ($LASTEXITCODE -ne 0) { throw 'Native publish failed' }
  & '.\native\publish\NetworkToolbox.Native.exe' --self-test
  if ($LASTEXITCODE -ne 0) { throw 'Native tests failed' }
  if ($Package) {
    pnpm package
    if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed' }
    node scripts/verify-package.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Packaged identity or icon validation failed' }
  }
} finally { Pop-Location }
