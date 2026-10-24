const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  dialog,
  shell,
  session,
  Notification,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { NativeClient } = require('./native-client.cjs');
let win, tray, client;
let exiting = false;
let quitPending = false;
const product = require('./product.json');
app.setName(product.productName);
app.setPath('userData', path.join(app.getPath('appData'), 'NetworkToolbox'));
if (!app.requestSingleInstanceLock({ requestExit: process.argv.includes('--request-exit') })) {
  app.quit();
} else if (process.argv.includes('--request-exit')) {
  app.quit();
} else {
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    if (data?.requestExit === true) {
      app.quit();
      return;
    }
    win?.show();
    win?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('local.network.toolbox');
      const root = app.getAppPath();
      const icon = path.join(root, 'assets/icon.png');
      client = new NativeClient({
        root: app.isPackaged ? path.join(process.resourcesPath, 'native') : root,
        dataDirectory: app.getPath('userData'),
        packaged: app.isPackaged,
      });
      win = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 920,
        minHeight: 680,
        title: product.productName,
        backgroundColor: '#f5f7f8',
        icon,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webviewTag: false,
          spellcheck: false,
        },
      });
      Menu.setApplicationMenu(null);
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      );
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      function trusted(event) {
        if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
          throw new Error('不允许此页面操作本机');
      }
      ipcMain.handle('toolbox:call', async (event, method, params) => {
        trusted(event);
        return client.call(method, params);
      });
      ipcMain.handle('toolbox:export', async (event, id, kind) => {
        trusted(event);
        if (
          typeof id !== 'string' ||
          !/^[-a-zA-Z0-9]{1,100}$/.test(id) ||
          !['report', 'capture'].includes(kind)
        )
          throw new Error('导出参数不正确');
        const result = await client.call('export', { id, kind });
        const choice = await dialog.showSaveDialog(win, {
          defaultPath: result.fileName,
          filters:
            kind === 'capture'
              ? [{ name: 'pcapng', extensions: ['pcapng'] }]
              : [{ name: 'HTML 报告', extensions: ['html'] }],
        });
        if (choice.canceled || !choice.filePath) return { cancelled: true };
        await fs.writeFile(choice.filePath, Buffer.from(result.base64, 'base64'));
        return { saved: true, path: choice.filePath };
      });
      ipcMain.handle('toolbox:open', async (event, value) => {
        trusted(event);
        if (value === 'ms-settings:privacy-location') {
          await shell.openExternal(value);
          return;
        }
        let u;
        try {
          u = new URL(value);
        } catch {
          throw new Error('地址不正确');
        }
        const local = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname);
        if (
          u.username ||
          u.password ||
          !(u.protocol === 'https:' || (u.protocol === 'http:' && local))
        )
          throw new Error('仅可打开 HTTPS 或局域网管理地址');
        await shell.openExternal(u.href);
      });
      ipcMain.handle('toolbox:window', (event, action) => {
        trusted(event);
        if (action === 'minimize') win.minimize();
        else if (action === 'tray') win.hide();
        else if (action === 'quit') app.quit();
      });
      client.on('event', (event) => {
        if (!win.isDestroyed()) win.webContents.send('toolbox:event', event);
        if (
          event.name === 'job' &&
          ['completed', 'failed'].includes(event.data.state) &&
          !win.isVisible() &&
          Notification.isSupported()
        ) {
          new Notification({
            title: event.data.title,
            body:
              event.data.state === 'completed'
                ? '检测已完成，可打开应用查看结果。'
                : (event.data.error ?? '检测未完成'),
            icon,
          }).show();
        }
      });
      client.on('offline', () => {
        if (!win.isDestroyed())
          win.webContents.send('toolbox:event', { name: 'offline', data: {} });
      });
      tray = new Tray(nativeImage.createFromPath(path.join(root, 'assets/tray.png')));
      tray.setToolTip(product.productName);
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: `打开 ${product.productName}`,
            click: () => {
              win.show();
              win.focus();
            },
          },
          {
            label: '后台检测任务',
            click: () => {
              win.show();
              win.webContents.send('toolbox:event', { name: 'navigate', data: { page: 'tasks' } });
            },
          },
          { type: 'separator' },
          { label: '退出', click: () => app.quit() },
        ]),
      );
      tray.on('double-click', () => {
        win.show();
        win.focus();
      });
      win.on('close', (event) => {
        if (!exiting) {
          event.preventDefault();
          win.hide();
        }
      });
      await win.loadFile(path.join(root, 'dist/index.html'));
    })
    .catch(async (error) => {
      await dialog.showMessageBox({ type: 'error', title: '启动失败', message: error.message });
      exiting = true;
      app.quit();
    });
  app.on('before-quit', (event) => {
    if (exiting) return;
    event.preventDefault();
    if (quitPending) return;
    quitPending = true;
    (async () => {
      try {
        const capture = await client?.call('capture.list');
        if (capture?.session) {
          const choice = await dialog.showMessageBox(win, {
            type: 'question',
            title: '停止捕获后退出',
            message: '当前正在捕获数据包。退出时将停止并保存本次捕获。',
            buttons: ['停止并退出', '取消'],
            defaultId: 0,
            cancelId: 1,
          });
          if (choice.response !== 0) return;
          await client.call('capture.stop');
        }
        await client?.close();
        exiting = true;
        tray?.destroy();
        app.quit();
      } catch (error) {
        await dialog.showMessageBox(win, { type: 'error', message: error.message });
      } finally {
        quitPending = false;
      }
    })();
  });
}
