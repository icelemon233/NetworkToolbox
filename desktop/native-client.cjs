const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

const METHODS = new Set([
  'meta',
  'overview',
  'routes',
  'wifi.scan',
  'wifi.monitor',
  'ping.start',
  'trace.start',
  'dns.query',
  'dns.flush',
  'web.test',
  'ports.test',
  'speed.start',
  'lan.server',
  'lan.server.stop',
  'lan.speed.start',
  'lan.discover',
  'connections',
  'traffic.start',
  'capture.start',
  'capture.stop',
  'capture.list',
  'capture.inspect',
  'config.plan',
  'config.apply',
  'config.snapshots',
  'config.restore',
  'router.info',
  'router.connect',
  'router.disconnect',
  'router.read',
  'router.plan',
  'router.apply',
  'tools.wol',
  'tools.vendor',
  'tools.subnet',
  'tools.publicIp',
  'jobs.list',
  'jobs.cancel',
  'history.list',
  'history.read',
  'history.delete',
  'history.snapshot',
  'export',
]);
class NativeClient extends EventEmitter {
  constructor({ root, dataDirectory, packaged = false }) {
    super();
    this.pending = new Map();
    const exe = path.join(root, packaged ? '' : 'native/publish', 'NetworkToolbox.Native.exe');
    let command = exe,
      args = [];
    if (!fs.existsSync(exe)) {
      const sdk = path.resolve(root, '../tools/dotnet/dotnet.exe');
      if (!fs.existsSync(sdk)) throw new Error('本机服务尚未构建，请先构建 native 项目。');
      command = sdk;
      args = [
        path.join(root, 'native/bin/Debug/net10.0-windows/win-x64/NetworkToolbox.Native.dll'),
      ];
    }
    this.child = spawn(command, [...args, '--data-dir', dataDirectory], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      try {
        const message = JSON.parse(line.replace(/^\uFEFF/, ''));
        if (message.event) {
          this.emit('event', { name: message.event, data: message.data });
          return;
        }
        const task = this.pending.get(message.id);
        if (!task) return;
        clearTimeout(task.timer);
        this.pending.delete(message.id);
        if (message.error) task.reject(new Error(message.error));
        else task.resolve(message.result);
      } catch {
        /* Non-protocol startup lines never become data. */
      }
    });
    this.child.stderr.on('data', () => {});
    const fail = () => {
      for (const task of this.pending.values()) {
        clearTimeout(task.timer);
        task.reject(new Error('本机服务已关闭，请重新打开应用。'));
      }
      this.pending.clear();
      this.emit('offline');
    };
    this.child.on('exit', fail);
    this.child.on('error', fail);
  }
  call(method, params = {}) {
    if (this.closing) return Promise.reject(new Error('应用正在退出，请等待当前操作完成'));
    if (!METHODS.has(method)) return Promise.reject(new Error('不受支持的操作'));
    if (!params || typeof params !== 'object' || Array.isArray(params))
      return Promise.reject(new Error('参数格式不正确'));
    if (!this.child.stdin.writable) return Promise.reject(new Error('本机服务不可用'));
    const id = randomUUID();
    const json = JSON.stringify({ id, method, params });
    if (json.length > 1_000_000) return Promise.reject(new Error('请求过大'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error('操作超时。涉及配置修改时，请先回读确认实际状态。'));
        },
        method.startsWith('config.') || method === 'capture.stop' ? 150_000 : 75_000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(json + '\n');
    });
  }
  close() {
    if (this.closing) return this.closing;
    this.closing = new Promise((resolve, reject) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return resolve();
      const timer = setTimeout(() => {
        reject(new Error('本机服务尚未完成退出，请等待任务结束后重试。'));
        this.closing = null;
      }, 15_000);
      this.child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error('本机服务退出异常，请重新打开应用检查任务与捕获状态。'));
      });
      this.child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.child.stdin.end();
    });
    return this.closing;
  }
}
module.exports = { NativeClient, METHODS };
