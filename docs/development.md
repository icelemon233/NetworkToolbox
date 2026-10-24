# Development

Windows 11 x64, Node.js 24, pnpm 11.25.0 and .NET 10 SDK are the supported development target. Dependencies are locked.

```powershell
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm assets
pnpm lint
pnpm format:check
pnpm test
pnpm build
dotnet restore native/NetworkToolbox.Native.csproj --locked-mode
dotnet publish native/NetworkToolbox.Native.csproj -c Release --no-restore -o native/publish -p:DebugType=None -p:DebugSymbols=false
native/publish/NetworkToolbox.Native.exe --self-test
pnpm desktop
pnpm package
```

`scripts/build.ps1 -Package` runs the build, native self-tests and packaging. `-Dotnet <path>` selects an SDK. It can reuse an already configured Windows loopback proxy for this build process without changing Windows proxy settings.

`node scripts/native-smoke.mjs` uses real read-only Windows APIs and a short gateway Ping. `node scripts/native-extended-smoke.mjs` additionally uses external services and temporarily appends a reserved test host to the current-user proxy bypass list, then restores the encrypted snapshot and checks the result. Run it only in an authorized integration-test session. Optional text arguments filter its named checks. Test records stay under `.runtime/`, outside source deliverables.

`node scripts/preview.mjs` is a read-only localhost renderer preview. Packaged production requires the native bridge and does not substitute fixture data.

The NSIS hook uses a temporary copy of the native worker to ask the exact installed application to exit and wait for processes in that installation directory. It aborts on timeout; it does not kill processes. `desktop/after-pack.cjs` derives an explicit removal list from the packaged files. Unrelated installation-directory files and the stable user-data directory are preserved.

Keep source and lockfiles in Git. Dependencies, build output and live-test state are excluded. Distributable Windows binaries belong to a versioned GitHub Release with checksums; the release tag must point to its corresponding source commit. Preserve the documented distinction between live checks, protocol fixtures and unverified privileged or device operations.

Module and privacy rules are in [AGENTS.md](../AGENTS.md). The Windows CI performs source checks; final portable/installer UI and privileged operations require separate machine verification.
