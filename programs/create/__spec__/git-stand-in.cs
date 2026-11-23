// The git stand-in the clone spec runs on Windows, where git is started with
// no shell. git-stand-in.ts compiles it and writes the .conf beside it.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;

static class GitStandIn
{
    static int Main(string[] args)
    {
        string step = args.Length > 0 ? args[0] : "";

        if (step == "--version")
        {
            Console.Out.Write("git version 2.99.0\n");
            Console.Out.Flush();

            return 0;
        }

        if (step != "pull") return 0;

        string self = Assembly.GetExecutingAssembly().Location;
        Dictionary<string, string> conf = ReadConf(self + ".conf");
        string pull = Environment.GetEnvironmentVariable("EXTJS_STAND_IN_PULL");

        if (pull == "hang")
        {
            int pid = Process.GetCurrentProcess().Id;
            File.WriteAllText(conf["pidFile"], pid + "\n");
            Thread.Sleep(30000);

            return 0;
        }

        if (pull == "fill")
        {
            string folder = Directory.GetCurrentDirectory();

            // The clone lands in the temp folder of the run and nowhere else.
            if (!IsInside(folder, conf["fillInside"]))
            {
                Console.Error.Write("stand-in: not filling " + folder + "\n");

                return 3;
            }

            string manifest = Path.Combine(folder, "manifest.json");
            File.WriteAllText(manifest, "{\"name\":\"cloned\"}\n");

            return 0;
        }

        Console.Error.Write("fatal: couldn't find remote ref\n");

        return 1;
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

    // By folder name: Windows spells one temp path in a short and a long form.
    static bool IsInside(string folder, string name)
    {
        foreach (string part in folder.Split('\\', '/'))
        {
            if (String.Equals(part, name, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
