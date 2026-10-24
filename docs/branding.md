# NetworkToolbox identity

NetworkToolbox belongs to the Cinna application series. Product name: `NetworkToolbox`; developer, company and publisher: `Cinna`. The application interface remains Simplified Chinese.

Keep app ID `local.network.toolbox`, user-data folder `%APPDATA%\NetworkToolbox`, native protocol namespace and existing local-storage keys stable. The package version is the version source; `pnpm assets` derives native version properties from it before compilation.

The confirmed Cinna portrait is preserved at `assets/cinna-portrait-source.png`. `scripts/icon.mjs` places it on milk-cloud blue (`#A8DFF1`) and exports a 1024 px square master, rounded UI and README PNGs, a tray crop and ICO layers at 16/20/24/32/40/48/64/128/256 px. README alpha uses a 112 px corner radius at 512 px. This is deterministic resizing and compositing of the confirmed asset; no replacement character was generated.

`assets/brand-manifest.json` records source, master and derived hashes. Packaging rejects stale product identity or changed derived image hashes. Frontend imports use Vite content hashes. The Electron window, tray, notification, main executable, native helper, NSIS installer and uninstaller reference these resources. Build-only masters and source artwork are excluded from the installed application.

Shared theme variables live in `src/theme.css`. Milk-cloud blue, cream (`#FFFCF6`) and cocoa (`#46332A`) define the light palette; the dark palette keeps readable text, controls and chart roles. Existing React components and Lucide functional icons remain in use.
