using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace NetworkToolbox;

public sealed class RouterService : IDisposable
{
    readonly LocalStore store; readonly HttpClient http; readonly SemaphoreSlim mutation = new(1, 1);
    string origin = "", token = "", hardware = "", firmware = "", region = ""; string? forwardNamespace;
    readonly Dictionary<string, RouterPlan> plans = new();
    sealed record RouterPlan(string Action, string Endpoint, string Verb, Dictionary<string, string> Fields, object Summary, DateTimeOffset Created, string? Fingerprint = null);
    string CredentialFile => Path.Combine(store.Root, "router-credential.bin");
    public RouterService(LocalStore s)
    {
        store = s;
        http = new(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false })
        {
            Timeout = TimeSpan.FromSeconds(45)
        };
    }
    public async Task<object> Info(JsonObject p)
    {
        string requested = p.Get("host", origin.Length > 0 ? origin : "http://" + (SystemNetwork.Gateway() ?? "192.168.31.1"))!;
        string next = await ValidateOrigin(requested);
        if (origin != next)
        {
            origin = next;
            token = "";
            forwardNamespace = null;
        }
        JsonObject info = await Api("xqsystem/init_info", auth: false);
        hardware = info.Get("hardware", "")!;
        firmware = info.Get("romversion", info.Get("version", ""))!;
        region = info.Get("countrycode", info.Get("countryCode", "CN"))!;
        return new
        {
            host = origin,
            name = info.Get("displayName", info.Get("model", "小米路由器")),
            hardware,
            firmware,
            region,
            connected = token.Length > 0,
            credentialStored = File.Exists(CredentialFile),
            supported = hardware == "RD03" && firmware == "1.0.84",
            capabilities = Report.Redact(info),
            adapter = "AX3000T / RD03 / CN / 1.0.84",
            verification = "公开信息已验证；管理功能依据同版本原厂模板，操作后回读确认。"
        };
    }
    public async Task<object> Connect(JsonObject p)
    {
        await Info(p);
        string password = p.Get("password", "")!;
        if (password.Length == 0 && File.Exists(CredentialFile))
        {
            JsonObject saved = ReadSecret(CredentialFile);
            if (saved.Get("host", "") == origin)
                password = saved.Get("password", "")!;
        }
        if (password.Length == 0)
            throw new Exception("请输入路由器管理密码");
        string page = await http.GetStringAsync(origin + "/cgi-bin/luci/web");
        string key = Regex.Match(page, @"\bEncrypt\s*=\s*\{\s*key\s*:\s*['""]([^'""]+)['""]").Groups[1].Value;
        string device = Regex.Match(page, @"\bdeviceId\s*=\s*['""]([^'""]+)['""]").Groups[1].Value;
        if (key.Length == 0 || device.Length == 0)
            throw new Exception("当前登录页的认证格式不受支持，未尝试提交密码");
        JsonObject init = await Api("xqsystem/init_info", auth: false);
        bool sha256 = Int(init["newEncryptMode"]) == 1;
        string nonce = "0_" + device + "_" + DateTimeOffset.UtcNow.ToUnixTimeSeconds() + "_" + RandomNumberGenerator.GetInt32(10000);
        string digest = Hash(nonce + Hash(password + key, sha256), sha256);
        JsonObject result = await Api("xqsystem/login", new()
        {
            ["username"] = "admin",
            ["password"] = digest,
            ["logtype"] = "2",
            ["nonce"] = nonce
        }, "POST", false);
        string session = result.Get("token", "")!;
        if (session.Length < 8 || session.Length > 256 || !session.All(char.IsAsciiLetterOrDigit))
            throw new Exception("路由器未返回有效会话");
        token = session;
        if (p.Get("remember", false))
            WriteSecret(CredentialFile, new JsonObject { ["host"] = origin, ["password"] = password });
        else File.Delete(CredentialFile);
        return new
        {
            connected = true,
            host = origin,
            remembered = p.Get("remember", false),
            supported = hardware == "RD03" && firmware == "1.0.84"
        };
    }
    public object Disconnect(bool forget)
    {
        token = "";
        plans.Clear();
        if (forget)
            File.Delete(CredentialFile);
        return new
        {
            connected = false,
            forgotten = forget
        };
    }
    public async Task<object> Read(JsonObject p)
    {
        RequireSession();
        string section = p.Get("section", "wifi")!;
        if (section == "wifi")
            return await Wifi();
        if (section == "forwards")
        {
            string ns = await ForwardNamespace();
            return Report.Redact(await Api(ns + "/portforward", new()
            {
                ["ftype"] = "0"
            }));
        }
        string endpoint = section switch
        {
            "devices" => "misystem/devicelist",
            "status" => "misystem/status",
            "qos" => "misystem/qos_info",
            "dhcp" => "xqnetwork/lan_dhcp",
            "bindings" => "xqnetwork/macbind_info",
            "filter" => "xqnetwork/wifi_macfilter_info",
            _ => throw new Exception("不支持读取此路由器信息")
        };
        return Report.Redact(await Api(endpoint, section == "devices" ? new()
        {
            ["mlo"] = "1"
        } : null));
    }
    async Task<object> Wifi()
    {
        JsonObject response = await Api("xqnetwork/wifi_detail_all");
        JsonArray info = response["info"]?.AsArray() ?? throw new Exception("无线配置格式不受支持");
        var channels = await Channels();
        var radios = info.Take(2).Select((n, i) => new { index = i + 1, band = i == 0 ? "2.4 GHz" : "5 GHz", ssid = n?["ssid"]?.ToString(), enabled = Int(n?["status"]) == 1, channel = Int(n?["channel"]), actualChannel = Int(n?["channelInfo"]?["channel"]), bandwidth = Int(n?["bandwidth"]), hidden = Int(n?["hidden"]) == 1, txpwr = n?["txpwr"]?.ToString(), encryption = n?["encryption"]?.ToString(), hasPassword = PasswordKnown(n?.AsObject()), channels = channels.GetValueOrDefault(i + 1) ?? new JsonArray() }).ToArray();
        return new
        {
            bsd = Int(response["bsd"]),
            radios,
            supported = hardware == "RD03" && firmware == "1.0.84",
            note = "可选信道与频宽读取自当前路由器管理页；管理密码与 Wi-Fi 密码不会返回到界面。"
        };
    }
    async Task<Dictionary<int, JsonArray>> Channels()
    {
        string page = await http.GetStringAsync(origin + "/cgi-bin/luci/;stok=" + token + "/web/setting/wifi");
        var block = ReadObjectBody(page, @"\bpddk\s*:\s*\{");
        Dictionary<int, JsonArray> result = [];
        foreach (Match match in Regex.Matches(block, @"['""]([12])['""]\s*:\s*'([^']*)'"))
        {
            string json = WebUtility.HtmlDecode(match.Groups[2].Value).Replace("\\\"", "\"");
            try
            {
                if (JsonNode.Parse(json) is JsonArray array)
                    result[int.Parse(match.Groups[1].Value)] = array;
            }
            catch (JsonException) { }
        }
        return result;
    }
    internal static string ReadObjectBody(string source, string marker)
    {
        Match match = Regex.Match(source, marker);
        if (!match.Success) return "";
        int start = match.Index + match.Length, depth = 1;
        char quote = '\0'; bool escape = false;
        for (int i = start; i < source.Length; i++)
        {
            char c = source[i];
            if (quote != '\0')
            {
                if (escape) { escape = false; continue; }
                if (c == '\\') { escape = true; continue; }
                if (c == quote) quote = '\0';
                continue;
            }
            if (c is '\'' or '"') { quote = c; continue; }
            if (c == '{') depth++;
            if (c == '}' && --depth == 0) return source[start..i];
        }
        return "";
    }
    public async Task<object> Plan(JsonObject p)
    {
        RequireSupported();
        string action = p.Get("action", "")!;
        JsonObject d = p["desired"]?.AsObject() ?? throw new Exception("缺少配置参数");
        Dictionary<string, string> fields = [];
        string endpoint, verb = "POST";
        object summary;
        string? fingerprint = null;
        if (action == "wifi")
        {
            JsonObject current = await Api("xqnetwork/wifi_detail_all");
            JsonArray radios = current["info"]?.AsArray() ?? throw new Exception("无线配置不完整");
            if (radios.Count != 2)
                throw new Exception("当前无线模式不符合 AX3000T 双频适配条件");
            var channels = await Channels();
            int band = d.Get("band", 2);
            if (band is < 1 or > 2)
                throw new Exception("频段不正确");
            int channel = d.Get("channel", Int(radios[band - 1]?["channel"])), width = d.Get("bandwidth", Int(radios[band - 1]?["bandwidth"]));
            JsonArray allowed = channels.GetValueOrDefault(band) ?? throw new Exception("未读取到当前地区的信道选项，无法提交配置");
            JsonNode? allowedChannel = allowed.FirstOrDefault(n => Int(n?["c"]) == channel);
            if (allowedChannel is null)
                throw new Exception("该信道不在路由器当前允许列表中");
            JsonArray bands = allowedChannel["b"]?.AsArray() ?? new();
            if (width != 0 && !bands.Any(n => Int(n) == width))
                throw new Exception("该信道不支持所选带宽");
            fields["bsd"] = Int(current["bsd"]).ToString();
            for (int i = 0; i < 2; i++)
            {
                JsonObject r = radios[i]!.AsObject();
                if(new[]{"status","ssid","encryption","channel","bandwidth","hidden","txpwr"}.Any(k=>r[k] is null)
                    || Int(r["status"]) is not(0 or 1) || Int(r["hidden"]) is not(0 or 1)
                    || string.IsNullOrEmpty(r["ssid"]?.ToString())
                    || r["txpwr"]?.ToString() is not("min" or "mid" or "max")
                    || !int.TryParse(r["channel"]?.ToString(),out _) || !int.TryParse(r["bandwidth"]?.ToString(),out _))
                    throw new Exception("路由器返回的无线配置不完整，未生成修改请求。请在原厂后台调整。");
                if (!PasswordKnown(r) && r.Get("encryption", "") != "none")
                    throw new Exception("路由器未返回可保留的 Wi-Fi 密码。请在原厂后台调整，避免覆盖已有密码。");
                string suffix = (i + 1).ToString();
                fields["on" + suffix] = Int(r["status"]).ToString();
                fields["ssid" + suffix] = r.Get("ssid", "")!;
                fields["pwd" + suffix] = r.Get("password", "")!;
                fields["encryption" + suffix] = r.Get("encryption", "")!;
                fields["channel" + suffix] = Int(r["channel"]).ToString();
                fields["bandwidth" + suffix] = Int(r["bandwidth"]).ToString();
                fields["hidden" + suffix] = Int(r["hidden"]).ToString();
                fields["txpwr" + suffix] = r.Get("txpwr", "mid")!;
            }
            string s = band.ToString();
            fields["channel" + s] = channel.ToString();
            fields["bandwidth" + s] = width.ToString();
            if (d["txpwr"] is { } power)
            {
                if (power.ToString() is not ("max" or "mid" or "min"))
                    throw new Exception("发射强度不正确");
                fields["txpwr" + s] = power.ToString();
            }
            if (d["ssid"] is { } ssid && ssid.ToString() != fields["ssid" + s])
            {
                if (Encoding.UTF8.GetByteCount(ssid.ToString()) is < 1 or > 28)
                    throw new Exception("SSID 请使用 1–28 字节");
                fields["ssid" + s] = ssid.ToString();
                if (fields["bsd"] == "1")
                {
                    fields["ssid1"] = ssid.ToString();
                    fields["ssid2"] = ssid.ToString();
                }
            }
            fields["isDFS"] = (fields["on2"] != "0" && ((int.Parse(fields["channel2"]) is >= 52 and <= 64) || fields["bandwidth2"] == "0")) ? "1" : "0";
            endpoint = "xqnetwork/set_all_wifi";
            fingerprint = WifiFingerprint(current);
            summary = new
            {
                band = band == 1 ? "2.4 GHz" : "5 GHz",
                before = new
                {
                    channel = Int(radios[band - 1]?["channel"]),
                    bandwidth = Int(radios[band - 1]?["bandwidth"]),
                    ssid = radios[band - 1]?["ssid"]?.ToString(),
                    txpwr = radios[band - 1]?["txpwr"]?.ToString()
                },
                after = new
                {
                    channel,
                    bandwidth = width,
                    ssid = fields["ssid" + s],
                    txpwr = fields["txpwr" + s]
                },
                notice = "保存后无线网络会短暂重连。两个频段的其他配置与密码保持读取到的值。"
            };
        }
        else if (action == "deviceAccess")
        {
            string mac = Mac(d.Get("mac", "")!);
            bool allow = d.Get("allow", true);
            JsonObject devices = await Api("misystem/devicelist", new()
            {
                ["mlo"] = "1"
            });
            if (!allow && Normalize(mac) == Normalize(devices.Get("mac", "")!))
                throw new Exception("不能在此阻断当前管理设备");
            fields["mac"] = mac;
            fields["wan"] = allow ? "1" : "0";
            endpoint = "xqsystem/set_mac_filter";
            verb = "GET";
            summary = new
            {
                mac,
                allow,
                scope = "访问互联网"
            };
        }
        else if (action == "deviceLimit")
        {
            string mac = Mac(d.Get("mac", "")!);
            int up = d.Get("upload", 0), down = d.Get("download", 0);
            if (up < 0 || down < 0 || up > 10_000_000 || down > 10_000_000)
                throw new Exception("限速数值不正确");
            fields["data"] = JsonSerializer.Serialize(new[] { new { mac, maxup = up.ToString(), maxdown = down.ToString() } });
            endpoint = "misystem/qos_limits";
            summary = new
            {
                mac,
                upload = up,
                download = down,
                unit = "KB/s，0 为不限速"
            };
        }
        else if (action == "filter.add" || action == "filter.remove")
        {
            string mac = Mac(d.Get("mac", "")!);
            JsonObject devices = await Api("misystem/devicelist", new()
            {
                ["mlo"] = "1"
            });
            if (action == "filter.add" && Normalize(mac) == Normalize(devices.Get("mac", "")!))
                throw new Exception("不能将当前管理设备加入黑名单");
            fields = new()
            {
                ["mac"] = mac,
                ["model"] = "0",
                ["option"] = action == "filter.add" ? "0" : "1",
                ["name"] = Text(d.Get("name", ""), 64)
            };
            endpoint = "xqnetwork/edit_device";
            verb = "GET";
            summary = new
            {
                mac,
                operation = action == "filter.add" ? "加入无线黑名单" : "移出无线黑名单",
                notice = "名单是否生效取决于路由器当前过滤模式"
            };
        }
        else if (action == "binding.add")
        {
            string mac = Mac(d.Get("mac", "")!), ip = Ipv4(d.Get("ip", "")!);
            fields["data"] = JsonSerializer.Serialize(new[] { new { ip, mac, name = Text(d.Get("name", ""), 64) } });
            endpoint = "xqnetwork/mac_bind";
            summary = new
            {
                mac,
                ip,
                name = d.Get("name", "")
            };
        }
        else if (action == "binding.remove")
        {
            string mac = Mac(d.Get("mac", "")!);
            fields["mac"] = mac;
            endpoint = "xqnetwork/mac_unbind";
            summary = new
            {
                mac
            };
        }
        else if (action == "dhcp")
        {
            JsonObject config = await Api("xqnetwork/lan_dhcp");
            JsonNode info = config["info"] ?? throw new Exception("未读取到 DHCP 配置");
            bool enabled = d.Get("enabled", true);
            fields["ignore"] = enabled ? "0" : "1";
            if (enabled)
            {
                string start = Ipv4(d.Get("start", "")!), end = Ipv4(d.Get("end", "")!);
                JsonNode? lan = info["lanIp"]?.AsArray().FirstOrDefault();
                string lanIp = Ipv4(lan?["ip"]?.ToString() ?? ""), mask = Ipv4(lan?["mask"]?.ToString() ?? "");
                uint maskValue = NetworkUtilities.ToUInt(IPAddress.Parse(mask)), sv = NetworkUtilities.ToUInt(IPAddress.Parse(start)), ev = NetworkUtilities.ToUInt(IPAddress.Parse(end)), network = NetworkUtilities.ToUInt(IPAddress.Parse(lanIp)) & maskValue;
                if ((sv & maskValue) != network || (ev & maskValue) != network || ev < sv || ev - sv > 4095)
                    throw new Exception("DHCP 地址池必须位于路由器 LAN 网段且起止顺序正确");
                if (mask == "255.255.255.0")
                {
                    fields["start"] = (sv & 255).ToString();
                    fields["end"] = (ev & 255).ToString();
                }
                else
                {
                    fields["startip"] = start;
                    fields["endip"] = end;
                }
                fields["limit"] = (ev - sv + 1).ToString();
                fields["leasetime"] = Math.Clamp(d.Get("leaseMinutes", 720), 2, 43200) + "m";
                fields["dns1"] = OptionalIp(d.Get("dns1", info["dns1"]?.ToString() ?? ""));
                fields["dns2"] = OptionalIp(d.Get("dns2", info["dns2"]?.ToString() ?? ""));
                fields["router"] = OptionalIp(d.Get("router", info["router"]?.ToString() ?? ""));
            }
            endpoint = "xqnetwork/set_lan_dhcp";
            verb = "GET";
            summary = new
            {
                enabled,
                start = d.Get("start", ""),
                end = d.Get("end", ""),
                leaseMinutes = d.Get("leaseMinutes", 720)
            };
        }
        else if (action == "forward.add" || action == "forward.remove")
        {
            string ns = await ForwardNamespace();
            int protocol = d.Get("protocol", 1);
            if (protocol is < 1 or > 3)
                throw new Exception("转发协议不正确");
            fields["proto"] = protocol.ToString();
            int external = Validation.Port(d.Get("externalPort", 0));
            if (action == "forward.add")
            {
                fields["sport"] = external.ToString();
                fields["dport"] = Validation.Port(d.Get("internalPort", 0)).ToString();
                fields["ip"] = Ipv4(d.Get("ip", "")!);
                if (!Validation.Private(IPAddress.Parse(fields["ip"])))
                    throw new Exception("转发目的地址应为局域网 IPv4");
                fields["name"] = Text(d.Get("name", ""), 64);
                endpoint = ns + "/add_redirect";
            }
            else
            {
                fields["port"] = external.ToString();
                endpoint = ns + "/delete_redirect";
            }
            summary = fields;
        }
        else if (action == "reboot")
        {
            endpoint = "xqsystem/reboot";
            verb = "GET";
            summary = new
            {
                operation = "重启路由器",
                notice = "所有连接将暂时中断"
            };
        }
        else
            throw new Exception("此路由器设置不受支持");
        string id = Guid.NewGuid().ToString("N");
        plans[id] = new(action, endpoint, verb, fields, summary, DateTimeOffset.Now, fingerprint);
        return new
        {
            id,
            action,
            summary,
            expiresAt = DateTimeOffset.Now.AddMinutes(5)
        };
    }
    public async Task<object> Apply(JsonObject p)
    {
        await mutation.WaitAsync();
        try
        {
            RequireSupported();
            string id = p.Get("id", "")!;
            if (!plans.Remove(id, out var plan) || DateTimeOffset.Now - plan.Created > TimeSpan.FromMinutes(5))
                throw new Exception("路由器配置预览已过期，请重新预览");
            if (plan.Fingerprint is not null)
            {
                JsonObject current = await Api("xqnetwork/wifi_detail_all");
                if (WifiFingerprint(current) != plan.Fingerprint)
                    throw new Exception("无线配置在预览后已发生变化，请刷新后重新预览");
                WriteSecret(Path.Combine(store.Folder("router-backups"), Guid.NewGuid().ToString("N") + ".bin"), current);
            }
            JsonObject response;
            try
            {
                response = await Api(plan.Endpoint, plan.Fields, plan.Verb);
            }
            catch (TaskCanceledException) { throw new Exception("提交后连接超时，是否生效尚未确认。请恢复连接后回读配置，不要直接重复提交。"); }
            catch (HttpRequestException) { throw new Exception("提交时连接中断，是否生效尚未确认。请重连后回读配置。"); }
            store.Save("router", new
            {
                action = plan.Action,
                summary = plan.Summary,
                businessCode = Int(response["code"])
            }, "修改小米路由器配置");
            return new
            {
                accepted = true,
                requiresReadback = true,
                action = plan.Action,
                summary = plan.Summary,
                cacTime = Int(response["cac_time"]),
                message = "路由器已接受请求。请回读配置或重新扫描，确认实际生效状态。"
            };
        }
        finally { mutation.Release(); }
    }
    async Task<string> ForwardNamespace()
    {
        if (forwardNamespace is not null)
            return forwardNamespace;
        try
        {
            string page = await http.GetStringAsync(origin + "/cgi-bin/luci/;stok=" + token + "/web/setting/nat");
            Match m = Regex.Match(page, @"/api/(xqsystem|xqnetwork)/portforward");
            if (m.Success)
            {
                forwardNamespace = m.Groups[1].Value;
                return forwardNamespace;
            }
        }
        catch (HttpRequestException) { }
        foreach (string ns in new[] { "xqsystem", "xqnetwork" })
        {
            try
            {
                JsonObject result = await Api(ns + "/portforward", new()
                {
                    ["ftype"] = "0"
                });
                if (result["list"] is JsonArray)
                {
                    forwardNamespace = ns;
                    return ns;
                }
            }
            catch (RouterSessionException) { throw; }
            catch (Exception) { }
        }
        throw new Exception("当前固件的端口转发接口未确认，请使用路由器后台");
    }
    async Task<JsonObject> Api(string endpoint, Dictionary<string, string>? fields = null, string verb = "GET", bool auth = true)
    {
        if (origin.Length == 0)
            throw new Exception("请先读取路由器信息");
        if (auth)
            RequireSession();
        string path = auth ? "/cgi-bin/luci/;stok=" + token + "/api/" : "/cgi-bin/luci/api/";
        string url = origin + path + endpoint;
        if (verb == "GET" && fields?.Count > 0)
            url += "?" + string.Join('&', fields.Select(k => Uri.EscapeDataString(k.Key) + "=" + Uri.EscapeDataString(k.Value)));
        using HttpRequestMessage request = new(new HttpMethod(verb), url);
        if (verb == "POST")
            request.Content = new FormUrlEncodedContent(fields ?? new());
        using var response = await http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
            throw new Exception("路由器接口返回 HTTP " + (int)response.StatusCode);
        string text = await response.Content.ReadAsStringAsync();
        if (text.Length > 4_000_000)
            throw new Exception("路由器响应过大");
        JsonObject data;
        try
        {
            data = JsonNode.Parse(text)?.AsObject() ?? throw new JsonException();
        }
        catch (JsonException) { throw new Exception("路由器返回了非预期数据，可能需要重新登录"); }
        int code = Int(data["code"]);
        if (code == 401 || code == 403)
        {
            if (auth)
                token = "";
            throw new RouterSessionException("路由器会话无效，请重新登录");
        }
        if (data["code"] is not null && code != 0)
            throw new Exception("路由器拒绝操作（" + code + "）：" + (data.Get("msg", data.Get("message", "请检查参数或在后台确认当前模式"))));
        return data;
    }
    void RequireSession()
    {
        if (token.Length == 0)
            throw new RouterSessionException("请先连接路由器管理会话");
    }
    void RequireSupported()
    {
        RequireSession();
        if (hardware != "RD03" || firmware != "1.0.84")
            throw new Exception("当前仅验证了 AX3000T / RD03 / 1.0.84 的配置协议。此型号或固件可查看信息，修改请使用原厂后台。");
    }
    static async Task<string> ValidateOrigin(string input)
    {
        if (!input.Contains("://"))
            input = "http://" + input;
        if (!Uri.TryCreate(input, UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https") || u.UserInfo.Length > 0 || u.Query.Length > 0 || u.Fragment.Length > 0 || u.AbsolutePath != "/")
            throw new Exception("请输入路由器地址，例如 http://192.168.31.1");
        var addresses = await Dns.GetHostAddressesAsync(u.DnsSafeHost);
        if (addresses.Length == 0 || addresses.Any(a => !Validation.Private(a)))
            throw new Exception("管理地址必须是私有 IPv4 局域网地址");
        return u.GetLeftPart(UriPartial.Authority);
    }
    static bool PasswordKnown(JsonObject? r)
    {
        string? s = r?["password"]?.ToString();
        return r?.Get("encryption","")=="none" || !string.IsNullOrEmpty(s) && s.Length>=8 && !s.All(c => c == '*' || c == '•');
    }
    static string Hash(string text, bool sha256) => Convert.ToHexString(sha256 ? SHA256.HashData(Encoding.UTF8.GetBytes(text)) : SHA1.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
    static string WifiFingerprint(JsonObject x)
    {
        string raw = (x["bsd"]?.ToString() ?? "") + string.Join('|', x["info"]!.AsArray().SelectMany(r => new[] { "status", "enabled", "ssid", "password", "encryption", "channel", "bandwidth", "hidden", "txpwr" }.Select(k => r?[k]?.ToString() ?? "")));
        return Hash(raw, true);
    }
    static int Int(JsonNode? n) => n is JsonValue v&&v.TryGetValue<bool>(out bool b)?(b?1:0):int.TryParse(n?.ToString(), out int i) ? i : 0;
    static string Normalize(string mac) => mac.Replace(":", "").Replace("-", "").ToUpperInvariant();
    static string Mac(string value)
    {
        string n = Normalize(value);
        if (n.Length != 12 || !n.All(Uri.IsHexDigit))
            throw new Exception("设备 MAC 地址不正确");
        return string.Join(':', Enumerable.Range(0, 6).Select(i => n.Substring(i * 2, 2)));
    }
    static string Ipv4(string value)
    {
        if (!IPAddress.TryParse(value, out var ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
            throw new Exception("请输入有效的 IPv4 地址");
        return ip.ToString();
    }
    static string OptionalIp(string? value) => string.IsNullOrWhiteSpace(value) ? "" : Ipv4(value);
    static string Text(string? value, int max)
    {
        value ??= "";
        if (value.Length > max || value.Any(char.IsControl))
            throw new Exception("名称过长或包含控制字符");
        return value;
    }
    void WriteSecret(string file, JsonNode value)
    {
        byte[] data = Encoding.UTF8.GetBytes(value.ToJsonString());
        byte[] encrypted = ProtectedData.Protect(data, Encoding.UTF8.GetBytes("NetworkToolbox/router/v1"), DataProtectionScope.CurrentUser);
        File.WriteAllBytes(file, encrypted);
        CryptographicOperations.ZeroMemory(data);
    }
    JsonObject ReadSecret(string file)
    {
        byte[] data = ProtectedData.Unprotect(File.ReadAllBytes(file), Encoding.UTF8.GetBytes("NetworkToolbox/router/v1"), DataProtectionScope.CurrentUser);
        try
        {
            return JsonNode.Parse(data)!.AsObject();
        }
        finally { CryptographicOperations.ZeroMemory(data); }
    }
    public void Dispose()
    {
        token = "";
        plans.Clear();
        http.Dispose();
        mutation.Dispose();
    }
}
sealed class RouterSessionException(string message) : Exception(message);
