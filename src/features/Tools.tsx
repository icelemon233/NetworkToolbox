import { useState } from 'react';
import { Globe, Calculator, Power, Route } from 'lucide-react';
import { bridge } from '../shared/bridge';
import { useAction } from '../shared/context';
import { row, list, text } from '../shared/models';
import {
  PageHeader,
  Card,
  Button,
  Field,
  ErrorNotice,
  Table,
  KeyValues,
  RawData,
} from '../shared/ui';
export function ToolsPage() {
  const subnet = useAction(),
    wake = useAction(),
    publicIp = useAction(),
    routes = useAction(),
    vendor = useAction();
  const [cidr, setCidr] = useState('192.168.1.10/24'),
    [mac, setMac] = useState(''),
    [broadcast, setBroadcast] = useState('255.255.255.255'),
    [vendorMac, setVendorMac] = useState('');
  const result = row(subnet.data);
  const publicResults = list(row(publicIp.data).results);
  return (
    <>
      <PageHeader
        title="常用网络工具"
        description="地址计算、唤醒、出口查询与 Windows 路由信息。"
      />
      <div className="two-columns">
        <Card title="MAC 厂商线索" caption="离线查询 IEEE MA-L / MA-M / MA-S，不上传设备地址。">
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              void vendor.run(() => bridge.call('tools.vendor', { mac: vendorMac }));
            }}
          >
            <Field label="MAC 地址" className="grow">
              <input
                required
                value={vendorMac}
                onChange={(e) => setVendorMac(e.target.value)}
                placeholder="00:11:22:33:44:55"
              />
            </Field>
            <Button type="submit" busy={vendor.busy}>
              查询厂商
            </Button>
          </form>
          <ErrorNotice error={vendor.error} />
          {vendor.data !== null && (
            <KeyValues
              items={[
                ['登记厂商 / 地址类型', text(row(vendor.data).vendor)],
                ['数据日期', text(row(vendor.data).dataDate)],
              ]}
            />
          )}
        </Card>
        <Card title="IPv4 子网计算" caption="本地计算，不发送网络请求。">
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              void subnet.run(() => bridge.call('tools.subnet', { cidr }));
            }}
          >
            <Field label="IPv4 / 前缀长度" className="grow">
              <input required value={cidr} onChange={(e) => setCidr(e.target.value)} />
            </Field>
            <Button type="submit" busy={subnet.busy}>
              <Calculator size={15} />
              计算
            </Button>
          </form>
          <ErrorNotice error={subnet.error} />
          {subnet.data !== null && (
            <KeyValues
              items={[
                ['网络地址', text(result.network)],
                ['子网掩码', text(result.mask)],
                ['广播地址', text(result.broadcast)],
                ['可用范围', `${text(result.first)} – ${text(result.last)}`],
                ['可用地址数', text(result.usable)],
              ]}
            />
          )}
        </Card>
        <Card title="Wake-on-LAN" caption="向指定广播地址发送魔术唤醒包。">
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              void wake.run(() => bridge.call('tools.wol', { mac, broadcast }), '已发送唤醒包');
            }}
          >
            <Field label="目标 MAC 地址">
              <input
                required
                value={mac}
                onChange={(e) => setMac(e.target.value)}
                placeholder="00:11:22:33:44:55"
              />
            </Field>
            <Field label="广播地址">
              <input required value={broadcast} onChange={(e) => setBroadcast(e.target.value)} />
            </Field>
            <div>
              <Button type="submit" busy={wake.busy}>
                <Power size={15} />
                发送唤醒包
              </Button>
            </div>
            <ErrorNotice error={wake.error} />
          </form>
        </Card>
        <Card title="公网出口与 IPv6" caption="手动查询 ipify 服务，结果可能反映代理或 VPN 出口。">
          <Button
            busy={publicIp.busy}
            onClick={() => void publicIp.run(() => bridge.call('tools.publicIp'))}
          >
            <Globe size={15} />
            查询公网 IP
          </Button>
          <ErrorNotice error={publicIp.error} />
          {publicResults.length > 0 && (
            <KeyValues
              items={publicResults.map((v) => {
                const r = row(v);
                return [text(r.family), text(r.value, r.error ? '未获取到地址' : '—')];
              })}
            />
          )}
          <RawData data={publicIp.data} />
        </Card>
        <Card title="Windows 路由表" caption="查看本机的目的网段、下一跳与接口。">
          <Button busy={routes.busy} onClick={() => void routes.run(() => bridge.call('routes'))}>
            <Route size={15} />
            读取路由表
          </Button>
          <ErrorNotice error={routes.error} />
          <p className="form-note">
            虚拟适配器与路由变化可以提供 VPN / 隧道线索，不能据此识别所有第三方分流方式。
          </p>
        </Card>
      </div>
      {routes.data !== null && (
        <Card title="路由记录">
          <Table
            rows={Array.isArray(routes.data) ? routes.data : [routes.data]}
            columns={[
              { key: 'DestinationPrefix', title: '目标网段', className: 'mono' },
              { key: 'NextHop', title: '下一跳', className: 'mono' },
              { key: 'InterfaceAlias', title: '接口' },
              { key: 'InterfaceIndex', title: '接口索引' },
              { key: 'RouteMetric', title: '路由开销' },
            ]}
          />
        </Card>
      )}
    </>
  );
}
