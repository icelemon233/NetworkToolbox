using System.Buffers.Binary;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NetworkToolbox;

public sealed class CaptureService(LocalStore store)
{
    readonly SemaphoreSlim gate = new(1, 1);
    string SessionFile => Path.Combine(store.Root, "capture-session.json");
    static string Tool => Path.Combine(Environment.SystemDirectory, "pktmon.exe");
    public async Task<object> Start(JsonObject p)
    {
        await gate.WaitAsync();
        try
        {
            if (File.Exists(SessionFile))
                throw new Exception("已有本应用启动的捕获，请先停止并转换");
            string id = Guid.NewGuid().ToString("N");
            var request = new JsonObject { ["id"] = id, ["maxMb"] = Math.Clamp(p.Get("maxMb", 64), 16, 256) };
            var result = await AdminBroker.Call(store, "capture.start", request);
            File.WriteAllText(SessionFile, JsonSerializer.Serialize(new
            {
                id,
                startedAt = DateTimeOffset.Now
            }, JsonDefaults.Options));
            return new
            {
                id,
                running = true,
                result
            };
        }
        finally { gate.Release(); }
    }
    public async Task<object> Stop()
    {
        await gate.WaitAsync();
        try
        {
            if (!File.Exists(SessionFile))
                throw new Exception("当前没有由本应用启动的捕获");
            JsonNode session = JsonNode.Parse(File.ReadAllText(SessionFile))!;
            string id = session["id"]!.ToString();
            var result = await AdminBroker.Call(store, "capture.stop", new JsonObject { ["id"] = id });
            File.Delete(SessionFile);
            store.Save("capture", new
            {
                id
            }, "数据包捕获");
            return new
            {
                id,
                running = false,
                result
            };
        }
        finally { gate.Release(); }
    }
    public object List() => new { session = File.Exists(SessionFile) ? JsonNode.Parse(File.ReadAllText(SessionFile)) : null, files = new DirectoryInfo(store.Folder("captures")).GetFiles("*.pcapng").OrderByDescending(f => f.CreationTimeUtc).Select(f => new { id = Path.GetFileNameWithoutExtension(f.Name), bytes = f.Length, createdAt = f.CreationTimeUtc }) };
    public object Inspect(string id) => PacketReader.Read(store.PathFor("captures", id, "pcapng"));
    public static async Task<object> ExecuteStart(LocalStore store, JsonObject p)
    {
        string id = p.Get("id", "")!;
        string path = store.PathFor("captures", id, "etl");
        if (!File.Exists(Tool))
            throw new Exception("当前系统不提供 Packet Monitor");
        var result = await Shell.Run(Tool, ["start", "--capture", "--comp", "nics", "--pkt-size", "0", "--file-name", path, "--file-size", Math.Clamp(p.Get("maxMb", 64), 16, 256).ToString(), "--log-mode", "circular"]);
        if (result.Code != 0)
            throw new Exception("无法开始捕获：" + result.Output + result.Error);
        return new
        {
            started = true
        };
    }
    public static async Task<object> ExecuteStop(LocalStore store, JsonObject p)
    {
        string id = p.Get("id", "")!;
        string input = store.PathFor("captures", id, "etl"), output = store.PathFor("captures", id, "pcapng");
        if (!File.Exists(input))
            throw new Exception("本应用的捕获文件不存在");
        string manifest=Path.Combine(store.Root,"capture-session.json");
        JsonNode? current=File.Exists(manifest)?JsonNode.Parse(File.ReadAllText(manifest)):null;
        if(current?["id"]?.ToString()!=id)throw new Exception("本应用的捕获会话标识不匹配");
        if(current?["stage"]?.ToString()!="stopped"){
            var status = await Shell.Run(Tool, ["status"]);
            if (!status.Output.Contains(Path.GetFileName(input), StringComparison.OrdinalIgnoreCase))
                throw new Exception("当前 Packet Monitor 状态与本应用的捕获不匹配，未停止其他捕获。请在系统中检查后重试。");
            var stop = await Shell.Run(Tool, ["stop"]);
            if (stop.Code != 0)throw new Exception("停止捕获失败：" + stop.Output + stop.Error);
            current!["stage"]="stopped";File.WriteAllText(manifest,current.ToJsonString());
        }
        var convert = await Shell.Run(Tool, ["etl2pcap", input, "--out", output], timeoutSeconds: 120);
        if (convert.Code != 0 || !File.Exists(output))
            throw new Exception("已停止捕获，但 pcapng 转换失败。原始 ETL 已保留。");
        return new
        {
            converted = true,
            bytes = new FileInfo(output).Length
        };
    }
}
public static class PacketReader
{
    public static object Read(string path)
    {
        using FileStream stream = File.OpenRead(path);
        if (stream.Length > 512 * 1024L * 1024)
            throw new Exception("捕获文件超过 512 MB，请使用 Wireshark 打开");
        using BinaryReader reader = new(stream);
        List<ushort> links = [];
        List<object> packets = [];
        Dictionary<string, int> protocols = [];
        long totalBytes = 0;
        int count = 0;
        bool truncated = false;
        while (stream.Position + 12 <= stream.Length)
        {
            uint block = reader.ReadUInt32(), length = reader.ReadUInt32();
            if (length < 12 || length > 16 * 1024 * 1024 || length % 4 != 0 || stream.Position - 8 + length > stream.Length)
                throw new Exception("pcapng 数据块损坏");
            byte[] data = reader.ReadBytes((int)length - 12);
            if (reader.ReadUInt32() != length)
                throw new Exception("pcapng 数据块长度不一致");
            if (block == 0x0A0D0D0A)
            {
                if (data.Length < 4 || BinaryPrimitives.ReadUInt32LittleEndian(data) != 0x1A2B3C4D)
                    throw new Exception("不支持此 pcapng 字节顺序");
                links.Clear();
            }
            else if (block == 1 && data.Length >= 8)
                links.Add(BinaryPrimitives.ReadUInt16LittleEndian(data));
            else if (block == 6 && data.Length >= 20)
            {
                uint index = BinaryPrimitives.ReadUInt32LittleEndian(data), captured = BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(12, 4)), original = BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(16, 4));
                if (captured > data.Length - 20)
                    throw new Exception("数据包长度不正确");
                ReadOnlySpan<byte> frame = data.AsSpan(20, (int)captured);
                ushort link = index < links.Count ? links[(int)index] : (ushort)0;
                string source = "", destination = "", protocol = "未解析";
                int? sourcePort = null, destinationPort = null;
                int offset = 0;
                int ether = 0;
                if (link == 1 && frame.Length >= 14)
                {
                    source = Convert.ToHexString(frame.Slice(6, 6));
                    destination = Convert.ToHexString(frame[..6]);
                    ether = BinaryPrimitives.ReadUInt16BigEndian(frame.Slice(12, 2));
                    offset = 14;
                    if (ether is 0x8100 or 0x88a8 && frame.Length >= 18)
                    {
                        ether = BinaryPrimitives.ReadUInt16BigEndian(frame.Slice(16, 2));
                        offset = 18;
                    }
                }
                else if (link == 101 && frame.Length >= 1)
                    ether = (frame[0] >> 4) == 4 ? 0x800 : 0x86dd;
                if (ether == 0x800 && frame.Length >= offset + 20)
                {
                    int header = (frame[offset] & 15) * 4;
                    if (header >= 20 && frame.Length >= offset + header)
                    {
                        source = new IPAddress(frame.Slice(offset + 12, 4)).ToString();
                        destination = new IPAddress(frame.Slice(offset + 16, 4)).ToString();
                        int ipProtocol = frame[offset + 9];
                        protocol = ipProtocol switch
                        {
                            6 => "TCP",
                            17 => "UDP",
                            1 => "ICMP",
                            _ => "IPv4/" + ipProtocol
                        };
                        int fragment = ((frame[offset + 6] & 31) << 8) | frame[offset + 7];
                        offset += header;
                        if (fragment == 0 && ipProtocol is 6 or 17 && frame.Length >= offset + 4)
                        {
                            sourcePort = BinaryPrimitives.ReadUInt16BigEndian(frame.Slice(offset, 2));
                            destinationPort = BinaryPrimitives.ReadUInt16BigEndian(frame.Slice(offset + 2, 2));
                        }
                    }
                }
                else if (ether == 0x86dd && frame.Length >= offset + 40)
                {
                    source = new IPAddress(frame.Slice(offset + 8, 16)).ToString();
                    destination = new IPAddress(frame.Slice(offset + 24, 16)).ToString();
                    int next = frame[offset + 6];
                    protocol = next switch
                    {
                        6 => "TCPv6",
                        17 => "UDPv6",
                        58 => "ICMPv6",
                        _ => "IPv6/" + next
                    };
                    offset += 40;
                    if (next is 6 or 17 && frame.Length >= offset + 4)
                    {
                        sourcePort = BinaryPrimitives.ReadUInt16BigEndian(frame.Slice(offset, 2));
                        destinationPort = BinaryPrimitives.ReadUInt16BigEndian(frame.Slice(offset + 2, 2));
                    }
                }
                else if (ether == 0x806)
                    protocol = "ARP";
                count++;
                totalBytes += original;
                protocols[protocol] = protocols.GetValueOrDefault(protocol) + 1;
                if (packets.Count < 1000)
                    packets.Add(new
                    {
                        number = count,
                        source,
                        destination,
                        sourcePort,
                        destinationPort,
                        protocol,
                        length = original,
                        hex = Convert.ToHexString(frame[..Math.Min(64, frame.Length)])
                    });
                if (count >= 200000)
                {
                    truncated = true;
                    break;
                }
            }
        }
        return new
        {
            packetCount = count,
            totalBytes,
            protocols,
            packets,
            truncated,
            note = "预览前 1000 个数据包；加密内容不解密。完整文件可导出到 Wireshark。"
        };
    }
}
