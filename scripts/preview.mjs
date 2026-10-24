import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NativeClient, METHODS } = require('../desktop/native-client.cjs');
const root = path.resolve(import.meta.dirname, '..');
const client = new NativeClient({ root, dataDirectory: path.join(root, '.runtime/preview') });
const denied = new Set([
  'dns.flush',
  'config.apply',
  'config.restore',
  'router.connect',
  'router.disconnect',
  'router.plan',
  'router.apply',
  'capture.start',
  'capture.stop',
  'traffic.start',
  'tools.wol',
  'lan.server',
  'lan.server.stop',
]);
const clients = new Set();
client.on('event', (event) => {
  for (const response of clients) response.write('data: ' + JSON.stringify(event) + '\n\n');
});
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/call' && req.method === 'POST') {
      if (
        req.headers['x-toolbox-preview'] !== '1' ||
        (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:4231')
      )
        throw new Error('不允许此来源');
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1_000_000) throw new Error('请求过大');
      }
      const { method, params } = JSON.parse(body);
      if (!METHODS.has(method) || denied.has(method))
        throw new Error('此操作需在 Windows 桌面应用内执行');
      const result = await client.call(method, params);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
      return;
    }
    let requested = decodeURIComponent(url.pathname);
    if (requested.includes('..')) throw new Error('无效路径');
    let file = path.join(root, 'dist', requested === '/' ? 'index.html' : requested);
    const buffer = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(buffer);
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});
server.listen(4231, '127.0.0.1', () =>
  console.log('Read-only Windows preview: http://127.0.0.1:4231/?preview=1'),
);
process.on('SIGINT', () => {
  client.close();
  server.close();
  process.exit(0);
});
