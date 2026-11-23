// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export const WINDOWS_PROCESS_TABLE_SOURCE_VARIABLE =
  'EXTENSION_PROCESS_TABLE_SOURCE'

// The whole process table of Windows as "pid parent-pid command line" rows,
// read from the kernel. A WMI query for the same rows took 23 seconds.
export const WINDOWS_PROCESS_TABLE_TIMEOUT_MS = 5000

// A snapshot names every pid and its parent with no handle opened. The
// command line is then asked of each process, and one that refuses has none.
export const WINDOWS_PROCESS_TABLE_SOURCE = [
  'using System;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  'public static class ExtensionProcessTable {',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
  '  struct Entry {',
  '    public uint dwSize;',
  '    public uint cntUsage;',
  '    public uint th32ProcessID;',
  '    public IntPtr th32DefaultHeapID;',
  '    public uint th32ModuleID;',
  '    public uint cntThreads;',
  '    public uint th32ParentProcessID;',
  '    public int pcPriClassBase;',
  '    public uint dwFlags;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]',
  '    public string szExeFile;',
  '  }',
  '  [DllImport("kernel32.dll", SetLastError = true)]',
  '  static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);',
  '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "Process32FirstW")]',
  '  static extern bool Process32First(IntPtr snapshot, ref Entry entry);',
  '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "Process32NextW")]',
  '  static extern bool Process32Next(IntPtr snapshot, ref Entry entry);',
  '  [DllImport("kernel32.dll")]',
  '  static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);',
  '  [DllImport("kernel32.dll")]',
  '  static extern bool CloseHandle(IntPtr handle);',
  '  [DllImport("ntdll.dll")]',
  '  static extern int NtQueryInformationProcess(IntPtr process, int kind, IntPtr buffer, int size, out int needed);',
  '  static string CommandLine(uint pid) {',
  '    IntPtr process = OpenProcess(0x1000, false, pid);',
  '    if (process == IntPtr.Zero) return "";',
  '    try {',
  '      int needed = 0;',
  '      NtQueryInformationProcess(process, 60, IntPtr.Zero, 0, out needed);',
  '      if (needed <= 0) return "";',
  '      IntPtr buffer = Marshal.AllocHGlobal(needed);',
  '      try {',
  '        if (NtQueryInformationProcess(process, 60, buffer, needed, out needed) != 0) return "";',
  '        int length = ((int) Marshal.ReadInt16(buffer)) & 0xFFFF;',
  '        IntPtr text = Marshal.ReadIntPtr(buffer, IntPtr.Size);',
  '        if (text == IntPtr.Zero || length == 0) return "";',
  '        return Marshal.PtrToStringUni(text, length / 2);',
  '      } finally {',
  '        Marshal.FreeHGlobal(buffer);',
  '      }',
  '    } finally {',
  '      CloseHandle(process);',
  '    }',
  '  }',
  '  public static string List() {',
  '    StringBuilder rows = new StringBuilder();',
  '    IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);',
  '    if (snapshot == new IntPtr(-1)) throw new InvalidOperationException("no process snapshot");',
  '    try {',
  '      Entry entry = new Entry();',
  '      entry.dwSize = (uint) Marshal.SizeOf(typeof(Entry));',
  '      if (!Process32First(snapshot, ref entry)) return "";',
  '      do {',
  '        string command = CommandLine(entry.th32ProcessID).Replace((char) 13, (char) 32).Replace((char) 10, (char) 32);',
  '        rows.Append(entry.th32ProcessID).Append((char) 32).Append(entry.th32ParentProcessID).Append((char) 32).Append(command).Append((char) 10);',
  '      } while (Process32Next(snapshot, ref entry));',
  '    } finally {',
  '      CloseHandle(snapshot);',
  '    }',
  '    return rows.ToString();',
  '  }',
  '}'
].join('\n')

// No cmdlet and no WMI: the compiler is called as a .NET type, and the
// source travels in a variable, so no text from it is ever read as script.
export const WINDOWS_PROCESS_TABLE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$options = [System.CodeDom.Compiler.CompilerParameters]::new()',
  '$options.GenerateInMemory = $true',
  `$built = [Microsoft.CSharp.CSharpCodeProvider]::new().CompileAssemblyFromSource($options, $env:${WINDOWS_PROCESS_TABLE_SOURCE_VARIABLE})`,
  "$list = $built.CompiledAssembly.GetType('ExtensionProcessTable').GetMethod('List')",
  '[Console]::Out.Write($list.Invoke($null, $null))'
].join('; ')
