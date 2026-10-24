import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const assets = path.join(root, 'assets');
const sourceName = 'cinna-network-source.png';
const source = await fs.readFile(path.join(assets, sourceName));
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
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
  height: Number.parseInt(themeToken(themeBlocks[0], 'titlebar-height'), 10),
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
