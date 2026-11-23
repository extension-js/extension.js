// The browser stand-in the specs run on Windows, where a shell script cannot
// be spawned. browser-stand-in.ts compiles it and writes the .conf beside it.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;

// Not a number, so a reader of the file's version metadata finds no version.
[assembly: AssemblyInformationalVersion("stand-in")]

static class BrowserStandIn
{
    const string ChildFlag = "--stand-in-child";

    static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == ChildFlag)
        {
            Thread.Sleep(Timeout.Infinite);

            return 0;
        }

        string self = Assembly.GetExecutingAssembly().Location;
        Dictionary<string, string> conf = ReadConf(self + ".conf");
        int pid = Process.GetCurrentProcess().Id;

        if (conf.ContainsKey("version") && AskedForVersion(args))
        {
            Console.Out.WriteLine(conf["version"]);
            Console.Out.Flush();

            return Number(conf, "versionExitCode");
        }

        if (conf.ContainsKey("pidFile"))
        {
            File.WriteAllText(conf["pidFile"], pid + "\n");
        }

        if (conf.ContainsKey("argvFile"))
        {
            string line = pid + " " + String.Join(" ", args) + "\n";
            File.AppendAllText(conf["argvFile"], line);
        }

        if (conf.ContainsKey("childPidFile"))
        {
            ProcessStartInfo info = new ProcessStartInfo(self, ChildFlag);
            info.UseShellExecute = false;
            Process child = Process.Start(info);
            File.WriteAllText(conf["childPidFile"], child.Id + "\n");
            child.WaitForExit();

            return 0;
        }

        if (conf.ContainsKey("debuggerServer"))
        {
            Serve(args, conf["debuggerServer"]);
        }

        if (conf.ContainsKey("stay"))
        {
            Thread.Sleep(Timeout.Infinite);
        }

        return Number(conf, "exitCode");
    }

    static Dictionary<string, string> ReadConf(string file)
    {
        Dictionary<string, string> conf = new Dictionary<string, string>();

        foreach (string line in File.ReadAllLines(file, Encoding.UTF8))
        {
            int at = line.IndexOf('=');

            if (at > 0) conf[line.Substring(0, at)] = line.Substring(at + 1);
        }

        return conf;
    }

    static int Number(Dictionary<string, string> conf, string key)
    {
        return conf.ContainsKey(key) ? Int32.Parse(conf[key]) : 0;
    }

    static bool AskedForVersion(string[] args)
    {
        foreach (string arg in args)
        {
            if (arg == "--version" || arg == "--product-version") return true;
        }

        return false;
    }

    // A debugger port that accepts and then closes, sends a bad frame, or
    // says nothing, on the port Firefox is told to open. It never returns.
    static void Serve(string[] args, string mode)
    {
        int at = Array.IndexOf(args, "-start-debugger-server");
        int port = at >= 0 && at + 1 < args.Length ? Int32.Parse(args[at + 1]) : 0;
        TcpListener listener = new TcpListener(IPAddress.Loopback, port);
        List<TcpClient> held = new List<TcpClient>();
        listener.Start();

        while (true)
        {
            TcpClient client = listener.AcceptTcpClient();

            try
            {
                if (mode == "close")
                {
                    client.Close();

                    continue;
                }

                if (mode == "garbage")
                {
                    byte[] frame = Encoding.ASCII.GetBytes("xx:{}");
                    client.GetStream().Write(frame, 0, frame.Length);
                }

                held.Add(client);
            }
            catch (Exception)
            {
                // The other end left first, which no mode has to answer.
            }
        }
    }
}
