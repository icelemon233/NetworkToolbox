import { useEffect, useState } from 'react';
import { Network, RefreshCw, Activity, Search } from 'lucide-react';
import { bridge } from '../shared/bridge';
import { useAction, useApp, useJob } from '../shared/context';
import { row, list, text, number, formatBytes } from '../shared/models';
import {
  Select,
  PageHeader,
  Card,
  Button,
  Field,
  Notice,
  ErrorNotice,
  JobControl,
  Table,
  Badge,
} from '../shared/ui';
export function LanPage() {
  const app = useApp(),
    action = useAction(),
    active = useJob('discovery');
  const [cidr, setCidr] = useState(''),
    [query, setQuery] = useState('');
  const adapter = app.overview?.adapters.find((a) => a.id === app.adapterId),
    ip = adapter?.addresses.find((x) => x.family === 'InterNetwork');
  const defaultCidr = ip ? `${ip.address}/${Math.max(24, ip.prefix)}` : '';
  const found = active.samples.length ? active.samples : list(row(active.job?.result).devices);
  const neighbors = list(row(active.job?.result).neighbors);
  const merged = new Map<string, Record<string, unknown>>();
  for (const v of neighbors) {
    const n = row(v);
    merged.set(text(n.IPAddress), {
      ip: n.IPAddress,
      mac: n.LinkLayerAddress,
      vendor: n.Vendor,
      name: '',
      state: n.State,
      source: '邻居缓存',
    });
  }
  for (const v of found) {
    const n = row(v),
      key = text(n.ip);
    merged.set(key, { ...merged.get(key), ...n, state: '已响应' });
  }
  const rows = [...merged.values()].filter((n) =>
    JSON.stringify(n).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        title="局域网设备"
        description="发现当前私有网段中的设备，并结合 Windows 邻居缓存查看地址信息。"
      />
      <Card
        title="选择发现范围"
        caption="支持当前网卡所在的 /23 至 /32 网段，每次最多 512 个地址。"
      >
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const result = await bridge.call<{ jobId: string }>('lan.discover', {
                cidr: cidr || defaultCidr,
              });
              active.setId(result.jobId);
              return result;
            });
          }}
        >
          <Field label="IPv4 / CIDR 网段" className="grow">
            <input
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
              placeholder={defaultCidr || '192.168.1.0/24'}
              required={!defaultCidr}
            />
          </Field>
          <Button
            variant="primary"
            busy={action.busy}
            disabled={active.job?.state === 'running'}
            type="submit"
          >
            <Network size={15} />
            发现设备
          </Button>
        </form>
        <ErrorNotice error={action.error} />
      </Card>
      <JobControl job={active.job} />
      <Card
        title={`发现记录 · ${rows.length}`}
        actions={
          <label className="search-input">
            <Search size={14} />
            <input
              aria-label="筛选局域网设备"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="IP、MAC 或名称"
            />
          </label>
        }
      >
        <Table
          rows={rows}
          rowKey="ip"
          columns={[
            { key: 'ip', title: 'IP 地址', className: 'mono' },
            { key: 'name', title: '主机名' },
            { key: 'mac', title: 'MAC 地址', className: 'mono' },
            { key: 'vendor', title: '厂商线索' },
            {
              key: 'latency',
              title: '响应延迟',
              render: (v) => (typeof v === 'number' ? `${v} ms` : '—'),
            },
            {
              key: 'state',
              title: '状态',
              render: (v) => <Badge tone={v === '已响应' ? 'good' : 'neutral'}>{text(v)}</Badge>,
            },
            { key: 'source', title: '信息来源' },
          ]}
        />
      </Card>
      <Notice>
        不响应 Ping
        的设备可能仍在线；邻居缓存可能已经过时。路由器设备列表提供另一种视角，可在“小米路由器”中查看。
      </Notice>
    </>
  );
}
export function ConnectionsPage() {
  const action = useAction(),
    active = useJob('traffic');
  const [query, setQuery] = useState(''),
    [protocol, setProtocol] = useState('all'),
    [auto, setAuto] = useState(false);
  const load = () => action.run(() => bridge.call('connections'));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [auto]);
  const trafficRows = list(row(active.samples.at(-1)).rows),
    traffic = new Map(
      trafficRows.map((v) => {
        const r = row(v);
        return [number(r.pid), r] as const;
      }),
    );
  const rows = list(row(action.data).rows)
    .map(row)
    .filter(
      (r) =>
        (protocol === 'all' || r.protocol === protocol) &&
        JSON.stringify(r).toLowerCase().includes(query.toLowerCase()),
    )
    .map((r) => ({
      ...r,
      uploadBps: traffic.get(number(r.pid))?.uploadBps,
      downloadBps: traffic.get(number(r.pid))?.downloadBps,
    }));
  return (
    <>
      <PageHeader
        title="进程连接与流量"
        description="查看程序的连接目标，按需开启系统事件采集以统计上下行。"
        actions={
          <>
            <Button busy={action.busy} onClick={() => void load()}>
              <RefreshCw size={15} />
              刷新连接
            </Button>
            <Button
              variant="primary"
              disabled={active.job?.state === 'running'}
              onClick={() =>
                void action.run(async () => {
                  const result = await bridge.call<{ jobId: string }>('traffic.start');
                  active.setId(result.jobId);
                  return result;
                })
              }
            >
              <Activity size={15} />
              启动流量监测
            </Button>
          </>
        }
      />
      <ErrorNotice error={action.error} />
      <JobControl job={active.job} />
      <Card
        title="当前连接"
        caption="进程流量是此进程所有连接的合计，不是单条连接的速率。"
        actions={
          <div className="inline-controls">
            <label className="check-label">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />每
              5 秒刷新
            </label>
            <Select
              aria-label="协议筛选"
              value={protocol}
              onValueChange={(selectedValue) => setProtocol(selectedValue)}
            >
              <option value="all">所有协议</option>
              <option>TCP</option>
              <option>UDP</option>
            </Select>
            <label className="search-input">
              <Search size={14} />
              <input
                aria-label="搜索进程或连接地址"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="进程、PID 或地址"
              />
            </label>
          </div>
        }
      >
        <Table
          rows={rows}
          columns={[
            {
              key: 'process',
              title: '进程',
              render: (v, r) => (
                <span className="process-name">
                  {text(v)}
                  <small className="cell-sub">PID {text(r.pid)}</small>
                </span>
              ),
            },
            { key: 'protocol', title: '协议' },
            {
              key: 'localAddress',
              title: '本地端点',
              render: (v, r) => (
                <span className="mono">
                  {text(v)}:{text(r.localPort)}
                </span>
              ),
            },
            {
              key: 'remoteAddress',
              title: '远端端点',
              render: (v, r) =>
                v ? (
                  <span className="mono">
                    {text(v)}:{text(r.remotePort)}
                  </span>
                ) : (
                  'UDP 表未提供'
                ),
            },
            { key: 'state', title: '状态' },
            {
              key: 'downloadBps',
              title: '进程下载',
              render: (v) => (typeof v === 'number' ? formatBytes(v) + '/s' : '未采集'),
            },
            {
              key: 'uploadBps',
              title: '进程上传',
              render: (v) => (typeof v === 'number' ? formatBytes(v) + '/s' : '未采集'),
            },
          ]}
        />
      </Card>
      {active.samples.length > 0 && (
        <Notice>
          流量来源：Windows ETW TCP/UDP。已丢失事件数{' '}
          {text(row(active.samples.at(-1)).eventsLost, '0')}；事件丢失可能使统计偏低。
        </Notice>
      )}
      <Notice>
        连接列表可直接读取；实时进程流量需要按需管理员授权。UDP 的常规连接表只返回本地端点。
      </Notice>
    </>
  );
}
