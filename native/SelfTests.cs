using System.Text.Json;
using System.Text.Json.Nodes;

namespace NetworkToolbox;

public static class SelfTests
{
    public static void Run()
    {
        int passed = 0;
        void Check(string name, Action test)
        {
            test();
            passed++;
            Console.WriteLine("PASS " + name);
        }
        void Equal<T>(T a, T b)
        {
            if (!Equals(a, b))
                throw new Exception($"Expected {b}, got {a}");
        }
        void Reject(Action action)
        {
            try
            {
                action();
            }
            catch { return; }
            throw new Exception("Expected rejection");
        }
        Check("subnet /24 boundary", () => { var n = JsonSerializer.SerializeToNode(NetworkUtilities.Subnet("192.0.2.253/24"), JsonDefaults.Options)!; Equal(n["network"]!.ToString(), "192.0.2.0"); Equal(n["last"]!.ToString(), "192.0.2.254"); Equal(n["usable"]!.GetValue<ulong>(), 254UL); });
        Check("subnet /31 and /32", () => { var n = JsonSerializer.SerializeToNode(NetworkUtilities.Subnet("10.0.0.3/31"), JsonDefaults.Options)!; Equal(n["usable"]!.GetValue<ulong>(), 2UL); Equal(n["first"]!.ToString(), "10.0.0.2"); Equal(NetworkUtilities.Range("10.0.0.3/32").Network, NetworkUtilities.ToUInt(System.Net.IPAddress.Parse("10.0.0.3"))); });
        Check("invalid network inputs", () => { Reject(() => NetworkUtilities.Range("192.168.1.1/33")); Reject(() => Validation.Host("host; ping other")); Reject(() => Validation.Host("http://example.com")); Reject(() => Validation.Port(65536)); });
        Check("Wi-Fi 160 MHz revised VHT encoding", () => { WifiNetwork n = new() { Frequency = 5240, Band = "5 GHz" }; NativeWifi.ParseIes(n, [61, 2, 48, 3, 192, 5, 1, 42, 50, 0, 0]); Equal(n.Width, 160); Equal(n.CenterFrequency, 5250d); });
        Check("Wi-Fi unknown width remains unknown", () => { WifiNetwork n = new() { Frequency = 5240, Band = "5 GHz" }; NativeWifi.ParseIes(n, [192, 255, 1]); Equal(n.Width, null); });
        Check("AP load is separately decoded", () => { WifiNetwork n = new() { Frequency = 2412, Band = "2.4 GHz" }; NativeWifi.ParseIes(n, [11, 5, 9, 0, 51, 0, 0]); Equal(n.Stations, 9); Equal(n.Utilization, 20); });
        Check("DNS compressed A response", () => { byte[] query = DnsTools.Build("example.com", 1, out ushort id); query[2] = 0x81; query[3] = 0x80; query[7] = 1; byte[] response = [.. query, 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 0, 2, 1]; var result = JsonSerializer.SerializeToNode(DnsTools.Parse(response, id), JsonDefaults.Options)!; Equal(result["records"]![0]!["value"]!.ToString(), "192.0.2.1"); Equal(result["records"]![0]!["name"]!.ToString(), "example.com"); });
        Check("DNS corrupt pointer terminates", () => { byte[] reply = [0, 1, 0x81, 0x80, 0, 1, 0, 0, 0, 0, 0, 0, 0xc0, 0x0c, 0, 1, 0, 1]; Reject(() => DnsTools.Parse(reply, 1)); });
        Check("configuration rejects malformed DNS", () => { Reject(() => ConfigurationService.Validate("dns", new() { ["servers"] = new JsonArray("not-an-address") })); Reject(() => ConfigurationService.Validate("mtu", new() { ["mtu"] = 42 })); });
        Check("report encodes hostile content and omits secrets", () => { JsonObject r = new() { ["title"] = "<script>alert(1)</script>", ["data"] = new JsonObject { ["password"] = "secret-value", ["token"] = "private-token", ["ssid"] = "<img onerror=bad>" } }; string html = Report.Render(r); if (html.Contains("<script>") || html.Contains("secret-value") || html.Contains("private-token") || (!html.Contains("&lt;img") && !html.Contains("\\u003Cimg"))) throw new Exception("Unsafe report"); });
        Check("reports remove HTTP cookies, authorization and URL credentials",()=>{JsonObject n=new(){["url"]="https://example.com/check?token=private-query",["headers"]=new JsonObject{["Set-Cookie"]="session=private-cookie",["Authorization"]="Bearer private-auth"},["server"]="socks5://name:private-proxy@127.0.0.1:1080"};string clean=Report.Redact(n).ToJsonString();foreach(string secret in new[]{"private-query","private-cookie","private-auth","private-proxy"})if(clean.Contains(secret))throw new Exception("Report credential leak");});
        Check("configuration previews are protected without applying settings",()=>{var s=new LocalStore(Path.Combine(Environment.CurrentDirectory,".runtime","config-tests"));var c=new ConfigurationService(s);JsonNode plan=JsonSerializer.SerializeToNode(c.Plan(new(){["type"]="proxy",["desired"]=new JsonObject{["enabled"]=false,["server"]="",["pac"]="https://example.com/proxy.pac?token=synthetic-private-value",["bypass"]=""}}).GetAwaiter().GetResult(),JsonDefaults.Options)!;byte[] stored=File.ReadAllBytes(s.PathFor("plans",plan["id"]!.ToString(),"bin"));if(System.Text.Encoding.UTF8.GetString(stored).Contains("synthetic-private-value"))throw new Exception("Plaintext configuration preview");});
        Check("peer /32 discovery range stays within attached subnet",()=>{var own=NetworkUtilities.Range("192.0.2.40/24");if(!NetworkUtilities.Contains(own,NetworkUtilities.Range("192.0.2.1/32"))||NetworkUtilities.Contains(own,NetworkUtilities.Range("192.0.1.0/23")))throw new Exception("Connected subnet containment failed");});
        RouterContractTests.Run().GetAwaiter().GetResult();
        Check("latency measurement prevents active Wi-Fi scan",()=>{WifiService wifi=new();wifi.BeginLatency(CancellationToken.None).GetAwaiter().GetResult();bool blocked=false;try{wifi.Scan(true).GetAwaiter().GetResult();}catch(WifiBusyException){blocked=true;}finally{wifi.EndLatency();}if(!blocked)throw new Exception("Scan isolation failed");});
        LanContractTests.Run().GetAwaiter().GetResult();
        PacketContractTests.Run();
        Check("offline IEEE vendor and randomized address distinction",()=>{if(!Vendors.Lookup("00:0A:95:12:34:56").Contains("Apple",StringComparison.OrdinalIgnoreCase)||Vendors.Lookup("02:0A:95:12:34:56")!="本地管理 / 随机地址")throw new Exception("Vendor lookup failed");});
        Console.WriteLine($"{passed} native domain tests and router contract suite passed");
    }
}
