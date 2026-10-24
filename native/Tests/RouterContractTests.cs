using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NetworkToolbox;

// Synthetic firmware-contract fixtures. These tests never contact a real router.
static class RouterContractTests
{
    public static async Task Run()
    {
        using FixtureServer server = new();
        LocalStore store = new(Path.Combine(Environment.CurrentDirectory, ".runtime", "router-tests-" + Guid.NewGuid().ToString("N")));
        using RouterService service = new(store);
        Console.WriteLine("Testing local router authentication fixture");
        await service.Connect(new() { ["host"] = server.Origin, ["password"] = "synthetic-admin", ["remember"] = true }).WaitAsync(TimeSpan.FromSeconds(15));
        Console.WriteLine("Local router fixture authenticated");
        if (!server.ValidLogin) throw new Exception("Router digest authentication contract failed");
        string credentials = Path.Combine(store.Root, "router-credential.bin");
        if (!File.Exists(credentials) || Encoding.UTF8.GetString(File.ReadAllBytes(credentials)).Contains("synthetic-admin")) throw new Exception("Credential protection failed");
        service.Disconnect(false);
        await service.Connect(new() { ["host"] = server.Origin, ["remember"] = true });
        JsonNode wifi = JsonSerializer.SerializeToNode(await service.Read(new() { ["section"] = "wifi" }), JsonDefaults.Options)!;
        if (wifi["radios"]?[1]?["channels"]?.AsArray().Count != 2 || wifi.ToJsonString().Contains("synthetic-wifi")) throw new Exception("Channel matrix or secret boundary failed");
        JsonNode plan = JsonSerializer.SerializeToNode(await service.Plan(new() { ["action"] = "wifi", ["desired"] = new JsonObject { ["band"] = 2, ["channel"] = 149, ["bandwidth"] = 80 } }), JsonDefaults.Options)!;
        await service.Apply(new() { ["id"] = plan["id"]!.ToString() });
        if (server.Writes != 1 || server.LastWrite.GetValueOrDefault("channel2") != "149" || server.LastWrite.GetValueOrDefault("on1")!="1" || server.LastWrite.GetValueOrDefault("pwd1") != "synthetic-wifi24" || server.LastWrite.GetValueOrDefault("pwd2") != "synthetic-wifi5" || server.LastWrite.ContainsKey("on3")) throw new Exception("Complete dual-band save contract failed");
        bool rejected = false;
        try { await service.Apply(new() { ["id"] = plan["id"]!.ToString() }); } catch { rejected = true; }
        if (!rejected || server.Writes != 1) throw new Exception("Duplicate write was not rejected");
        JsonNode stale = JsonSerializer.SerializeToNode(await service.Plan(new() { ["action"] = "wifi", ["desired"] = new JsonObject { ["band"] = 2, ["channel"] = 48, ["bandwidth"] = 80 } }), JsonDefaults.Options)!;
        server.Radios[0]!["ssid"] = "changed-outside-toolbox";
        rejected = false;
        try { await service.Apply(new() { ["id"] = stale["id"]!.ToString() }); } catch { rejected = true; }
        if (!rejected || server.Writes != 1) throw new Exception("Stale router plan was not rejected");
        server.Radios[0]!["password"] = "********";
        rejected = false;
        try { await service.Plan(new() { ["action"] = "wifi", ["desired"] = new JsonObject { ["band"] = 2, ["channel"] = 48, ["bandwidth"] = 80 } }); } catch { rejected = true; }
        if (!rejected) throw new Exception("Masked password should block incomplete saves");
        service.Disconnect(true);
        if (File.Exists(credentials)) throw new Exception("Forgetting the credential failed");
        Console.WriteLine("PASS router firmware contracts: SHA256 login, DPAPI, channel matrix, full dual-band save, duplicate/stale rejection, masked-password guard");
    }

    sealed class FixtureServer : IDisposable
    {
        readonly TcpListener listener = new(IPAddress.Loopback, 0);
        readonly CancellationTokenSource stop = new();
        public string Origin { get; }
        public bool ValidLogin { get; private set; }
        public int Writes { get; private set; }
        public Dictionary<string, string> LastWrite { get; private set; } = new();
        public JsonArray Radios { get; } = new(
            new JsonObject { ["ssid"] = "synthetic24", ["password"] = "synthetic-wifi24", ["channel"] = 1, ["bandwidth"] = 20, ["enabled"] = 1, ["status"] = 1, ["encryption"] = "psk2", ["hidden"] = 0, ["txpwr"] = "mid" },
            new JsonObject { ["ssid"] = "synthetic5", ["password"] = "synthetic-wifi5", ["channel"] = 48, ["bandwidth"] = 80, ["enabled"] = 1, ["status"] = 1, ["encryption"] = "psk2", ["hidden"] = 0, ["txpwr"] = "mid" });
        public FixtureServer()
        {
            listener.Start(); Origin = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port;
            _ = Task.Run(async () => { try { while (!stop.IsCancellationRequested) { TcpClient client = await listener.AcceptTcpClientAsync(stop.Token); _ = Serve(client); } } catch (OperationCanceledException) { } catch (SocketException) { } });
        }
        async Task Serve(TcpClient client)
        {
            using (client)
            {
                try
                {
                    using NetworkStream stream = client.GetStream();
                    using StreamReader reader = new(stream, Encoding.ASCII, leaveOpen: true);
                    string line = await reader.ReadLineAsync(stop.Token) ?? "";
                    string target = line.Split(' ').ElementAtOrDefault(1) ?? "/";
                    int length = 0; string? header;
                    while (!string.IsNullOrEmpty(header = await reader.ReadLineAsync(stop.Token))) if (header.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) length = int.Parse(header[15..].Trim());
                    if (length < 0 || length > 100000) return;
                    char[] body = new char[length]; if(length>0) await reader.ReadBlockAsync(body, stop.Token);
                    Dictionary<string, string> form = new string(body).Split('&', StringSplitOptions.RemoveEmptyEntries).Select(s => s.Split('=', 2)).ToDictionary(p => Decode(p[0]), p => p.Length > 1 ? Decode(p[1]) : "");
                    string response = Respond(target, form), type = response.StartsWith('<') || response.StartsWith("var ") ? "text/html" : "application/json";
                    byte[] bytes = Encoding.UTF8.GetBytes(response), head = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: " + type + "; charset=utf-8\r\nContent-Length: " + bytes.Length + "\r\nConnection: close\r\n\r\n");
                    await stream.WriteAsync(head, stop.Token); await stream.WriteAsync(bytes, stop.Token);
                }
                catch (OperationCanceledException) { } catch (IOException) { } catch (SocketException) { }
            }
        }
        string Respond(string target, Dictionary<string, string> form)
        {
            if (target.EndsWith("/init_info")) return "{\"code\":0,\"hardware\":\"RD03\",\"romversion\":\"1.0.84\",\"newEncryptMode\":1,\"displayName\":\"Synthetic AX3000T\"}";
            if (target.EndsWith("/web")) return "<script>var Encrypt = {key:'synthetic-salt',nonceCreat:function(){var deviceId='00:00:00:00:00:01';}};</script>";
            if (target.EndsWith("/login"))
            {
                string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
                ValidLogin = form.GetValueOrDefault("password") == Hash(form.GetValueOrDefault("nonce") + Hash("synthetic-admin" + "synthetic-salt"));
                return ValidLogin ? "{\"code\":0,\"token\":\"syntheticToken1234567890\"}" : "{\"code\":999,\"msg\":\"fixture digest mismatch\"}";
            }
            if (target.EndsWith("/web/setting/wifi")) return "var global={wifi:{pddk:{'1':'[{\"c\":1,\"b\":[20,40,0]}]','2':'[{\"c\":48,\"b\":[20,40,80,0]},{\"c\":149,\"b\":[20,40,80,0]}]'}}};";
            if (target.EndsWith("/wifi_detail_all")) return new JsonObject { ["code"] = 0, ["bsd"] = 0, ["info"] = Radios.DeepClone() }.ToJsonString();
            if (target.EndsWith("/set_all_wifi")) { Writes++; LastWrite = form; Radios[1]!["channel"] = int.Parse(form["channel2"]); return "{\"code\":0}"; }
            return "{\"code\":404,\"msg\":\"unsupported synthetic route\"}";
        }
        static string Decode(string s) => Uri.UnescapeDataString(s.Replace('+', ' '));
        public void Dispose() { stop.Cancel(); listener.Stop(); stop.Dispose(); }
    }
}
