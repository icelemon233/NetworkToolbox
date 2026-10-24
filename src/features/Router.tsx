import { useEffect, useState } from 'react';
import {
  Router,
  LockKeyhole,
  LogOut,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { bridge } from '../shared/bridge';
import { useApp, useAction } from '../shared/context';
import { row, list, text, number } from '../shared/models';
import {
  PageHeader,
  Card,
  Button,
  Field,
  Tabs,
  Notice,
  ErrorNotice,
  Empty,
  PlanDialog,
  Table,
  RawData,
  KeyValues,
  Badge,
} from '../shared/ui';
export function RouterPage() {
  const app = useApp(),
    action = useAction();
  const [info, setInfo] = useState<Record<string, unknown>>({}),
    [host, setHost] = useState(''),
    [password, setPassword] = useState(''),
    [remember, setRemember] = useState(false),
    [tab, setTab] = useState('wifi'),
    [data, setData] = useState<unknown>(null),
    [plan, setPlan] = useState<unknown>(null);
  const connected = info.connected === true;
  async function readInfo() {
    const result = await action.run(() =>
      bridge.call('router.info', { ...(host ? { host } : {}) }),
    );
    if (result) {
      setInfo(row(result));
      setRemember(row(result).credentialStored === true);
      if (!host) setHost(text(row(result).host, ''));
    }
  }
  async function load() {
    setData(null);
    const result = await action.run(() => bridge.call('router.read', { section: tab }));
    if (result !== undefined) setData(result);
  }
  useEffect(() => {
    void readInfo();
  }, []);
  useEffect(() => {
    setData(null);
    if (connected) void load();
  }, [tab, connected]);
  async function prepare(actionName: string, desired: Record<string, unknown>) {
    const result = await action.run(() =>
      bridge.call('router.plan', { action: actionName, desired }),
    );
    if (result) setPlan(result);
  }
  return (
    <>
      <PageHeader
        title="小米路由器"
        description="先适配 AX3000T / RD03 / 1.0.84，读取设备能力后再呈现可用设置。"
        actions={
          <>
            <Button
              onClick={() =>
                void action.run(() =>
                  bridge.openExternal(
                    `${host || 'http://' + app.overview?.gateway}/cgi-bin/luci/web`,
                  ),
                )
              }
            >
              <ExternalLink size={15} />
              打开原厂后台
            </Button>
            {connected && (
              <Button
                onClick={() =>
                  void action.run(async () => {
                    await bridge.call('router.disconnect');
                    setInfo((v) => ({ ...v, connected: false }));
                    setData(null);
                  })
                }
              >
                <LogOut size={15} />
                断开管理会话
              </Button>
            )}
          </>
        }
      />
      <div className="router-identity">
        <span className="router-device-icon">
          <Router size={34} />
        </span>
        <div>
          <h2>{text(info.name, '正在识别路由器')}</h2>
          <p>
            {text(info.host, '默认网关')}
            <span>·</span>固件 {text(info.firmware)}
            <span>·</span>
            {text(info.hardware)}
          </p>
        </div>
        <Badge tone={connected ? 'good' : 'neutral'}>
          {connected ? '管理会话已连接' : '尚未登录管理后台'}
        </Badge>
      </div>
      {!connected ? (
        <div className="two-columns login-columns">
          <Card title="连接管理会话" caption="管理密码仅用于本机与路由器之间的认证。">
            <form
              className="stack-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  const result = await bridge.call('router.connect', { host, password, remember });
                  setInfo((v) => ({ ...v, ...row(result) }));
                  setPassword('');
                  return result;
                });
              }}
            >
              <Field label="路由器地址">
                <input
                  required
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="http://192.168.31.1"
                />
              </Field>
              <Field
                label="路由器管理密码"
                hint={
                  info.credentialStored
                    ? '已存在受 Windows 保护的凭据，可留空尝试使用'
                    : '与 Wi-Fi 密码可能不同'
                }
              >
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  required={!info.credentialStored}
                />
              </Field>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                在这台 Windows 电脑上记住登录
              </label>
              <div className="button-row">
                <Button type="submit" variant="primary" busy={action.busy}>
                  <LockKeyhole size={15} />
                  连接路由器
                </Button>
                <Button busy={action.busy} onClick={() => void readInfo()}>
                  重新识别
                </Button>
                {info.credentialStored === true && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void action.run(async () => {
                        await bridge.call('router.disconnect', { forget: true });
                        setInfo((v) => ({ ...v, credentialStored: false }));
                      }, '已删除保存的路由器凭据')
                    }
                  >
                    忘记密码
                  </Button>
                )}
              </div>
            </form>
          </Card>
          <Card title="可以在这里做什么">
            <div className="capability-list">
              {[
                '查看并调整无线信道、频宽与发射强度',
                '管理设备上网权限、限速与无线黑名单',
                '配置 DHCP 地址池和静态 IP 绑定',
                '添加或删除端口转发规则',
                '读取路由器状态，保留完整后台入口',
              ].map((t) => (
                <div key={t}>
                  <ShieldCheck size={16} />
                  <span>{t}</span>
                </div>
              ))}
            </div>
            <Notice>
              保存凭据使用 Windows
              当前用户保护。固件升级后会重新检查适配条件，不向未知配置协议尝试写入。
            </Notice>
          </Card>
        </div>
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: 'wifi', label: '无线设置' },
              { id: 'devices', label: '设备管理' },
              { id: 'dhcp', label: 'DHCP' },
              { id: 'bindings', label: '静态绑定' },
              { id: 'forwards', label: '端口转发' },
              { id: 'status', label: '运行状态' },
            ]}
          />
          <div className="section-heading">
            <span>{action.busy ? '正在与路由器通信…' : '数据来自当前管理会话'}</span>
            <Button variant="ghost" busy={action.busy} onClick={() => void load()}>
              <RefreshCw size={14} />
              回读配置
            </Button>
          </div>
          {data === null ? (
            <Empty
              title="正在读取路由器配置"
              description="权限不足或接口不兼容时会显示具体原因。"
            />
          ) : tab === 'wifi' ? (
            <WifiSettings data={data} busy={action.busy} prepare={prepare} />
          ) : tab === 'devices' ? (
            <DeviceSettings data={data} busy={action.busy} prepare={prepare} />
          ) : tab === 'dhcp' ? (
            <DhcpSettings data={data} busy={action.busy} prepare={prepare} />
          ) : tab === 'bindings' ? (
            <BindingSettings data={data} busy={action.busy} prepare={prepare} />
          ) : tab === 'forwards' ? (
            <ForwardSettings data={data} busy={action.busy} prepare={prepare} />
          ) : (
            <Card title="路由器运行信息">
              <RawData data={data} label="查看路由器返回的运行状态" />
              <Notice>此型号的官方后台不提供 CPU 与内存占用，本应用不为其生成估计值。</Notice>
              <Button
                variant="danger"
                busy={action.busy}
                onClick={() => void prepare('reboot', {})}
              >
                <RotateCcw size={14} />
                预览重启路由器
              </Button>
            </Card>
          )}
        </>
      )}
      <ErrorNotice error={action.error} />
      {plan !== null && (
        <PlanDialog
          plan={plan}
          scope="router"
          onClose={() => setPlan(null)}
          onApplied={() => {
            setData(null);
            void load();
          }}
        />
      )}
    </>
  );
}
interface SettingProps {
  data: unknown;
  busy: boolean;
  prepare: (action: string, desired: Record<string, unknown>) => Promise<void>;
}
function WifiSettings({ data, busy, prepare }: SettingProps) {
  return (
    <>
      <div className="two-columns">
        {list(row(data).radios).map((v) => (
          <RadioSettings key={text(row(v).index)} radio={row(v)} busy={busy} prepare={prepare} />
        ))}
      </div>
      <Notice>
        信道和频宽选项来自此路由器当前地区与运行模式。修改时保留两个频段的其余配置和密码，提交后需要回读或重新扫描确认。
      </Notice>
    </>
  );
}
function RadioSettings({
  radio,
  busy,
  prepare,
}: {
  radio: Record<string, unknown>;
  busy: boolean;
  prepare: SettingProps['prepare'];
}) {
  const [channel, setChannel] = useState(number(radio.channel)),
    [bandwidth, setBandwidth] = useState(number(radio.bandwidth)),
    [power, setPower] = useState(text(radio.txpwr, 'mid')),
    [ssid, setSsid] = useState(text(radio.ssid, ''));
  const options = list(radio.channels).map(row);
  const selected = options.find((c) => number(c.c) === channel);
  const widths = list(selected?.b)
    .map((v) => number(v))
    .filter((n) => n > 0);
  return (
    <Card
      title={text(radio.band)}
      caption={`当前实际信道 ${text(radio.actualChannel)} · ${radio.enabled ? '已启用' : '已关闭'}`}
    >
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          void prepare('wifi', { band: radio.index, channel, bandwidth, txpwr: power, ssid });
        }}
      >
        <Field label="网络名称 SSID">
          <input value={ssid} onChange={(e) => setSsid(e.target.value)} required />
        </Field>
        <div className="two-fields">
          <Field label="信道">
            <select
              value={channel}
              onChange={(e) => {
                const next = Number(e.target.value);
                setChannel(next);
                const candidate = options.find((c) => number(c.c) === next);
                if (bandwidth !== 0 && !list(candidate?.b).includes(bandwidth)) setBandwidth(0);
              }}
              disabled={!options.length}
            >
              {!options.some((c) => number(c.c) === channel) && (
                <option value={channel}>{channel === 0 ? '自动' : channel}（当前）</option>
              )}
              {options.map((c) => (
                <option key={number(c.c)} value={number(c.c)}>
                  {number(c.c) === 0 ? '自动' : number(c.c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="频宽">
            <select value={bandwidth} onChange={(e) => setBandwidth(Number(e.target.value))}>
              <option value={0}>自动</option>
              {widths.map((w) => (
                <option key={w} value={w}>
                  {w} MHz
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="发射强度">
          <select value={power} onChange={(e) => setPower(e.target.value)}>
            <option value="max">穿墙</option>
            <option value="mid">标准</option>
            <option value="min">节能</option>
          </select>
        </Field>
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!options.length || radio.hasPassword === false}
        >
          <ShieldCheck size={15} />
          预览无线修改
        </Button>
        {!options.length && <Notice>未读取到可选信道，保留查看能力；请在原厂后台调整。</Notice>}
      </form>
    </Card>
  );
}
function DeviceSettings({ data, busy, prepare }: SettingProps) {
  const devices = list(row(data).list).map(row);
  const [mac, setMac] = useState(''),
    [operation, setOperation] = useState('deviceAccess'),
    [allow, setAllow] = useState(true),
    [up, setUp] = useState(0),
    [down, setDown] = useState(0);
  return (
    <>
      <Card title="路由器设备列表">
        <Table
          rows={devices}
          rowKey="mac"
          columns={[
            {
              key: 'name',
              title: '设备名称',
              render: (v, r) => text(v, text(r.oname, '未命名设备')),
            },
            {
              key: 'ip',
              title: 'IP 地址',
              render: (v) =>
                list(v)
                  .map((x) => text(row(x).ip))
                  .join('、'),
            },
            { key: 'mac', title: 'MAC 地址', className: 'mono' },
            {
              key: 'authority',
              title: '上网权限',
              render: (v) =>
                row(v).wan === undefined ? (
                  <Badge>未报告</Badge>
                ) : number(row(v).wan) === 1 ? (
                  <Badge tone="good">允许</Badge>
                ) : (
                  <Badge tone="warn">受限 / 未报告</Badge>
                ),
            },
            {
              key: 'mac',
              title: '操作',
              render: (v) => (
                <Button variant="ghost" onClick={() => setMac(text(v, ''))}>
                  选择设备
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card title="设备管理操作">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void prepare(operation, { mac, allow, upload: up, download: down });
          }}
        >
          <Field label="设备 MAC" className="grow">
            <input
              value={mac}
              onChange={(e) => setMac(e.target.value)}
              required
              placeholder="从上方选择或手动填写"
            />
          </Field>
          <Field label="操作">
            <select value={operation} onChange={(e) => setOperation(e.target.value)}>
              <option value="deviceAccess">上网权限</option>
              <option value="deviceLimit">设备限速</option>
              <option value="filter.add">加入无线黑名单</option>
              <option value="filter.remove">移出无线黑名单</option>
            </select>
          </Field>
          {operation === 'deviceAccess' && (
            <Field label="互联网访问">
              <select
                value={allow ? 'allow' : 'block'}
                onChange={(e) => setAllow(e.target.value === 'allow')}
              >
                <option value="allow">允许上网</option>
                <option value="block">禁止上网</option>
              </select>
            </Field>
          )}
          {operation === 'deviceLimit' && (
            <>
              <Field label="上传上限 KB/s">
                <input
                  type="number"
                  min={0}
                  value={up}
                  onChange={(e) => setUp(Number(e.target.value))}
                />
              </Field>
              <Field label="下载上限 KB/s">
                <input
                  type="number"
                  min={0}
                  value={down}
                  onChange={(e) => setDown(Number(e.target.value))}
                />
              </Field>
            </>
          )}
          <Button variant="primary" busy={busy} type="submit">
            预览修改
          </Button>
        </form>
        <p className="form-note">
          设备限速需要路由器已启用 QoS，0
          表示不限速。无线黑名单是否生效取决于当前过滤模式；不允许阻断当前管理设备。
        </p>
      </Card>
      <RawData data={data} />
    </>
  );
}
function DhcpSettings({ data, busy, prepare }: SettingProps) {
  const info = row(row(data).info),
    lan = row(list(info.lanIp)[0]),
    lanIp = text(lan.ip, ''),
    base = lanIp.split('.').slice(0, 3).join('.');
  const [enabled, setEnabled] = useState(number(info.ignore) === 0),
    [start, setStart] = useState(
      text(info.startip, base ? `${base}.${number(info.start, 100)}` : ''),
    ),
    [end, setEnd] = useState(
      text(
        info.endip,
        base ? `${base}.${number(info.start, 100) + number(info.limit, 100) - 1}` : '',
      ),
    ),
    [lease, setLease] = useState(
      number(info.leasetimeNum, 720) * (info.leasetimeUnit === 'h' ? 60 : 1),
    ),
    [dns1, setDns1] = useState(text(info.dns1, '')),
    [dns2, setDns2] = useState(text(info.dns2, '')),
    [gateway, setGateway] = useState(text(info.router, ''));
  return (
    <div className="two-columns">
      <Card title="DHCP 地址分配">
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            void prepare('dhcp', {
              enabled,
              start,
              end,
              leaseMinutes: lease,
              dns1,
              dns2,
              router: gateway,
            });
          }}
        >
          <label className="check-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            启用 DHCP 服务
          </label>
          <div className="two-fields">
            <Field label="地址池起始 IP">
              <input value={start} onChange={(e) => setStart(e.target.value)} required={enabled} />
            </Field>
            <Field label="地址池结束 IP">
              <input value={end} onChange={(e) => setEnd(e.target.value)} required={enabled} />
            </Field>
          </div>
          <Field label="租期（分钟）">
            <input
              type="number"
              min={2}
              max={43200}
              value={lease}
              onChange={(e) => setLease(Number(e.target.value))}
            />
          </Field>
          <div className="two-fields">
            <Field label="DNS 1（可留空）">
              <input value={dns1} onChange={(e) => setDns1(e.target.value)} />
            </Field>
            <Field label="DNS 2（可留空）">
              <input value={dns2} onChange={(e) => setDns2(e.target.value)} />
            </Field>
          </div>
          <Field label="下发网关（可留空）">
            <input value={gateway} onChange={(e) => setGateway(e.target.value)} />
          </Field>
          <Button variant="primary" busy={busy} type="submit">
            预览 DHCP 修改
          </Button>
        </form>
      </Card>
      <Card title="当前 LAN 信息">
        <KeyValues
          items={[
            ['LAN 地址', lanIp],
            ['子网掩码', text(lan.mask)],
            ['DHCP 状态', number(info.ignore) === 1 ? '关闭' : '开启'],
            ['原厂租期', text(info.leasetime)],
          ]}
        />
        <RawData data={data} />
      </Card>
    </div>
  );
}
function BindingSettings({ data, busy, prepare }: SettingProps) {
  const [name, setName] = useState(''),
    [mac, setMac] = useState(''),
    [ip, setIp] = useState('');
  return (
    <>
      <Card title="静态 IP 与 MAC 绑定">
        <Table
          rows={list(row(data).list)}
          columns={[
            { key: 'name', title: '设备名称' },
            { key: 'ip', title: 'IP 地址', className: 'mono' },
            { key: 'mac', title: 'MAC 地址', className: 'mono' },
            {
              key: 'mac',
              title: '操作',
              render: (v) => (
                <Button
                  variant="ghost"
                  busy={busy}
                  onClick={() => void prepare('binding.remove', { mac: v })}
                >
                  预览解除绑定
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card title="新增绑定">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void prepare('binding.add', { name, mac, ip });
          }}
        >
          <Field label="设备名称" className="grow">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="MAC 地址" className="grow">
            <input required value={mac} onChange={(e) => setMac(e.target.value)} />
          </Field>
          <Field label="IPv4 地址">
            <input required value={ip} onChange={(e) => setIp(e.target.value)} />
          </Field>
          <Button variant="primary" busy={busy} type="submit">
            预览新增绑定
          </Button>
        </form>
      </Card>
    </>
  );
}
function ForwardSettings({ data, busy, prepare }: SettingProps) {
  const [name, setName] = useState(''),
    [ip, setIp] = useState(''),
    [protocol, setProtocol] = useState(1),
    [external, setExternal] = useState(8080),
    [internal, setInternal] = useState(80);
  return (
    <>
      <Card title="已有端口转发规则">
        <Table
          rows={list(row(data).list)}
          columns={[
            { key: 'name', title: '名称' },
            {
              key: 'proto',
              title: '协议',
              render: (v) => ({ 1: 'TCP', 2: 'UDP', 3: 'TCP + UDP' })[number(v) as 1] ?? text(v),
            },
            { key: 'srcport', title: '外部端口' },
            { key: 'destip', title: '内部地址', className: 'mono' },
            { key: 'destport', title: '内部端口' },
            {
              key: 'srcport',
              title: '操作',
              render: (v, r) => (
                <Button
                  variant="ghost"
                  busy={busy}
                  onClick={() =>
                    void prepare('forward.remove', {
                      externalPort: typeof v === 'object' ? number(row(v).f) : Number(v),
                      protocol: Number(r.proto),
                    })
                  }
                >
                  预览删除
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card title="添加单端口转发">
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            void prepare('forward.add', {
              name,
              ip,
              protocol,
              externalPort: external,
              internalPort: internal,
            });
          }}
        >
          <div className="two-fields">
            <Field label="规则名称">
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="协议">
              <select value={protocol} onChange={(e) => setProtocol(Number(e.target.value))}>
                <option value={1}>TCP</option>
                <option value={2}>UDP</option>
                <option value={3}>TCP + UDP</option>
              </select>
            </Field>
          </div>
          <div className="three-fields">
            <Field label="外部端口">
              <input
                type="number"
                min={1}
                max={65535}
                required
                value={external}
                onChange={(e) => setExternal(Number(e.target.value))}
              />
            </Field>
            <Field label="内部 IPv4 地址">
              <input required value={ip} onChange={(e) => setIp(e.target.value)} />
            </Field>
            <Field label="内部端口">
              <input
                type="number"
                min={1}
                max={65535}
                required
                value={internal}
                onChange={(e) => setInternal(Number(e.target.value))}
              />
            </Field>
          </div>
          <div>
            <Button variant="primary" busy={busy} type="submit">
              预览新增转发
            </Button>
          </div>
        </form>
      </Card>
      <Notice>
        应用先通过只读页面或规则列表确定当前固件的接口，再提交到确认的路径；同名冲突不会自动覆盖已有规则。
      </Notice>
    </>
  );
}
