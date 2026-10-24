# NetworkToolbox

Cinna-series application; product name NetworkToolbox, developer Cinna. Keep app ID `local.network.toolbox`, user-data folder `NetworkToolbox` and existing persistence keys stable. Application artwork: `assets/cinna-network-source.png`, showing Cinna holding a Wi-Fi/Ethernet analyzer. The original portrait remains an identity reference. Run `pnpm assets` to export the master, ICO, tray, UI and README images and synchronize the native assembly version from package.json. Preserve the business prop at small sizes; packaging requires the `network-analyzer` variant and matching source/derived hashes.

Windows 11 x64 desktop application. React/TypeScript renderer, sandboxed Electron host, .NET 10 native worker over JSON-lines. Native commands are a fixed allowlist. No renderer shell or arbitrary filesystem API.

- `src/features/`: user-facing tools; `src/shared/`: contracts, native bridge, common controls and charts.
- Shared selectors use Radix Select through `src/shared/Select.tsx`; do not reintroduce visible native selects or per-page popup styles. `src/theme.css` owns UI tokens, `src/styles.css` owns shared Cinna styling. Lucide provides icons, not form controls. Preserve value callbacks, labels, keyboard navigation and required form validation when changing controls.
- `desktop/`: window/tray, file dialogs, IPC caller validation. No credentials in renderer storage.
- `native/`: native Wi-Fi, diagnostics, router adapter, local records and privileged operations. Changes require validated plans; elevation is on demand.
- All diagnostics are real. Unsupported, unavailable, permission denied and empty are different states. Never silently substitute sample data.
- Wi-Fi suggestions describe overlap risk, not measured spectrum noise. Signal units, AP-reported load and sample counts stay visible. Active scans must not contaminate latency statistics.
- SVG chart coordinates follow actual container width so labels stay readable; missing bandwidth is a position marker rather than an invented envelope. Keep IEEE vendor lookup offline and distinguish locally administered MAC addresses.
- Data is local under the app's user-data directory. Remembered credentials use Windows DPAPI. Reports omit secrets. Never commit live SSIDs, device addresses, tokens or scan records.
- Configuration plans and rollback snapshots use DPAPI as well. HTTP history and reports strip cookies, authorization and URL query values. Keep normal interactive results separate from sanitized history copies.

Validation: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; `dotnet build native/NetworkToolbox.Native.csproj`; native `--self-test`; real read-only Windows integration through `node scripts/native-smoke.mjs`. Extended live tests explicitly change and restore the user proxy bypass list, use external services, and must only run within an authorized real-machine test session. Keep test state under `.runtime/`. Never accept UAC or enter credentials through automation.

Exit waits for owned jobs and the native worker. The installer requests normal application exit and stops if processes remain; it must not force-kill them. Its generated removal list preserves unrelated files in the installation directory and leaves user data intact.
