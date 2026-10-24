import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { NativeClient } = require('../desktop/native-client.cjs');
const root = path.resolve(import.meta.dirname, '..');
const dataDirectory = path.join(root, '.runtime', 'extended-' + Date.now());
const client = new NativeClient({ root, dataDirectory });
const completed = new Map();
client.on('event', (event) => {
  if (event.name === 'job' && event.data.state !== 'running')
    completed.set(event.data.id, event.data);
});
const results = [];
const selected = process.argv.slice(2);
async function check(name, run) {
  if (selected.length && !selected.some((value) => name.includes(value))) return;
  try {
    await run();
    results.push({ name, state: 'passed' });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, state: 'failed', error: error.message });
    console.error('FAIL ' + name + ': ' + error.message);
  }
}
async function job(method, params, timeoutMs = 45_000) {
  const { jobId } = await client.call(method, params);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const result = completed.get(jobId);
    if (result) {
      assert.equal(result.state, 'completed', result.error);
      return result.result;
    }
    await delay(150);
  }
  await client.call('jobs.cancel', { id: jobId });
  throw new Error('Task exceeded integration test deadline');
}
const server = http.createServer((_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Set-Cookie': 'fixture=synthetic-secret-cookie',
  });
  res.end('NetworkToolbox local integration fixture');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
let originalProxy, restoreId;
try {
  await check('published native identity', async () => {
    const meta = await client.call('meta');
    assert.equal(meta.version, '0.2.0');
    assert.equal(meta.admin, false);
  });
  await check('live loopback HTTP, TCP ports and private-history redaction', async () => {
    const response = await client.call('web.test', {
      url: `http://127.0.0.1:${port}/test?token=synthetic-secret-query`,
    });
    assert.equal(response.status, 200);
    assert.ok(response.tcpMs >= 0);
    const ports = await client.call('ports.test', { target: '127.0.0.1', ports: [port] });
    assert.equal(ports.results[0].state, 'open');
    const history = await client.call('history.list');
    const record = history.find((r) => r.type === 'web');
    assert.ok(record);
    const clean = JSON.stringify(await client.call('history.read', { id: record.id }));
    assert.ok(
      !clean.includes('synthetic-secret-cookie') && !clean.includes('synthetic-secret-query'),
    );
    const report = await client.call('export', { id: record.id, kind: 'report' });
    const html = Buffer.from(report.base64, 'base64').toString('utf8');
    assert.ok(html.includes('NetworkToolbox') && !html.includes('synthetic-secret-cookie'));
  });
  const overview = await client.call('overview');
  await check('live UDP DNS lookup through configured servers', async () => {
    const answer = await client.call('dns.query', { domain: 'example.com', type: 'A' });
    assert.ok(
      answer.results.some(
        (r) => !r.error && r.result.records.some((r) => r.type === 'A' || r.type === 1),
      ),
      'No DNS server returned an A record',
    );
  });
  await check('live gateway route trace', async () => {
    const trace = await job('trace.start', {
      target: overview.gateway,
      maxHops: 3,
      timeoutMs: 750,
    });
    assert.ok(trace.hops.some((h) => h.reached));
  });
  await check('live connected-subnet discovery limited to gateway', async () => {
    const scan = await job('lan.discover', { cidr: overview.gateway + '/32' });
    assert.ok(scan.devices.some((d) => d.ip === overview.gateway));
  });
  await check('live loopback Wake-on-LAN datagram contents', async () => {
    const receiver = dgram.createSocket('udp4');
    try {
      receiver.bind(0, '127.0.0.1');
      await once(receiver, 'listening');
      const message = once(receiver, 'message', { signal: AbortSignal.timeout(3000) });
      await client.call('tools.wol', {
        mac: '02:00:00:00:00:01',
        broadcast: '127.0.0.1',
        port: receiver.address().port,
      });
      const [packet] = await message;
      assert.equal(packet.length, 102);
      assert.ok(packet.subarray(0, 6).every((v) => v === 255));
      for (let i = 0; i < 16; i++)
        assert.deepEqual(packet.subarray(6 + i * 6, 12 + i * 6), Buffer.from([2, 0, 0, 0, 0, 1]));
    } finally {
      receiver.close();
    }
  });
  await check('real Windows TCP transfer, exclusive port and release', async () => {
    const peer = await client.call('lan.server', { bind: '127.0.0.1', port: 0 });
    try {
      const conflict = net.createServer();
      const occupied = await new Promise((resolve) => {
        conflict.once('error', (error) =>
          resolve(error.code === 'EADDRINUSE' || error.code === 'EACCES'),
        );
        conflict.listen(peer.port, '127.0.0.1', () => {
          conflict.close();
          resolve(false);
        });
      });
      assert.equal(occupied, true);
      for (const direction of ['upload', 'download']) {
        const transfer = await job('lan.speed.start', {
          target: '127.0.0.1',
          port: peer.port,
          key: peer.key,
          mb: 1,
          direction,
        });
        assert.equal(transfer.bytes, 1048576);
        assert.ok(transfer.mbps > 0);
      }
    } finally {
      await client.call('lan.server.stop');
    }
    const released = net.createServer();
    released.listen(peer.port, '127.0.0.1');
    await once(released, 'listening');
    await new Promise((resolve) => released.close(resolve));
  });
  await check('real user proxy change and encrypted snapshot restoration', async () => {
    const plan = await client.call('config.plan', {
      type: 'proxy',
      desired: { enabled: false, server: '', pac: '', bypass: '' },
    });
    originalProxy = plan.before;
    const desired = {
      ...originalProxy,
      bypass: [originalProxy.bypass, 'networktoolbox-test.invalid'].filter(Boolean).join(';'),
    };
    const changed = await client.call('config.plan', { type: 'proxy', desired });
    const applied = await client.call('config.apply', { id: changed.id });
    restoreId = applied.snapshotId;
    try {
      const after = await client.call('config.plan', { type: 'proxy', desired: originalProxy });
      assert.deepEqual(after.before, desired);
      await assert.rejects(client.call('config.apply', { id: changed.id }), /已提交/);
    } finally {
      await client.call('config.restore', { id: restoreId });
      restoreId = null;
    }
    const restored = await client.call('config.plan', { type: 'proxy', desired: originalProxy });
    assert.deepEqual(restored.before, originalProxy);
  });
  await check('live HTTPS and TLS result', async () => {
    const result = await client.call('web.test', { url: 'https://example.com' });
    assert.ok(result.status >= 200 && result.status < 400, result.httpError);
    assert.ok(result.certificate?.subject);
  });
  await check('live Internet throughput with 1 MiB each direction', async () => {
    const result = await job('speed.start', { downloadMb: 1, uploadMb: 1 }, 100_000);
    assert.equal(result.downloadBytes, 1048576);
    assert.equal(result.uploadBytes, 1048576);
    assert.ok(result.downloadMbps > 0 && result.uploadMbps > 0);
  });
  await check('live public IP response distinguishes address families', async () => {
    const result = await client.call('tools.publicIp');
    assert.equal(result.results.length, 2);
    assert.ok(result.results.some((r) => r.value && net.isIP(r.value) > 0));
  });
  await check('cancelled Ping saves partial samples', async () => {
    const { jobId } = await client.call('ping.start', {
      target: '127.0.0.1',
      count: 100,
      intervalMs: 250,
    });
    await delay(700);
    await client.call('jobs.cancel', { id: jobId });
    for (let i = 0; i < 40 && !completed.has(jobId); i++) await delay(100);
    const result = completed.get(jobId);
    assert.equal(result?.state, 'cancelled');
    assert.ok(result.result.samples.length > 0);
  });
  await check('worker exit waits for task cancellation and saves history', async () => {
    await client.call('ping.start', { target: '127.0.0.1', count: 100, intervalMs: 250 });
    await delay(500);
    await client.close();
    assert.equal(client.child.exitCode, 0);
    const files = await fs.readdir(path.join(dataDirectory, 'history'));
    const records = await Promise.all(
      files.map((file) => fs.readFile(path.join(dataDirectory, 'history', file), 'utf8')),
    );
    assert.ok(records.some((content) => JSON.parse(content).title.includes('退出时保存')));
  });
} finally {
  if (restoreId) await client.call('config.restore', { id: restoreId });
  if (client.child.exitCode === null) await client.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(
    path.join(dataDirectory, 'test-summary.json'),
    JSON.stringify({ results, proxyRestored: !restoreId }, null, 2),
  );
}
if (results.some((r) => r.state === 'failed')) process.exitCode = 1;
