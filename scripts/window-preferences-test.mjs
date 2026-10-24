import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadWindowPreferences } = require('../desktop/window-preferences.cjs');
const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, '.runtime', 'window-preferences-tests');
await fs.mkdir(directory, { recursive: true });
const sandbox = await fs.mkdtemp(path.join(directory, 'run-'));
const fixture = (name) => path.join(sandbox, name);

test('new users follow Windows and keep the existing tray behavior', async () => {
  const store = await loadWindowPreferences(fixture('defaults'));
  assert.deepEqual(store.get(), { theme: 'system', closeBehavior: 'tray', trayNoticeSeen: false });
  await store.update({ theme: 'system' });
  await assert.rejects(fs.stat(fixture('defaults')), { code: 'ENOENT' });
});

test('concurrent updates merge, save atomically and survive reopening', async () => {
  const store = await loadWindowPreferences(fixture('merge'));
  await Promise.all([
    store.update({ theme: 'dark' }),
    store.update({ closeBehavior: 'quit' }),
    store.update({ trayNoticeSeen: true }, true),
  ]);
  const reopened = await loadWindowPreferences(fixture('merge'));
  assert.deepEqual(reopened.get(), { theme: 'dark', closeBehavior: 'quit', trayNoticeSeen: true });
  assert.deepEqual(await fs.readdir(fixture('merge')), ['window-preferences.json']);
});

test('renderer patches accept only the fixed preference fields and values', async () => {
  const store = await loadWindowPreferences(fixture('validation'));
  for (const patch of [
    null,
    [],
    { theme: 'unknown' },
    { closeBehavior: 'force' },
    { trayNoticeSeen: true },
    { path: 'elsewhere' },
  ]) {
    await assert.rejects(store.update(patch), /窗口偏好/);
  }
  await store.update({ theme: 'light' });
  assert.equal(store.get().theme, 'light');
});

test('malformed files remain intact and are never replaced by defaults', async () => {
  const location = fixture('corrupt');
  await fs.mkdir(location);
  const file = path.join(location, 'window-preferences.json');
  const original = '{"theme":';
  await fs.writeFile(file, original);
  const store = await loadWindowPreferences(location);
  assert.match(store.get().error, /原文件已保留/);
  await assert.rejects(store.update({ theme: 'dark' }), /原文件已保留/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('failed saves preserve the effective preference and permit retry', async () => {
  const location = fixture('blocked');
  const store = await loadWindowPreferences(location);
  const blocker = path.join(location, 'window-preferences.json');
  await fs.mkdir(blocker, { recursive: true });
  await assert.rejects(store.update({ theme: 'dark' }), /原设置已保留/);
  assert.equal(store.get().theme, 'system');
  await fs.rmdir(blocker);
  await store.update({ theme: 'dark' });
  assert.equal(store.get().theme, 'dark');
});

test('the first paint uses the saved theme, with safe system fallback', async () => {
  const source = await fs.readFile(path.join(root, 'public/theme-init.js'), 'utf8');
  for (const [saved, dark, expected] of [
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    [null, true, 'dark'],
    ['invalid', false, 'light'],
  ]) {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(source, {
      document,
      localStorage: {
        getItem: (key) => {
          assert.equal(key, 'theme');
          return saved;
        },
      },
      matchMedia: () => ({ matches: dark }),
    });
    assert.equal(document.documentElement.dataset.theme, expected);
  }
  const document = { documentElement: { dataset: {} } };
  vm.runInNewContext(source, {
    document,
    localStorage: {
      getItem: () => {
        throw new Error('blocked');
      },
    },
    matchMedia: () => ({ matches: true }),
  });
  assert.equal(document.documentElement.dataset.theme, 'dark');
});

test('preload keeps native error details without the Electron transport prefix', async () => {
  const source = await fs.readFile(path.join(root, 'desktop/preload.cjs'), 'utf8');
  let exposed;
  let failure = "Error invoking remote method 'toolbox:preferences': Error: 窗口偏好保存失败";
  vm.runInNewContext(source, {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_key, bridge) => {
          exposed = bridge;
        },
      },
      ipcRenderer: {
        invoke: async () => {
          throw new Error(failure);
        },
      },
    }),
  });
  await assert.rejects(exposed.setWindowPreferences({ theme: 'dark' }), {
    message: '窗口偏好保存失败',
  });
  failure = '当前系统不支持此操作';
  await assert.rejects(exposed.call('meta'), { message: failure });
});
