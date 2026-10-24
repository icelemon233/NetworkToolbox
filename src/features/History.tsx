import { useEffect, useState } from 'react';
import { RefreshCw, GitCompareArrows, Trash2, FileText } from 'lucide-react';
import { bridge } from '../shared/bridge';
import { productName, developer } from '../shared/product';
import { useAction, useApp } from '../shared/context';
import { row, list, text, date, type Job } from '../shared/models';
import { diffRecords, type Difference } from '../shared/diff';
import {
  PageHeader,
  Card,
  Button,
  Field,
  Notice,
  ErrorNotice,
  Empty,
  Table,
  RawData,
  ExportButton,
  JobControl,
  KeyValues,
} from '../shared/ui';
const typeNames: Record<string, string> = {
  dns: 'DNS 查询',
  web: 'HTTP / TLS',
  ports: '端口检测',
  wifi: '无线扫描',
  ping: 'Ping',
  trace: '路由追踪',
  speed: '外网测速',
  'lan-speed': '局域网测速',
  discovery: '设备发现',
  snapshot: '网络快照',
  configuration: '本机配置',
  router: '路由器配置',
  capture: '数据包捕获',
  traffic: '进程流量',
};
export function HistoryPage() {
  const action = useAction(),
    detail = useAction(),
    compare = useAction();
  const [type, setType] = useState('all'),
    [a, setA] = useState(''),
    [b, setB] = useState(''),
    [diff, setDiff] = useState<Difference[] | null>(null);
  const { notify } = useApp();
  const load = () => action.run(() => bridge.call('history.list'));
  useEffect(() => {
    void load();
  }, []);
  const all = list(action.data).map(row),
    rows = all.filter((r) => type === 'all' || r.type === type);
  return (
    <>
      <PageHeader
        title="历史与对比"
        description="本地保存检测快照和修改记录，比较调整前后的实际变化。"
        actions={
          <Button busy={action.busy} onClick={() => void load()}>
            <RefreshCw size={15} />
            刷新记录
          </Button>
        }
      />
      <Card
        title="选择两次记录对比"
        caption="忽略记录时间与瞬时网卡累计字节；按网卡 / BSSID 标识匹配条目。"
      >
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void compare.run(async () => {
              const [before, after] = await Promise.all([
                bridge.call('history.read', { id: a }),
                bridge.call('history.read', { id: b }),
              ]);
              const result = diffRecords(row(before).data, row(after).data);
              setDiff(result);
              return result;
            });
          }}
        >
          <Field label="调整前" className="grow">
            <select required value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">选择记录</option>
              {all.map((r) => (
                <option key={text(r.id)} value={text(r.id)}>
                  {date(r.createdAt)} · {text(r.title)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="调整后" className="grow">
            <select required value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">选择记录</option>
              {all.map((r) => (
                <option key={text(r.id)} value={text(r.id)}>
                  {date(r.createdAt)} · {text(r.title)}
                </option>
              ))}
            </select>
          </Field>
          <Button
            type="submit"
            variant="primary"
            busy={compare.busy}
            disabled={!a || !b || a === b}
          >
            <GitCompareArrows size={15} />
            比较变化
          </Button>
        </form>
        <ErrorNotice error={compare.error} />
        {diff !== null && (
          <Table
            rows={diff}
            columns={[
              { key: 'path', title: '变化字段', className: 'mono' },
              { key: 'before', title: '调整前' },
              { key: 'after', title: '调整后' },
            ]}
            empty="选定记录在可比较字段上没有变化"
          />
        )}
      </Card>
      <Card
        title={`检测与修改记录 · ${rows.length}`}
        actions={
          <select aria-label="历史记录类型" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">所有类型</option>
            {[...new Set(all.map((r) => text(r.type)))].map((t) => (
              <option key={t} value={t}>
                {typeNames[t] ?? t}
              </option>
            ))}
          </select>
        }
      >
        <Table
          rows={rows}
          rowKey="id"
          columns={[
            { key: 'createdAt', title: '时间', render: date },
            { key: 'type', title: '类型', render: (v) => typeNames[text(v)] ?? text(v) },
            { key: 'title', title: '记录' },
            {
              key: 'id',
              title: '操作',
              render: (v) => (
                <div className="button-row">
                  <Button
                    variant="ghost"
                    busy={detail.busy}
                    onClick={() => void detail.run(() => bridge.call('history.read', { id: v }))}
                  >
                    <FileText size={14} />
                    查看
                  </Button>
                  <ExportButton id={text(v)} />
                  <Button
                    variant="ghost"
                    aria-label="删除此条历史记录"
                    onClick={() =>
                      void action.run(async () => {
                        await bridge.call('history.delete', { id: v });
                        await load();
                        notify('历史记录已删除');
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ),
            },
          ]}
        />
        <ErrorNotice error={action.error || detail.error} />
      </Card>
      {detail.data !== null && (
        <Card
          title={text(row(detail.data).title, '检测详情')}
          caption={date(row(detail.data).createdAt)}
        >
          <RawData data={row(detail.data).data} label="展开完整记录" />
        </Card>
      )}
      <Notice>最多保留 500 条检测记录。导出报告会移除凭据字段，仍可能含网络名称和设备地址。</Notice>
    </>
  );
}
export function TasksPage() {
  const app = useApp();
  const running = app.jobs.filter((j) => j.state === 'running');
  return (
    <>
      <PageHeader title="后台检测任务" description="任务由你手动启动；最小化到托盘后继续运行。" />
      <div className="tasks-summary">
        <span className="status-dot pulse" />
        <strong>{running.length}</strong> 个正在运行的任务
        <span className="muted">· 同时最多 8 个</span>
      </div>
      {app.jobs.length ? (
        app.jobs.map((job) => (
          <Card key={job.id}>
            <JobControl job={job} />
            <div className="task-progress">
              <span style={{ width: `${job.progress}%` }} />
            </div>
            <div className="task-meta">
              <span>开始于 {date(job.startedAt)}</span>
              <span>
                {Math.max(
                  (job as Job & { sampleCount?: number }).sampleCount ?? 0,
                  app.samples[job.id]?.length ?? 0,
                )}{' '}
                个样本
              </span>
              <span>{job.progress}%</span>
            </div>
            {job.state !== 'running' && <RawData data={job.result} />}
          </Card>
        ))
      ) : (
        <Empty
          title="还没有后台任务"
          description="从无线监测、连续 Ping、路由追踪或测速工具开始。"
        />
      )}
      <Notice>主动无线扫描与延迟测试协调运行。手动停止的任务会保存已收集的部分结果。</Notice>
    </>
  );
}
export function SettingsPage() {
  const app = useApp(),
    action = useAction();
  useEffect(() => {
    void action.run(() => bridge.call('meta'));
  }, []);
  const meta = row(action.data);
  return (
    <>
      <PageHeader title="应用设置" description="界面与数据保留在本机，不需要云账号。" />
      <div className="two-columns">
        <Card title="外观">
          <Field label="主题">
            <select value={app.theme} onChange={(e) => app.setTheme(e.target.value)}>
              <option value="system">跟随 Windows</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </Field>
        </Card>
        <Card title="后台运行">
          <KeyValues
            items={[
              ['关闭窗口', '最小化到系统托盘'],
              ['外网检测', '由你手动开始'],
              ['后台通知', '任务完成或失败时提醒'],
              ['退出应用', '托盘菜单 → 退出'],
            ]}
          />
          <Button onClick={() => void bridge.window('tray')}>最小化到托盘</Button>
          <Button variant="ghost" onClick={() => void bridge.window('quit')}>
            退出应用
          </Button>
        </Card>
        <Card title="本地数据">
          <KeyValues
            items={[
              ['保存位置', text(meta.dataDirectory)],
              ['历史记录上限', '500 条'],
              ['路由器凭据', '可选择由 Windows 当前用户保护'],
              ['遥测与云同步', '未启用'],
            ]}
          />
        </Card>
        <Card title={`关于 ${productName}`}>
          <KeyValues
            items={[
              ['版本', text(meta.version)],
              ['开发者', developer],
              ['支持系统', 'Windows 11 x64'],
              ['首个路由器适配', '小米 AX3000T · RD03 · CN · 1.0.84'],
              ['Packet Monitor', meta.captureAvailable ? '系统已提供' : '当前系统不可用'],
            ]}
          />
          <Button
            onClick={() =>
              void action.run(() => bridge.openExternal('ms-settings:privacy-location'))
            }
          >
            打开 Windows 位置权限设置
          </Button>
          <ErrorNotice error={action.error} />
        </Card>
      </div>
    </>
  );
}
