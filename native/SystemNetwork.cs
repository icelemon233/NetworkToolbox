using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace NetworkToolbox;

public static class SystemNetwork
{
    public static NetworkInterface[] Adapters() => NetworkInterface.GetAllNetworkInterfaces().Where(n => n.NetworkInterfaceType != NetworkInterfaceType.Loopback).ToArray();
    public static NetworkInterface Adapter(string id) => Adapters().FirstOrDefault(a => a.Id.Equals(id, StringComparison.OrdinalIgnoreCase)) ?? throw new Exception("选中的网卡已不存在，请刷新后重试");
    public static string? Gateway() => Adapters().Where(a => a.OperationalStatus == OperationalStatus.Up).OrderBy(a => a.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 ? 0 : 1).SelectMany(a => a.GetIPProperties().GatewayAddresses).Select(g => g.Address).FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !a.Equals(IPAddress.Any))?.ToString();
    public static async Task<object> Snapshot()
    {
        List<WifiConnection> wifi = [];
        string? wifiError = null;
        try
        {
            wifi = NativeWifi.Current();
        }
        catch (Exception ex) { wifiError = ex.Message; }
        using var proxy = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings");
        var adapters = Adapters().Select(a => { var p = a.GetIPProperties(); IPv4InterfaceStatistics? s = null; try { s = a.GetIPv4Statistics(); } catch { } int? index = null; try { index = p.GetIPv4Properties()?.Index; } catch { } return new { id = a.Id, name = a.Name, description = a.Description, type = a.NetworkInterfaceType.ToString(), status = a.OperationalStatus.ToString(), speedMbps = a.Speed / 1_000_000d, mac = a.GetPhysicalAddress().ToString(), index, addresses = p.UnicastAddresses.Select(x => new { address = x.Address.ToString(), prefix = x.PrefixLength, family = x.Address.AddressFamily.ToString() }), gateways = p.GatewayAddresses.Select(x => x.Address.ToString()), dns = p.DnsAddresses.Select(x => x.ToString()), receivedBytes = s?.BytesReceived, sentBytes = s?.BytesSent }; }).ToArray();
        await Task.CompletedTask;
        return new
        {
            timestamp = DateTimeOffset.Now,
            computerName = Environment.MachineName,
            os = Environment.OSVersion.VersionString,
            adapters,
            wifi,
            wifiError,
            gateway = Gateway(),
            proxy = new
            {
                enabled = Convert.ToInt32(proxy?.GetValue("ProxyEnable", 0) ?? 0) != 0,
                server = proxy?.GetValue("ProxyServer", "")?.ToString(),
                pac = proxy?.GetValue("AutoConfigURL", "")?.ToString()
            }
        };
    }
    public static async Task<object> Routes() => await Shell.Json("Get-NetRoute | Select-Object DestinationPrefix,NextHop,InterfaceAlias,InterfaceIndex,RouteMetric,AddressFamily | ConvertTo-Json -Depth 4");
    public static async Task<object> Discover(JsonObject p, Job job, JobRunner jobs)
    {
        string cidr = p.Get("cidr", "")!;
        var range = NetworkUtilities.Range(cidr);
        if (range.Prefix < 23 || range.Prefix > 32)
            throw new Exception("设备发现支持 /23 至 /32 网段，每次最多 512 个地址");
        if (!Validation.Private(range.Address))
            throw new Exception("设备发现仅支持本机私有局域网网段");
        var attached = Adapters().Where(x => x.OperationalStatus == OperationalStatus.Up).SelectMany(x => x.GetIPProperties().UnicastAddresses).Where(x => x.Address.AddressFamily == AddressFamily.InterNetwork&&x.PrefixLength>0).Any(x => NetworkUtilities.Contains(NetworkUtilities.Range(x.Address+"/"+x.PrefixLength),range));
        if (!attached)
            throw new Exception("请输入当前网卡所在的局域网网段");
        ConcurrentBag<object> devices = [];
        int completed = 0;
        int count = (int)(range.Broadcast - range.Network + 1);
        var token = job.Cancellation.Token;
        await Parallel.ForEachAsync(Enumerable.Range(0, count), new ParallelOptions { MaxDegreeOfParallelism = 16, CancellationToken = token }, async (i, ct) =>
        {
            uint value = range.Network + (uint)i;
            if (range.Prefix < 31 && (value == range.Network || value == range.Broadcast))
                return;
            string ip = NetworkUtilities.FromUInt(value).ToString();
            using Ping ping = new();
            bool alive = false;
            long? latency = null;
            try
            {
                var r = await ping.SendPingAsync(ip, 450);
                alive = r.Status == IPStatus.Success;
                if (alive)
                    latency = r.RoundtripTime;
            }
            catch (PingException) { }
            if (alive)
            {
                string name = "";
                try
                {
                    name = (await Dns.GetHostEntryAsync(ip).WaitAsync(TimeSpan.FromMilliseconds(550), ct)).HostName;
                }
                catch { }
                var d = new
                {
                    ip,
                    name,
                    latency,
                    source = "ICMP 响应"
                };
                devices.Add(d);
                jobs.Sample(job, d);
            }
            Interlocked.Increment(ref completed);
            job.Progress = (int)(completed * 100d / count);
        });
        object? neighbors = null;
        try
        {
            neighbors = await Shell.Json("Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.State -ne 'Unreachable' -and $_.LinkLayerAddress -ne '00-00-00-00-00-00' } | Select-Object IPAddress,LinkLayerAddress,State,InterfaceIndex | ConvertTo-Json -Depth 3");
            if(neighbors is JsonNode raw){JsonArray entries=raw is JsonArray array?array:new JsonArray(raw);JsonArray annotated=new();foreach(JsonNode? entry in entries){if(!IPAddress.TryParse(entry?["IPAddress"]?.ToString(),out var address)||address.AddressFamily!=AddressFamily.InterNetwork)continue;uint value=NetworkUtilities.ToUInt(address);if(value<range.Network||value>range.Broadcast)continue;var copy=entry!.DeepClone();try{copy["Vendor"]=Vendors.Lookup(entry["LinkLayerAddress"]?.ToString()??"");}catch{copy["Vendor"]="未匹配到厂商";}annotated.Add(copy);}neighbors=annotated;}
        }
        catch { }
        return new
        {
            cidr,
            devices,
            neighbors,
            note = "不响应 Ping 的设备可能仍然在线；邻居缓存记录不保证设备当前在线。",
            sampleCount = completed
        };
    }
}
public static class Shell
{
    public static async Task<(int Code, string Output, string Error)> Run(string file, IEnumerable<string> args, CancellationToken ct = default, int timeoutSeconds = 60)
    {
        ProcessStartInfo info = new(file)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        foreach (string a in args)
            info.ArgumentList.Add(a);
        using Process process = Process.Start(info) ?? throw new Exception("无法启动系统工具");
        var output = process.StandardOutput.ReadToEndAsync(ct);
        var error = process.StandardError.ReadToEndAsync(ct);
        using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch { try { process.Kill(true); } catch { } throw; }
        return (process.ExitCode, await output, await error);
    }
    public static async Task<JsonNode> Json(string script)
    {
        string prefix = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); ";
        string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(prefix + script));
        var r = await Run(Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]);
        if (r.Code != 0)
            throw new Exception(r.Error.Length > 0 ? r.Error.Trim() : "读取系统配置失败");
        if (string.IsNullOrWhiteSpace(r.Output))
            return new JsonArray();
        return JsonNode.Parse(r.Output.TrimStart('\uFEFF')) ?? new JsonArray();
    }
    public static string PsLiteral(string s) => "'" + s.Replace("'", "''") + "'";
}
