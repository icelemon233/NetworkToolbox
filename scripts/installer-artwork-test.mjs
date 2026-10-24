import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeBmp24, exportInstallerArtwork } from './installer-artwork.mjs';
import sharp from 'sharp';

function pixel(bitmap, x, y) {
  const width = bitmap.readInt32LE(18),
    height = bitmap.readInt32LE(22);
  const stride = (width * 3 + 3) & ~3;
  const offset = bitmap.readUInt32LE(10) + (height - y - 1) * stride + x * 3;
  return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
}

test('24-bit BMP preserves RGB orientation and aligned rows', () => {
  const bitmap = encodeBmp24(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]), 2, 2);
  assert.equal(bitmap.toString('ascii', 0, 2), 'BM');
  assert.equal(bitmap.readUInt16LE(28), 24);
  assert.equal(bitmap.readUInt32LE(2), bitmap.length);
  assert.equal(bitmap.length, 54 + 8 * 2);
  assert.deepEqual(pixel(bitmap, 0, 0), [255, 0, 0]);
  assert.deepEqual(pixel(bitmap, 1, 0), [0, 255, 0]);
  assert.deepEqual(pixel(bitmap, 0, 1), [0, 0, 255]);
  assert.deepEqual(pixel(bitmap, 1, 1), [255, 255, 255]);
  assert.throws(() => encodeBmp24(Buffer.alloc(5), 2, 2));
});

test('wizard artwork composites rounded identity onto the agreed cream layouts', async () => {
  const master = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: '#125634' },
  })
    .png()
    .toBuffer();
  const files = await exportInstallerArtwork(master);
  for (const [name, width, height, left, top, size] of [
    ['installer-sidebar.bmp', 164, 314, 8, 58, 148],
    ['installer-header.bmp', 150, 57, 98, 4, 48],
  ]) {
    const bitmap = files[name];
    assert.equal(bitmap.readInt32LE(18), width);
    assert.equal(bitmap.readInt32LE(22), height);
    assert.deepEqual(pixel(bitmap, 0, 0), [255, 252, 246]);
    assert.deepEqual(pixel(bitmap, left, top), [255, 252, 246]);
    assert.deepEqual(
      pixel(bitmap, left + Math.floor(size / 2), top + Math.floor(size / 2)),
      [18, 86, 52],
    );
    assert.deepEqual(pixel(bitmap, width - 1, height - 1), [255, 252, 246]);
  }
});
