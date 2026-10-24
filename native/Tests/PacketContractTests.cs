using System.Text.Json;
using System.Text.Json.Nodes;
namespace NetworkToolbox;
static class PacketContractTests
{
    public static void Run()
    {
        string folder=Path.Combine(Environment.CurrentDirectory,".runtime");Directory.CreateDirectory(folder);string file=Path.Combine(folder,"synthetic-packet-test.pcapng");
        using(MemoryStream bytes=new()){
            using(BinaryWriter writer=new(bytes,System.Text.Encoding.UTF8,true)){
                void Block(uint type,byte[] data){writer.Write(type);writer.Write((uint)(data.Length+12));writer.Write(data);writer.Write((uint)(data.Length+12));}
                byte[] section=new byte[16];BitConverter.GetBytes(0x1A2B3C4Du).CopyTo(section,0);section[4]=1;Array.Fill(section,(byte)255,8,8);Block(0x0A0D0D0A,section);
                byte[] iface=new byte[8];iface[0]=1;BitConverter.GetBytes(65535u).CopyTo(iface,4);Block(1,iface);
                byte[] packet=new byte[42];packet[12]=8;packet[14]=0x45;packet[17]=28;packet[22]=64;packet[23]=17;new byte[]{192,0,2,1,192,0,2,2}.CopyTo(packet,26);packet[34]=0x30;packet[35]=0x39;packet[37]=53;packet[39]=8;
                byte[] block=new byte[64];BitConverter.GetBytes(42u).CopyTo(block,12);BitConverter.GetBytes(42u).CopyTo(block,16);packet.CopyTo(block,20);Block(6,block);
            }
            File.WriteAllBytes(file,bytes.ToArray());
        }
        JsonNode result=JsonSerializer.SerializeToNode(PacketReader.Read(file),JsonDefaults.Options)!;
        if(result["packetCount"]!.GetValue<int>()!=1||result["packets"]?[0]?["source"]?.ToString()!="192.0.2.1"||result["packets"]?[0]?["destinationPort"]?.GetValue<int>()!=53)throw new Exception("PCAPNG decoding failed");
        byte[] corrupt=File.ReadAllBytes(file);corrupt[^1]=255;File.WriteAllBytes(file,corrupt);bool rejected=false;try{PacketReader.Read(file);}catch{rejected=true;}File.Delete(file);if(!rejected)throw new Exception("PCAPNG damaged block was accepted");
        Console.WriteLine("PASS PCAPNG: Ethernet IPv4 UDP decode and corrupt-length rejection");
    }
}
