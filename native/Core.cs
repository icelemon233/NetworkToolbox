using System.Collections.Concurrent;
using System.Net;
using System.Net.NetworkInformation;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NetworkToolbox;

public static class JsonDefaults
{
    public static JsonSerializerOptions Options { get; } = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = false };
    public static T? Get<T>(this JsonObject p, string key, T? fallback = default) => p[key] is null ? fallback : p[key]!.GetValue<T>();
}
public sealed class LocalStore
{
    public string Root
    {
        get;
    }
    readonly object gate = new();
    public LocalStore(string root)
    {
        Root = Path.GetFullPath(root);
        Directory.CreateDirectory(Root);
    }
    public string Folder(string name)
    {
        if (name.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-'))
            throw new Exception("无效目录");
        string p = Path.Combine(Root, name);
        Directory.CreateDirectory(p);
        return p;
    }
    public string PathFor(string folder, string id, string ext = "json")
    {
        if (id.Length > 100 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-'))
            throw new Exception("记录标识不正确");
        return Path.Combine(Folder(folder), id + "." + ext);
    }
    public string Save(string type, object data, string? title = null)
    {
        string id = Guid.NewGuid().ToString("N");
        var record = new
        {
            id,
            type,
            title = title ?? type,
            createdAt = DateTimeOffset.Now,
            data
        };
        lock (gate)
            AtomicWrite(PathFor("history", id), System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(record, JsonDefaults.Options)));
        var files = new DirectoryInfo(Folder("history")).GetFiles("*.json").OrderByDescending(x => x.CreationTimeUtc).Skip(500).ToArray();
        foreach (var f in files)
        {
            try
            {
                f.Delete();
            }
            catch (IOException) { }
        }
        return id;
    }
    public object[] List() => new DirectoryInfo(Folder("history")).GetFiles("*.json").OrderByDescending(x => x.CreationTimeUtc).Select(f => { try { var n = JsonNode.Parse(File.ReadAllText(f.FullName))!; return (object)new { id = n["id"]?.ToString(), type = n["type"]?.ToString(), title = n["title"]?.ToString(), createdAt = n["createdAt"]?.ToString() }; } catch { return null; } }).Where(x => x != null).Take(500).ToArray()!;
    public JsonNode Read(string id) => JsonNode.Parse(File.ReadAllText(PathFor("history", id))) ?? throw new Exception("记录损坏");
    public void Remove(string id) => File.Delete(PathFor("history", id));
    public static void AtomicWrite(string path, byte[] bytes)
    {
        string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllBytes(temporary, bytes); File.Move(temporary, path, true); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
public sealed class Job
{
    public string Id { get; } = Guid.NewGuid().ToString("N");
    public string Kind { get; init; } = ""; public string Title { get; init; } = "";
    public string State { get; set; } = "running"; public DateTimeOffset StartedAt { get; } = DateTimeOffset.Now;
    public int Progress
    {
        get; set;
    }
    public object? Result
    {
        get; set;
    }
    public string? Error
    {
        get; set;
    }
    public int SampleCount
    {
        get; set;
    }
    [System.Text.Json.Serialization.JsonIgnore] public ConcurrentQueue<object> Samples { get; } = new();
    [System.Text.Json.Serialization.JsonIgnore] public CancellationTokenSource Cancellation { get; } = new();
    [System.Text.Json.Serialization.JsonIgnore] public bool ShutdownSaved;
}
public sealed class JobRunner : IDisposable
{
    readonly ConcurrentDictionary<string, Job> jobs = new(); readonly Action<string, object> emit; readonly LocalStore store;
    readonly ConcurrentDictionary<string, Task> tasks = new();
    public JobRunner(LocalStore s, Action<string, object> e)
    {
        store = s;
        emit = e;
    }
    public object Start(string kind, string title, Func<Job, Task<object>> run)
    {
        if (jobs.Values.Count(j => j.State == "running") >= 8)
            throw new Exception("已有 8 个任务运行，请先停止一个任务");
        Job job = new()
        {
            Kind = kind,
            Title = title
        };
        jobs[job.Id] = job;
        emit("job", job);
        tasks[job.Id] = Task.Run(async () => {
            try { job.Result = await run(job); job.State = "completed"; job.Progress = 100; if(!job.ShutdownSaved)store.Save(kind, job.Result, title); }
            catch (OperationCanceledException) { job.State = "cancelled"; job.Result = new { partial = true, samples = job.Samples.ToArray() }; if(!job.ShutdownSaved)store.Save(kind, job.Result, title + "（已停止）"); }
            catch (Exception ex) { job.Error = ex.Message; job.State = "failed"; if (job.SampleCount > 0) { job.Result = new { partial = true, error = ex.Message, samples = job.Samples.ToArray() }; if(!job.ShutdownSaved)store.Save(kind, job.Result, title + "（部分结果）"); } }
            finally { emit("job", job); }
        });
        return new
        {
            jobId = job.Id
        };
    }
    public void Sample(Job j, object data, int? progress = null)
    {
        j.SampleCount++;
        j.Samples.Enqueue(data);
        while (j.Samples.Count > 5000)
            j.Samples.TryDequeue(out _);
        if (progress is int p)
            j.Progress = Math.Clamp(p, 0, 100);
        emit("sample", new
        {
            jobId = j.Id,
            kind = j.Kind,
            data,
            progress = j.Progress
        });
    }
    public object[] List() => jobs.Values.OrderByDescending(j => j.StartedAt).Select(j => (object)j).ToArray();
    public object Cancel(string id)
    {
        if (!jobs.TryGetValue(id, out var j))
            throw new Exception("任务不存在");
        j.Cancellation.Cancel();
        return new
        {
            ok = true
        };
    }
    public void Dispose()
    {
        foreach (var j in jobs.Values)
        {
            if(j.State=="running"){j.ShutdownSaved=true;store.Save(j.Kind,new{partial=true,samples=j.Samples.ToArray()},j.Title+"（退出时保存）");}
            j.Cancellation.Cancel();
        }
        Task.WhenAll(tasks.Values).WaitAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult();
    }
}
public sealed class Toolbox : IDisposable
{
    readonly LocalStore store; readonly JobRunner jobs; readonly WifiService wifi = new(); readonly RouterService router;
    readonly ConfigurationService config; readonly CaptureService capture; readonly LanSpeedService lanSpeed = new();
    readonly SemaphoreSlim routerGate=new(1,1);
    readonly Action<string, object> emit;
    public Toolbox(LocalStore s, Action<string, object> e)
    {
        store = s;
        emit = e;
        jobs = new(s, e);
        router = new(s);
        config = new(s);
        capture = new(s);
    }
    public async Task<object?> Call(string method, JsonObject p) => method switch
    {
        "meta" => new { version = typeof(Toolbox).Assembly.GetName().Version?.ToString(3), platform = "windows", dataDirectory = store.Root, admin = AdminBroker.IsAdmin(), captureAvailable = File.Exists(Path.Combine(Environment.SystemDirectory, "pktmon.exe")) },
        "overview" => await SystemNetwork.Snapshot(),
        "routes" => await SystemNetwork.Routes(),
        "wifi.scan" => await Scan(p.Get("refresh", true)),
        "wifi.monitor" => jobs.Start("wifi", "Wi-Fi 信号监测", async j =>
        {
            int minutes = Math.Clamp(p.Get("minutes", 30), 1, 1440);
            DateTimeOffset end = DateTimeOffset.Now.AddMinutes(minutes);
            List<object> samples = [];
            while (DateTimeOffset.Now < end)
            {
                j.Cancellation.Token.ThrowIfCancellationRequested();
                if (!wifi.LatencyActive)
                {
                    try {var sample = await wifi.Scan(true, j.Cancellation.Token);samples.Add(sample);jobs.Sample(j, sample);}catch(WifiBusyException){}
                }
                await Task.Delay(15000, j.Cancellation.Token);
            }
            return new
            {
                samples
            };
        }),
        "ping.start" => jobs.Start("ping", "连续 Ping · " + Diagnostics.Target(p), j => Diagnostics.Ping(p, j, jobs, wifi)),
        "trace.start" => jobs.Start("trace", "路由追踪 · " + Diagnostics.Target(p), j => Diagnostics.Trace(p, j, jobs)),
        "dns.query" => await Recorded("dns","DNS 查询",()=>DnsTools.Query(p)),
        "dns.flush" => await AdminBroker.Call(store,"dns.flush",new()),
        "web.test" => await Recorded("web","HTTP / TLS 检测",()=>Diagnostics.Web(p)),
        "ports.test" => await Recorded("ports","端口检测",()=>Diagnostics.Ports(p)),
        "speed.start" => jobs.Start("speed", "外网测速", j => SpeedTools.Internet(p, j, jobs)),
        "lan.server" => await lanSpeed.StartServer(p),
        "lan.server.stop" => lanSpeed.Stop(),
        "lan.speed.start" => jobs.Start("lan-speed", "局域网测速", j => lanSpeed.Client(p, j, jobs)),
        "lan.discover" => jobs.Start("discovery", "局域网设备发现", j => SystemNetwork.Discover(p, j, jobs)),
        "connections" => Connections.Read(),
        "traffic.start" => jobs.Start("traffic", "进程流量监测", j => AdminBroker.Traffic(store, j, x => jobs.Sample(j, x))),
        "capture.start" => await capture.Start(p),
        "capture.stop" => await capture.Stop(),
        "capture.list" => capture.List(),
        "capture.inspect" => capture.Inspect(p.Get("id", "")!),
        "config.plan" => await config.Plan(p),
        "config.apply" => await config.Apply(p.Get("id", "")!),
        "config.snapshots" => config.List(),
        "config.restore" => await config.Restore(p.Get("id", "")!),
        "router.info" => await RouterCall(()=>router.Info(p)),
        "router.connect" => await RouterCall(()=>router.Connect(p)),
        "router.disconnect" => await RouterCall(()=>Task.FromResult(router.Disconnect(p.Get("forget", false)))),
        "router.read" => await RouterCall(()=>router.Read(p)),
        "router.plan" => await RouterCall(()=>router.Plan(p)),
        "router.apply" => await RouterCall(()=>router.Apply(p)),
        "tools.wol" => await NetworkUtilities.Wake(p),
        "tools.vendor" => new {mac=p.Get("mac","")!,vendor=Vendors.Lookup(p.Get("mac","")!),source="IEEE MA-L / MA-M / MA-S",dataDate=Vendors.DataDate},
        "tools.subnet" => NetworkUtilities.Subnet(p.Get("cidr", "")!),
        "tools.publicIp" => await NetworkUtilities.PublicIp(),
        "jobs.list" => jobs.List(),
        "jobs.cancel" => jobs.Cancel(p.Get("id", "")!),
        "history.list" => store.List(),
        "history.read" => store.Read(p.Get("id", "")!),
        "history.delete" => Delete(p),
        "history.snapshot" => await RecordedSnapshot(),
        "export" => Export(p),
        _ => throw new Exception("此操作不受支持")
    };
    async Task<object> RouterCall(Func<Task<object>> call){if(!await routerGate.WaitAsync(TimeSpan.FromSeconds(10)))throw new Exception("路由器有操作尚未完成，请稍后重试");try{return await call();}finally{routerGate.Release();}}
    async Task<object> Scan(bool refresh)
    {
        object result = await wifi.Scan(refresh);
        if (refresh)
            store.Save("wifi", result, "Wi-Fi 扫描");
        return result;
    }
    async Task<object> Recorded(string kind,string title,Func<Task<object>> run){object result=await run();store.Save(kind,Report.Redact(JsonSerializer.SerializeToNode(result,JsonDefaults.Options)!),title);return result;}
    async Task<object> RecordedSnapshot(){object result=await SystemNetwork.Snapshot();return store.Save("snapshot",Report.Redact(JsonSerializer.SerializeToNode(result,JsonDefaults.Options)!),"网络配置快照");}
    object Delete(JsonObject p)
    {
        store.Remove(p.Get("id", "")!);
        return new
        {
            ok = true
        };
    }
    object Export(JsonObject p)
    {
        string id = p.Get("id", "")!;
        if (p.Get("kind", "") == "capture")
            return new
            {
                fileName = "NetworkToolbox-capture-" + id + ".pcapng",
                base64 = Convert.ToBase64String(File.ReadAllBytes(store.PathFor("captures", id, "pcapng")))
            };
        var record = store.Read(id);
        return new
        {
            fileName = "NetworkToolbox-report-" + id[..Math.Min(8, id.Length)] + ".html",
            base64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(Report.Render(record)))
        };
    }
    public void Dispose()
    {
        jobs.Dispose();
        lanSpeed.Dispose();
        router.Dispose();
    }
}
public static class Validation
{
    public static string Host(string value)
    {
        value = value.Trim();
        if (value.Length is < 1 or > 253 || value.Any(c => char.IsWhiteSpace(c) || c == '/' || c == '\\' || c == '@'))
            throw new Exception("请输入有效的主机名或 IP 地址");
        if (!IPAddress.TryParse(value, out _) && Uri.CheckHostName(value) == UriHostNameType.Unknown)
            throw new Exception("主机名格式不正确");
        return value;
    }
    public static int Port(int port)
    {
        if (port < 1 || port > 65535)
            throw new Exception("端口范围应为 1–65535");
        return port;
    }
    public static bool Private(IPAddress ip)
    {
        var b = ip.GetAddressBytes();
        return b.Length == 4 && (b[0] == 10 || b[0] == 127 || (b[0] == 192 && b[1] == 168) || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 169 && b[1] == 254));
    }
}
