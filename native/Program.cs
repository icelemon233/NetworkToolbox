using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using NetworkToolbox;

Console.InputEncoding = Encoding.UTF8;
Console.OutputEncoding = new UTF8Encoding(false);
if (args.Contains("--ensure-exit")) { Environment.ExitCode = await InstallLifecycle.EnsureExit(Argument("--install-dir") ?? ""); return; }
if (args.Contains("--self-test")) { try{SelfTests.Run();}catch(Exception ex){Console.Error.WriteLine(ex);Environment.ExitCode=1;} return; }
string dataDirectory = Argument("--data-dir") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NetworkToolbox");
LocalStore store = new(dataDirectory);
if (Argument("--elevated") is { } pipeName) { await AdminBroker.RunWorker(pipeName, store); return; }
object outputLock = new();
void Send(object message) { lock (outputLock) Console.WriteLine(JsonSerializer.Serialize(message, JsonDefaults.Options)); }
using Toolbox toolbox = new(store, (name, data) => Send(new { @event = name, data }));
string? input;
while ((input = await Console.In.ReadLineAsync()) is not null)
{
    if (input.Length > 2_000_000)
        continue;
    try
    {
        JsonObject request = JsonNode.Parse(input)?.AsObject() ?? throw new Exception("无效请求");
        string id = request["id"]?.GetValue<string>() ?? "";
        string method = request["method"]?.GetValue<string>() ?? "";
        JsonObject parameters = request["params"]?.AsObject() ?? new();
        _ = Task.Run(async () =>
        {
            try
            {
                Send(new
                {
                    id,
                    result = await toolbox.Call(method, parameters)
                });
            }
            catch (OperationCanceledException) { Send(new { id, error = "操作已取消" }); }
            catch (Exception ex) { Send(new { id, error = ex.Message }); }
        });
    }
    catch (Exception) { Send(new { error = "请求格式不正确" }); }
}
string? Argument(string key) { int i = Array.IndexOf(args, key); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
