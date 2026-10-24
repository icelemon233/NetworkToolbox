# NetworkToolbox identity

NetworkToolbox belongs to the Cinna application series. Product name: `NetworkToolbox`; developer, company and publisher: `Cinna`. The application interface remains Simplified Chinese.

Keep app ID `local.network.toolbox`, user-data folder `%APPDATA%\NetworkToolbox`, native protocol namespace and existing local-storage keys stable. The package version is the version source; `pnpm assets` derives native version properties from it before compilation.

The application-specific artwork is preserved at `assets/cinna-network-source.png`: the same Cinna holding a cream/blue network tester with a Wi-Fi display, antenna and Ethernet connection. It was produced with the built-in image generation tool using the confirmed character and sibling app styles as references. The original portrait remains at `assets/cinna-portrait-source.png`; the generation prompt is saved at `assets/network-icon-prompt.txt`.

`scripts/icon.mjs` derives a 1024 px square master, rounded UI and README PNGs, a tray image and ICO layers at 16/20/24/32/40/48/64/128/256 px. Small exports keep the tester together with the character. README alpha uses a 112 px corner radius at 512 px.

`assets/brand-manifest.json` records the `network-analyzer` variant plus source, master and derived hashes. Packaging rejects the generic portrait variant, stale product identity or changed source/derived image hashes. Frontend imports use Vite content hashes. The Electron window, tray, notification, main executable, native helper, NSIS installer and uninstaller reference these resources. Build-only masters and source artwork are excluded from the installed application.

The installer gives desktop and Start menu shortcuts a versioned `resources/app-icon-<version>.ico` source and preserves the application ID. This avoids reusing a cached EXE icon after an artwork update. It refreshes existing shortcuts without recreating a shortcut the user removed, clearing global caches or restarting Explorer.

Shared theme variables live in `src/theme.css`. Cloud blue, cream (`#FFFCF6`) and cocoa (`#46332A`) define the light palette; dark surfaces use neutral charcoal (`#1B1D20`, `#24272B`). [Shared controls](controls.md) combine Radix Select behavior with Cinna styling and Lucide action icons.
