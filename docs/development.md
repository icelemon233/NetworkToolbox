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

`pnpm package` builds a portable ZIP and an Inno Setup 7.1.0 installer. It does not use the NSIS or NSIS-portable targets. The [shared native installer](../installer/inno/README.md) always offers current-user/all-users installation, an editable destination and separate desktop/Start menu shortcut choices. It follows Windows light/dark appearance. The compiler is verified and extracted in portable mode.

The installer uses a temporary native worker to request normal exit of the exact installed app and waits for the app and worker before writing files. It stops on timeout. Silent setup refuses a running app unless `/CLOSEAPP` requests normal exit. The old registration and known uninstaller are retired after success. Inno's uninstall log removes owned files and preserves unrelated files and `%APPDATA%\\NetworkToolbox`.

Run `pwsh -File installer/inno/test.ps1 -PayloadDirectory release/win-unpacked -Version <version>` for isolated installation, shortcut, migration and uninstall checks. `scripts/build-installer.ps1 -QaRoot .runtime/inno-qa-<GUID>` creates a separate visible native installer. QA never installs shared runtimes or uses real application data. All-users UAC remains a separate interactive check.

Keep source and lockfiles in Git. Dependencies, build output and live-test state are excluded. Distributable Windows binaries belong to a versioned GitHub Release with checksums; the release tag must point to its corresponding source commit. Preserve the documented distinction between live checks, protocol fixtures and unverified privileged or device operations.

Module and privacy rules are in [AGENTS.md](../AGENTS.md). The Windows CI performs source checks; final portable/installer UI and privileged operations require separate machine verification.

The full-window scene, settings drawer, red cancellation button, completion actions and upgrade recovery share one implementation. Run `installer/inno/test-custom.ps1` alongside the existing installer tests. Current evidence and manual verification limits are in [custom-installer-validation.md](custom-installer-validation.md).
