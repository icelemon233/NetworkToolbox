import sharp from 'sharp';

export const installerArtwork = {
  background: '#FFFCF6',
  sidebar: {
    file: 'installer-sidebar.bmp',
    width: 164,
    height: 314,
    x: 8,
    y: 58,
    size: 148,
    radius: 32,
  },
  header: {
    file: 'installer-header.bmp',
    width: 150,
    height: 57,
    x: 98,
    y: 4,
    size: 48,
    radius: 11,
  },
};

/** Windows BI_RGB, bottom-up BGR scanlines with four-byte row alignment. */
export function encodeBmp24(data, width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    data.length !== width * height * 3
  )
    throw new Error('Invalid RGB bitmap dimensions');
  const stride = (width * 3 + 3) & ~3;
  const bitmap = Buffer.alloc(54 + stride * height);
  bitmap.write('BM');
  bitmap.writeUInt32LE(bitmap.length, 2);
  bitmap.writeUInt32LE(54, 10);
  bitmap.writeUInt32LE(40, 14);
  bitmap.writeInt32LE(width, 18);
  bitmap.writeInt32LE(height, 22);
  bitmap.writeUInt16LE(1, 26);
  bitmap.writeUInt16LE(24, 28);
  bitmap.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 3;
      const target = 54 + (height - y - 1) * stride + x * 3;
      bitmap[target] = data[source + 2];
      bitmap[target + 1] = data[source + 1];
      bitmap[target + 2] = data[source];
    }
  return bitmap;
}

export async function exportInstallerArtwork(master) {
  const exports = {};
  for (const resource of [installerArtwork.sidebar, installerArtwork.header]) {
    const mask = Buffer.from(
      `<svg width="${resource.size}" height="${resource.size}"><rect width="${resource.size}" height="${resource.size}" rx="${resource.radius}" fill="white"/></svg>`,
    );
    const icon = await sharp(master)
      .resize(resource.size, resource.size, { kernel: 'lanczos3' })
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
    const rgb = await sharp({
      create: {
        width: resource.width,
        height: resource.height,
        channels: 3,
        background: installerArtwork.background,
      },
    })
      .composite([{ input: icon, left: resource.x, top: resource.y }])
      .removeAlpha()
      .raw()
      .toBuffer();
    exports[resource.file] = encodeBmp24(rgb, resource.width, resource.height);
  }
  return exports;
}
