import {
  cloneElement,
  isValidElement,
  useId,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  ChevronRight,
  LoaderCircle,
  Check,
  Download,
  Play,
  Square,
  X,
  ShieldCheck,
} from 'lucide-react';
import { bridge } from './bridge';
import { useApp, useAction } from './context';
import { row, list, text, date, type Job } from './models';
import { useModalDialog } from './dialog';
export { Select } from './Select';
export function Button({
  children,
  variant = 'secondary',
  busy = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
      className={`button ${variant} ${props.className ?? ''}`}
    >
      {busy && <LoaderCircle size={15} className="spin" />}
      {children}
    </button>
  );
}
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  );
}
export function Card({
  title,
  caption,
  children,
  actions,
  className = '',
}: {
  title?: string;
  caption?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {caption && <p>{caption}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
export function Metric({
  label,
  value,
  unit,
  detail,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div className={`metric ${accent ? 'metric-accent' : ''}`}>
      <span className="eyebrow">{label}</span>
      <div className="metric-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {detail && <span className="metric-detail">{detail}</span>}
    </div>
  );
}
export function Empty({
  title = '尚无检测结果',
  description = '设置参数后开始检测。',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark">
        <ActivityMark />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function ActivityMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M3 15h5l3-7 5 13 3-6h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'error' | 'success';
}) {
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {tone === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
      <div>{children}</div>
    </div>
  );
}
export function ErrorNotice({ error }: { error?: string }) {
  return error ? <Notice tone="error">{error}</Notice> : null;
}
export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const child = isValidElement<{
    id?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
  }>(children)
    ? children
    : null;
  const controlId = child?.props.id ?? `${id}-control`;
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  return (
    <div className={`field ${className}`}>
      <label id={labelId} htmlFor={controlId}>
        {label}
      </label>
      {child
        ? cloneElement(child, {
            id: controlId,
            'aria-labelledby': child.props['aria-labelledby'] ?? labelId,
            'aria-describedby':
              [child.props['aria-describedby'], hint && hintId].filter(Boolean).join(' ') ||
              undefined,
          })
        : children}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
export function tabLabelId(panelId: string, value: string) {
  return `${panelId}-${encodeURIComponent(value)}`;
}
export function Tabs({
  items,
  value,
  onChange,
  label = '工具选项',
  panelId,
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
  panelId?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((i, index) => (
        <button
          key={i.id}
          role="tab"
          type="button"
          id={panelId ? tabLabelId(panelId, i.id) : undefined}
          aria-controls={panelId}
          aria-selected={i.id === value}
          tabIndex={i.id === value ? 0 : -1}
          className={i.id === value ? 'active' : ''}
          onClick={() => onChange(i.id)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const nextIndex =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
            const next = items[nextIndex];
            if (!next) return;
            onChange(next.id);
            const buttons =
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              );
            buttons?.[nextIndex]?.focus();
          }}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="key-values">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function RawData({ data, label = '详细检测数据' }: { data: unknown; label?: string }) {
  if (data === null || data === undefined) return null;
  return (
    <details className="raw">
      <summary>
        {label}
        <ChevronRight size={14} />
      </summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}
export interface Column {
  title: string;
  key: string;
  render?: (value: unknown, record: Record<string, unknown>) => ReactNode;
  className?: string;
}
export function Table({
  columns,
  rows,
  empty = '没有符合条件的记录',
  rowKey,
}: {
  columns: Column[];
  rows: unknown[];
  empty?: string;
  rowKey?: string;
}) {
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label={`数据表格：${columns.map((c) => c.title).join('、')}`}
    >
      <table>
        <thead>
          <tr>
            {columns.map((c, columnIndex) => (
              <th key={`${c.key}-${columnIndex}`} className={c.className}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <div className="table-empty">{empty}</div>
              </td>
            </tr>
          ) : (
            rows.map((value, index) => {
              const record = row(value);
              return (
                <tr key={text(rowKey ? record[rowKey] : index, String(index))}>
                  {columns.map((c, columnIndex) => (
                    <td key={`${c.key}-${columnIndex}`} className={c.className}>
                      {c.render ? c.render(record[c.key], record) : text(record[c.key])}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
export function JobControl({ job }: { job?: Job }) {
  const action = useAction();
  return (
    <>
      {job && (
        <div className="job-strip">
          <div>
            <span
              className={`status-dot ${{ running: 'pulse', completed: 'good', failed: 'bad', cancelled: 'off' }[job.state]}`}
            />
            <strong>{job.title}</strong>
            <span>
              {
                { running: '检测中', completed: '已完成', failed: '未完成', cancelled: '已停止' }[
                  job.state
                ]
              }
            </span>
          </div>
          {job.state === 'running' ? (
            <Button
              variant="ghost"
              onClick={() => void action.run(() => bridge.call('jobs.cancel', { id: job.id }))}
            >
              <Square size={13} />
              停止
            </Button>
          ) : (
            <span>{date(job.startedAt)}</span>
          )}
        </div>
      )}
      <ErrorNotice error={job?.error ?? action.error} />
    </>
  );
}
export function PlanDialog({
  plan,
  scope,
  onClose,
  onApplied,
  returnFocus,
}: {
  plan: unknown;
  scope: 'config' | 'router';
  onClose: () => void;
  onApplied?: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const dialog = useModalDialog(true, returnFocus);
  const titleId = useId();
  const action = useAction();
  const { notify } = useApp();
  const p = row(plan);
  const summary = row(p.summary);
  const before = row(scope === 'config' ? p.before : summary.before);
  const after = row(scope === 'config' ? p.desired : summary.after);
  const labels: Record<string, string> = {
    band: '频段',
    channel: '信道',
    bandwidth: '频宽',
    ssid: '网络名称',
    txpwr: '发射强度',
    enabled: '启用状态',
    server: '手动代理',
    pac: 'PAC 地址',
    bypass: '代理绕过列表',
    mtu: 'MTU',
    dhcp: 'DHCP',
    gateway: '默认网关',
    addresses: '静态地址',
    mac: '设备 MAC',
    allow: '允许上网',
    upload: '上传上限',
    download: '下载上限',
    unit: '单位',
    scope: '作用范围',
    operation: '操作',
    notice: '说明',
    start: '地址池起点',
    end: '地址池终点',
    leaseMinutes: '租期（分钟）',
    ip: '内部地址',
    proto: '协议',
    sport: '外部端口',
    dport: '内部端口',
    name: '规则名称',
  };
  function display(key: string, value: unknown): string {
    if (value === null || value === undefined) return '未报告';
    if (typeof value === 'boolean') return value ? '开启 / 允许' : '关闭 / 禁止';
    if ((key === 'channel' || key === 'bandwidth') && Number(value) === 0) return '自动';
    if (key === 'bandwidth') return `${text(value)} MHz`;
    if (key === 'txpwr')
      return { max: '穿墙', mid: '标准', min: '节能' }[text(value) as 'mid'] ?? text(value);
    if (key === 'addresses')
      return (
        list(value)
          .map((v) => `${text(row(v).address)}/${text(row(v).prefix)}`)
          .join('、') || '无静态地址'
      );
    return text(value, '未设置');
  }
  const changes =
    scope === 'config' && p.type === 'dns'
      ? [
          {
            label: `${text(after.family, 'IPv4')} DNS`,
            before: before.dnsAutomatic ? '自动获取' : list(before.dns).join('、') || '未设置',
            after: list(after.servers).length ? list(after.servers).join('、') : '自动获取',
          },
        ]
      : Object.keys(after).length
        ? Object.keys(after)
            .filter((key) => key !== 'family')
            .map((key) => ({
              label: labels[key] ?? key,
              before: display(key, before[key]),
              after: display(key, after[key]),
            }))
        : [];
  return (
    <dialog
      ref={dialog}
      className="plan-dialog"
      aria-labelledby={titleId}
      aria-busy={action.busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!action.busy) onClose();
      }}
    >
      <div className="dialog-head">
        <span className="dialog-icon">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h2 id={titleId}>检查将要应用的修改</h2>
          <p>
            {scope === 'router' ? '仅提交本次预览的路由器设置' : '修改前会自动保存可恢复的配置快照'}
          </p>
        </div>
        <Button aria-label="关闭配置预览" variant="ghost" disabled={action.busy} onClick={onClose}>
          <X size={17} />
        </Button>
      </div>
      <div className="plan-content">
        {changes.length > 0 ? (
          <Table
            rows={changes}
            columns={[
              { key: 'label', title: '设置项' },
              { key: 'before', title: '修改前' },
              { key: 'after', title: '修改后' },
            ]}
          />
        ) : (
          <KeyValues
            items={Object.entries(summary)
              .filter(([key]) => key !== 'before' && key !== 'after')
              .map(([key, value]) => [labels[key] ?? key, display(key, value)])}
          />
        )}
        {typeof summary.notice === 'string' && changes.length > 0 && (
          <Notice>{summary.notice}</Notice>
        )}
      </div>
      <ErrorNotice error={action.error} />
      <div className="dialog-actions">
        <Button disabled={action.busy} onClick={onClose}>
          取消
        </Button>
        <Button
          variant="primary"
          busy={action.busy}
          onClick={() =>
            void action.run(async () => {
              const result = await bridge.call(`${scope}.apply`, { id: p.id });
              notify(scope === 'router' ? '请求已提交，请回读配置确认' : '配置已应用，快照已保存');
              onApplied?.();
              onClose();
              return result;
            })
          }
        >
          应用修改
        </Button>
      </div>
    </dialog>
  );
}
export function ExportButton({ id, kind = 'report' }: { id: string; kind?: 'report' | 'capture' }) {
  const action = useAction();
  const { notify } = useApp();
  return (
    <>
      <Button
        variant="ghost"
        busy={action.busy}
        onClick={() =>
          void action.run(async () => {
            const result = await bridge.exportRecord(id, kind);
            if (result.saved) notify('文件已保存');
            return result;
          })
        }
      >
        <Download size={14} />
        导出
      </Button>
      <ErrorNotice error={action.error} />
    </>
  );
}
export const StartIcon = () => <Play size={14} fill="currentColor" />;
export function JsonResults({ data }: { data: unknown }) {
  const r = row(data);
  if (!Object.keys(r).length) return null;
  return (
    <>
      <KeyValues
        items={Object.entries(r)
          .filter(([, v]) => v !== null && typeof v !== 'object')
          .map(([k, v]) => [k, text(v)])}
      />
      {Object.entries(r)
        .filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => {
          const values = list(v);
          const first = row(values[0]);
          return (
            <div key={k}>
              <h3 className="section-label">{k}</h3>
              {Object.keys(first).length ? (
                <Table
                  rows={values}
                  columns={Object.keys(first).map((key) => ({ key, title: key }))}
                />
              ) : (
                <pre>{JSON.stringify(values, null, 2)}</pre>
              )}
            </div>
          );
        })}
      <RawData data={data} />
    </>
  );
}
