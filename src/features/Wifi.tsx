import { useMemo, useState } from 'react';
import { RefreshCw, Router, Radio, Search } from 'lucide-react';
import { bridge } from '../shared/bridge';
import { useApp, useAction, useJob } from '../shared/context';
import { row, list, number, text, date } from '../shared/models';
import {
  Select,
  PageHeader,
  Card,
  Button,
  Metric,
  Tabs,
  tabLabelId,
  Table,
  Notice,
  ErrorNotice,
  Empty,
  Badge,
  JobControl,
} from '../shared/ui';
import { ChannelChart, LineChart } from '../shared/charts';
export function WifiPage() {
  const app = useApp(),
    action = useAction(),
    monitor = useJob('wifi');
  const [band, setBand] = useState('5 GHz'),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('signal');
  const scan = app.wifi;
  const networks = useMemo(() => {
    const values = (scan?.networks ?? []).filter(
      (n) => n.band === band && `${n.ssid} ${n.bssid}`.toLowerCase().includes(query.toLowerCase()),
    );
    return [...values].sort((a, b) =>
      sort === 'channel' ? a.channel - b.channel : b.rssi - a.rssi,
    );
  }, [scan, band, query, sort]);
  const own = scan?.networks.find((n) => n.connected);
  const best = scan?.candidates[0];
  const monitored = monitor.samples.map((s) => {
    const n = list(row(s).networks)
      .map(row)
      .find((n) => n.connected);
    return n && typeof n.rssi === 'number' ? n.rssi : null;
  });
  return (
    <>
      <PageHeader
        title="无线信道分析"
        description="把信号强度、广播频宽和邻近网络放到同一张图上。"
        actions={
          <>
            <Button
              busy={action.busy}
              disabled={monitor.job?.state === 'running'}
              onClick={() =>
                void action.run(async () => {
                  const result = await bridge.call<{ jobId: string }>('wifi.monitor', {
                    minutes: 60,
                  });
                  monitor.setId(result.jobId);
                  return result;
                })
              }
            >
              <Radio size={15} />
              持续观察
            </Button>
            <Button variant="primary" busy={app.scanning} onClick={() => void app.scan()}>
              <RefreshCw size={15} />
              刷新扫描
            </Button>
          </>
        }
      />
      <div className="metrics-grid">
        <Metric
          label="当前信道"
          value={own?.channel ?? '—'}
          detail={own?.band ?? '等待无线数据'}
          accent
        />
        <Metric label="广播频宽" value={own?.width ?? '—'} unit="MHz" detail="来自接入点广播信息" />
        <Metric
          label="当前信号"
          value={own?.rssi ?? '—'}
          unit="dBm"
          detail={own?.ssid ?? '尚未识别当前接入点'}
        />
        <Metric
          label="接入点报告占用"
          value={own?.utilization ?? '—'}
          unit="%"
          detail={
            own?.stations !== null && own?.stations !== undefined
              ? `${own.stations} 个连接终端`
              : '未报告的数据保持未知'
          }
        />
      </div>
      <Card
        className="wifi-chart-card"
        title="信道与频宽分布"
        caption={
          scan
            ? `${scan.refreshed ? '最近扫描' : 'Windows 缓存'} · ${date(scan.timestamp)} · ${scan.visibleNetworkCount} 个可见网络`
            : '点击刷新扫描获取附近网络'
        }
        actions={
          <Tabs
            label="无线频段"
            panelId="wifi-panel"
            items={['2.4 GHz', '5 GHz', '6 GHz'].map((v) => ({ id: v, label: v }))}
            value={band}
            onChange={setBand}
          />
        }
      >
        <div role="tabpanel" id="wifi-panel" aria-labelledby={tabLabelId('wifi-panel', band)}>
          {!networks.length ? (
            <Empty
              title={band === '6 GHz' ? '未扫描到 6 GHz 网络' : '此频段暂无扫描记录'}
              description={
                band === '6 GHz'
                  ? '需要网卡、驱动、地区和接入点共同支持；无记录不代表附近不存在。'
                  : '点击“刷新扫描”，并确认 Windows 位置权限已允许。'
              }
            />
          ) : band === '2.4 GHz' ? (
            <ChannelChart networks={networks} min={2400} max={2490} title="2.4 GHz · 信道 1–13" />
          ) : band === '5 GHz' ? (
            <div className="spectrum-groups">
              <ChannelChart networks={networks} min={5170} max={5330} title="5 GHz · 36–64" />
              {networks.some((n) => n.channel >= 100 && n.channel <= 144) && (
                <ChannelChart networks={networks} min={5490} max={5730} title="5 GHz · 100–144" />
              )}
              <ChannelChart networks={networks} min={5735} max={5835} title="5 GHz · 149–165" />
            </div>
          ) : (
            <Notice>
              已读取到 6 GHz
              热点。当前版本保留热点表中的实测频率；缺少可解析广播频宽时不绘制假定范围。
            </Notice>
          )}
        </div>
      </Card>
      {scan?.refreshed && best && band === '5 GHz' && (
        <div className="recommendation">
          <span className="recommendation-icon">
            <Radio size={21} />
          </span>
          <div>
            <strong>
              {best.channel === own?.channel && best.width === own.width
                ? '当前信道可保持'
                : `可对比试用：信道 ${best.channel} + ${best.width} MHz`}
            </strong>
            <p>
              {best.reason}。重叠风险评分 {best.risk}
              ，数值越低表示扫描到的重叠信号更弱；需切换后复测。
            </p>
          </div>
          <Button onClick={() => app.go('router')}>
            <Router size={15} />
            路由器设置
          </Button>
        </div>
      )}
      <Card
        title="附近接入点"
        actions={
          <div className="inline-controls">
            <label className="search-input">
              <Search size={14} />
              <input
                aria-label="筛选无线网络"
                placeholder="名称或 BSSID"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Select
              aria-label="无线网络排序"
              value={sort}
              onValueChange={(selectedValue) => setSort(selectedValue)}
            >
              <option value="signal">按信号强度</option>
              <option value="channel">按信道</option>
            </Select>
          </div>
        }
      >
        <Table
          rows={networks as unknown[]}
          rowKey="bssid"
          columns={[
            {
              title: '网络名称',
              key: 'ssid',
              render: (v, r) => (
                <span className="network-name">
                  {text(v, '隐藏网络')}
                  {r.connected === true && <Badge tone="good">当前</Badge>}
                </span>
              ),
            },
            { title: '信道', key: 'channel' },
            {
              title: '频宽',
              key: 'width',
              render: (v) => (v === null ? '未知' : `${text(v)} MHz`),
            },
            {
              title: '信号',
              key: 'rssi',
              render: (v) => (
                <span className="signal-value">
                  <i
                    style={{ width: `${Math.max(5, Math.min(100, (number(v) + 100) * 1.25))}%` }}
                  />
                  {text(v)} dBm
                </span>
              ),
            },
            {
              title: 'AP 占用',
              key: 'utilization',
              render: (v) => (v === null ? '未报告' : `${text(v)}%`),
            },
            {
              title: '协议 / 安全',
              key: 'protocol',
              render: (v, r) => (
                <span>
                  {text(v)}
                  <small className="cell-sub">{text(r.security)}</small>
                </span>
              ),
            },
            { title: 'BSSID', key: 'bssid', className: 'mono' },
          ]}
        />
      </Card>
      {monitor.job && (
        <Card title="当前连接的信号变化" caption="每 15 秒采样；延迟测试期间暂停主动扫描。">
          <JobControl job={monitor.job} />
          <LineChart
            domain={[-100, -20]}
            unit="dBm"
            label="Wi-Fi 信号时间线"
            series={[{ name: '当前连接 RSSI', color: 'var(--accent)', values: monitored }]}
          />
        </Card>
      )}
      <Notice>
        这是网卡当前位置的扫描视角。多个 BSSID
        可能来自同一设备；图形表示广播频宽，不是频谱仪测得的噪声或干扰功率。
      </Notice>
      <ErrorNotice error={action.error} />
    </>
  );
}
