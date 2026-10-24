using System.Buffers.Binary;
using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;

namespace NetworkToolbox;

public static class DnsTools
{
    public static async Task<object> Query(JsonObject p)
    {
        string domain = Validation.Host(p.Get("domain", "")!);
        ushort type = (p.Get("type", "A")!).ToUpperInvariant() switch
        {
            "A" => 1,
            "AAAA" => 28,
            "CNAME" => 5,
            "MX" => 15,
            "NS" => 2,
            "TXT" => 16,
            "SOA" => 6,
            _ => throw new Exception("不支持此 DNS 记录类型")
        };
        string[] servers = p["servers"]?.AsArray().Select(x => x?.ToString() ?? "").Where(x => x.Length > 0).Distinct().Take(6).ToArray() ?? [];
        if (servers.Length == 0)
            servers = SystemNetwork.Adapters().Where(a => a.OperationalStatus == OperationalStatus.Up).SelectMany(a => a.GetIPProperties().DnsAddresses).Select(x => x.ToString()).Distinct().Take(3).ToArray();
        if (servers.Length == 0)
            throw new Exception("没有可用的 DNS 服务器");
        foreach (var s in servers)
        if (!IPAddress.TryParse(s, out _))
            throw new Exception("DNS 服务器必须是 IP 地址");
        var results = await Task.WhenAll(servers.Select(async server => { Stopwatch timer = Stopwatch.StartNew(); try { byte[] query = Build(domain, type, out ushort id); using UdpClient udp = new(IPAddress.Parse(server).AddressFamily); udp.Connect(server, 53); await udp.SendAsync(query); using CancellationTokenSource ct = new(TimeSpan.FromSeconds(4)); var reply = await udp.ReceiveAsync(ct.Token); var result = Parse(reply.Buffer, id); return (object)new { server, ms = Math.Round(timer.Elapsed.TotalMilliseconds, 2), result, transport = "UDP", error = (string?)null }; } catch (Exception ex) { return new { server, ms = Math.Round(timer.Elapsed.TotalMilliseconds, 2), error = ex is OperationCanceledException ? "查询超时" : ex.Message }; } }));
        return new
        {
            domain,
            type = p.Get("type", "A"),
            timestamp = DateTimeOffset.Now,
            results
        };
    }
    internal static byte[] Build(string domain, ushort type, out ushort id)
    {
        id = (ushort)Random.Shared.Next(1, 65535);
        using MemoryStream stream = new();
        byte[] header = new byte[12];
        BinaryPrimitives.WriteUInt16BigEndian(header, id);
        header[2] = 1;
        header[5] = 1;
        stream.Write(header);
        string ascii = new System.Globalization.IdnMapping().GetAscii(domain.TrimEnd('.'));
        foreach (string label in ascii.Split('.'))
        {
            byte[] b = Encoding.ASCII.GetBytes(label);
            if (b.Length is < 1 or > 63)
                throw new Exception("域名标签长度不正确");
            stream.WriteByte((byte)b.Length);
            stream.Write(b);
        }
        stream.WriteByte(0);
        stream.WriteByte((byte)(type >> 8));
        stream.WriteByte((byte)type);
        stream.WriteByte(0);
        stream.WriteByte(1);
        return stream.ToArray();
    }
    internal static object Parse(byte[] b, ushort id)
    {
        if (b.Length < 12 || U16(b, 0) != id || (b[2] & 0x80) == 0)
            throw new Exception("DNS 响应格式不正确");
        int questions = U16(b, 4), answers = U16(b, 6), offset = 12;
        if (questions > 16 || answers > 512)
            throw new Exception("DNS 响应过大");
        for (int i = 0; i < questions; i++)
        {
            Name(b, ref offset);
            offset += 4;
            Ensure(b, offset, 0);
        }
        List<object> records = [];
        for (int i = 0; i < answers; i++)
        {
            string name = Name(b, ref offset);
            Ensure(b, offset, 10);
            ushort t = U16(b, offset);
            uint ttl = BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(offset + 4, 4));
            int length = U16(b, offset + 8);
            offset += 10;
            Ensure(b, offset, length);
            int end = offset + length;
            int read = offset;
            string value;
            if (t == 1 && length == 4 || t == 28 && length == 16)
                value = new IPAddress(b.AsSpan(offset, length)).ToString();
            else if (t is 2 or 5)
                value = Name(b, ref read);
            else if (t == 15 && length >= 3)
            {
                read += 2;
                value = U16(b, offset) + " " + Name(b, ref read);
            }
            else if (t == 16)
            {
                List<string> texts = [];
                while (read < end)
                {
                    int len = b[read++];
                    if (read + len > end)
                        throw new Exception("TXT 记录损坏");
                    texts.Add(Encoding.UTF8.GetString(b, read, len));
                    read += len;
                }
                value = string.Join(" ", texts);
            }
            else if (t == 6)
            {
                string primary = Name(b, ref read), mailbox = Name(b, ref read);
                Ensure(b, read, 20);
                value = primary + " " + mailbox + " " + string.Join(" ", Enumerable.Range(0, 5).Select(k => BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(read + 4 * k, 4))));
            }
            else
                value = Convert.ToHexString(b.AsSpan(offset, length));
            records.Add(new
            {
                name,
                type = t switch
                {
                    1 => "A",
                    28 => "AAAA",
                    5 => "CNAME",
                    2 => "NS",
                    15 => "MX",
                    16 => "TXT",
                    6 => "SOA",
                    _ => t.ToString()
                },
                ttl,
                value
            });
            offset = end;
        }
        return new
        {
            rcode = b[3] & 15,
            truncated = (b[2] & 2) != 0,
            authenticatedData = (b[3] & 0x20) != 0,
            records
        };
    }
    static ushort U16(byte[] b, int p)
    {
        Ensure(b, p, 2);
        return BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(p, 2));
    }
    static void Ensure(byte[] b, int p, int n)
    {
        if (p < 0 || n < 0 || p > b.Length - n)
            throw new Exception("DNS 数据被截断");
    }
    static string Name(byte[] b, ref int pos)
    {
        int cursor = pos, steps = 0;
        bool jumped = false;
        List<string> labels = [];
        while (true)
        {
            Ensure(b, cursor, 1);
            if (++steps > 128)
                throw new Exception("DNS 压缩指针循环");
            int len = b[cursor++];
            if (len == 0)
            {
                if (!jumped)
                    pos = cursor;
                break;
            }
            if ((len & 0xc0) == 0xc0)
            {
                Ensure(b, cursor, 1);
                int next = ((len & 0x3f) << 8) | b[cursor++];
                if (!jumped)
                {
                    pos = cursor;
                    jumped = true;
                }
                cursor = next;
                continue;
            }
            if ((len & 0xc0) != 0 || len > 63)
                throw new Exception("DNS 标签格式不正确");
            Ensure(b, cursor, len);
            labels.Add(Encoding.UTF8.GetString(b, cursor, len));
            cursor += len;
            if (!jumped)
                pos = cursor;
        }
        return string.Join('.', labels);
    }
}
