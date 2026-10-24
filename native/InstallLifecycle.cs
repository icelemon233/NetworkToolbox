using System.Diagnostics;

namespace NetworkToolbox;

public static class InstallLifecycle
{
    public static async Task<int> EnsureExit(string directory)
    {
        try
        {
            if (!Path.IsPathFullyQualified(directory)) throw new Exception("安装目录必须是绝对路径。");
            string root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(directory));
            if (!Directory.Exists(root)) return 0;
            using Process self = Process.GetCurrentProcess();
            List<(int Id, string File)> Owned()
            {
                List<(int, string)> found = [];
                foreach (Process process in Process.GetProcesses())
                {
                    using (process)
                    {
                        if (process.Id == self.Id) continue;
                        try
                        {
                            if (process.SessionId != self.SessionId) continue;
                            string? file = process.MainModule?.FileName;
                            if (file is not null && file.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) found.Add((process.Id, file));
                        }
                        catch (System.ComponentModel.Win32Exception) { }
                        catch (InvalidOperationException) { }
                    }
                }
                return found;
            }
            var processes = Owned();
            if (processes.Count == 0) return 0;
            string executable = Path.Combine(root, "NetworkToolbox.exe");
            if (processes.Any(p => p.File.Equals(executable, StringComparison.OrdinalIgnoreCase)))
            {
                using Process? request = Process.Start(new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, Arguments = "--request-exit" });
            }
            DateTime end = DateTime.UtcNow.AddSeconds(18);
            while (DateTime.UtcNow < end)
            {
                if (Owned().Count == 0) return 0;
                await Task.Delay(250);
            }
            Console.WriteLine("NetworkToolbox 尚未退出，安装文件未替换。请在应用设置或托盘菜单中退出；若正在抓包，请先停止并保存，再重新运行安装程序。");
            return 20;
        }
        catch (Exception ex) { Console.WriteLine("无法确认应用已退出，安装文件未替换：" + ex.Message); return 21; }
    }
}
