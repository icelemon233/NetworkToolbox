import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { NativeClient } = require('../desktop/native-client.cjs');
const root = path.resolve(import.meta.dirname, '..');
const client = new NativeClient({ root, dataDirectory: path.join(root, '.runtime/smoke') });
function assert(value, label) {
  if (!value) throw new Error(label);
  console.log('PASS ' + label);
}
try {
  const meta = await client.call('meta');
  assert(meta.platform === 'windows', 'native Windows worker handshake');
  const overview = await client.call('overview');
  assert(overview.adapters.length > 0, 'real adapters returned');
  const wifi = await client.call('wifi.scan', { refresh: true });
  assert(
    wifi.networks.length > 0 && wifi.networks.some((n) => n.connected),
    'real fresh Wi-Fi scan and connected BSSID',
  );
  assert(
    wifi.networks
      .filter((n) => n.width !== null)
      .every((n) => [20, 40, 80, 160, 320].includes(n.width)),
    'decoded broadcast widths',
  );
  const conns = await client.call('connections');
  assert(
    conns.rows.length > 0 &&
      conns.rows.every(
        (r) => Number.isInteger(r.localPort) && r.localPort >= 0 && r.localPort <= 65535,
      ),
    'real TCP/UDP endpoint ports',
  );
  const info = await client.call('router.info');
  assert(
    info.hardware === 'RD03' && info.firmware === '1.0.84' && !info.connected,
    'read-only AX3000T identity',
  );
  const adapter = overview.adapters.find((a) => a.status === 'Up' && a.gateways.length > 0);
  const plan = await client.call('config.plan', {
    adapterId: adapter.id,
    type: 'dns',
    desired: { servers: ['223.5.5.5'], family: 'IPv4' },
  });
  assert(
    plan.before && Array.isArray(plan.before.dns) && typeof plan.before.dnsAutomatic === 'boolean',
    'configuration preview captures real DNS state without applying',
  );
  assert(typeof plan.before.mtu === 'number', 'MTU snapshot is numeric');
  const bad = await client
    .call('config.plan', { adapterId: adapter.id, type: 'mtu', desired: { mtu: 20 } })
    .then(
      () => false,
      () => true,
    );
  assert(bad, 'invalid configuration rejected before mutation');
  const completed = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ping did not complete')), 20000);
    client.on('event', (event) => {
      if (event.name === 'job' && event.data.kind === 'ping' && event.data.state === 'completed') {
        clearTimeout(t);
        resolve(event.data.result);
      }
    });
  });
  await client.call('ping.start', { target: overview.gateway, count: 4, intervalMs: 500 });
  const ping = await completed;
  assert(ping.sent === 4 && ping.received >= 1, 'real gateway Ping task and samples');
  const history = await client.call('history.list');
  assert(history.length >= 2, 'scan and completed diagnostics persisted');
  console.log(
    'All read-only Windows integration checks passed. No configuration changes were applied.',
  );
} finally {
  client.close();
}
