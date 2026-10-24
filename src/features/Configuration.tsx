import { useEffect, useState } from 'react';
import { RotateCcw, ShieldCheck } from 'lucide-react';
import { bridge } from '../shared/bridge';
import { useAction, useApp } from '../shared/context';
import { list, date } from '../shared/models';
import {
  PageHeader,
  Card,
  Button,
  Field,
  Tabs,
  Notice,
  ErrorNotice,
  PlanDialog,
  Table,
  KeyValues,
} from '../shared/ui';
export function ConfigurationPage() {
  const app = useApp(),
    action = useAction(),
    backups = useAction();
  const [tab, setTab] = useState('dns'),
    [dns, setDns] = useState(''),
    [automatic, setAutomatic] = useState(false),
    [family, setFamily] = useState('IPv4'),
    [dhcp, setDhcp] = useState(true),
    [ip, setIp] = useState(''),
    [prefix, setPrefix] = useState(24),
    [gateway, setGateway] = useState(''),
    [mtu, setMtu] = useState(1500),
    [proxyOn, setProxyOn] = useState(false),
    [proxy, setProxy] = useState(''),
    [pac, setPac] = useState(''),
    [bypass, setBypass] = useState('<local>'),
    [enable, setEnable] = useState(true),
    [plan, setPlan] = useState<unknown>(null);
  const adapter = app.overview?.adapters.find((a) => a.id === app.adapterId);
  const loadBackups = () => backups.run(() => bridge.call('config.snapshots'));
  useEffect(() => {
    void loadBackups();
  }, []);
  async function preview() {
    let desired: Record<string, unknown> = {};
    if (tab === 'dns')
      desired = { servers: automatic ? [] : dns.split(/[,，\s]+/).filter(Boolean), family };
    else if (tab === 'ip')
      desired = { dhcp, addresses: dhcp ? [] : [{ address: ip, prefix }], gateway };
    else if (tab === 'mtu') desired = { mtu };
    else if (tab === 'proxy') desired = { enabled: proxyOn, server: proxy, pac, bypass };
    else if (tab === 'adapter') desired = { enabled: enable };
    const result = await action.run(() =>
      bridge.call('config.plan', { type: tab, adapterId: app.adapterId, desired }),
    );
    if (result) setPlan(result);
  }
  return (
    <>
      <PageHeader
        title="本机网络配置"
        description="预览修改、保存原配置，再按需申请 Windows 管理员权限。"
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'dns', label: 'DNS 设置' },
          { id: 'ip', label: 'IP 与 DHCP' },
          { id: 'mtu', label: 'MTU' },
          { id: 'proxy', label: '系统用户代理' },
          { id: 'adapter', label: '网卡开关' },
          { id: 'backups', label: '配置恢复' },
        ]}
      />
      {tab === 'backups' ? (
        <Card
          title="已保存的修改前快照"
          actions={
            <Button busy={backups.busy} onClick={() => void loadBackups()}>
              刷新
            </Button>
          }
        >
          <Table
            rows={list(backups.data)}
            rowKey="id"
            columns={[
              { key: 'createdAt', title: '保存时间', render: date },
              { key: 'type', title: '配置类型' },
              { key: 'adapterId', title: '网卡标识', className: 'mono' },
              {
                key: 'id',
                title: '操作',
                render: (v) => (
                  <Button
                    busy={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        const result = await bridge.call('config.restore', { id: v });
                        await app.refresh();
                        return result;
                      }, '已恢复所选快照的配置')
                    }
                  >
                    <RotateCcw size={14} />
                    恢复此项配置
                  </Button>
                ),
              },
            ]}
          />
          <ErrorNotice error={action.error || backups.error} />
        </Card>
      ) : (
        <div className="two-columns config-columns">
          <Card
            title={
              {
                dns: '设置网卡 DNS',
                ip: '配置 IPv4 地址',
                mtu: '设置 IPv4 MTU',
                proxy: '配置当前用户代理',
                adapter: '启用或禁用网卡',
              }[tab]
            }
          >
            <form
              className="stack-form"
              onSubmit={(e) => {
                e.preventDefault();
                void preview();
              }}
            >
              {tab !== 'proxy' && (
                <Field label="目标适配器">
                  <select value={app.adapterId} onChange={(e) => app.setAdapterId(e.target.value)}>
                    {app.overview?.adapters.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.description}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {tab === 'dns' && (
                <>
                  <Field label="地址族">
                    <select value={family} onChange={(e) => setFamily(e.target.value)}>
                      <option>IPv4</option>
                      <option>IPv6</option>
                    </select>
                  </Field>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={automatic}
                      onChange={(e) => setAutomatic(e.target.checked)}
                    />
                    自动获取 DNS 服务器
                  </label>
                  {!automatic && (
                    <Field
                      label="DNS 服务器地址"
                      hint="最多 4 个，按优先顺序填写，用逗号或空格分隔"
                    >
                      <textarea
                        required
                        value={dns}
                        onChange={(e) => setDns(e.target.value)}
                        placeholder={
                          family === 'IPv4' ? '223.5.5.5, 1.1.1.1' : '2606:4700:4700::1111'
                        }
                      />
                    </Field>
                  )}
                </>
              )}
              {tab === 'ip' && (
                <>
                  <Field label="地址分配方式">
                    <select
                      value={dhcp ? 'dhcp' : 'static'}
                      onChange={(e) => setDhcp(e.target.value === 'dhcp')}
                    >
                      <option value="dhcp">自动获取（DHCP）</option>
                      <option value="static">手动设置静态 IPv4</option>
                    </select>
                  </Field>
                  {!dhcp && (
                    <>
                      <div className="two-fields">
                        <Field label="IPv4 地址">
                          <input required value={ip} onChange={(e) => setIp(e.target.value)} />
                        </Field>
                        <Field label="前缀长度">
                          <input
                            type="number"
                            required
                            min={1}
                            max={32}
                            value={prefix}
                            onChange={(e) => setPrefix(Number(e.target.value))}
                          />
                        </Field>
                      </div>
                      <Field label="默认网关（可留空）">
                        <input value={gateway} onChange={(e) => setGateway(e.target.value)} />
                      </Field>
                    </>
                  )}
                </>
              )}
              {tab === 'mtu' && (
                <Field label="MTU 字节数" hint="576–9000，仅修改所选适配器的 IPv4 接口">
                  <input
                    type="number"
                    min={576}
                    max={9000}
                    required
                    value={mtu}
                    onChange={(e) => setMtu(Number(e.target.value))}
                  />
                </Field>
              )}
              {tab === 'proxy' && (
                <>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={proxyOn}
                      onChange={(e) => setProxyOn(e.target.checked)}
                    />
                    启用手动代理
                  </label>
                  <Field label="代理服务器" hint="例如 127.0.0.1:7890；也可按 Windows 格式指定协议">
                    <input
                      value={proxy}
                      onChange={(e) => setProxy(e.target.value)}
                      required={proxyOn}
                    />
                  </Field>
                  <Field label="自动配置脚本 PAC 地址（可留空）">
                    <input
                      value={pac}
                      onChange={(e) => setPac(e.target.value)}
                      placeholder="https://…/proxy.pac"
                    />
                  </Field>
                  <Field label="绕过列表">
                    <input value={bypass} onChange={(e) => setBypass(e.target.value)} />
                  </Field>
                </>
              )}
              {tab === 'adapter' && (
                <Field label="目标状态">
                  <select
                    value={enable ? 'on' : 'off'}
                    onChange={(e) => setEnable(e.target.value === 'on')}
                  >
                    <option value="on">启用适配器</option>
                    <option value="off">禁用适配器</option>
                  </select>
                </Field>
              )}
              <Button variant="primary" busy={action.busy} type="submit">
                <ShieldCheck size={15} />
                预览修改
              </Button>
              <ErrorNotice error={action.error} />
            </form>
          </Card>
          <Card title="当前 Windows 配置">
            <KeyValues
              items={[
                ['适配器', adapter?.name ?? '—'],
                ['状态', adapter?.status === 'Up' ? '已连接' : (adapter?.status ?? '—')],
                [
                  '地址',
                  adapter?.addresses.map((a) => `${a.address}/${a.prefix}`).join('、') ?? '—',
                ],
                ['网关', adapter?.gateways.join('、') ?? '—'],
                ['DNS', adapter?.dns.join('、') ?? '—'],
                ['手动代理', app.overview?.proxy.enabled ? app.overview.proxy.server : '未启用'],
                ['PAC', app.overview?.proxy.pac || '未设置'],
              ]}
            />
            <Notice>
              IP、DNS、MTU 与网卡开关按需申请管理员权限。用户代理只修改当前用户，不更改 WinHTTP
              独立代理。
            </Notice>
          </Card>
        </div>
      )}
      {plan !== null && (
        <PlanDialog
          plan={plan}
          scope="config"
          onClose={() => setPlan(null)}
          onApplied={() => {
            void app.refresh();
            void loadBackups();
          }}
        />
      )}
    </>
  );
}
