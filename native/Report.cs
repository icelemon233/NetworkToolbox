using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NetworkToolbox;

public static class Report
{
    public static string Render(JsonNode record)
    {
        string title = WebUtility.HtmlEncode(record["title"]?.ToString() ?? "网络检测报告");
        string rawDate=record["createdAt"]?.ToString()??"";
        string date=WebUtility.HtmlEncode(DateTimeOffset.TryParse(rawDate,out var parsed)?parsed.ToOffset(TimeSpan.FromHours(8)).ToString("yyyy-MM-dd HH:mm:ss 'UTC+08:00'"):rawDate);
        JsonNode clean = Redact(record);
        string json = WebUtility.HtmlEncode(clean.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        return "<!doctype html><html lang=zh-CN><meta charset=utf-8><meta name=viewport content='width=device-width'><title>" + title + "</title><style>body{font:15px/1.7 'Segoe UI','Microsoft YaHei',sans-serif;color:#46332a;max-width:960px;margin:48px auto;padding:0 24px}h1{font-size:28px}small{color:#686967}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef5f7;padding:24px;border-radius:12px;font-size:13px}footer{border-top:1px solid #dfe7e8;margin-top:32px;padding-top:16px;color:#686967}</style><h1>" + title + "</h1><small>" + date + " · NetworkToolbox</small><pre>" + json + "</pre><footer>结果对应记录中的目标、位置和检测时段。无线重叠评分是推断，AP 占用是接入点报告值；缺失值不视为零。凭据字段已移除。报告仍可能包含本机地址与网络名称，请按需分享。</footer></html>";
    }
    public static JsonNode Redact(JsonNode node)
    {
        if (node is JsonObject obj)
        {
            JsonObject clean = new();
            foreach (var kv in obj)
            {
                if (kv.Value is null)
                {
                    clean[kv.Key] = null;
                    continue;
                }
                string key = kv.Key.ToLowerInvariant();
                if (key.Contains("password") || key.Contains("token") || key.StartsWith("pwd") || key == "key" || key == "nonce" || key.Contains("authorization") || key.Contains("api-key") || key.Contains("apikey") || key.Contains("credential") || key.Contains("secret") || key is "cookie" or "set-cookie")
                    continue;
                if(key=="server"&&kv.Value is JsonValue server&&server.TryGetValue<string>(out var address)&&address.Contains('@')){clean[kv.Key]="[已省略代理认证地址]";continue;}
                clean[kv.Key] = Redact(kv.Value);
            }
            return clean;
        }
        if (node is JsonArray array)
            return new JsonArray(array.Select(n => n is null ? null : Redact(n)).ToArray());
        if(node is JsonValue scalar&&scalar.TryGetValue<string>(out var value)&&Uri.TryCreate(value,UriKind.Absolute,out var uri)&&uri.Scheme is "http" or "https" or "socks5"){
            UriBuilder sanitized=new(uri){UserName="",Password="",Query="",Fragment=""};
            return JsonValue.Create(sanitized.Uri.GetLeftPart(UriPartial.Path)+(uri.Query.Length>0?"?[已省略查询参数]":""))!;
        }
        return node.DeepClone();
    }
}
