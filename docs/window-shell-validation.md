# Window shell validation

The application adopts the approved Cinna window contract in `desktop/window-shell.json`. `pnpm assets` generates `src/window-shell.css` and the native startup theme metadata from project sources. The running application does not read local skills or visualization files.

The renderer owns the 44 DIP title bar and its 46 × 44 caption controls, including the approved glyphs and hover colors. The host retains the native thick frame and system corners. `desktop/win32/window-frame.c` subclasses only a window owned by the current process and UI thread. It returns real non-client hit codes and sends normal window system commands; Windows owns the drag and resize loops. The fixed native diagnostics command allowlist is unchanged.

Electron 45's existing resize targets included invisible input borders. At the actual 192 DPI, the original `GetWindowRect` was `(728, 252)–(3112, 1824)` and the DWM visible frame was `(739, 252)–(3101, 1813)`, in physical pixels. Sampling 2 DIP inside the DWM frame returned `HTCLIENT` for the left, right and bottom and their bottom corners, and `HTCLOSE` at the top right. The new handler uses DWM visible bounds, per-HWND DPI and Windows frame metrics. Those same samples return the expected eight resize codes. Caption centers return `HTMINBUTTON` (8), `HTMAXBUTTON` (9) and `HTCLOSE` (20).

This uses a native subclass because Electron's [`hookWindowMessage`](https://www.electronjs.org/docs/latest/api/browser-window#winhookwindowmessagemessage-callback-windows) callback does not replace the window procedure return value. Coordinate and return-code definitions follow Microsoft's [`WM_NCHITTEST`](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest) contract. Hit-test return codes alone do not establish successful physical mouse dragging.

The Windows x64 / Node-API 8 module is shipped as `desktop/win32/window-frame.node` with source and binary hashes in `window-frame-build.json`. `pnpm assets` rejects a stale module. To rebuild after changing the C source, use Zig 0.15.2 through `ZIG` or `PATH` and run `node scripts/build-window-frame.mjs`. Packaging explicitly unpacks the module from ASAR. End users need no compiler.

## Automated and isolated checks

On 2026-10-25, typecheck, lint, format, 32 tests, the production renderer build and the isolated Windows directory package passed. Package inspection compares the current renderer, host, project contract and native module with the final package and excludes QA state and source artwork.

Renderer checks cover pin/unpin, pointer hover without content movement, pointer focus left on the pin, keyboard focus, modifier keys, menu and drag holds, re-entering from the narrow drawer, menu rows and Escape focus return. Theme and viewport checks cover light/dark/system, a 920 × 680 CSS viewport and a 620 × 760 drawer. CSS viewport emulation is not a Windows DPI test.

The final directory package also passed the same-button keyboard → pointer → modifiers/Ctrl+C → Tab sequence: real focus remained, pointer input removed the outline, and keyboard input restored it. Reopening an isolated profile retained the saved light theme and unpinned state without restoring a temporary hover. `--request-exit` stopped the owned packaged QA process normally, and its children contained no native worker.

The real QA HWND reports 192 DPI; Electron display scale and renderer `devicePixelRatio` are 2, and WebContents zoom is 1. The window API reports 1180 × 780 DIP, with a 1179 × 780 renderer viewport after native frame accounting. DOM rectangles use renderer logical coordinates:

| Element | Position and size |
| --- | --- |
| Title bar | `(0, 0)`, `1179 × 44` |
| Identity icon / name | icon `(16, 10)`, `24 × 24`; name starts `x=48`, `14px/400` |
| Caption controls | `x=1041 / 1087 / 1133`, `y=0`, each `46 × 44` |
| Full title separator | starts at `y=44`, one continuous border on the body |
| Toolbar | `(224, 45)`, height `48`, horizontal inset `24` |
| Pinned sidebar / nav row | width `224`; first row `(8, 49)`, `208 × 40`; icon center `x=28` |
| Footer settings / pin | settings `(8, 732)`, `164 × 40`; pin `(180, 734)`, `36 × 36` |
| Collapsed settings | `40 × 40`; pin hidden and removed from tab navigation |
| Settings field | `(248, 186)`, `320 × 36`; label bottom gap `8` |
| Text | body/label `14/21`, section `16/24` at weight `500`, page title `20/30` at weight `600` |

Raw DOM, native hit-test and package records are under ignored `.runtime/window-shell-qa-20261025/`. Frontend interaction checks use the QA renderer; they do not move the desktop pointer. Physical eight-direction dragging, caption pointer tracking, Snap Layout, Alt+Space, maximize/restore corner rendering and other actual Windows DPIs remain for the coordinated desktop pass. Native screenshots and foreground input were paused while the desktop security prompt awaited user handling.

## Isolated QA launch

The directory package is at `.runtime/window-shell-qa-20261025/package/win-unpacked/NetworkToolbox.exe`. Run it with an explicit, separate profile:

```powershell
$qaProfile = Join-Path $PWD '.runtime\window-shell-qa-20261025\parent-data'
& '.\.runtime\window-shell-qa-20261025\package\win-unpacked\NetworkToolbox.exe' --ui-qa "--user-data-dir=$qaProfile" --ui-qa-size=1180x780 --ui-qa-theme=dark
```

The window title is `NetworkToolbox · UI QA`. A fresh profile opens settings, dark theme and the pinned sidebar. The theme argument initializes a fresh profile; reopening preserves changes. The profile contains `qa-window-metrics.json` with PID, native handle, window bounds, display scale and WebContents zoom. `--ui-qa-hidden` supports independent renderer checks while keeping the native window hidden.

Stop that profile normally, using the same executable and profile path:

```powershell
& '.\.runtime\window-shell-qa-20261025\package\win-unpacked\NetworkToolbox.exe' --ui-qa "--user-data-dir=$qaProfile" --request-exit
```

QA mode does not create the native worker. It rejects network detection, configuration, export and external-opening calls; metadata describes the actual QA profile. Profile validation rejects the daily user-data directory, its children and ancestors. The normal application ID, user-data directory, persistence keys and business boundaries remain stable. No release or installer operation is part of this UI pass.
