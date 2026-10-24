import { useEffect, useState } from 'react';
import { ScanLine, Square, FileSearch, RefreshCw, Search } from 'lucide-react';
import { bridge } from '../shared/bridge';
import { useAction } from '../shared/context';
import { row, list, text, number, formatBytes, date } from '../shared/models';
import {
  Select,
  PageHeader,
  Card,
  Button,
  Field,
  Metric,
  Notice,
  ErrorNotice,
  Table,
  ExportButton,
  Badge,
} from '../shared/ui';
export function CapturePage() {
  const action = useAction(),
    files = useAction(),
    inspect = useAction();
  const [maxMb, setMaxMb] = useState(64),
    [query, setQuery] = useState('');
  const data = row(files.data),
    session = row(data.session);
  const running = Object.keys(session).length > 0;
  const summary = row(inspect.data),
    packets = list(summary.packets).filter((v) =>
      JSON.stringify(v).toLowerCase().includes(query.toLowerCase()),
    );
  const load = () => files.run(() => bridge.call('capture.list'));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [running]);
  return (
    <>
      <PageHeader
        title="数据包捕获"
        description="使用 Windows Packet Monitor 捕获，查看基础报文并导出标准 pcapng。"
      />
      <Card title="本机接口捕获" caption="仅捕获网卡组件，使用循环日志限制磁盘占用。">
        <div className="toolbar">
          <Field label="最大原始日志大小">
            <Select
              value={maxMb}
              onValueChange={(selectedValue) => setMaxMb(Number(selectedValue))}
              disabled={running}
            >
              {[32, 64, 128, 256].map((n) => (
                <option key={n} value={n}>
                  {n} MB
                </option>
              ))}
            </Select>
          </Field>
          {running ? (
            <Button
              variant="primary"
              busy={action.busy}
              onClick={() =>
                void action.run(async () => {
                  const result = await bridge.call('capture.stop');
                  await load();
                  return result;
                }, '捕获已停止并转换为 pcapng')
              }
            >
              <Square size={15} />
              停止并保存
            </Button>
          ) : (
            <Button
              variant="primary"
              busy={action.busy}
              onClick={() =>
                void action.run(async () => {
                  const result = await bridge.call('capture.start', { maxMb });
                  await load();
                  return result;
                })
              }
            >
              <ScanLine size={15} />
              开始捕获
            </Button>
          )}
          {running && <Badge tone="good">正在捕获 · {date(session.startedAt)}</Badge>}
        </div>
        <ErrorNotice error={action.error} />
        <p className="form-note">
          启动与停止按需请求管理员权限。不会停止其他工具启动的捕获；未自行安装捕获驱动。
        </p>
      </Card>
      <Card
        title="已保存的捕获"
        actions={
          <Button variant="ghost" busy={files.busy} onClick={() => void load()}>
            <RefreshCw size={14} />
            刷新
          </Button>
        }
      >
        <Table
          rows={list(data.files)}
          rowKey="id"
          columns={[
            { key: 'createdAt', title: '创建时间', render: date },
            { key: 'id', title: '捕获编号', render: (v) => <code>{text(v).slice(0, 12)}</code> },
            { key: 'bytes', title: '文件大小', render: (v) => formatBytes(number(v)) },
            {
              key: 'id',
              title: '操作',
              render: (v) => (
                <div className="button-row">
                  <Button
                    variant="ghost"
                    busy={inspect.busy}
                    onClick={() =>
                      void inspect.run(() => bridge.call('capture.inspect', { id: v }))
                    }
                  >
                    <FileSearch size={14} />
                    查看
                  </Button>
                  <ExportButton id={text(v)} kind="capture" />
                </div>
              ),
            },
          ]}
        />
        <ErrorNotice error={files.error || inspect.error} />
      </Card>
      {inspect.data !== null && (
        <>
          <div className="metrics-grid three">
            <Metric label="已解析数据包" value={text(summary.packetCount)} accent />
            <Metric label="原始报文总量" value={formatBytes(number(summary.totalBytes))} />
            <Metric label="协议种类" value={Object.keys(row(summary.protocols)).length} />
          </div>
          <Card title="协议分布">
            <div className="protocol-bars">
              {Object.entries(row(summary.protocols))
                .sort((a, b) => number(b[1]) - number(a[1]))
                .map(([name, n]) => (
                  <div key={name}>
                    <span>{name}</span>
                    <div>
                      <i
                        style={{
                          width: `${(number(n) * 100) / Math.max(1, number(summary.packetCount))}%`,
                        }}
                      />
                    </div>
                    <strong>{text(n)}</strong>
                  </div>
                ))}
            </div>
          </Card>
          <Card
            title="数据包预览"
            caption="展示前 1000 条记录；完整文件可用 Wireshark 打开。"
            actions={
              <label className="search-input">
                <Search size={14} />
                <input
                  aria-label="筛选捕获报文"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="地址、端口、协议"
                />
              </label>
            }
          >
            <Table
              rows={packets}
              columns={[
                { key: 'number', title: '#' },
                { key: 'source', title: '源地址', className: 'mono' },
                { key: 'destination', title: '目的地址', className: 'mono' },
                { key: 'protocol', title: '协议' },
                { key: 'sourcePort', title: '源端口' },
                { key: 'destinationPort', title: '目的端口' },
                { key: 'length', title: '长度' },
                {
                  key: 'hex',
                  title: '报文十六进制',
                  render: (v) => (
                    <details>
                      <summary>查看前 64 字节</summary>
                      <code className="packet-hex">{text(v)}</code>
                    </details>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}
      <Notice>
        捕获可能包含本机通信数据；文件只保存在本地。当前提供以太网、IPv4 / IPv6、TCP / UDP、ARP
        的基础解析，不解密加密内容。
      </Notice>
    </>
  );
}
