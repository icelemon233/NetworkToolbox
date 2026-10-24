import { useState } from 'react';
import { Route, Globe, Plug } from 'lucide-react';
import { bridge } from '../shared/bridge';
import { useApp, useAction, useJob } from '../shared/context';
import { row, list, text, number } from '../shared/models';
import {
  PageHeader,
  Card,
  Button,
  Field,
  Tabs,
  Metric,
  Notice,
  ErrorNotice,
  Empty,
  JobControl,
  Table,
  RawData,
  StartIcon,
  KeyValues,
  Badge,
} from '../shared/ui';
import { LineChart } from '../shared/charts';
export function DiagnosticsPage() {
  const [tab, setTab] = useState('ping');
  return (
    <>
      <PageHeader
        title="连通性诊断"
        description="从本机到指定目标，逐项检查延迟、路径与应用连接。"
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'ping', label: 'Ping 与丢包' },
          { id: 'trace', label: '路由追踪' },
          { id: 'web', label: 'HTTP / TLS' },
          { id: 'ports', label: '端口检测' },
        ]}
      />
      {tab === 'ping' ? (
        <PingTool />
      ) : tab === 'trace' ? (
        <TraceTool />
      ) : tab === 'web' ? (
        <WebTool />
      ) : (
        <PortTool />
      )}
    </>
  );
}
function PingTool() {
  const app = useApp(),
    action = useAction(),
    active = useJob('ping');
  const [target, setTarget] = useState(''),
    [count, setCount] = useState(60),
    [interval, setInterval] = useState(1000);
  const samples = active.samples.length ? active.samples : list(row(active.job?.result).samples);
  const success = samples.map(row).filter((s) => typeof s.ms === 'number');
  const delays = success.map((s) => number(s.ms));
  const lost = samples.length - success.length;
  const summary = row(active.job?.result);
  return (
    <>
      <Card title="开始一次连续检测" caption="可先检测默认网关，再用相同参数检测外网目标。">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const result = await bridge.call<{ jobId: string }>('ping.start', {
                target: target || app.overview?.gateway || '127.0.0.1',
                count,
                intervalMs: interval,
              });
              active.setId(result.jobId);
              return result;
            });
          }}
        >
          <Field label="目标 IP 或域名" className="grow">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={app.overview?.gateway ?? '192.168.1.1'}
              required={!app.overview?.gateway}
            />
          </Field>
          <Field label="探测次数">
            <input
              type="number"
              min={1}
              max={86400}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </Field>
          <Field label="间隔">
            <select value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
              <option value={500}>500 ms</option>
              <option value={1000}>1 秒</option>
              <option value={3000}>3 秒</option>
            </select>
          </Field>
          <Button type="submit" variant="primary" busy={action.busy}>
            <StartIcon />
            开始检测
          </Button>
        </form>
        <div className="target-presets">
          <span>快捷目标</span>
          <button onClick={() => setTarget(app.overview?.gateway ?? '')}>默认网关</button>
          <button onClick={() => setTarget('223.5.5.5')}>223.5.5.5</button>
          <button onClick={() => setTarget('1.1.1.1')}>1.1.1.1</button>
        </div>
        <ErrorNotice error={action.error} />
      </Card>
      <JobControl job={active.job} />
      <div className="metrics-grid">
        <Metric
          label="平均延迟"
          value={
            delays.length ? (delays.reduce((a, b) => a + b, 0) / delays.length).toFixed(1) : '—'
          }
          unit="ms"
          accent
        />
        <Metric label="最高延迟" value={delays.length ? Math.max(...delays) : '—'} unit="ms" />
        <Metric
          label="丢包率"
          value={samples.length ? ((lost * 100) / samples.length).toFixed(1) : '—'}
          unit="%"
          detail={`${samples.length} 个已完成样本`}
        />
        <Metric
          label="相邻样本抖动"
          value={
            typeof summary.jitterMs === 'number'
              ? summary.jitterMs.toFixed(1)
              : delays.length > 1
                ? (
                    delays.slice(1).reduce((s, v, i) => s + Math.abs(v - delays[i]!), 0) /
                    (delays.length - 1)
                  ).toFixed(1)
                : '—'
          }
          unit="ms"
        />
      </div>
      <Card title="往返延迟时间线" caption="中断处代表未收到成功响应；运行中的任务可在托盘继续。">
        {samples.length ? (
          <LineChart
            series={[
              {
                name: '往返延迟',
                color: 'var(--accent)',
                values: samples.map((s) =>
                  typeof row(s).ms === 'number' ? number(row(s).ms) : null,
                ),
              },
            ]}
          />
        ) : (
          <Empty title="等待第一组样本" description="检测由你手动启动，不会自动探测外网。" />
        )}
      </Card>
      {samples.length > 0 && (
        <Card title="最近的探测记录">
          <Table
            rows={samples.slice(-15).reverse()}
            columns={[
              { key: 'sequence', title: '序号' },
              {
                key: 'timestamp',
                title: '时间',
                render: (v) =>
                  new Date(text(v)).toLocaleTimeString('zh-CN', {
                    hour12: false,
                    timeZone: 'Asia/Shanghai',
                  }),
              },
              { key: 'address', title: '响应地址', className: 'mono' },
              { key: 'ms', title: '延迟', render: (v) => (v === null ? '—' : `${text(v)} ms`) },
              {
                key: 'status',
                title: '结果',
                render: (v) => (
                  <Badge tone={v === 'Success' ? 'good' : 'warn'}>
                    {v === 'Success' ? '成功' : text(v)}
                  </Badge>
                ),
              },
            ]}
          />
        </Card>
      )}
      <Notice>
        到网关异常可能涉及无线、网卡驱动、本机负载或网关响应；单个外网目标异常也可能来自远端。请结合多个检测结果判断。
      </Notice>
    </>
  );
}
function TraceTool() {
  const action = useAction(),
    active = useJob('trace');
  const [target, setTarget] = useState(''),
    [maxHops, setMaxHops] = useState(30);
  const hops = active.samples.length ? active.samples : list(row(active.job?.result).hops);
  return (
    <>
      <Card title="查看数据包经过的路径">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const result = await bridge.call<{ jobId: string }>('trace.start', {
                target,
                maxHops,
              });
              active.setId(result.jobId);
              return result;
            });
          }}
        >
          <Field label="目标 IP 或域名" className="grow">
            <input
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="例如 www.example.com"
            />
          </Field>
          <Field label="最大跳数">
            <input
              type="number"
              min={1}
              max={64}
              value={maxHops}
              onChange={(e) => setMaxHops(Number(e.target.value))}
            />
          </Field>
          <Button variant="primary" busy={action.busy} type="submit">
            <Route size={15} />
            追踪路径
          </Button>
        </form>
        <ErrorNotice error={action.error} />
      </Card>
      <JobControl job={active.job} />
      <Card title="路径节点" caption="每跳发送 3 次 IPv4 ICMP 探测。">
        <Table
          rows={hops}
          columns={[
            { key: 'hop', title: '跳数' },
            { key: 'address', title: '节点 IP', className: 'mono' },
            {
              key: 'times',
              title: '往返耗时',
              render: (v) =>
                list(v).length
                  ? list(v)
                      .map((n) => `${text(n)} ms`)
                      .join(' / ')
                  : '* / * / *',
            },
            {
              key: 'reached',
              title: '状态',
              render: (v, r) =>
                v ? <Badge tone="good">已到达目标</Badge> : r.address ? '已响应' : '未响应',
            },
          ]}
        />
      </Card>
      <Notice>
        星号可能只是该跳不回复 ICMP。当前工具使用 IPv4 路径，不把“未响应”直接判断为断网。
      </Notice>
    </>
  );
}
function WebTool() {
  const action = useAction();
  const [url, setUrl] = useState('https://www.example.com');
  const data = row(action.data);
  return (
    <>
      <Card title="检查网页连接与 TLS 证书">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(() => bridge.call('web.test', { url }));
          }}
        >
          <Field label="HTTP(S) 地址" className="grow">
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </Field>
          <Button variant="primary" busy={action.busy} type="submit">
            <Globe size={15} />
            检测连接
          </Button>
        </form>
        <ErrorNotice error={action.error} />
      </Card>
      {action.data ? (
        <>
          <div className="metrics-grid">
            <Metric
              label="DNS 查询"
              value={typeof data.dnsMs === 'number' ? data.dnsMs.toFixed(1) : '—'}
              unit="ms"
            />
            <Metric
              label="TCP 建连"
              value={typeof data.tcpMs === 'number' ? data.tcpMs.toFixed(1) : '—'}
              unit="ms"
            />
            <Metric
              label="TLS 握手"
              value={typeof data.tlsMs === 'number' ? data.tlsMs.toFixed(1) : '—'}
              unit="ms"
            />
            <Metric
              label="HTTP 状态"
              value={text(data.status)}
              detail={text(data.reason, '尚未收到响应')}
              accent
            />
          </div>
          <Card title="响应与证书">
            <KeyValues
              items={[
                ['目标地址', text(data.url)],
                [
                  '解析地址',
                  list(data.addresses)
                    .map((v) => text(v))
                    .join('、'),
                ],
                ['证书主题', text(row(data.certificate).subject)],
                ['证书颁发者', text(row(data.certificate).issuer)],
                ['证书有效期至', text(row(data.certificate).notAfter)],
                ['TLS 协议', text(row(data.certificate).protocol)],
              ]}
            />
            {data.directError !== null && data.directError !== undefined && (
              <Notice tone="error">直接连接探测：{text(data.directError)}</Notice>
            )}
            {data.httpError !== undefined && (
              <Notice tone="error">HTTP 请求：{text(data.httpError)}</Notice>
            )}
            <RawData data={action.data} />
          </Card>
          <Notice>
            DNS / TCP / TLS 是直接连接探测；HTTP 请求遵循系统代理，分项耗时不能直接相加。
          </Notice>
        </>
      ) : (
        <Empty
          title="检查连接建立在哪一步"
          description="分别测量 DNS、TCP、TLS 和 HTTP 响应，验证证书，不跳过 TLS 校验。"
        />
      )}
    </>
  );
}
function PortTool() {
  const action = useAction();
  const [target, setTarget] = useState(''),
    [ports, setPorts] = useState('80,443');
  return (
    <>
      <Card title="检查指定 TCP 端口">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(() =>
              bridge.call('ports.test', {
                target,
                ports: ports
                  .split(/[,，\s]+/)
                  .filter(Boolean)
                  .map(Number),
              }),
            );
          }}
        >
          <Field label="目标主机" className="grow">
            <input
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="IP 或域名"
            />
          </Field>
          <Field label="端口（最多 32 个）">
            <input
              required
              value={ports}
              onChange={(e) => setPorts(e.target.value)}
              placeholder="80,443"
            />
          </Field>
          <Button variant="primary" busy={action.busy} type="submit">
            <Plug size={15} />
            检查端口
          </Button>
        </form>
        <ErrorNotice error={action.error} />
      </Card>
      {action.data && (
        <Card title="端口连接结果">
          <Table
            rows={list(row(action.data).results)}
            columns={[
              { key: 'port', title: 'TCP 端口' },
              {
                key: 'state',
                title: '状态',
                render: (v) => (
                  <Badge tone={v === 'open' ? 'good' : v === 'closed' ? 'neutral' : 'warn'}>
                    {v === 'open' ? '可建立连接' : v === 'closed' ? '拒绝连接' : '不可达 / 超时'}
                  </Badge>
                ),
              },
              { key: 'ms', title: '建连耗时', render: (v) => `${text(v)} ms` },
              { key: 'error', title: '说明' },
            ]}
          />
        </Card>
      )}
      <Notice>TCP 建连成功表示该端口接受连接；超时可能涉及防火墙、路径或目标状态。</Notice>
    </>
  );
}
export function DnsPage() {
  const action = useAction();
  const [domain, setDomain] = useState('example.com'),
    [type, setType] = useState('A'),
    [servers, setServers] = useState('');
  const results = list(row(action.data).results);
  const records = results.flatMap((v) => {
    const r = row(v);
    return list(row(r.result).records).map((a) => ({ ...row(a), server: r.server, ms: r.ms }));
  });
  return (
    <>
      <PageHeader
        title="DNS 查询与对比"
        description="直接向指定 DNS 服务器查询，比较答案、TTL 和耗时。"
        actions={
          <Button
            busy={action.busy}
            onClick={() => void action.run(() => bridge.call('dns.flush'), '本机 DNS 缓存已清除')}
          >
            清除本机 DNS 缓存
          </Button>
        }
      />
      <Card title="查询参数">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(() =>
              bridge.call('dns.query', {
                domain,
                type,
                servers: servers.split(/[,，\s]+/).filter(Boolean),
              }),
            );
          }}
        >
          <Field label="域名" className="grow">
            <input required value={domain} onChange={(e) => setDomain(e.target.value)} />
          </Field>
          <Field label="记录类型">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="DNS 服务器" className="grow" hint="留空使用当前网卡配置；最多 6 个 IP">
            <input
              value={servers}
              onChange={(e) => setServers(e.target.value)}
              placeholder="223.5.5.5, 1.1.1.1"
            />
          </Field>
          <Button variant="primary" busy={action.busy} type="submit">
            <StartIcon />
            查询对比
          </Button>
        </form>
        <ErrorNotice error={action.error} />
      </Card>
      {results.length > 0 ? (
        <>
          <div className="dns-server-grid">
            {results.map((v, i) => {
              const r = row(v);
              return (
                <Card key={i}>
                  <span className="eyebrow mono">{text(r.server)}</span>
                  <div className="dns-time">
                    {number(r.ms).toFixed(1)}
                    <small>ms</small>
                  </div>
                  <Badge
                    tone={r.error ? 'bad' : number(row(r.result).rcode) === 0 ? 'good' : 'warn'}
                  >
                    {r.error
                      ? text(r.error)
                      : `响应码 ${text(row(r.result).rcode)} · ${list(row(r.result).records).length} 条答案`}
                  </Badge>
                  {row(r.result).truncated === true && (
                    <Notice>响应被截断；当前 UDP 结果可能不完整。</Notice>
                  )}
                </Card>
              );
            })}
          </div>
          <Card title="解析答案">
            <Table
              rows={records}
              columns={[
                { key: 'server', title: 'DNS 服务器', className: 'mono' },
                { key: 'name', title: '域名' },
                { key: 'type', title: '类型' },
                { key: 'value', title: '记录值', className: 'mono' },
                { key: 'ttl', title: 'TTL（秒）' },
                { key: 'ms', title: '查询耗时', render: (v) => `${text(v)} ms` },
              ]}
            />
            <RawData data={action.data} />
          </Card>
        </>
      ) : (
        <Empty
          title="比较 DNS 的答案与响应时间"
          description="查询会直接发送到所选服务器，不修改系统 DNS 配置。"
        />
      )}
    </>
  );
}
