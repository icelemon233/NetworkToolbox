using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Diagnostics.Tracing.Parsers;
using Microsoft.Diagnostics.Tracing.Session;

namespace NetworkToolbox;

public static class AdminBroker
{
    public static bool IsAdmin()
    {
        using WindowsIdentity id = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
    }
    static Process Launch(string pipe, LocalStore store)
    {
        ProcessStartInfo info = new(Environment.ProcessPath ?? throw new Exception("无法定位本机服务程序"))
        {
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden
        };
        if (Path.GetFileNameWithoutExtension(info.FileName).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) info.ArgumentList.Add(Environment.GetCommandLineArgs()[0]);
        info.ArgumentList.Add("--elevated");
        info.ArgumentList.Add(pipe);
        info.ArgumentList.Add("--data-dir");
        info.ArgumentList.Add(store.Root);
        try
        {
            return Process.Start(info) ?? throw new Exception("管理员操作未启动");
        }
        catch (System.ComponentModel.Win32Exception ex) when (ex.NativeErrorCode == 1223) { throw new Exception("已取消管理员授权，未更改设置"); }
    }
    public static async Task<JsonNode> Call(LocalStore store, string method, JsonObject p)
    {
        if (IsAdmin())
            return JsonSerializer.SerializeToNode(await Execute(method, p, store), JsonDefaults.Options)!;
        string pipe = "NetworkToolbox-" + Guid.NewGuid().ToString("N");
        using NamedPipeServerStream server = new(pipe, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        using Process child = Launch(pipe, store);
        using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(120));
        await server.WaitForConnectionAsync(timeout.Token);
        using StreamWriter writer = new(server, new UTF8Encoding(false), leaveOpen: true)
        {
            AutoFlush = true
        };
        using StreamReader reader = new(server, Encoding.UTF8, leaveOpen: true);
        await writer.WriteLineAsync(JsonSerializer.Serialize(new
        {
            method,
            @params = p
        }, JsonDefaults.Options));
        string response = await reader.ReadLineAsync(timeout.Token) ?? throw new Exception("管理员操作未返回结果");
        JsonNode result = JsonNode.Parse(response)!;
        await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
        if (result["error"] is { } error)
            throw new Exception(error.ToString());
        return result["result"]?.DeepClone() ?? new JsonObject();
    }
    public static async Task<object> Traffic(LocalStore store, Job job, Action<object> sample)
    {
        string pipe = "NetworkToolbox-" + Guid.NewGuid().ToString("N");
        using NamedPipeServerStream server = new(pipe, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        using Process child = Launch(pipe, store);
        using CancellationTokenSource start = CancellationTokenSource.CreateLinkedTokenSource(job.Cancellation.Token);
        start.CancelAfter(TimeSpan.FromSeconds(90));
        await server.WaitForConnectionAsync(start.Token);
        using StreamWriter writer = new(server, new UTF8Encoding(false), leaveOpen: true)
        {
            AutoFlush = true
        };
        using StreamReader reader = new(server, Encoding.UTF8, leaveOpen: true);
        await writer.WriteLineAsync("{\"method\":\"traffic\",\"params\":{}}");
        int count = 0;
        using var registration = job.Cancellation.Token.Register(() => { try { server.Dispose(); } catch { } });
        try
        {
            while (!job.Cancellation.IsCancellationRequested)
            {
                string? line = await reader.ReadLineAsync(job.Cancellation.Token);
                if (line is null)
                    break;
                JsonNode response = JsonNode.Parse(line)!;
                if (response["error"] is { } error)
                    throw new Exception(error.ToString());
                if (response["sample"] is { } data)
                {
                    sample(data.DeepClone());
                    count++;
                }
            }
        }
        catch (IOException) when (job.Cancellation.IsCancellationRequested) { }
        finally { server.Dispose(); if (!child.HasExited) await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)); }
        job.Cancellation.Token.ThrowIfCancellationRequested();
        return new
        {
            samples = count
        };
    }
    public static async Task RunWorker(string pipe, LocalStore store)
    {
        if (!IsAdmin() || !pipe.StartsWith("NetworkToolbox-", StringComparison.Ordinal) || pipe.Length > 100)
            return;
        using NamedPipeClientStream client = new(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        await client.ConnectAsync(30000);
        using StreamReader reader = new(client, Encoding.UTF8, leaveOpen: true);
        using StreamWriter writer = new(client, new UTF8Encoding(false), leaveOpen: true)
        {
            AutoFlush = true
        };
        try
        {
            string line = await reader.ReadLineAsync() ?? throw new Exception("请求已关闭");
            if (line.Length > 1_000_000)
                throw new Exception("请求过大");
            JsonObject request = JsonNode.Parse(line)!.AsObject();
            string method = request.Get("method", "")!;
            if (method == "traffic")
            {
                await TrafficWorker(writer, client);
                return;
            }
            object result = await Execute(method, request["params"]?.AsObject() ?? new(), store);
            await writer.WriteLineAsync(JsonSerializer.Serialize(new
            {
                result
            }, JsonDefaults.Options));
        }
        catch (Exception ex) { try { await writer.WriteLineAsync(JsonSerializer.Serialize(new { error = ex.Message }, JsonDefaults.Options)); } catch (IOException) { } }
    }
    static async Task<object> Execute(string method, JsonObject p, LocalStore store) => method switch
    {
        "network.apply" => await ConfigurationService.Execute(p),
        "dns.flush" => await FlushDns(),
        "capture.start" => await CaptureService.ExecuteStart(store, p),
        "capture.stop" => await CaptureService.ExecuteStop(store, p),
        _ => throw new Exception("此管理员操作不受支持")
    };
    static async Task<object> FlushDns(){var r=await Shell.Run(Path.Combine(Environment.SystemDirectory,"ipconfig.exe"),["/flushdns"]);if(r.Code!=0)throw new Exception("清除 DNS 缓存失败："+r.Output+r.Error);return new{ok=true};}
    static async Task TrafficWorker(StreamWriter writer, NamedPipeClientStream pipe)
    {
        using TraceEventSession session = new("NetworkToolbox-" + Guid.NewGuid().ToString("N"))
        {
            StopOnDispose = true
        };
        ConcurrentDictionary<int, (long Up, long Down)> counters = new();
        void Add(int pid, long size, bool up)
        {
            if (pid < 0 || size < 0)
                return;
            counters.AddOrUpdate(pid, up ? (size, 0) : (0, size), (_, v) => up ? (v.Up + size, v.Down) : (v.Up, v.Down + size));
        }
        session.Source.Kernel.TcpIpSend += e => Add(e.ProcessID, e.size, true);
        session.Source.Kernel.TcpIpRecv += e => Add(e.ProcessID, e.size, false);
        session.Source.Kernel.UdpIpSend += e => Add(e.ProcessID, e.size, true);
        session.Source.Kernel.UdpIpRecv += e => Add(e.ProcessID, e.size, false);
        session.Source.Kernel.TcpIpSendIPV6 += e => Add(e.ProcessID, e.size, true);
        session.Source.Kernel.TcpIpRecvIPV6 += e => Add(e.ProcessID, e.size, false);
        session.Source.Kernel.UdpIpSendIPV6 += e => Add(e.ProcessID, e.size, true);
        session.Source.Kernel.UdpIpRecvIPV6 += e => Add(e.ProcessID, e.size, false);
        session.EnableKernelProvider(KernelTraceEventParser.Keywords.NetworkTCPIP);
        Task processing = Task.Run(() => session.Source.Process());
        Stopwatch clock = Stopwatch.StartNew();
        try
        {
            while (pipe.IsConnected)
            {
                await Task.Delay(1000);
                double seconds = clock.Elapsed.TotalSeconds;
                clock.Restart();
                List<object> rows = [];
                foreach (var pid in counters.Keys)
                {
                    if (!counters.TryRemove(pid, out var n))
                        continue;
                    string name;
                    try
                    {
                        using Process process = Process.GetProcessById(pid);
                        name = process.ProcessName;
                    }
                    catch { name = pid == 0 ? "System" : "PID " + pid; }
                    rows.Add(new
                    {
                        pid,
                        process = name,
                        uploadBps = n.Up / seconds,
                        downloadBps = n.Down / seconds
                    });
                }
                await writer.WriteLineAsync(JsonSerializer.Serialize(new
                {
                    sample = new
                    {
                        timestamp = DateTimeOffset.Now,
                        rows,
                        eventsLost = session.Source.EventsLost,
                        source = "Windows ETW TCP/UDP"
                    }
                }, JsonDefaults.Options));
            }
        }
        finally { session.Stop(); try { await processing.WaitAsync(TimeSpan.FromSeconds(3)); } catch { } }
    }
}
