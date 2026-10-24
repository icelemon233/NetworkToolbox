using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace NetworkToolbox;

public sealed class ConfigurationService(LocalStore store)
{
    readonly SemaphoreSlim applyGate=new(1,1);
    [DllImport("wininet.dll", SetLastError = true)] static extern bool InternetSetOption(IntPtr internet, int option, IntPtr buffer, int length);
    public async Task<object> Plan(JsonObject p)
    {
        string type = p.Get("type", "")!;
        JsonObject desired = p["desired"]?.AsObject() ?? throw new Exception("缺少目标配置");
        string adapterId = p.Get("adapterId", "")!;
        JsonNode before;
        Validate(type, desired);
        if (type == "proxy")
            before = ProxyState();
        else
        {
            var adapter = SystemNetwork.Adapter(adapterId);
            before = type=="adapter" ? await AdapterState(adapter.Id) : await Current(adapter.Id, type == "dns" ? desired.Get("family", "IPv4")! : "IPv4");
        }
        Validate(type, desired);
        string id = Guid.NewGuid().ToString("N");
        JsonObject plan = new()
        {
            ["id"] = id,
            ["createdAt"] = DateTimeOffset.Now.ToString("O"),
            ["type"] = type,
            ["adapterId"] = adapterId,
            ["before"] = before,
            ["desired"] = desired.DeepClone()
        };
        WriteProtected("plans",id,plan);
        return plan;
    }
    public async Task<object> Apply(string id)
    { await applyGate.WaitAsync();try{return await ApplyCore(id);}finally{applyGate.Release();} }
    async Task<object> ApplyCore(string id)
    {
        JsonObject plan = ReadPlan(id);
        DateTimeOffset created = DateTimeOffset.Parse(plan.Get("createdAt", "")!);
        if (DateTimeOffset.Now - created > TimeSpan.FromMinutes(10))
            throw new Exception("配置预览已过期，请重新生成");
        if (plan["applied"]?.GetValue<bool>() == true)
            throw new Exception("此配置预览已提交，请重新生成预览");
        string type = plan.Get("type", "")!;
        JsonObject desired = plan["desired"]!.AsObject();
        Validate(type, desired);
        plan["applied"]=true;WriteProtected("plans",id,plan);
        string snapshot = Guid.NewGuid().ToString("N");
        var saved = plan.DeepClone();
        WriteProtected("snapshots",snapshot,saved);
        object result = type == "proxy" ? ApplyProxy(desired) : await AdminBroker.Call(store, "network.apply", new JsonObject { ["type"] = type, ["adapterId"] = plan["adapterId"]!.DeepClone(), ["desired"] = desired.DeepClone() });
        plan["applied"] = true;
        WriteProtected("plans",id,plan);
        store.Save("configuration", new
        {
            type,
            snapshotId = snapshot,
            result
        }, "修改本机配置 · " + type);
        return new
        {
            ok = true,
            snapshotId = snapshot,
            result
        };
    }
    public object[] List() => new DirectoryInfo(store.Folder("snapshots")).GetFiles().Where(f=>f.Extension is ".bin" or ".json").OrderByDescending(f => f.CreationTimeUtc).Select(f => {string id=Path.GetFileNameWithoutExtension(f.Name);JsonNode p=ReadProtected("snapshots",id); return (object)new { id, type = p["type"]?.ToString(), adapterId = p["adapterId"]?.ToString(), createdAt = p["createdAt"]?.ToString() }; }).ToArray();
    public async Task<object> Restore(string id)
    { await applyGate.WaitAsync();try{return await RestoreCore(id);}finally{applyGate.Release();} }
    async Task<object> RestoreCore(string id)
    {
        JsonObject saved = ReadProtected("snapshots",id);
        string type = saved.Get("type", "")!;
        var before = saved["before"]!.AsObject();
        JsonObject desired;
        if (type == "proxy")
            desired = (JsonObject)before.DeepClone();
        else if (type == "dns")
            desired = new()
            {
                ["servers"] = before["dnsAutomatic"]?.GetValue<bool>() == true ? new JsonArray() : before["dns"]?.DeepClone() ?? new JsonArray(),
                ["family"] = before["family"]?.DeepClone() ?? JsonValue.Create("IPv4")
            };
        else if (type == "mtu")
            desired = new()
            {
                ["mtu"] = before["mtu"]?.DeepClone()
            };
        else if (type == "adapter")
            desired = new()
            {
                ["enabled"] = before["enabled"]?.DeepClone()
            };
        else
            desired = new()
            {
                ["dhcp"] = before["dhcp"]?.DeepClone(),
                ["addresses"] = before["addresses"]?.DeepClone(),
                ["gateway"] = before["gateway"]?.DeepClone()
            };
        Validate(type, desired);
        object result = type == "proxy" ? ApplyProxy(desired) : await AdminBroker.Call(store, "network.apply", new JsonObject { ["type"] = type, ["adapterId"] = saved["adapterId"]!.DeepClone(), ["desired"] = desired });
        store.Save("configuration", new
        {
            restoredSnapshot = id,
            type
        }, "恢复本机配置");
        return new
        {
            ok = true,
            result
        };
    }
    JsonObject ReadPlan(string id) => ReadProtected("plans",id);
    void WriteProtected(string folder,string id,JsonNode value){byte[] plain=Encoding.UTF8.GetBytes(value.ToJsonString());try{LocalStore.AtomicWrite(store.PathFor(folder,id,"bin"),ProtectedData.Protect(plain,Encoding.UTF8.GetBytes("NetworkToolbox/config/v1"),DataProtectionScope.CurrentUser));}finally{CryptographicOperations.ZeroMemory(plain);}}
    JsonObject ReadProtected(string folder,string id){string file=store.PathFor(folder,id,"bin");if(!File.Exists(file))return JsonNode.Parse(File.ReadAllText(store.PathFor(folder,id)))!.AsObject();byte[] plain=ProtectedData.Unprotect(File.ReadAllBytes(file),Encoding.UTF8.GetBytes("NetworkToolbox/config/v1"),DataProtectionScope.CurrentUser);try{return JsonNode.Parse(plain)!.AsObject();}finally{CryptographicOperations.ZeroMemory(plain);}}
    public static void Validate(string type, JsonObject d)
    {
        if (type == "dns")
        {
            string family = d.Get("family", "IPv4")!;
            if (family is not ("IPv4" or "IPv6"))
                throw new Exception("DNS 地址族不正确");
            var servers = d["servers"]?.AsArray() ?? throw new Exception("DNS 参数不正确");
            if (servers.Count > 4 || servers.Any(x => !IPAddress.TryParse(x?.ToString(), out var a) || a.AddressFamily != (family == "IPv4" ? System.Net.Sockets.AddressFamily.InterNetwork : System.Net.Sockets.AddressFamily.InterNetworkV6)))
                throw new Exception("请输入最多 4 个所选地址族的有效 DNS 地址；留空表示自动获取");
        }
        else if (type == "ip")
        {
            if (!d.Get("dhcp", true))
            {
                var addresses = d["addresses"]?.AsArray() ?? throw new Exception("缺少静态 IP");
                if (addresses.Count is < 1 or > 8)
                    throw new Exception("请输入 1–8 个 IPv4 地址");
                foreach (var a in addresses)
                {
                    if (!IPAddress.TryParse(a?["address"]?.ToString(), out var ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
                        throw new Exception("静态地址必须是 IPv4");
                    int prefix = a?["prefix"]?.GetValue<int>() ?? -1;
                    if (prefix is < 1 or > 32)
                        throw new Exception("前缀长度应为 1–32");
                }
                string gw = d.Get("gateway", "")!;
                if (gw.Length > 0 && (!IPAddress.TryParse(gw, out var g) || g.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork))
                    throw new Exception("网关必须是 IPv4 地址");
            }
        }
        else if (type == "mtu")
        {
            int mtu = d.Get("mtu", 0);
            if (mtu < 576 || mtu > 9000)
                throw new Exception("MTU 应为 576–9000");
        }
        else if (type == "adapter")
        {
            if (d["enabled"] is null)
                throw new Exception("网卡状态不正确");
            _ = d["enabled"]!.GetValue<bool>();
        }
        else if (type == "proxy")
        {
            string server = d.Get("server", "")!, pac = d.Get("pac", "")!, bypass = d.Get("bypass", "")!;
            if (server.Length > 2048 || bypass.Length > 4096 || server.Any(char.IsControl) || bypass.Any(char.IsControl))
                throw new Exception("代理参数不正确");
            if (d.Get("enabled", false) && server.Length == 0)
                throw new Exception("请输入代理服务器");
            if (pac.Length > 0 && (!Uri.TryCreate(pac, UriKind.Absolute, out var u) || u.Scheme is not ("https" or "http") || u.UserInfo.Length > 0))
                throw new Exception("PAC 地址必须是 HTTP(S) 地址");
        }
        else
            throw new Exception("不支持此配置类型");
    }
    public static async Task<JsonNode> Current(string id, string family = "IPv4")
    {
        var adapter = SystemNetwork.Adapter(id);
        int index = adapter.GetIPProperties().GetIPv4Properties()?.Index ?? throw new Exception("网卡不支持 IPv4");
        if (family is not ("IPv4" or "IPv6"))
            throw new Exception("地址族不正确");
        string protocol = family == "IPv4" ? "Tcpip" : "Tcpip6";
        string script = "$n=" + index + "; $a=Get-NetAdapter -InterfaceIndex $n; $i=Get-NetIPInterface -InterfaceIndex $n -AddressFamily IPv4; $dns=@((Get-DnsClientServerAddress -InterfaceIndex $n -AddressFamily " + family + ").ServerAddresses); $reg=Get-ItemProperty -LiteralPath " + Shell.PsLiteral(@"HKLM:\SYSTEM\CurrentControlSet\Services\" + protocol + @"\Parameters\Interfaces\" + adapter.Id) + " -ErrorAction SilentlyContinue; [pscustomobject]@{id=" + Shell.PsLiteral(id) + ";name=$a.Name;index=$n;family='" + family + "';enabled=($a.Status -ne 'Disabled');dhcp=($i.Dhcp -eq 'Enabled');mtu=$i.NlMtu;dns=$dns;dnsAutomatic=[string]::IsNullOrWhiteSpace($reg.NameServer);addresses=@(Get-NetIPAddress -InterfaceIndex $n -AddressFamily IPv4 | Where-Object {$_.PrefixOrigin -ne 'WellKnown'} | ForEach-Object {[pscustomobject]@{address=$_.IPAddress;prefix=$_.PrefixLength}});gateway=[string](@(Get-NetRoute -InterfaceIndex $n -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop)} | ConvertTo-Json -Depth 6";
        return await Shell.Json(script);
    }
    static async Task<JsonNode> AdapterState(string id){var adapter=SystemNetwork.Adapter(id);return await Shell.Json("$a=Get-NetAdapter -Name "+Shell.PsLiteral(adapter.Name)+"; [pscustomobject]@{id="+Shell.PsLiteral(id)+";name=$a.Name;enabled=($a.Status -ne 'Disabled')}|ConvertTo-Json");}
    public static async Task<object> Execute(JsonObject p)
    {
        string type = p.Get("type", "")!, id = p.Get("adapterId", "")!;
        JsonObject d = p["desired"]!.AsObject();
        Validate(type, d);
        var adapter = SystemNetwork.Adapter(id);
        if(type=="adapter")return await Shell.Json((d.Get("enabled",true)?"Enable-NetAdapter":"Disable-NetAdapter")+" -Name "+Shell.PsLiteral(adapter.Name)+" -Confirm:$false; [pscustomobject]@{ok=$true}|ConvertTo-Json");
        int index = adapter.GetIPProperties().GetIPv4Properties()?.Index ?? throw new Exception("网卡没有 IPv4 接口");
        string n = index.ToString(), script;
        if (type == "dns")
        {
            var servers = d["servers"]!.AsArray();
            string family = d.Get("family", "IPv4") == "IPv6" ? "ipv6" : "ipv4";
            string tool = Path.Combine(Environment.SystemDirectory, "netsh.exe");
            List<string> args = ["interface", family, "set", "dnsservers", "name=" + n, "source=" + (servers.Count == 0 ? "dhcp" : "static")];
            if (servers.Count > 0)
            {
                args.Add("address=" + servers[0]!.ToString());
                args.Add("validate=no");
            }
            var changed = await Shell.Run(tool, args);
            if (changed.Code != 0)
                throw new Exception("DNS 设置失败：" + changed.Output + changed.Error);
            for (int i = 1; i < servers.Count; i++)
            {
                var added = await Shell.Run(tool, ["interface", family, "add", "dnsservers", "name=" + n, "address=" + servers[i]!.ToString(), "index=" + (i + 1), "validate=no"]);
                if (added.Code != 0)
                    throw new Exception("部分 DNS 地址添加失败，可从已保存的快照恢复：" + added.Output + added.Error);
            }
            return new
            {
                ok = true,
                family
            };
        }
        else if (type == "mtu")
            script = "Set-NetIPInterface -InterfaceIndex " + n + " -AddressFamily IPv4 -NlMtuBytes " + d.Get("mtu", 1500) + "; [pscustomobject]@{ok=$true}|ConvertTo-Json";
        else if (type == "adapter")
            script = (d.Get("enabled", true) ? "Enable-NetAdapter" : "Disable-NetAdapter") + " -Name " + Shell.PsLiteral(adapter.Name) + " -Confirm:$false; [pscustomobject]@{ok=$true}|ConvertTo-Json";
        else if (type == "ip")
        {
            bool dhcp = d.Get("dhcp", true);
            script = "Set-NetIPInterface -InterfaceIndex " + n + " -AddressFamily IPv4 -Dhcp Disabled; Get-NetIPAddress -InterfaceIndex " + n + " -AddressFamily IPv4 | Where-Object {$_.PrefixOrigin -ne 'WellKnown'} | Remove-NetIPAddress -Confirm:$false; Get-NetRoute -InterfaceIndex " + n + " -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false; ";
            if (dhcp)
                script += "Set-NetIPInterface -InterfaceIndex " + n + " -AddressFamily IPv4 -Dhcp Enabled; ";
            else
            {
                bool first = true;
                foreach (JsonNode? item in d["addresses"]!.AsArray())
                {
                    script += "New-NetIPAddress -InterfaceIndex " + n + " -IPAddress " + Shell.PsLiteral(item!["address"]!.ToString()) + " -PrefixLength " + item["prefix"]!.GetValue<int>();
                    if (first && d.Get("gateway", "")!.Length > 0)
                        script += " -DefaultGateway " + Shell.PsLiteral(d.Get("gateway", "")!);
                    script += " | Out-Null; ";
                    first = false;
                }
            }
            script += "[pscustomobject]@{ok=$true}|ConvertTo-Json";
        }
        else
            throw new Exception("此设置不通过管理员服务修改");
        return await Shell.Json(script);
    }
    static JsonObject ProxyState()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings");
        return new()
        {
            ["enabled"] = Convert.ToInt32(key?.GetValue("ProxyEnable", 0) ?? 0) != 0,
            ["server"] = key?.GetValue("ProxyServer", "")?.ToString(),
            ["pac"] = key?.GetValue("AutoConfigURL", "")?.ToString(),
            ["bypass"] = key?.GetValue("ProxyOverride", "")?.ToString()
        };
    }
    static object ApplyProxy(JsonObject d)
    {
        Validate("proxy", d);
        using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings");
        key.SetValue("ProxyEnable", d.Get("enabled", false) ? 1 : 0, RegistryValueKind.DWord);
        key.SetValue("ProxyServer", d.Get("server", "")!);
        key.SetValue("ProxyOverride", d.Get("bypass", "")!);
        string pac = d.Get("pac", "")!;
        if (pac.Length > 0)
            key.SetValue("AutoConfigURL", pac);
        else
            key.DeleteValue("AutoConfigURL", false);
        InternetSetOption(IntPtr.Zero, 39, IntPtr.Zero, 0);
        InternetSetOption(IntPtr.Zero, 37, IntPtr.Zero, 0);
        return new
        {
            ok = true,
            scope = "当前 Windows 用户代理（不修改 WinHTTP 独立代理）"
        };
    }
}
