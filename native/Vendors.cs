using System.Text.Json;
namespace NetworkToolbox;
public static class Vendors
{
    public const string DataDate="2026-10-24";
    static readonly Lazy<Dictionary<string,string>> Database=new(()=>{
        var assembly=typeof(Vendors).Assembly;
        string resource=assembly.GetManifestResourceNames().Single(n=>n.EndsWith("data.vendors.json",StringComparison.Ordinal));
        using Stream stream=assembly.GetManifestResourceStream(resource)!;
        return JsonSerializer.Deserialize<Dictionary<string,string>>(stream)??new();
    });
    public static string Lookup(string mac){
        string value=mac.Replace(":","").Replace("-","").ToUpperInvariant();
        if(value.Length!=12||!value.All(Uri.IsHexDigit))throw new Exception("MAC 地址格式不正确");
        byte first=Convert.ToByte(value[..2],16);
        if((first&1)!=0)return "组播 / 广播地址";
        if((first&2)!=0)return "本地管理 / 随机地址";
        foreach(int length in new[]{9,7,6})if(Database.Value.TryGetValue(value[..length],out string? vendor))return vendor;
        return "未匹配到厂商";
    }
}
