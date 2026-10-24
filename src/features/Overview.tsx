import {
  Laptop,
  Router,
  Globe,
  ArrowRight,
  ArrowDownLeft,
  ArrowUpRight,
  Wifi,
  Activity,
  Search,
  Network,
  Gauge,
  Camera,
  ChevronRight,
} from 'lucide-react';
import { useApp, useAction } from '../shared/context';
import { bridge } from '../shared/bridge';
import { formatBytes, row, text } from '../shared/models';
import {
  Card,
  PageHeader,
  Metric,
  Button,
  KeyValues,
  Empty,
  Notice,
  ErrorNotice,
  Badge,
} from '../shared/ui';
import { LineChart } from '../shared/charts';
export function OverviewPage() {
  const app = useApp(),
    action = useAction();
  const o = app.overview,
    a = o?.adapters.find((a) => a.id === app.adapterId),
    c = a
      ? o?.wifi.find(
          (w) => w.interfaceId.toLowerCase() === a?.id.replace(/[{}]/g, '').toLowerCase(),
        )
      : o?.wifi[0];
  const current = app.wifi?.networks.find(
    (n) =>
      n.connected &&
      (!a || n.interfaceId.toLowerCase() === a.id.replace(/[{}]/g, '').toLowerCase()),
  );
  const rate = app.rates.at(-1);
  const gateway = a
    ? (a.gateways.find((value) => !value.includes(':')) ?? a.gateways[0] ?? null)
    : o?.gateway;
  const ping = app.jobs.find(
    (j) => j.kind === 'ping' && j.state === 'completed' && row(j.result).target === gateway,
  );
  const ip = a?.addresses.find((x) => x.family === 'InterNetwork');
  return (
    <>
      <PageHeader
        title="网络总览"
        actions={
          <Button
            busy={action.busy}
            onClick={() => void action.run(() => bridge.call('history.snapshot'), '网络快照已保存')}
          >
            <Camera size={15} />
            保存快照
          </Button>
        }
      />
      {!o ? (
        <Empty
          title={app.overviewError ? '本机网络读取失败' : '正在读取本机网络'}
          description={
            app.overviewError
              ? '检查本机服务后重新读取连接信息。'
              : '连接信息来自 Windows 当前配置。'
          }
          action={
            app.overviewError ? (
              <Button onClick={() => void app.refresh()}>重新读取</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="connection-card">
            <div className="connection-intro">
              <div className="connection-icon">
                <Wifi size={24} />
              </div>
              <div>
                <div className="connection-name">{c?.ssid ?? a?.name ?? '未选择网卡'}</div>
                <span>
                  <i className={`status-dot ${a?.status === 'Up' ? '' : 'off'}`} />
                  {a?.status === 'Up' ? '已连接到本地网络' : '网卡未连接'}
                  <span className="separator">·</span>
                  {current?.protocol ?? a?.type ?? '等待连接'}
                </span>
              </div>
              <Badge tone={a?.status === 'Up' ? 'good' : 'neutral'}>
                {current?.band ?? '当前适配器'}
              </Badge>
            </div>
            <div className="network-path">
              <div>
                <Laptop size={23} />
                <strong>这台电脑</strong>
                <small>{ip?.address ?? '无 IPv4 地址'}</small>
              </div>
              <span className="path-link">
                <span />
                <small>{a?.status === 'Up' ? '链路已连接' : '未连接'}</small>
                <span />
              </span>
              <div>
                <Router size={24} />
                <strong>默认网关</strong>
                <small>{gateway ?? '未配置'}</small>
              </div>
              <span className="path-link muted">
                <span />
                <small>外网按需检测</small>
                <span />
              </span>
              <div className="muted">
                <Globe size={24} />
                <strong>互联网</strong>
                <small>可手动检测连接</small>
              </div>
            </div>
          </div>
          <div className="metrics-grid">
            <Metric
              label="接收链路速率"
              value={c ? Math.round(c.receiveMbps) : (a?.speedMbps ?? '—')}
              unit="Mbps"
              detail="协商速率，不是下载测速"
              accent
            />
            <Metric
              label="当前信号"
              value={current?.rssi ?? '—'}
              unit="dBm"
              detail={
                current
                  ? `信道 ${current.channel} · ${current.width ?? '未知'} MHz 广播频宽`
                  : '刷新无线扫描后显示'
              }
            />
            <Metric
              label="到网关平均延迟"
              value={ping ? text(row(ping.result).avgMs) : '—'}
              unit="ms"
              detail={
                ping
                  ? `${text(row(ping.result).sent)} 次探测 · ${text(row(ping.result).lossPercent)}% 丢包`
                  : '尚未检测，点击连通性诊断开始'
              }
            />
            <Metric
              label="当前下载 / 上传"
              value={
                rate
                  ? `${((rate.down * 8) / 1e6).toFixed(1)} / ${((rate.up * 8) / 1e6).toFixed(1)}`
                  : '—'
              }
              unit="Mbps"
              detail="所选网卡的实时字节计数"
            />
          </div>
          <div className="two-columns overview-columns">
            <Card
              title="实时网络流量"
              caption="仅统计所选网卡，避免物理网卡与虚拟网卡重复累加。"
              actions={
                <span className="live-label">
                  <i className="status-dot pulse" />
                  本机实时
                </span>
              }
            >
              <LineChart
                unit="Mbps"
                label="网卡实时上下行流量"
                series={[
                  {
                    name: '下载',
                    color: 'var(--accent)',
                    values: app.rates.map((r) => (r.down * 8) / 1e6),
                  },
                  {
                    name: '上传',
                    color: '#8d9cce',
                    values: app.rates.map((r) => (r.up * 8) / 1e6),
                  },
                ]}
              />
              <div className="traffic-totals">
                <span>
                  <ArrowDownLeft size={15} />
                  接口累计接收 <strong>{formatBytes(a?.receivedBytes ?? 0)}</strong>
                </span>
                <span>
                  <ArrowUpRight size={15} />
                  累计发送 <strong>{formatBytes(a?.sentBytes ?? 0)}</strong>
                </span>
              </div>
            </Card>
            <Card
              title="连接详情"
              actions={
                <Button variant="ghost" onClick={() => app.go('config')}>
                  配置
                  <ChevronRight size={14} />
                </Button>
              }
            >
              <KeyValues
                items={[
                  ['适配器', a?.name ?? '—'],
                  ['IPv4', ip ? `${ip.address} / ${ip.prefix}` : '—'],
                  ['网卡网关', gateway ?? '—'],
                  ['DNS', a?.dns.join('、') ?? '—'],
                  [
                    'IPv6',
                    a?.addresses.some(
                      (x) => x.family === 'InterNetworkV6' && !x.address.startsWith('fe80'),
                    )
                      ? '存在 IPv6 地址'
                      : '未发现全局地址',
                  ],
                  ['系统用户代理', o.proxy.enabled ? o.proxy.server : '未启用手动代理'],
                ]}
              />
            </Card>
          </div>
          <div className="section-heading">
            <h2>打开一个工具</h2>
            <span>检测结果保存在这台电脑上</span>
          </div>
          <div className="tool-grid">
            {[
              { page: 'wifi', icon: Wifi, name: '无线信道分析', desc: '查看附近热点与频宽重叠' },
              {
                page: 'diagnostics',
                icon: Activity,
                name: '连通性诊断',
                desc: '延迟、丢包与路由追踪',
              },
              { page: 'dns', icon: Search, name: 'DNS 查询与对比', desc: '检查解析结果与查询耗时' },
              { page: 'speed', icon: Gauge, name: '网络测速', desc: '外网吞吐与局域网对测' },
              { page: 'lan', icon: Network, name: '局域网设备', desc: '发现本地设备与开放服务' },
              { page: 'router', icon: Router, name: '小米路由器', desc: '无线参数与设备管理' },
            ].map((t) => (
              <button key={t.page} className="tool-tile" onClick={() => app.go(t.page)}>
                <span className="tool-icon">
                  <t.icon size={20} />
                </span>
                <span>
                  <strong>{t.name}</strong>
                  <small>{t.desc}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
          {o.wifiError && <Notice>{o.wifiError}</Notice>}
        </>
      )}
      <ErrorNotice error={action.error} />
    </>
  );
}
