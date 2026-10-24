using System.Text.Json;
using System.Text.Json.Nodes;
namespace NetworkToolbox;
static class LanContractTests
{
    public static async Task Run()
    {
        using LanSpeedService service=new();
        JsonNode server=JsonSerializer.SerializeToNode(await service.StartServer(new(){["port"]=0,["bind"]="127.0.0.1"}),JsonDefaults.Options)!;
        using LanSpeedService conflicting=new();bool refused=false;
        try{await conflicting.StartServer(new(){["port"]=server["port"]!.GetValue<int>(),["bind"]="127.0.0.1"});}catch(System.Net.Sockets.SocketException){refused=true;}
        if(!refused)throw new Exception("Occupied Windows listener was reused");
        await conflicting.StartServer(new(){["port"]=0,["bind"]="127.0.0.1"});conflicting.Stop();
        var store=new LocalStore(Path.Combine(Environment.CurrentDirectory,".runtime","lan-tests"));
        using JobRunner jobs=new(store,(_,_)=>{});
        foreach(string direction in new[]{"upload","download"}){
            Job job=new(){Kind="test",Title="loopback"};job.Cancellation.CancelAfter(TimeSpan.FromSeconds(8));
            JsonNode result=JsonSerializer.SerializeToNode(await service.Client(new(){["target"]="127.0.0.1",["port"]=server["port"]!.GetValue<int>(),["key"]=server["key"]!.ToString(),["direction"]=direction,["mb"]=1},job,jobs),JsonDefaults.Options)!;
            if(result["bytes"]!.GetValue<long>()!=1024*1024||result["mbps"]!.GetValue<double>()<=0)throw new Exception("LAN throughput protocol failed");
            job.Cancellation.Dispose();
        }
        Console.WriteLine("PASS LAN transport: authenticated loopback upload and download, exact byte counts");
    }
}
