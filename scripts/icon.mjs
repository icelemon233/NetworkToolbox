import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { exportInstallerArtwork, installerArtwork } from './installer-artwork.mjs';
import { verifyWindowFrame } from './build-window-frame.mjs';

const root = path.resolve(import.meta.dirname, '..');
await verifyWindowFrame();
const assets = path.join(root, 'assets');
const sourceName = 'cinna-network-source.png';
const source = await fs.readFile(path.join(assets, sourceName));
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const windowShell = JSON.parse(
  await fs.readFile(path.join(root, 'desktop/window-shell.json'), 'utf8'),
);
const { titlebar, sidebar, content, controls } = windowShell;
const shellTokens = {
  'titlebar-height': titlebar.height,
  'caption-button-width': titlebar.captionButtonWidth,
  'caption-button-height': titlebar.captionButtonHeight,
  'caption-glyph-size': titlebar.captionGlyphSize,
  'caption-glyph-stroke': titlebar.captionGlyphStroke,
  'titlebar-icon-size': titlebar.iconSize,
  'titlebar-icon-inset': titlebar.iconLeftInset,
  'titlebar-name-gap': titlebar.iconNameGap,
  'titlebar-name-size': titlebar.nameFontSize,
  'sidebar-width': sidebar.expandedWidth,
  'sidebar-compact-width': sidebar.collapsedWidth,
  'nav-height': sidebar.rowHeight,
  'nav-icon-size': sidebar.iconSize,
  'nav-icon-width': sidebar.iconColumnWidth,
  'nav-inset': sidebar.horizontalInset,
  'nav-top': sidebar.topInset,
  'sidebar-footer-inset': sidebar.footer.inset,
  'sidebar-footer-height': sidebar.footer.height,
  'sidebar-footer-gap': sidebar.footer.gap,
  'sidebar-settings-width': sidebar.footer.settingsExpandedWidth,
  'sidebar-settings-collapsed': sidebar.footer.settingsCollapsedSize,
  'sidebar-pin-size': sidebar.footer.pinSize,
  'toolbar-height': content.toolbarHeight,
  'toolbar-padding': content.toolbarHorizontalPadding,
  'business-status-size': content.businessStatusFontSize,
  'business-status-dot-size': content.businessStatusDotSize,
  'business-status-gap': content.businessStatusGap,
  'space-page': content.pagePadding,
  'text-body': content.bodyFontSize,
  'text-caption': content.auxiliaryFontSize,
  'text-group': content.sectionTitleSize,
  'text-title': content.pageTitleSize,
  'control-height': controls.height,
  'radius-control': controls.radius,
  'radius-panel': controls.panelRadius,
  'menu-item-height': controls.menuItemHeight,
  'menu-inset': controls.menuInset,
  'menu-radius': controls.menuRadius,
  'settings-field-width': controls.settingsFieldWidth,
  'label-gap': controls.labelBottomGap,
  'space-section': content.sectionGap,
};
await fs.writeFile(
  path.join(root, 'src/window-shell.css'),
  '/* Generated from desktop/window-shell.json by pnpm assets. */\n:root {\n' +
    Object.entries(shellTokens)
      .map(([key, value]) => `  --${key}: ${value}px;`)
      .join('\n') +
    `\n  --titlebar-name-weight: ${titlebar.nameFontWeight};\n  --nav-font-weight: ${sidebar.fontWeight};\n  --nav-icon-stroke: ${sidebar.iconStroke};\n  --page-title-weight: ${content.pageTitleFontWeight};\n  --section-title-weight: ${content.sectionTitleFontWeight};\n}\n`,
);
const master = await sharp(source)
  .resize(1024, 1024, { fit: 'cover', kernel: 'lanczos3' })
  .toColourspace('srgb')
  .png()
  .toBuffer();
await fs.writeFile(path.join(assets, 'icon-master.png'), master);
async function icon(size, rounded = true) {
  // Keep the network tester visible together with Cinna at every exported size.
  let data = await sharp(master).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
  if (rounded) {
    const radius = (size * 112) / 512;
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="white"/></svg>`,
    );
    data = await sharp(data)
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
  }
  return data;
}
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const layers = await Promise.all(sizes.map((size) => icon(size)));
const header = Buffer.alloc(6 + 16 * layers.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(layers.length, 4);
let offset = header.length;
layers.forEach((data, i) => {
  const entry = 6 + i * 16;
  header[entry] = sizes[i] === 256 ? 0 : sizes[i];
  header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
const files = {
  'icon.png': await icon(256),
  'tray.png': await icon(32),
  'icon-readme.png': await icon(512),
  'icon.ico': Buffer.concat([header, ...layers]),
  ...(await exportInstallerArtwork(master)),
};
for (const [name, bytes] of Object.entries(files))
  await fs.writeFile(path.join(assets, name), bytes);
const digest = (data) => createHash('sha256').update(data).digest('hex');
await fs.writeFile(
  path.join(assets, 'brand-manifest.json'),
  JSON.stringify(
    {
      product: metadata.build.productName,
      version: metadata.version,
      identity: 'Cinna with a Wi-Fi and Ethernet network analyzer',
      variant: 'network-analyzer',
      source: sourceName,
      sourceSha256: digest(source),
      master: 'icon-master.png',
      masterSha256: digest(master),
      icoSizes: sizes,
      installerArtwork,
      files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, digest(data)])),
    },
    null,
    2,
  ) + '\n',
);
await fs.writeFile(
  path.join(root, 'native/ProductVersion.props'),
  `<Project><PropertyGroup><Version>${metadata.version}</Version><AssemblyVersion>${metadata.version}.0</AssemblyVersion><FileVersion>${metadata.version}.0</FileVersion></PropertyGroup></Project>\n`,
);
console.log(`Prepared ${metadata.build.productName} ${metadata.version} icons and native version`);
// The renderer's theme tokens also supply the native frame and startup background.
const themeCss = await fs.readFile(path.join(root, 'src/theme.css'), 'utf8');
const themeBlocks = [...themeCss.matchAll(/:root[^{]*\{([^}]+)\}/g)].map((match) => match[1]);
function themeToken(block, name) {
  const value = block?.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
  if (!value) throw new Error(`Missing window theme token: ${name}`);
  return value;
}
const windowTheme = {
  height: titlebar.height,
  ...Object.fromEntries(
    ['light', 'dark'].map((name, index) => [
      name,
      {
        background: themeToken(themeBlocks[index], 'canvas'),
        titlebar: themeToken(themeBlocks[index], 'sidebar'),
        text: themeToken(themeBlocks[index], 'text'),
      },
    ]),
  ),
};
await fs.writeFile(
  path.join(root, 'desktop/product.json'),
  JSON.stringify(
    {
      productName: metadata.build.productName,
      version: metadata.version,
      developer: metadata.author,
      windowTheme,
    },
    null,
    2,
  ) + '\n',
);
