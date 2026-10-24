using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace NetworkToolbox;

public sealed class WifiNetwork
{
    public string Ssid { get; set; } = ""; public string Bssid { get; set; } = "";
    public string InterfaceId { get; set; } = ""; public int Rssi
    {
        get; set;
    }
    public int Quality
    {
        get; set;
    }
    public double Frequency
    {
        get; set;
    }
    public int Channel
    {
        get; set;
    }
    public string Band { get; set; } = "";
    public int? Width
    {
        get; set;
    }
    public double? CenterFrequency
    {
        get; set;
    }
    public int? Utilization
    {
        get; set;
    }
    public int? Stations
    {
        get; set;
    }
    public string Security { get; set; } = ""; public bool Connected
    {
        get; set;
    }
    public string Protocol { get; set; } = "";
}
public sealed class WifiConnection
{
    public string InterfaceId { get; set; } = ""; public string Ssid { get; set; } = ""; public string Bssid { get; set; } = "";
    public double ReceiveMbps
    {
        get; set;
    }
    public double TransmitMbps
    {
        get; set;
    }
    public int Quality
    {
        get; set;
    }
}
public sealed class WifiService
{
    readonly SemaphoreSlim gate = new(1, 1);
    int activeLatency; public bool LatencyActive => Volatile.Read(ref activeLatency) > 0;
    public async Task BeginLatency(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            Interlocked.Increment(ref activeLatency);
        }
        finally { gate.Release(); }
    }
    public void EndLatency() => Interlocked.Decrement(ref activeLatency);
    public async Task<object> Scan(bool refresh, CancellationToken ct = default)
    {
        await gate.WaitAsync(ct);
        try
        {
            if (refresh && LatencyActive)
                throw new WifiBusyException();
            using WlanHandle handle = new();
            List<(Guid Id, string Name)> interfaces = NativeWifi.Interfaces(handle.Value);
            if (interfaces.Count == 0)
                throw new Exception("未发现 Wi-Fi 网卡，请检查网卡是否启用");
            if (refresh)
            {
                foreach (var x in interfaces)
                {
                    Guid id = x.Id;
                    NativeWifi.Check(NativeWifi.WlanScan(handle.Value, ref id, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero));
                }
                await Task.Delay(4000, ct);
            }
            List<WifiNetwork> networks = [];
            List<WifiConnection> connections = [];
            foreach (var x in interfaces)
            {
                try
                {
                    var c = NativeWifi.Connection(handle.Value, x.Id);
                    if (c is not null)
                        connections.Add(c);
                }
                catch (Win32Exception) { }
                networks.AddRange(NativeWifi.Networks(handle.Value, x.Id));
            }
            foreach (var n in networks)
                n.Connected = connections.Any(c => c.Bssid.Equals(n.Bssid, StringComparison.OrdinalIgnoreCase));
            var current = networks.FirstOrDefault(n => n.Connected);
            int low = current is { Band: "5 GHz", Channel: >=36 and <=48 } ? current.Channel : 36;
            int high = current is { Band: "5 GHz", Channel: >=149 and <=161 } ? current.Channel : 149;
            var candidates = new[] { low, high }.Select(ch => new { channel = ch, width = 80, band = "5 GHz", risk = Score(networks, ch, 80, current?.Bssid), reason = ch >= 149 ? "使用 149–161 频谱组，与 36–48 组分开" : "使用 36–48 频谱组" }).OrderBy(x => x.risk).ThenBy(x=>x.channel==current?.Channel?0:1).ToArray();
            return new
            {
                timestamp = DateTimeOffset.Now,
                networks = networks.OrderByDescending(n => n.Connected).ThenByDescending(n => n.Rssi),
                connections,
                candidates,
                visibleNetworkCount = networks.Where(n => n.Ssid.Length > 0).Select(n => n.Ssid).Distinct().Count(),
                refreshed = refresh,
                notes = new[] { "信道建议依据广播带宽、信号强度与重叠范围估算；不代表实际吞吐或完整频谱干扰。", "信道占用与客户端数由接入点报告；缺失时显示未知。", "是否支持候选信道，以路由器当前地区与固件可选项为准。" }
            };
        }
        finally { gate.Release(); }
    }
    public static double Score(IEnumerable<WifiNetwork> list, int channel, int width, string? currentBssid)
    {
        double center = 5000 + 5 * (width == 80 ? (channel < 100 ? 42 : 155) : channel), score = 0;
        foreach (var n in list.Where(n => n.Band == "5 GHz" && !n.Bssid.Equals(currentBssid, StringComparison.OrdinalIgnoreCase)))
        {
            if (n.Width is not int nw || n.CenterFrequency is not double nc)
                continue;
            double overlap = Math.Max(0, Math.Min(center + width / 2d, nc + nw / 2d) - Math.Max(center - width / 2d, nc - nw / 2d));
            score += overlap / width * Math.Pow(10, (n.Rssi + 90) / 20d);
        }
        return Math.Round(score, 1);
    }
}
sealed class WifiBusyException():Exception("延迟测试正在进行。请停止后刷新扫描，避免扫描影响延迟结果。");
sealed class WlanHandle : IDisposable
{
    public IntPtr Value
    {
        get;
    }
    public WlanHandle()
    {
        NativeWifi.Check(NativeWifi.WlanOpenHandle(2, IntPtr.Zero, out _, out var h));
        Value = h;
    }
    public void Dispose() => NativeWifi.WlanCloseHandle(Value, IntPtr.Zero);
}
static class NativeWifi
{
    [DllImport("wlanapi.dll")] public static extern uint WlanOpenHandle(uint version, IntPtr reserved, out uint negotiated, out IntPtr handle);
    [DllImport("wlanapi.dll")] static extern uint WlanEnumInterfaces(IntPtr handle, IntPtr reserved, out IntPtr list);
    [DllImport("wlanapi.dll")] public static extern uint WlanScan(IntPtr handle, ref Guid id, IntPtr ssid, IntPtr ie, IntPtr reserved);
    [DllImport("wlanapi.dll")] static extern uint WlanGetNetworkBssList(IntPtr handle, ref Guid id, IntPtr ssid, uint type, [MarshalAs(UnmanagedType.Bool)] bool security, IntPtr reserved, out IntPtr list);
    [DllImport("wlanapi.dll")] static extern uint WlanQueryInterface(IntPtr handle, ref Guid id, uint opcode, IntPtr reserved, out uint size, out IntPtr data, out uint type);
    [DllImport("wlanapi.dll")] public static extern void WlanFreeMemory(IntPtr pointer);
    [DllImport("wlanapi.dll")] public static extern uint WlanCloseHandle(IntPtr handle, IntPtr reserved);
    public static void Check(uint code)
    {
        if (code == 5)
            throw new Exception("Windows 未允许读取附近 Wi-Fi。请在“设置 → 隐私和安全性 → 位置”允许位置服务及桌面应用访问位置，然后重试。");
        if (code != 0)
            throw new Win32Exception((int)code, "Wi-Fi 查询失败：" + new Win32Exception((int)code).Message);
    }
    public static List<(Guid, string)> Interfaces(IntPtr h)
    {
        Check(WlanEnumInterfaces(h, IntPtr.Zero, out var p));
        try
        {
            List<(Guid, string)> list = [];
            int count = Marshal.ReadInt32(p);
            for (int i = 0; i < count; i++)
            {
                var e = IntPtr.Add(p, 8 + i * 532);
                byte[] g = new byte[16];
                Marshal.Copy(e, g, 0, 16);
                list.Add((new Guid(g), Marshal.PtrToStringUni(IntPtr.Add(e, 16), 256)?.TrimEnd('\0') ?? "Wi-Fi"));
            }
            return list;
        }
        finally { WlanFreeMemory(p); }
    }
    public static WifiConnection? Connection(IntPtr h, Guid id)
    {
        uint r = WlanQueryInterface(h, ref id, 7, IntPtr.Zero, out var size, out var p, out _);
        if (r == 5023 || r == 1168)
            return null;
        Check(r);
        try
        {
            if (size < 588)
                return null;
            int sl = Marshal.ReadInt32(p, 520);
            if (sl < 0 || sl > 32)
                return null;
            byte[] ssid = new byte[sl], mac = new byte[6];
            Marshal.Copy(IntPtr.Add(p, 524), ssid, 0, sl);
            Marshal.Copy(IntPtr.Add(p, 560), mac, 0, 6);
            return new()
            {
                InterfaceId = id.ToString(),
                Ssid = Encoding.UTF8.GetString(ssid),
                Bssid = BitConverter.ToString(mac).Replace('-', ':'),
                Quality = Marshal.ReadInt32(p, 576),
                ReceiveMbps = (uint)Marshal.ReadInt32(p, 580) / 1000d,
                TransmitMbps = (uint)Marshal.ReadInt32(p, 584) / 1000d
            };
        }
        finally { WlanFreeMemory(p); }
    }
    public static List<WifiConnection> Current()
    {
        using WlanHandle h = new();
        return Interfaces(h.Value).Select(x => { try { return Connection(h.Value, x.Item1); } catch { return null; } }).Where(x => x is not null).ToList()!;
    }
    public static List<WifiNetwork> Networks(IntPtr h, Guid id)
    {
        Check(WlanGetNetworkBssList(h, ref id, IntPtr.Zero, 3, false, IntPtr.Zero, out var p));
        try
        {
            int total = Marshal.ReadInt32(p), count = Marshal.ReadInt32(p, 4);
            if (count < 0 || 8L + count * 360L > total)
                throw new Exception("Windows 返回的无线数据格式不受支持");
            List<WifiNetwork> list = [];
            for (int i = 0; i < count; i++)
            {
                int pos = 8 + i * 360;
                IntPtr e = IntPtr.Add(p, pos);
                int sl = Marshal.ReadInt32(e);
                if (sl < 0 || sl > 32)
                    continue;
                byte[] ssid = new byte[sl], mac = new byte[6];
                Marshal.Copy(IntPtr.Add(e, 4), ssid, 0, sl);
                Marshal.Copy(IntPtr.Add(e, 40), mac, 0, 6);
                double freq = Marshal.ReadInt32(e, 92) / 1000d;
                ushort capability = (ushort)Marshal.ReadInt16(e, 88);
                WifiNetwork n = new()
                {
                    InterfaceId = id.ToString(),
                    Ssid = Encoding.UTF8.GetString(ssid),
                    Bssid = BitConverter.ToString(mac).Replace('-', ':'),
                    Rssi = Marshal.ReadInt32(e, 56),
                    Quality = Marshal.ReadInt32(e, 60),
                    Frequency = freq,
                    Band = freq < 2500 ? "2.4 GHz" : freq >= 5925 ? "6 GHz" : "5 GHz",
                    Channel = freq == 2484 ? 14 : freq < 2500 ? (int)(freq - 2407) / 5 : freq >= 5925 ? (int)(freq - 5950) / 5 : (int)(freq - 5000) / 5,
                    Security = (capability & 0x10) != 0 ? "加密" : "开放"
                };
                int off = Marshal.ReadInt32(e, 352), len = Marshal.ReadInt32(e, 356);
                int phy = Marshal.ReadInt32(e, 52);
                n.Protocol = phy switch
                {
                    11 => "Wi-Fi 7",
                    10 => "Wi-Fi 6",
                    8 => "Wi-Fi 5",
                    7 => "Wi-Fi 4",
                    _ => "802.11"
                };
                if (off >= 0 && len >= 0 && pos + (long)off + len <= total)
                {
                    byte[] ies = new byte[len];
                    Marshal.Copy(IntPtr.Add(e, off), ies, 0, len);
                    ParseIes(n, ies);
                }
                list.Add(n);
            }
            return list;
        }
        finally { WlanFreeMemory(p); }
    }
    internal static void ParseIes(WifiNetwork n, byte[] ies)
    {
        bool ht = false, vht = false, rsn = false;
        int secondary = 0, vw = 0, c0 = 0, c1 = 0;
        for (int p = 0; p + 2 <= ies.Length;)
        {
            int id = ies[p++], len = ies[p++];
            if (p + len > ies.Length)
                break;
            if (id == 61 && len >= 2)
            {
                ht = true;
                secondary = ies[p + 1] & 3;
            }
            if (id == 192 && len >= 3)
            {
                vht = true;
                vw = ies[p];
                c0 = ies[p + 1];
                c1 = ies[p + 2];
            }
            if (id == 11 && len >= 5)
            {
                n.Stations = ies[p] | ies[p + 1] << 8;
                n.Utilization = (int)Math.Round(ies[p + 2] * 100d / 255);
            }
            if (id == 48 && len >= 8)
            {
                rsn = true;
                n.Security = "WPA2/RSN";
                int pairCount = ies[p + 6] | ies[p + 7] << 8;
                int ak = p + 8 + pairCount * 4;
                if (ak + 2 <= p + len)
                {
                    int cnt = ies[ak] | ies[ak + 1] << 8;
                    for (int a = ak + 2; a + 4 <= p + len && cnt-- > 0; a += 4)
                    if (ies[a] == 0 && ies[a + 1] == 15 && ies[a + 2] == 172 && (ies[a + 3] == 8 || ies[a + 3] == 9))
                        n.Security = "WPA3/SAE";
                }
            }
            p += len;
        }
        if (ht)
        {
            n.Width = secondary == 1 || secondary == 3 ? 40 : 20;
            n.CenterFrequency = n.Frequency + (secondary == 1 ? 10 : secondary == 3 ? -10 : 0);
        }
        if (vht && vw > 0)
        {
            n.Width = vw == 2 ? 160 : vw == 3 ? null : vw == 1 && c1 != 0 && Math.Abs(c0 - c1) == 8 ? 160 : 80;
            n.CenterFrequency = n.Width == 160 && vw == 1 ? 5000 + 5 * c1 : 5000 + 5 * c0;
        }
        if (!ht && !vht && n.Band == "2.4 GHz")
        {
            n.Width = 20;
            n.CenterFrequency = n.Frequency;
        }
        if (!rsn && n.Security == "加密")
            n.Security = "加密（未识别）";
    }
}
