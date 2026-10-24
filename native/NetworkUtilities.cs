using System.Net;
using System.Net.Sockets;
using System.Text.Json.Nodes;

namespace NetworkToolbox;

public static class NetworkUtilities
{
    public record IpRange(IPAddress Address, int Prefix, uint Mask, uint Network, uint Broadcast);
    public static uint ToUInt(IPAddress ip)
    {
        byte[] b = ip.GetAddressBytes();
        if (b.Length != 4)
            throw new Exception("请输入 IPv4 地址");
        return (uint)b[0] << 24 | (uint)b[1] << 16 | (uint)b[2] << 8 | b[3];
    }
    public static IPAddress FromUInt(uint v) => new(new[] { (byte)(v >> 24), (byte)(v >> 16), (byte)(v >> 8), (byte)v });
    public static IpRange Range(string cidr)
    {
        string[] parts = cidr.Trim().Split('/');
        if (parts.Length != 2 || !IPAddress.TryParse(parts[0], out var ip) || ip.AddressFamily != AddressFamily.InterNetwork || !int.TryParse(parts[1], out int prefix) || prefix < 0 || prefix > 32)
            throw new Exception("请输入有效的 IPv4/CIDR，例如 192.168.1.10/24");
        uint mask = prefix == 0 ? 0 : uint.MaxValue << (32 - prefix), v = ToUInt(ip), network = v & mask;
        return new(ip, prefix, mask, network, network | ~mask);
    }
    public static bool Contains(IpRange outer,IpRange inner)=>inner.Network>=outer.Network&&inner.Broadcast<=outer.Broadcast;
    public static object Subnet(string cidr)
    {
        var r = Range(cidr);
        ulong total = 1UL << (32 - r.Prefix);
        return new
        {
            address = r.Address.ToString(),
            prefix = r.Prefix,
            network = FromUInt(r.Network).ToString(),
            broadcast = FromUInt(r.Broadcast).ToString(),
            mask = FromUInt(r.Mask).ToString(),
            first = FromUInt(r.Network + (r.Prefix >= 31 ? 0u : 1u)).ToString(),
            last = FromUInt(r.Broadcast - (r.Prefix >= 31 ? 0u : 1u)).ToString(),
            usable = r.Prefix >= 31 ? total : total - 2
        };
    }
    public static async Task<object> Wake(JsonObject p)
    {
        string raw = p.Get("mac", "")!.Replace(":", "").Replace("-", "");
        if (raw.Length != 12 || !raw.All(Uri.IsHexDigit))
            throw new Exception("MAC 地址格式不正确");
        byte[] mac = Convert.FromHexString(raw), packet = new byte[102];
        Array.Fill(packet, (byte)255, 0, 6);
        for (int i = 0; i < 16; i++)
            Array.Copy(mac, 0, packet, 6 + i * 6, 6);
        string broadcast = p.Get("broadcast", "255.255.255.255")!;
        if (!IPAddress.TryParse(broadcast, out var target) || target.AddressFamily != AddressFamily.InterNetwork)
            throw new Exception("广播地址格式不正确");
        using UdpClient udp = new()
        {
            EnableBroadcast = true
        };
        await udp.SendAsync(packet, new IPEndPoint(target, Validation.Port(p.Get("port", 9))));
        return new
        {
            sent = true,
            bytes = packet.Length,
            target = broadcast,
            note = "已发送唤醒包；设备是否启动取决于设备和网络配置。"
        };
    }
    public static async Task<object> PublicIp()
    {
        using HttpClient http = new()
        {
            Timeout = TimeSpan.FromSeconds(8)
        };
        var results = await Task.WhenAll(new[] { "https://api.ipify.org?format=json", "https://api6.ipify.org?format=json" }.Select(async url => { try { return (object)new { family = url.Contains("api6") ? "IPv6" : "IPv4", value = JsonNode.Parse(await http.GetStringAsync(url))?["ip"]?.ToString(), error = (string?)null }; } catch (Exception ex) { return new { family = url.Contains("api6") ? "IPv6" : "IPv4", value = (string?)null, error = ex.Message }; } }));
        return new
        {
            results,
            provider = "ipify",
            note = "未获取到 IPv6 不足以单独证明本机完全不支持 IPv6。"
        };
    }
}
