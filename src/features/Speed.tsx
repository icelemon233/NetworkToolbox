import { useState } from 'react';
import { Gauge, Server, Square } from 'lucide-react';
import { bridge } from '../shared/bridge';
import { useAction, useJob } from '../shared/context';
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
  StartIcon,
  RawData,
  KeyValues,
} from '../shared/ui';
import { LineChart } from '../shared/charts';
export function SpeedPage() {
  const [tab, setTab] = useState('internet');
  return (
    <>
      <PageHeader title="网络测速" description="测量实际传输能力，并观察传输时延迟如何变化。" />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'internet', label: '外网测速' },
          { id: 'lan', label: '局域网对测' },
        ]}
      />
      {tab === 'internet' ? <InternetSpeed /> : <LanSpeed />}
    </>
  );
}
function InternetSpeed() {
  const action = useAction(),
    active = useJob('speed');
  const [server, setServer] = useState('https://speed.cloudflare.com'),
    [size, setSize] = useState(32);
  const result = row(active.job?.result);
  const downloads = active.samples.map(row).filter((s) => s.phase === 'download'),
    uploads = active.samples.map(row).filter((s) => s.phase === 'upload'),
    latencies = active.samples.map(row).filter((s) => s.phase === 'latency');
  const last = row(active.samples.at(-1));
  return (
    <>
      <Card
        title="测试到指定服务的吞吐"
        caption="默认服务为 Cloudflare；自定义服务需兼容 /__down 与 /__up 接口。"
      >
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const value = await bridge.call<{ jobId: string }>('speed.start', {
                server,
                downloadMb: size,
                uploadMb: Math.max(4, Math.round(size / 4)),
              });
              active.setId(value.jobId);
              return value;
            });
          }}
        >
          <Field label="测速服务" className="grow">
            <input type="url" required value={server} onChange={(e) => setServer(e.target.value)} />
          </Field>
          <Field label="下载数据量">
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {[16, 32, 64, 128].map((n) => (
                <option key={n} value={n}>
                  {n} MB
                </option>
              ))}
            </select>
          </Field>
          <Button
            variant="primary"
            busy={action.busy}
            disabled={active.job?.state === 'running'}
            type="submit"
          >
            <Gauge size={15} />
            开始测速
          </Button>
        </form>
        <p className="form-note">
          本次约传输 {size + Math.max(4, Math.round(size / 4))}{' '}
          MB，并发送少量延迟探测请求。仅在点击后联网。
        </p>
        <ErrorNotice error={action.error} />
      </Card>
      <JobControl job={active.job} />
      <div className="metrics-grid">
        <Metric
          label="下载速度"
          value={
            typeof result.downloadMbps === 'number'
              ? result.downloadMbps.toFixed(1)
              : downloads.length
                ? number(downloads.at(-1)?.mbps).toFixed(1)
                : '—'
          }
          unit="Mbps"
          accent
        />
        <Metric
          label="上传速度"
          value={
            typeof result.uploadMbps === 'number'
              ? result.uploadMbps.toFixed(1)
              : uploads.length
                ? number(uploads.at(-1)?.mbps).toFixed(1)
                : '—'
          }
          unit="Mbps"
        />
        <Metric
          label="空闲 HTTP 延迟"
          value={typeof result.idleLatencyMs === 'number' ? result.idleLatencyMs : '—'}
          unit="ms"
        />
        <Metric
          label="负载下 HTTP 延迟"
          value={
            typeof result.loadedLatencyMs === 'number'
              ? result.loadedLatencyMs
              : latencies.length
                ? number(latencies.at(-1)?.ms).toFixed(1)
                : '—'
          }
          unit="ms"
        />
      </div>
      <Card
        title="测速过程"
        caption={
          active.job?.state === 'running'
            ? ({
                idle: '测量空闲延迟',
                download: '正在下载',
                upload: '正在上传',
                latency: '正在传输与采样',
              }[text(last.phase) as 'idle'] ?? '正在连接测速服务')
            : '每次测速独立保存结果'
        }
      >
        {active.samples.length ? (
          <LineChart
            unit="Mbps"
            series={[
              {
                name: '下载',
                color: 'var(--accent)',
                values: downloads.map((s) => number(s.mbps)),
              },
              { name: '上传', color: '#8d9cce', values: uploads.map((s) => number(s.mbps)) },
            ]}
          />
        ) : (
          <Empty
            title="等待测速开始"
            description="协商速率与实际吞吐不同，测速结果对应到所选服务的路径。"
          />
        )}
        <RawData data={active.job?.result} />
      </Card>
      <Notice>
        单连接测速会受到远端服务、路径和代理影响。负载延迟使用 HTTP 响应时间，不与 ICMP Ping
        混为同一指标。
      </Notice>
    </>
  );
}
function LanSpeed() {
  const server = useAction(),
    action = useAction(),
    active = useJob('lan-speed');
  const [target, setTarget] = useState(''),
    [port, setPort] = useState(5201),
    [key, setKey] = useState(''),
    [direction, setDirection] = useState('upload'),
    [size, setSize] = useState(32);
  const receiver = row(server.data);
  return (
    <>
      <div className="two-columns">
        <Card title="在这台电脑启动接收端" caption="另一台电脑打开同一工具箱，填入地址和密钥。">
          <Field label="监听端口">
            <input
              type="number"
              value={port}
              min={1024}
              max={65535}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </Field>
          <div className="button-row">
            {receiver.running === true ? (
              <Button
                busy={server.busy}
                onClick={() => void server.run(() => bridge.call('lan.server.stop'))}
              >
                <Square size={14} />
                停止接收端
              </Button>
            ) : (
              <Button
                busy={server.busy}
                onClick={() => void server.run(() => bridge.call('lan.server', { port }))}
              >
                <Server size={15} />
                启动接收端
              </Button>
            )}
          </div>
          {receiver.running === true && (
            <KeyValues
              items={[
                [
                  '本机地址',
                  list(receiver.addresses)
                    .map((v) => text(v))
                    .join('、'),
                ],
                ['端口', text(receiver.port)],
                ['连接密钥', <code>{text(receiver.key)}</code>],
              ]}
            />
          )}
          <ErrorNotice error={server.error} />
        </Card>
        <Card title="连接另一台电脑测速">
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                const result = await bridge.call<{ jobId: string }>('lan.speed.start', {
                  target,
                  port,
                  key,
                  direction,
                  mb: size,
                });
                active.setId(result.jobId);
                return result;
              });
            }}
          >
            <Field label="接收端 IP 地址">
              <input
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="例如 192.168.1.20"
              />
            </Field>
            <Field label="接收端连接密钥">
              <input
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <div className="two-fields">
              <Field label="传输方向">
                <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                  <option value="upload">本机 → 接收端</option>
                  <option value="download">接收端 → 本机</option>
                </select>
              </Field>
              <Field label="数据量">
                <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
                  {[16, 32, 64, 128, 256].map((n) => (
                    <option key={n} value={n}>
                      {n} MB
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Button variant="primary" busy={action.busy} type="submit">
              <StartIcon />
              开始局域网对测
            </Button>
          </form>
          <ErrorNotice error={action.error} />
        </Card>
      </div>
      <JobControl job={active.job} />
      {active.job && (
        <Card title="局域网传输结果">
          <Metric
            label="实际传输吞吐"
            value={
              typeof row(active.job.result).mbps === 'number'
                ? number(row(active.job.result).mbps).toFixed(1)
                : number(row(active.samples.at(-1)).mbps).toFixed(1)
            }
            unit="Mbps"
          />
          <LineChart
            unit="Mbps"
            series={[
              {
                name: '传输吞吐',
                color: 'var(--accent)',
                values: active.samples.map((s) => number(row(s).mbps)),
              },
            ]}
          />
          <RawData data={active.job.result} />
        </Card>
      )}
      <Notice>
        这是工具箱自带的双端测试协议，不是 iperf 服务。建议另一端使用有线连接，以帮助区分 Wi-Fi
        与外网路径的影响；Windows 防火墙可能需要允许局域网连接。
      </Notice>
    </>
  );
}
