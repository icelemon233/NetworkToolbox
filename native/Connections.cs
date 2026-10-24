using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;

namespace NetworkToolbox;

public static class Connections
{
    [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int family, int tableClass, uint reserved);
    [DllImport("iphlpapi.dll")] static extern uint GetExtendedUdpTable(IntPtr table, ref int size, bool sort, int family, int tableClass, uint reserved);
    public static object Read()
    {
        List<object> rows = [];
        Dictionary<int, string> names = [];
        foreach (bool tcp in new[] { true, false })
        foreach (int af in new[] { 2, 23 })
        {
            int size = 0;
            uint result = tcp ? GetExtendedTcpTable(IntPtr.Zero, ref size, true, af, 5, 0) : GetExtendedUdpTable(IntPtr.Zero, ref size, true, af, 1, 0);
            if (result != 122 && result != 0)
                continue;
            IntPtr ptr = Marshal.AllocHGlobal(size);
            try
            {
                result = tcp ? GetExtendedTcpTable(ptr, ref size, true, af, 5, 0) : GetExtendedUdpTable(ptr, ref size, true, af, 1, 0);
                if (result != 0)
                    continue;
                int count = Marshal.ReadInt32(ptr), rowSize = tcp ? (af == 2 ? 24 : 56) : (af == 2 ? 12 : 28);
                if (count < 0 || 4L + rowSize * (long)count > size)
                    continue;
                for (int i = 0; i < count; i++)
                {
                    IntPtr e = IntPtr.Add(ptr, 4 + i * rowSize);
                    int pid = Marshal.ReadInt32(e, rowSize - 4);
                    if (!names.TryGetValue(pid, out string? name))
                    {
                        try
                        {
                            using Process process = Process.GetProcessById(pid);
                            name = process.ProcessName;
                        }
                        catch { name = pid == 0 ? "System Idle" : "PID " + pid; }
                        names[pid] = name;
                    }
                    string local, remote = "";
                    int localPort, remotePort = 0, state = 0;
                    if (af == 2)
                    {
                        int l = tcp ? 4 : 0;
                        local = new IPAddress(BitConverter.GetBytes(Marshal.ReadInt32(e, l))).ToString();
                        localPort = Port(Marshal.ReadInt32(e, l + 4));
                        if (tcp)
                        {
                            state = Marshal.ReadInt32(e);
                            remote = new IPAddress(BitConverter.GetBytes(Marshal.ReadInt32(e, 12))).ToString();
                            remotePort = Port(Marshal.ReadInt32(e, 16));
                        }
                    }
                    else
                    {
                        byte[] a = new byte[16];
                        Marshal.Copy(e, a, 0, 16);
                        local = new IPAddress(a, (uint)Marshal.ReadInt32(e, 16)).ToString();
                        localPort = Port(Marshal.ReadInt32(e, 20));
                        if (tcp)
                        {
                            Marshal.Copy(IntPtr.Add(e, 24), a, 0, 16);
                            remote = new IPAddress(a, (uint)Marshal.ReadInt32(e, 40)).ToString();
                            remotePort = Port(Marshal.ReadInt32(e, 44));
                            state = Marshal.ReadInt32(e, 48);
                        }
                    }
                    rows.Add(new
                    {
                        pid,
                        process = name,
                        protocol = tcp ? "TCP" : "UDP",
                        family = af == 2 ? "IPv4" : "IPv6",
                        localAddress = local,
                        localPort,
                        remoteAddress = tcp ? remote : null,
                        remotePort = tcp ? (int?)remotePort : null,
                        state = tcp ? ((System.Net.NetworkInformation.TcpState)state).ToString() : "本地端点"
                    });
                }
            }
            finally { Marshal.FreeHGlobal(ptr); }
        }
        return new
        {
            timestamp = DateTimeOffset.Now,
            rows,
            note = "UDP 表只提供本地端点；实时进程流量需单独启动采集。"
        };
    }
    static int Port(int value) => (ushort)IPAddress.NetworkToHostOrder((short)(value & 0xffff));
}
