using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json.Nodes;

namespace NetworkToolbox;

public static class Diagnostics
{
    public static string Target(JsonObject p) => Validation.Host(p.Get("target", SystemNetwork.Gateway() ?? "127.0.0.1")!);
    public static async Task<object> Ping(JsonObject p, Job job, JobRunner jobs, WifiService wifi)
    {
        string host = Target(p);
        int count = Math.Clamp(p.Get("count", 60), 1, 86400), interval = Math.Clamp(p.Get("intervalMs", 1000), 250, 60000), timeout = Math.Clamp(p.Get("timeoutMs", 1500), 250, 10000);
        List<object> samples = [];
        List<double> delays = [];
        int lost = 0;
        var ct = job.Cancellation.Token;
        await wifi.BeginLatency(ct);
        try
        {
            for (int i = 0; i < count; i++)
            {
                ct.ThrowIfCancellationRequested();
                using Ping ping = new();
                Stopwatch timer = Stopwatch.StartNew();
                double? ms = null;
                string status;
                string? address = null;
                try
                {
                    var reply = await ping.SendPingAsync(host, TimeSpan.FromMilliseconds(timeout), new byte[32], null, ct);
                    status = reply.Status.ToString();
                    address = reply.Address?.ToString();
                    if (reply.Status == IPStatus.Success)
                    {
                        ms = reply.RoundtripTime;
                        delays.Add(ms.Value);
                    }
                    else
                        lost++;
                }
                catch (PingException) { status = "Unreachable"; lost++; }
                var sample = new
                {
                    sequence = i + 1,
                    timestamp = DateTimeOffset.Now,
                    ms,
                    status,
                    address
                };
                samples.Add(sample);
                jobs.Sample(job, sample, (i + 1) * 100 / count);
                int wait = interval - (int)timer.ElapsedMilliseconds;
                if (i < count - 1 && wait > 0)
                    await Task.Delay(wait, ct);
            }
        }
        finally { wifi.EndLatency(); }
        return new
        {
            target = host,
            sent = count,
            received = count - lost,
            lossPercent = Math.Round(lost * 100d / count, 2),
            minMs = delays.Count > 0 ? (double?)delays.Min() : null,
            avgMs = delays.Count > 0 ? Math.Round(delays.Average(), 2) : (double?)null,
            maxMs = delays.Count > 0 ? (double?)delays.Max() : null,
            jitterMs = delays.Count > 1 ? Math.Round(delays.Zip(delays.Skip(1), (a, b) => Math.Abs(b - a)).Average(), 2) : (double?)null,
            p95Ms = delays.Count > 0 ? (double?)delays.Order().ElementAt((int)Math.Ceiling(delays.Count * 0.95) - 1) : null,
            samples,
            note = "抖动为相邻成功样本 RTT 差的绝对值均值。ICMP 不响应不等于应用不可联网。"
        };
    }
    public static async Task<object> Trace(JsonObject p, Job job, JobRunner jobs)
    {
        string host = Target(p);
        int maxHops = Math.Clamp(p.Get("maxHops", 30), 1, 64), timeout = Math.Clamp(p.Get("timeoutMs", 1200), 300, 5000);
        IPAddress destination = (await Dns.GetHostAddressesAsync(host, job.Cancellation.Token)).FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork) ?? throw new Exception("此版本的路由追踪需要 IPv4 目标");
        List<object> hops = [];
        for (int ttl = 1; ttl <= maxHops; ttl++)
        {
            job.Cancellation.Token.ThrowIfCancellationRequested();
            List<long> times = [];
            string? address = null;
            string status = "TimedOut";
            bool reached = false;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                using Ping ping = new();
                try
                {
                    Stopwatch hopClock=Stopwatch.StartNew();
                    var r = await ping.SendPingAsync(destination, TimeSpan.FromMilliseconds(timeout), new byte[32], new PingOptions(ttl, true), job.Cancellation.Token);
                    status = r.Status.ToString();
                    if (r.Status is IPStatus.Success or IPStatus.TtlExpired)
                    {
                        address = r.Address?.ToString();
                        times.Add(r.Status==IPStatus.Success?r.RoundtripTime:hopClock.ElapsedMilliseconds);
                    }
                    if (r.Status == IPStatus.Success)
                        reached = true;
                }
                catch (PingException) { status = "Unreachable"; }
            }
            var hop = new
            {
                hop = ttl,
                address,
                times,
                status,
                reached
            };
            hops.Add(hop);
            jobs.Sample(job, hop, ttl * 100 / maxHops);
            if (reached)
                break;
        }
        return new
        {
            target = host,
            destination = destination.ToString(),
            hops,
            note = "未响应的跳点可能只是未回复 ICMP；不能据此认定该跳断网。"
        };
    }
    public static async Task<object> Ports(JsonObject p)
    {
        string target = Target(p);
        int[] ports = p["ports"]?.AsArray().Select(n => Validation.Port(n!.GetValue<int>())).Distinct().Take(32).ToArray() ?? [80, 443];
        if (ports.Length == 0)
            throw new Exception("请输入至少一个端口");
        var results = await Task.WhenAll(ports.Select(async port => { using TcpClient client = new(); Stopwatch clock = Stopwatch.StartNew(); string state = "open", error = ""; try { await client.ConnectAsync(target, port).WaitAsync(TimeSpan.FromSeconds(3)); } catch (Exception ex) { state = ex is SocketException se && se.SocketErrorCode == SocketError.ConnectionRefused ? "closed" : "unreachable"; error = ex is TimeoutException ? "超时" : ex.Message; } return new { port, state, ms = Math.Round(clock.Elapsed.TotalMilliseconds, 1), error }; }));
        return new
        {
            target,
            results
        };
    }
    public static async Task<object> Web(JsonObject p)
    {
        string input = p.Get("url", "")!;
        if (!Uri.TryCreate(input, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || uri.UserInfo.Length > 0)
            throw new Exception("请输入 http:// 或 https:// 地址，不能包含登录凭据");
        using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(20));
        var ct = timeout.Token;
        Stopwatch phase = Stopwatch.StartNew();
        var addresses = await Dns.GetHostAddressesAsync(uri.DnsSafeHost, ct);
        double dnsMs = phase.Elapsed.TotalMilliseconds;
        double? tcpMs = null, tlsMs = null;
        object? certificate = null;
        string? directError = null;
        try
        {
            using TcpClient client = new();
            phase.Restart();
            await client.ConnectAsync(uri.DnsSafeHost, uri.Port, ct);
            tcpMs = phase.Elapsed.TotalMilliseconds;
            if (uri.Scheme == "https")
            {
                using SslStream ssl = new(client.GetStream());
                phase.Restart();
                await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = uri.DnsSafeHost }, ct);
                tlsMs = phase.Elapsed.TotalMilliseconds;
                if (ssl.RemoteCertificate is not null)
                {
                    using X509Certificate2 cert = new(ssl.RemoteCertificate);
                    certificate = new
                    {
                        subject = cert.Subject,
                        issuer = cert.Issuer,
                        notBefore = cert.NotBefore,
                        notAfter = cert.NotAfter,
                        protocol = ssl.SslProtocol.ToString(),
                        thumbprint = cert.Thumbprint
                    };
                }
            }
        }
        catch (Exception ex) { directError = ex.Message; }
        using HttpClientHandler handler = new()
        {
            AllowAutoRedirect = false
        };
        using HttpClient http = new(handler)
        {
            Timeout = TimeSpan.FromSeconds(15)
        };
        using HttpRequestMessage request = new(HttpMethod.Get, uri);
        request.Headers.UserAgent.ParseAdd("NetworkToolbox/" + typeof(Toolbox).Assembly.GetName().Version?.ToString(3));
        phase.Restart();
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            return new
            {
                url = uri.ToString(),
                addresses = addresses.Select(a => a.ToString()),
                dnsMs = Math.Round(dnsMs, 2),
                tcpMs,
                tlsMs,
                headerMs = phase.Elapsed.TotalMilliseconds,
                status = (int)response.StatusCode,
                reason = response.ReasonPhrase,
                headers = response.Headers.Concat(response.Content.Headers).ToDictionary(x => x.Key, x => string.Join(", ", x.Value)),
                certificate,
                directError,
                note = "DNS/TCP/TLS 分项为直接连接探测；HTTP 请求遵循系统代理，计时不能简单相加。"
            };
        }
        catch (Exception ex) { return new { url = input, addresses = addresses.Select(a => a.ToString()), dnsMs, tcpMs, tlsMs, certificate, directError, httpError = ex.Message }; }
    }
}
