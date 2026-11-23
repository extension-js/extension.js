import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  findLiveBrowserPid,
  listProcesses,
  parseProcessRows
} from '../../browsers-lib/resolve-live-pid'
import {
  WINDOWS_PROCESS_TABLE_SCRIPT,
  WINDOWS_PROCESS_TABLE_SOURCE
} from '../../browsers-lib/windows-process-table'

// TEMPORARY: measures each way to read the Windows process table on the
// hosted runner. Removed before this branch is handed back.
const SHELL = ['-NoProfile', '-NonInteractive', '-Command']
const SRC = {EXTENSION_PROCESS_TABLE_SOURCE: WINDOWS_PROCESS_TABLE_SOURCE}
const WATCH = '$w = [System.Diagnostics.Stopwatch]::StartNew()'
const say = (text: string) => `[Console]::Out.WriteLine(${text})`
const WQL = 'SELECT ProcessId, ParentProcessId, CommandLine FROM Win32_Process'
const ROW =
  "[string]$p['ProcessId'] + ' ' + [string]$p['ParentProcessId'] + ' ' + [string]$p['CommandLine']"

describe.skipIf(process.platform !== 'win32')('TIMING process table', () => {
  const profile = mkdtempSync(join(tmpdir(), 'extjs-table-timing-'))
  let child: ChildProcess | undefined

  afterAll(() => {
    child?.kill('SIGKILL')
    rmSync(profile, {recursive: true, force: true})
  })

  function measure(
    label: string,
    bin: string,
    args: string[],
    env: Record<string, string> = {},
    show = false
  ) {
    const started = Date.now()
    const result = spawnSync(bin, args, {
      encoding: 'utf8',
      env: {...process.env, ...env},
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 45_000,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    })
    const ms = Date.now() - started
    const stdout = String(result.stdout || '')
    const rows = parseProcessRows(stdout)
    const mine = rows.find((row) => row.pid === child?.pid)
    const found = findLiveBrowserPid({
      profilePath: profile,
      binary: process.execPath,
      launcherPid: child?.pid,
      rows
    })

    console.log(
      `TIMING ${label} ms=${ms} status=${result.status} error=${result.error?.message ?? ''} ` +
        `bytes=${stdout.length} rows=${rows.length} ppidOk=${mine?.ppid === process.pid} ` +
        `found=${found === child?.pid} mine=${JSON.stringify(mine ?? null)}`
    )

    if (show || result.status !== 0) {
      console.log(
        `TIMING ${label} STDOUT ${stdout.slice(0, 1500)}\nTIMING ${label} STDERR ${String(result.stderr || '').slice(0, 3000)}`
      )
    }
  }

  const ps = (label: string, script: string, env = {}, show = false) =>
    measure(label, 'powershell.exe', [...SHELL, script], env, show)

  it('prints what each candidate costs', () => {
    child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)', '--', '-profile', profile],
      {stdio: 'ignore', windowsHide: true}
    )

    console.log(
      `TIMING env pid=${process.pid} child=${child.pid} node=${process.execPath} profile=${profile} ` +
        `LOCALAPPDATA=${process.env.LOCALAPPDATA} PSModulePath=${process.env.PSModulePath} TEMP=${process.env.TEMP}`
    )

    ps('baseline-1', '1')
    ps('baseline-2', '1')

    for (const turn of [1, 2, 3]) {
      ps(`codedom-${turn}`, WINDOWS_PROCESS_TABLE_SCRIPT, SRC)
    }

    ps(
      'codedom-split',
      [
        WATCH,
        '$o = [System.CodeDom.Compiler.CompilerParameters]::new()',
        '$o.GenerateInMemory = $true',
        '$b = [Microsoft.CSharp.CSharpCodeProvider]::new().CompileAssemblyFromSource($o, $env:EXTENSION_PROCESS_TABLE_SOURCE)',
        say(
          "'compiled ' + $w.ElapsedMilliseconds + ' errors ' + $b.Errors.Count"
        ),
        `foreach ($e in $b.Errors) { ${say('$e.ToString()')} }`,
        "$t = $b.CompiledAssembly.GetType('ExtensionProcessTable').GetMethod('List').Invoke($null, $null)",
        say("'listed ' + $w.ElapsedMilliseconds + ' chars ' + $t.Length")
      ].join('; '),
      SRC,
      true
    )

    for (const turn of [1, 2]) {
      ps(
        `add-type-${turn}`,
        'Add-Type -TypeDefinition $env:EXTENSION_PROCESS_TABLE_SOURCE; [Console]::Out.Write([ExtensionProcessTable]::List())',
        SRC
      )
    }

    ps(
      'add-type-split',
      [
        WATCH,
        'Add-Type -TypeDefinition $env:EXTENSION_PROCESS_TABLE_SOURCE',
        say("'compiled ' + $w.ElapsedMilliseconds"),
        '$t = [ExtensionProcessTable]::List()',
        say("'listed ' + $w.ElapsedMilliseconds + ' chars ' + $t.Length")
      ].join('; '),
      SRC,
      true
    )

    for (const turn of [1, 2]) {
      ps(
        `dotnet-getprocesses-${turn}`,
        `foreach ($p in [System.Diagnostics.Process]::GetProcesses()) { ${say("[string]$p.Id + ' 0 ' + $p.ProcessName")} }`
      )
    }

    ps(
      'dotnet-getprocesses-path-start',
      [
        WATCH,
        '$n = 0',
        "foreach ($p in [System.Diagnostics.Process]::GetProcesses()) { try { $f = $p.MainModule.FileName + ' ' + $p.StartTime.ToUniversalTime().ToString('o'); $n++ } catch { $f = '' } }",
        say("'read ' + $n + ' paths in ' + $w.ElapsedMilliseconds")
      ].join('; '),
      {},
      true
    )

    for (const turn of [1, 2]) {
      measure(`tasklist-${turn}`, 'tasklist.exe', ['/fo', 'csv', '/nh'])
    }

    measure(
      'wmic',
      'wmic.exe',
      [
        'process',
        'get',
        'ProcessId,ParentProcessId,CommandLine',
        '/format:csv'
      ],
      {},
      true
    )

    ps(
      'wmi-split',
      [
        WATCH,
        `$s = [wmisearcher]'${WQL}'`,
        say("'searcher ' + $w.ElapsedMilliseconds"),
        '$r = $s.Get()',
        say("'get ' + $w.ElapsedMilliseconds"),
        '$n = 0',
        'foreach ($p in $r) { $n++ }',
        say("'walked ' + $n + ' in ' + $w.ElapsedMilliseconds"),
        '$r | ForEach-Object { $n++ }',
        say("'cmdlet ' + $w.ElapsedMilliseconds")
      ].join('; '),
      {},
      true
    )

    ps(
      'wmi-no-command-line',
      `foreach ($p in ([wmisearcher]'SELECT ProcessId, ParentProcessId FROM Win32_Process').Get()) { ${say("[string]$p['ProcessId'] + ' ' + [string]$p['ParentProcessId'] + ' x'")} }`
    )

    for (const turn of [1, 2]) {
      ps(
        `wmi-by-name-${turn}`,
        `foreach ($p in ([wmisearcher]('${WQL} WHERE Name = ' + [char]39 + 'node.exe' + [char]39)).Get()) { ${say(ROW)} }`
      )
    }

    ps(
      'wmi-statement',
      `foreach ($p in ([wmisearcher]'${WQL}').Get()) { ${say(ROW)} }`
    )

    ps(
      'wmi-as-shipped',
      `([wmisearcher]'${WQL}').Get() | ForEach-Object { ` +
        '"$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }'
    )

    for (const turn of [1, 2]) {
      const started = Date.now()
      const rows = listProcesses()
      const ms = Date.now() - started
      const found = findLiveBrowserPid({
        profilePath: profile,
        binary: process.execPath,
        launcherPid: child.pid,
        rows
      })

      console.log(
        `TIMING product-listProcesses-${turn} ms=${ms} rows=${rows.length} found=${found === child.pid}`
      )
    }

    expect(child.pid).toBeGreaterThan(0)
  }, 900_000)
})
