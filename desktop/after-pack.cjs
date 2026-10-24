const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

module.exports = async function afterPack(context) {
  const root = context.appOutDir;
  const project = context.packager.projectDir;
  const metadata = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  const manifest = JSON.parse(
    await fs.readFile(path.join(project, 'assets/brand-manifest.json'), 'utf8'),
  );
  const identity = JSON.parse(
    await fs.readFile(path.join(project, 'desktop/product.json'), 'utf8'),
  );
  if (
    manifest.version !== metadata.version ||
    manifest.product !== metadata.build.productName ||
    identity.version !== metadata.version ||
    identity.productName !== metadata.build.productName ||
    identity.developer !== metadata.author
  ) {
    throw new Error('Product resources are stale. Run pnpm build before packaging.');
  }
  for (const [name, expected] of Object.entries(manifest.files)) {
    const digest = createHash('sha256')
      .update(await fs.readFile(path.join(project, 'assets', name)))
      .digest('hex');
    if (digest !== expected)
      throw new Error(`Brand resource ${name} differs from the confirmed export. Run pnpm assets.`);
  }
  async function files(directory) {
    const result = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await files(name)));
      else if (entry.isFile()) result.push(path.relative(root, name));
    }
    return result;
  }
  const owned = (await files(root)).sort();
  const dirs = new Set();
  for (const file of owned) {
    let dir = path.dirname(file);
    while (dir !== '.') {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }
  const escape = (value) => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
  const lines = [
    '; Generated from the current packaged file list. Never recursively remove user files.',
    '!macro customRemoveFiles',
    ...owned.map((file) => `  Delete "$INSTDIR\\${escape(file)}"`),
    '  Delete "$INSTDIR\\网络工具箱.exe"',
    '  Delete "$INSTDIR\\Uninstall 网络工具箱.exe"',
    '  Delete "$INSTDIR\\Uninstall NetworkToolbox.exe"',
    '  Delete "$INSTDIR\\uninstallerIcon.ico"',
    '  Delete "$INSTDIR\\resources\\elevate.exe"',
    ...[...dirs]
      .sort((a, b) => b.length - a.length)
      .map((dir) => `  RMDir "$INSTDIR\\${escape(dir)}"`),
    '  RMDir "$INSTDIR"',
    '!macroend',
    '',
  ];
  await fs.writeFile(
    path.join(context.packager.projectDir, 'desktop/installer-files.nsh'),
    lines.join('\n'),
  );
};
