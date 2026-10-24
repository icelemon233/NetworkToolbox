using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NetworkToolbox;

public static class SpeedTools
{
    public static async Task<object> Internet(JsonObject p, Job job, JobRunner jobs)
    {
        string input = p.Get("server", "https://speed.cloudflare.com")!;
        if (!Uri.TryCreate(input, UriKind.Absolute, out var server) || server.Scheme != "https" || server.UserInfo.Length > 0 || server.Query.Length > 0 || server.Fragment.Length > 0)
            throw new Exception("测速服务必须是有效的 HTTPS 地址");
        int downloadMb = Math.Clamp(p.Get("downloadMb", 32), 1, 256), uploadMb = Math.Clamp(p.Get("uploadMb", 8), 1, 128);
        string baseUrl = server.ToString().TrimEnd('/');
        var ct = job.Cancellation.Token;
        using HttpClient http = new(new SocketsHttpHandler { AutomaticDecompression = DecompressionMethods.None, ConnectTimeout = TimeSpan.FromSeconds(10) })
        {
            Timeout = TimeSpan.FromSeconds(90)
        };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("NetworkToolbox/" + typeof(Toolbox).Assembly.GetName().Version?.ToString(3));
        http.DefaultRequestHeaders.CacheControl = new CacheControlHeaderValue { NoCache = true };
        async Task<double?> Probe(CancellationToken probeToken)
        {
            using CancellationTokenSource probeTimeout=CancellationTokenSource.CreateLinkedTokenSource(probeToken);probeTimeout.CancelAfter(TimeSpan.FromSeconds(4));
            Stopwatch t = Stopwatch.StartNew();
            try
            {
                using var response = await http.GetAsync(baseUrl + "/__down?bytes=0", HttpCompletionOption.ResponseHeadersRead, probeTimeout.Token);
                response.EnsureSuccessStatusCode();
                return t.Elapsed.TotalMilliseconds;
            }
            catch (OperationCanceledException) when (probeToken.IsCancellationRequested) { throw; }
            catch { return null; }
        }
        List<double> idle = [];
        for (int i = 0; i < 3; i++)
        {
            double? sample=await Probe(ct);
            if (sample is double t)
                idle.Add(t);
            jobs.Sample(job, new
            {
                phase = "idle",
                ms = sample
            }, i * 3);
        }
        List<double> loaded = [];
        using CancellationTokenSource latency = CancellationTokenSource.CreateLinkedTokenSource(ct);
        Task latencyTask = Task.Run(async () => { while (!latency.IsCancellationRequested) { try { if (await Probe(latency.Token) is double t) { loaded.Add(t); jobs.Sample(job, new { phase = "latency", ms = t }); } await Task.Delay(800, latency.Token); } catch (OperationCanceledException) { break; } } }, ct);
        long received = 0;
        double down = 0, up = 0;
        Stopwatch clock = new();
        try
        {
            using (var response = await http.GetAsync(baseUrl + "/__down?bytes=" + (downloadMb * 1024L * 1024), HttpCompletionOption.ResponseHeadersRead, ct))
            {
                response.EnsureSuccessStatusCode();
                using Stream stream = await response.Content.ReadAsStreamAsync(ct);
                byte[] buffer = new byte[128 * 1024];
                clock.Restart();
                long last = 0;
                while (true)
                {
                    int read = await stream.ReadAsync(buffer, ct);
                    if (read == 0)
                        break;
                    received += read;
                    if (clock.ElapsedMilliseconds - last > 150)
                    {
                        jobs.Sample(job, new
                        {
                            phase = "download",
                            mbps = received * 8d / clock.Elapsed.TotalSeconds / 1_000_000,
                            bytes = received
                        }, 10 + (int)Math.Min(50, received * 50 / (downloadMb * 1024L * 1024)));
                        last = clock.ElapsedMilliseconds;
                    }
                }
                down = received * 8d / Math.Max(clock.Elapsed.TotalSeconds, .001) / 1_000_000;
            }
            ct.ThrowIfCancellationRequested();
            byte[] upload = new byte[uploadMb * 1024 * 1024];
            RandomNumberGenerator.Fill(upload);
            using ByteArrayContent body = new(upload);
            body.Headers.ContentType = new("application/octet-stream");
            jobs.Sample(job, new
            {
                phase = "upload",
                mbps = 0
            }, 65);
            clock.Restart();
            using var uploaded = await http.PostAsync(baseUrl + "/__up", body, ct);
            uploaded.EnsureSuccessStatusCode();
            up = upload.Length * 8d / clock.Elapsed.TotalSeconds / 1_000_000;
            jobs.Sample(job, new
            {
                phase = "upload",
                mbps = up,
                bytes = upload.Length
            }, 95);
        }
        finally { latency.Cancel(); try { await latencyTask; } catch (OperationCanceledException) { } }
        return new
        {
            server = baseUrl,
            downloadMbps = Math.Round(down, 2),
            uploadMbps = Math.Round(up, 2),
            downloadBytes = received,
            uploadBytes = uploadMb * 1024L * 1024,
            idleLatencyMs = idle.Count > 0 ? (double?)Math.Round(idle.Average(), 1) : null,
            loadedLatencyMs = loaded.Count > 0 ? (double?)Math.Round(loaded.Average(), 1) : null,
            loadedSamples = loaded.Count,
            latencyProtocol = "HTTP 响应头 RTT",
            note = "结果反映本机到此服务的路径与单连接吞吐；负载延迟采用 HTTP 请求，包含服务端响应时间。"
        };
    }
}
public sealed class LanSpeedService : IDisposable
{
    TcpListener? listener; CancellationTokenSource? source; string? key; int port;
    public async Task<object> StartServer(JsonObject p)
    {
        if (listener is not null)
            throw new Exception("局域网测速接收端已在运行");
        string bind=p.Get("bind","0.0.0.0")!;if(!IPAddress.TryParse(bind,out var bindAddress)||bindAddress.AddressFamily!=AddressFamily.InterNetwork||(!bindAddress.Equals(IPAddress.Any)&&!IPAddress.IsLoopback(bindAddress)))throw new Exception("监听地址不受支持");
        port = p.Get("port", 5201);if(port!=0||!IPAddress.IsLoopback(bindAddress))Validation.Port(port);
        if (port !=0 && port < 1024)
            throw new Exception("接收端端口必须大于 1023");
        key = Convert.ToHexString(RandomNumberGenerator.GetBytes(12));
        source = new();
        listener = new(bindAddress, port) { ExclusiveAddressUse = true };
        try { listener.Start(2); }
        catch { listener.Stop(); listener = null; source.Dispose(); source = null; key = null; throw; }
        port=((IPEndPoint)listener.LocalEndpoint).Port;
        var activeListener = listener;
        var ct = source.Token;
        _ = Task.Run(async () => { while (!ct.IsCancellationRequested) { try { var client = await activeListener.AcceptTcpClientAsync(ct); _ = Handle(client, ct); } catch (OperationCanceledException) { break; } catch (SocketException) { break; } } });
        await Task.CompletedTask;
        return new
        {
            running = true,
            port,
            key,
            addresses = SystemNetwork.Adapters().Where(a => a.OperationalStatus == System.Net.NetworkInformation.OperationalStatus.Up).SelectMany(a => a.GetIPProperties().UnicastAddresses).Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a.Address)).Select(a => a.Address.ToString()),
            note = "另一台电脑运行同一工具箱，输入此地址与连接密钥。接收端仅接受私有地址连接；停止后密钥失效。"
        };
    }
    async Task Handle(TcpClient client, CancellationToken serverToken)
    {
        using (client)
        {
            using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(serverToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(90));
            var ct = timeout.Token;
            try
            {
                if (client.Client.RemoteEndPoint is not IPEndPoint remote || !Validation.Private(remote.Address))
                    return;
                using NetworkStream stream = client.GetStream();
                var request = JsonNode.Parse(await ReadLine(stream, ct))?.AsObject() ?? throw new Exception();
                string supplied = request.Get("key", "")!;
                if (key is null || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(supplied), Encoding.UTF8.GetBytes(key)))
                    return;
                long bytes = Math.Clamp(request.Get("bytes", 16 * 1024 * 1024), 1024, 256 * 1024 * 1024);
                string direction = request.Get("direction", "upload")!;
                await stream.WriteAsync(Encoding.UTF8.GetBytes("OK\n"), ct);
                byte[] buffer = new byte[128 * 1024];
                long done = 0;
                if (direction == "download")
                {
                    while (done < bytes)
                    {
                        int amount = (int)Math.Min(buffer.Length, bytes - done);
                        await stream.WriteAsync(buffer.AsMemory(0, amount), ct);
                        done += amount;
                    }
                }
                else if (direction == "upload")
                {
                    while (done < bytes)
                    {
                        int read = await stream.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, bytes - done)), ct);
                        if (read == 0)
                            break;
                        done += read;
                    }
                    await stream.WriteAsync(Encoding.UTF8.GetBytes(done + "\n"), ct);
                }
            }
            catch (OperationCanceledException) { }
            catch (IOException) { }
            catch (SocketException) { }
            catch (JsonException) { }
        }
    }
    public object Stop()
    {
        source?.Cancel();
        listener?.Stop();
        listener = null;
        source?.Dispose();
        source = null;
        key = null;
        return new
        {
            running = false
        };
    }
    public async Task<object> Client(JsonObject p, Job job, JobRunner jobs)
    {
        string host = Validation.Host(p.Get("target", "")!);
        var addresses = await Dns.GetHostAddressesAsync(host, job.Cancellation.Token);
        if (addresses.Length == 0 || addresses.Any(a => !Validation.Private(a)))
            throw new Exception("局域网测速目标必须是私有 IPv4 地址");
        int peerPort = Validation.Port(p.Get("port", 5201));
        string peerKey = p.Get("key", "")!;
        if (peerKey.Length != 24 || !peerKey.All(Uri.IsHexDigit))
            throw new Exception("请输入接收端显示的连接密钥");
        int bytes = Math.Clamp(p.Get("mb", 32), 1, 256) * 1024 * 1024;
        string direction = p.Get("direction", "upload")!;
        if (direction is not ("upload" or "download"))
            throw new Exception("测速方向无效");
        var ct = job.Cancellation.Token;
        using TcpClient client = new();
        await client.ConnectAsync(addresses[0], peerPort, ct);
        using NetworkStream stream = client.GetStream();
        await stream.WriteAsync(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            key = peerKey,
            bytes,
            direction
        }) + "\n"), ct);
        if (await ReadLine(stream, ct) != "OK")
            throw new Exception("接收端拒绝连接，请检查密钥与版本");
        byte[] buffer = new byte[128 * 1024];
        long transferred = 0, last = 0;
        Stopwatch clock = Stopwatch.StartNew();
        while (transferred < bytes)
        {
            int amount = (int)Math.Min(buffer.Length, bytes - transferred);
            if (direction == "upload")
            {
                await stream.WriteAsync(buffer.AsMemory(0, amount), ct);
                transferred += amount;
            }
            else
            {
                int read = await stream.ReadAsync(buffer.AsMemory(0, amount), ct);
                if (read == 0)
                    break;
                transferred += read;
            }
            if (clock.ElapsedMilliseconds - last > 150)
            {
                jobs.Sample(job, new
                {
                    phase = direction,
                    mbps = transferred * 8d / clock.Elapsed.TotalSeconds / 1_000_000,
                    bytes = transferred
                }, (int)(transferred * 100 / bytes));
                last = clock.ElapsedMilliseconds;
            }
        }
        if (direction == "upload")
        {
            string ack = await ReadLine(stream, ct);
            if (!long.TryParse(ack, out long received) || received != bytes)
                throw new Exception("接收端报告的数据量不完整");
        }
        if (transferred != bytes)
            throw new Exception("连接提前结束，数据量不完整");
        return new
        {
            target = host,
            port = peerPort,
            direction,
            bytes = transferred,
            seconds = clock.Elapsed.TotalSeconds,
            mbps = Math.Round(transferred * 8d / clock.Elapsed.TotalSeconds / 1_000_000, 2)
        };
    }
    static async Task<string> ReadLine(Stream stream, CancellationToken ct)
    {
        List<byte> bytes = [];
        byte[] one = new byte[1];
        while (bytes.Count < 4096)
        {
            int n = await stream.ReadAsync(one, ct);
            if (n == 0)
                throw new IOException("连接已关闭");
            if (one[0] == 10)
                return Encoding.UTF8.GetString(bytes.ToArray());
            bytes.Add(one[0]);
        }
        throw new IOException("握手消息过长");
    }
    public void Dispose() => Stop();
}
