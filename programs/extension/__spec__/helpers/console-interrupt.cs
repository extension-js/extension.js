// Sends Ctrl+C to the console of one process, the way a terminal does. Node
// cannot: its kill ends a Windows process before any handler runs.
using System;
using System.Runtime.InteropServices;
using System.Threading;

static class ConsoleInterrupt
{
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AttachConsole(uint pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GenerateConsoleCtrlEvent(uint kind, uint group);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint GetConsoleProcessList(uint[] list, uint count);

    // Arguments: the pid whose console gets the event, then pids that must
    // not be on that console. Exit 0 once sent, and nothing is sent otherwise.
    static int Main(string[] args)
    {
        uint target = UInt32.Parse(args[0]);

        FreeConsole();

        if (!AttachConsole(target))
        {
            Console.Out.WriteLine("attach failed " + Marshal.GetLastWin32Error());

            return 2;
        }

        uint[] list = new uint[1024];
        uint count = GetConsoleProcessList(list, (uint) list.Length);
        string seen = "";

        for (uint at = 0; at < count && at < list.Length; at++)
        {
            seen += " " + list[at];

            for (int spared = 1; spared < args.Length; spared++)
            {
                if (list[at] == UInt32.Parse(args[spared]))
                {
                    Console.Out.WriteLine("shared console with " + list[at]);

                    return 3;
                }
            }
        }

        SetConsoleCtrlHandler(IntPtr.Zero, true);

        if (!GenerateConsoleCtrlEvent(0, 0))
        {
            Console.Out.WriteLine("send failed " + Marshal.GetLastWin32Error());

            return 4;
        }

        Console.Out.WriteLine("sent to" + seen);
        Thread.Sleep(250);

        return 0;
    }
}
