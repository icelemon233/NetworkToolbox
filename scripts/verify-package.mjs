import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const packages = await fs.readdir(path.join(root, 'node_modules/.pnpm'));
const asarPackage = packages.find((name) => name.startsWith('@electron+asar@'));
assert.ok(asarPackage, 'electron-builder ASAR tooling is missing');
const asar = require(
  path.join(root, 'node_modules/.pnpm', asarPackage, 'node_modules/@electron/asar'),
);
const source = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const { NativeClient } = require('../desktop/native-client.cjs');
const client = new NativeClient({
  root: path.join(root, 'release/win-unpacked/resources/native'),
  packaged: true,
  dataDirectory: path.join(root, '.runtime/package-verification'),
});
try {
  assert.equal(
    (await client.call('meta')).version,
    source.version,
    'Packaged native worker version differs from the product version',
  );
} finally {
  await client.close();
}
const packedFile = path.join(root, 'release/win-unpacked/resources/app.asar');
async function verifyRenderer(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await verifyRenderer(file);
    else {
      const relative = path.relative(root, file);
      assert.ok(
        (await fs.readFile(file)).equals(asar.extractFile(packedFile, relative)),
        `${relative} in ASAR differs from the current renderer build`,
      );
    }
  }
}
await verifyRenderer(path.join(root, 'dist'));
const setup =
  process.env.NETWORKTOOLBOX_SETUP || `release/NetworkToolbox-Setup-${source.version}.exe`;
const installer = JSON.parse(await fs.readFile(path.resolve(root, `${setup}.build.json`), 'utf8'));
assert.equal(installer.engine, 'Inno Setup');
assert.equal(installer.version, source.version);
const payload = new Map(installer.files.map((file) => [path.normalize(file.path), file]));
async function verifyPayload(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await verifyPayload(file);
    else {
      const relative = path.relative(path.join(root, 'release/win-unpacked'), file);
      const manifest = payload.get(relative);
      assert.ok(manifest, `${relative} is missing from the installer payload`);
      assert.equal(
        createHash('sha256')
          .update(await fs.readFile(file))
          .digest('hex'),
        manifest.sha256,
        `${relative} differs from the installer payload`,
      );
    }
  }
}
await verifyPayload(path.join(root, 'release/win-unpacked'));
const identity = JSON.parse(asar.extractFile(packedFile, 'desktop/product.json'));
const generatedIdentity = JSON.parse(
  await fs.readFile(path.join(root, 'desktop/product.json'), 'utf8'),
);
assert.deepEqual(identity, {
  productName: source.build.productName,
  version: source.version,
  developer: source.author,
  windowTheme: generatedIdentity.windowTheme,
});
for (const name of ['main.cjs', 'preload.cjs', 'native-client.cjs', 'window-preferences.cjs']) {
  assert.ok(
    (await fs.readFile(path.join(root, 'desktop', name))).equals(
      asar.extractFile(packedFile, `desktop/${name}`),
    ),
    `desktop/${name} in ASAR differs from the current host`,
  );
}
for (const name of ['icon.png', 'icon.ico', 'tray.png']) {
  assert.ok(
    (await fs.readFile(path.join(root, 'assets', name))).equals(
      asar.extractFile(packedFile, 'assets/' + name),
    ),
    name + ' in ASAR differs from the confirmed brand resource',
  );
}
assert.ok(
  !asar
    .listPackage(packedFile)
    .some(
      (name) =>
        name.includes('portrait-source') ||
        name.includes('network-source') ||
        name.includes('installer-files'),
    ),
);
const ico = await fs.readFile(path.join(root, 'assets/icon.ico'));
assert.ok(
  ico.equals(
    await fs.readFile(
      path.join(root, 'release/win-unpacked/resources', `app-icon-${source.version}.ico`),
    ),
  ),
  'Versioned shortcut icon differs from the confirmed artwork',
);
const count = ico.readUInt16LE(4);
const layers = Array.from({ length: count }, (_, i) => {
  const entry = 6 + i * 16;
  return ico.subarray(
    ico.readUInt32LE(entry + 12),
    ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8),
  );
});
for (const file of [
  'release/win-unpacked/NetworkToolbox.exe',
  'release/win-unpacked/resources/native/NetworkToolbox.Native.exe',
  setup,
  ...process.argv.slice(2),
]) {
  const bytes = await fs.readFile(path.resolve(root, file));
  const matches = layers.filter((layer) => bytes.indexOf(layer) >= 0).length;
  assert.ok(matches > 0, `${path.basename(file)} does not embed the current icon images`);
  console.log(`PASS ${path.basename(file)} embeds ${matches}/${count} current ICO image layers`);
}
console.log(
  `PASS packaged ${identity.productName} ${identity.version}: identity, artwork and source exclusion`,
);
