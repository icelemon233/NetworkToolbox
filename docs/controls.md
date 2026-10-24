# Shared Windows controls

The renderer uses React and project-local Cinna CSS. Lucide is the icon library. Radix Select 2.4.1 supplies accessible selection, focus and popup primitives; it has no built-in visual theme. Its public contract is wrapped by `src/shared/Select.tsx` and shared by all 24 selectors in the application, including conditional router and configuration forms.

`src/theme.css` is the source for fonts, control dimensions, radii and semantic colors. `src/styles.css` applies these tokens to buttons, inputs, checkboxes, selectors, menus and the rest of the interface. Light and dark portals inherit the document theme. The existing saved theme preference and Windows theme subscription remain in effect.

`public/theme-init.js` resolves the existing `theme` preference before the stylesheet and React load. `pnpm assets` also derives the native window palette and caption height from `src/theme.css` into `desktop/product.json`. Keep these values generated. The Electron frame uses the system window controls overlay; its drag area and CSS caption height follow the overlay's actual bounds when the renderer is zoomed.

The sidebar remembers `sidebar-collapsed`; its default responds to available width. Below 700 CSS pixels the expanded navigation uses a modal drawer, so a saved desktop preference cannot squeeze the toolbar out of the window. The drawer and the regular sidebar share `SidebarContent`. Settings remain at the bottom and use grouped rows.

`Field` connects the visible label and instructions separately to its control. Tabs use one tab stop, arrow/Home/End navigation, and a labelled panel; use `tabLabelId` for both the tab and panel reference so values containing spaces remain valid ARIA references. All application dialogs use `src/shared/dialog.ts` for entry and return focus. Asynchronous configuration and router previews capture the original focus before their submit control is disabled. Do not add React autofocus ahead of native `showModal()`, since it would replace the original focus before the dialog records it.

`desktop/window-preferences.cjs` stores only appearance and close behavior in `window-preferences.json` under the existing user-data folder. Writes are serialized and atomic; malformed or unreadable files are preserved and block automatic replacement. The renderer's existing theme key remains authoritative, and the host preference mirrors it for startup. Preference IPC uses the same main-frame caller check as the other bridge methods and accepts only fixed fields. Preload errors retain the native explanation without Electron's transport prefix.

Selectors use `value` and `onValueChange`, with numeric conversion at the feature boundary. The wrapper accepts option children to retain the existing labels and option lists. Empty values are placeholders. Disabled items, native form values and required validation remain supported; invalid forms focus the visible trigger and display a local error. Menus use Popper placement with a trigger gap, collision handling and bounded scrolling. Long item labels wrap, while triggers truncate with the full label available in a tooltip.

Controls have a 36 logical-pixel baseline and 14 px text; captions and shortcut hints use 12 px. Keyboard focus uses a single inset ring on bordered controls. Pointer opening does not apply a keyboard ring. Application checkboxes share the theme, with a native fallback in Windows forced-colors mode.

`src/shared/Select.test.tsx` checks pointer and keyboard selection, disabled options, Escape focus return, numeric values, native form serialization and required validation. JSDOM geometry is a test stub, not placement evidence. Real Chromium rendering and installed Windows checks are recorded separately in `docs/validation.md`.

The current UI audit, screenshots and native API limits are recorded in [the October 24 UI validation](ui-validation-2026-10-24.md).

Reference: [Radix Select documentation](https://www.radix-ui.com/primitives/docs/components/select).
