const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

module.exports = async function afterPack(context) {
  const project = context.packager.projectDir;
  const metadata = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  const manifest = JSON.parse(
    await fs.readFile(path.join(project, 'assets/brand-manifest.json'), 'utf8'),
  );
  const identity = JSON.parse(
    await fs.readFile(path.join(project, 'desktop/product.json'), 'utf8'),
  );
  if (
    manifest.variant !== 'network-analyzer' ||
    manifest.version !== metadata.version ||
    manifest.product !== metadata.build.productName ||
    identity.version !== metadata.version ||
    identity.productName !== metadata.build.productName ||
    identity.developer !== metadata.author
  ) {
    throw new Error('Product resources are stale. Run pnpm build before packaging.');
  }
  for (const [name, expected] of [
    [manifest.source, manifest.sourceSha256],
    [manifest.master, manifest.masterSha256],
  ]) {
    const digest = createHash('sha256')
      .update(await fs.readFile(path.join(project, 'assets', name)))
      .digest('hex');
    if (digest !== expected) throw new Error(`Brand source ${name} is stale. Run pnpm assets.`);
  }
  for (const [name, expected] of Object.entries(manifest.files)) {
    const digest = createHash('sha256')
      .update(await fs.readFile(path.join(project, 'assets', name)))
      .digest('hex');
    if (digest !== expected)
      throw new Error(`Brand resource ${name} differs from the confirmed export. Run pnpm assets.`);
  }
};
