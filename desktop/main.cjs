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
  nativeTheme,
  screen,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { NativeClient } = require('./native-client.cjs');
const { loadWindowPreferences } = require('./window-preferences.cjs');
const { uiQaSession } = require('./window-shell.cjs');
let win, tray, client;
let preferences;
let exiting = false;
let quitPending = false;
const product = require('./product.json');
const windowShell = require('./window-shell.json');
const qa = uiQaSession(process.argv, app.getPath('appData'));
app.setName(product.productName);
app.setPath('userData', qa?.directory ?? path.join(app.getPath('appData'), 'NetworkToolbox'));
function restoreWindow() {
  if (qa?.hidden) return;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function themeColors() {
  return product.windowTheme[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
}
function updateWindowTheme() {
  if (!win || win.isDestroyed()) return;
  const colors = themeColors();
  win.setBackgroundColor(colors.background);
}
function publicPreferences() {
  const { theme, closeBehavior, error } = preferences.get();
  return { theme, closeBehavior, ...(error ? { error } : {}) };
}
let trayPending = false;
async function hideToTray() {
  if (trayPending) return;
  trayPending = true;
  try {
    if (!tray || tray.isDestroyed())
      throw new Error('系统托盘不可用，窗口已保持打开。可在应用设置中退出。');
    if (!preferences.get().trayNoticeSeen) {
      const choice = await dialog.showMessageBox(win, {
        type: 'info',
        title: '窗口将进入托盘',
        message: '关闭窗口后，NetworkToolbox 会在系统托盘继续运行。',
        detail: '点击托盘图标可重新打开，在托盘菜单中可退出。你也可以在“应用设置”中更改关闭行为。',
        buttons: ['进入托盘', '取消'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response !== 0) return;
      await preferences.update({ trayNoticeSeen: true }, true);
    }
    win.hide();
  } finally {
    trayPending = false;
  }
}
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
    restoreWindow();
  });
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId(qa ? 'local.network.toolbox.ui-qa' : 'local.network.toolbox');
      const root = app.getAppPath();
      const icon = path.join(root, 'assets/icon.png');
      preferences = await loadWindowPreferences(app.getPath('userData'));
      if (qa) {
        const exists = await fs
          .stat(path.join(qa.directory, 'window-preferences.json'))
          .catch(() => null);
        if (!exists) await preferences.update({ theme: qa.theme });
      }
      nativeTheme.themeSource = preferences.get().theme;
      const colors = themeColors();
      if (!qa)
        client = new NativeClient({
          root: app.isPackaged ? path.join(process.resourcesPath, 'native') : root,
          dataDirectory: app.getPath('userData'),
          packaged: app.isPackaged,
        });
      win = new BrowserWindow({
        width: qa?.width ?? 1440,
        height: qa?.height ?? 940,
        minWidth: 920,
        minHeight: 680,
        title: qa ? `${product.productName} · UI QA` : product.productName,
        backgroundColor: colors.background,
        frame: true,
        thickFrame: true,
        roundedCorners: true,
        resizable: true,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,
        show: false,
        icon,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webviewTag: false,
          spellcheck: false,
          backgroundThrottling: !qa,
          additionalArguments: [
            `--toolbox-initial-theme=${preferences.get().theme}`,
            `--toolbox-native-theme=${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}`,
            ...(qa ? ['--toolbox-ui-qa'] : []),
          ],
        },
      });
      nativeTheme.on('updated', updateWindowTheme);
      if (process.platform === 'win32') {
        require('./win32/window-frame.node').attach(
          win.getNativeWindowHandle(),
          windowShell.titlebar.height,
          windowShell.titlebar.captionButtonWidth,
        );
        win.hookWindowMessage(0x8443, (wparam) => {
          const state = wparam.readUInt32LE(0);
          if (!win.webContents.isDestroyed())
            win.webContents.send('toolbox:event', {
              name: 'window-caption',
              data: { hovered: state & 0xff, pressed: (state >> 8) & 0xff },
            });
        });
        for (const message of [0x00a1, 0x00a4])
          win.hookWindowMessage(message, () => {
            if (!win.webContents.isDestroyed())
              win.webContents.send('toolbox:event', { name: 'window-pointer', data: {} });
          });
      }
      for (const event of ['maximize', 'unmaximize'])
        win.on(
          event,
          () =>
            !win.webContents.isDestroyed() &&
            win.webContents.send('toolbox:event', {
              name: 'window-state',
              data: { maximized: win.isMaximized() },
            }),
        );
      win.once('ready-to-show', () => {
        if (!qa) win.show();
        else if (!qa.hidden) win.showInactive();
      });
      Menu.setApplicationMenu(null);
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      );
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      if (qa) win.on('page-title-updated', (event) => event.preventDefault());
      if (qa) {
        const recordMetrics = () => {
          const bounds = win.getBounds();
          const metrics = {
            pid: process.pid,
            handle: win.getNativeWindowHandle().toString('hex'),
            requested: { width: qa.width, height: qa.height },
            bounds,
            contentBounds: win.getContentBounds(),
            maximized: win.isMaximized(),
            displayScaleFactor: screen.getDisplayMatching(bounds).scaleFactor,
            webContentsZoomFactor: win.webContents.getZoomFactor(),
          };
          void fs
            .writeFile(
              path.join(qa.directory, 'qa-window-metrics.json'),
              JSON.stringify(metrics, null, 2),
            )
            .catch(console.error);
        };
        for (const event of ['ready-to-show', 'resize', 'maximize', 'unmaximize'])
          win.on(event, recordMetrics);
      }
      function trusted(event) {
        if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
          throw new Error('不允许此页面操作本机');
      }
      ipcMain.on('toolbox:startup', (event) => {
        try {
          trusted(event);
          event.returnValue = {
            theme: preferences.get().theme,
            nativeTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
            uiQa: Boolean(qa),
          };
        } catch {
          event.returnValue = null;
        }
      });
      ipcMain.handle('toolbox:call', async (event, method, params) => {
        trusted(event);
        if (qa) {
          if (method === 'meta')
            return {
              version: product.version,
              platform: process.platform,
              dataDirectory: qa.directory,
              uiQa: true,
            };
          throw new Error('界面验收模式未启动本机服务，网络检测与配置操作已停用。');
        }
        return client.call(method, params);
      });
      ipcMain.handle('toolbox:export', async (event, id, kind) => {
        trusted(event);
        if (qa) throw new Error('界面验收模式不导出检测记录。');
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
        if (qa) throw new Error('界面验收模式不打开外部程序或网址。');
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
        else if (action === 'maximize') {
          if (win.isMaximized()) win.unmaximize();
          else win.maximize();
        } else if (action === 'close') win.close();
        else if (action === 'tray') return hideToTray();
        else if (action === 'quit') app.quit();
        else throw new Error('窗口操作不支持');
      });
      ipcMain.handle('toolbox:preferences', async (event, action, patch) => {
        trusted(event);
        if (action === 'get') return publicPreferences();
        if (action !== 'set') throw new Error('窗口偏好操作不支持');
        const saved = await preferences.update(patch);
        nativeTheme.themeSource = saved.theme;
        updateWindowTheme();
        return publicPreferences();
      });
      client?.on('event', (event) => {
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
      client?.on('offline', () => {
        if (!win.isDestroyed())
          win.webContents.send('toolbox:event', { name: 'offline', data: {} });
      });
      try {
        tray = new Tray(nativeImage.createFromPath(path.join(root, 'assets/tray.png')));
        tray.setToolTip(qa ? `${product.productName} · UI QA` : product.productName);
        tray.setContextMenu(
          Menu.buildFromTemplate([
            {
              label: `打开 ${product.productName}`,
              click: () => {
                restoreWindow();
              },
            },
            {
              label: '后台检测任务',
              click: () => {
                restoreWindow();
                win.webContents.send('toolbox:event', {
                  name: 'navigate',
                  data: { page: 'tasks' },
                });
              },
            },
            { type: 'separator' },
            { label: '退出', click: () => app.quit() },
          ]),
        );
        tray.on('double-click', () => {
          restoreWindow();
        });
        tray.on('click', restoreWindow);
      } catch {
        tray?.destroy();
        tray = undefined;
        win.once('ready-to-show', () => {
          void dialog.showMessageBox(win, {
            type: 'warning',
            message: '系统托盘不可用，窗口将保持打开。可在应用设置中退出。',
          });
        });
      }
      win.on('close', (event) => {
        if (!exiting) {
          event.preventDefault();
          if (quitPending) return;
          if (preferences.get().closeBehavior === 'quit') app.quit();
          else
            void hideToTray().catch((error) =>
              dialog.showMessageBox(win, { type: 'error', message: error.message }),
            );
        }
      });
      await win.loadFile(path.join(root, 'dist/index.html'));
    })
    .catch(async (error) => {
      await dialog.showMessageBox({ type: 'error', title: '启动失败', message: error.message });
      await client?.close();
      tray?.destroy();
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
