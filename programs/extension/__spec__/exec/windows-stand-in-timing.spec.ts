import {spawnSync} from 'node:child_process'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {expect, it} from 'vitest'
import {readWindowsProductVersion} from '../../browsers/browsers-lib/binary-version-metadata'
import {listProcesses} from '../../browsers/browsers-lib/resolve-live-pid'
import {plantBrowserStandIn} from '../helpers/browser-stand-in'
import {cliEnv} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTemp = trackTempFolders()

// Temporary: times the old and new Windows reads on the hosted runner, with
// and without LOCALAPPDATA. Removed before merge.
it.runIf(process.platform === 'win32')(
  'times the version read',
  () => {
    const dir = makeTemp('extjs-stand-in-timing-')
    const binary = plantBrowserStandIn(join(dir, 'a'), 'canary', {
      version: 'Canary 999.0.1234.5'
    })
    const lines: string[] = []

    const time = (label: string, bin: string, args: string[], env: object) => {
      const started = Date.now()
      const run = spawnSync(bin, args, {
        encoding: 'utf8',
        env: env as NodeJS.ProcessEnv,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000
      })

      lines.push(
        `${label} ${Date.now() - started}ms status=${run.status} out=${JSON.stringify(String(run.stdout).trim().slice(0, 60))} err=${JSON.stringify(String(run.stderr).trim().slice(0, 160))}`
      )
    }

    const read = (file: string) => [
      '-NoProfile',
      '-Command',
      `(Get-Item -LiteralPath '${file}').VersionInfo.ProductVersion`
    ]
    const dotnet = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:EXTENSION_VERSION_READ_PATH).ProductVersion'
    ]
    const count = (script: string) => [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(${script} | Measure-Object).Count`
    ]
    const cim = count('Get-CimInstance Win32_Process')
    const wmi = count(
      "([wmisearcher]'SELECT ProcessId, ParentProcessId, CommandLine FROM Win32_Process').Get()"
    )
    const whoami = 'C:\\Windows\\System32\\whoami.exe'
    const localAppData = join(homedir(), 'AppData', 'Local')
    const bare = {...process.env, EXTENSION_VERSION_READ_PATH: whoami}
    Reflect.deleteProperty(bare, 'LOCALAPPDATA')
    const withCache = {...bare, LOCALAPPDATA: localAppData}
    const child = {...cliEnv(), EXTENSION_VERSION_READ_PATH: whoami}
    const ps = 'powershell.exe'

    time('stand-in --version', binary, ['--version'], bare)
    time('OLD Get-Item read, no LOCALAPPDATA', ps, read(whoami), bare)
    time(
      'OLD Get-Item read, LOCALAPPDATA set, 1st',
      ps,
      read(whoami),
      withCache
    )

    time(
      'OLD Get-Item read, LOCALAPPDATA set, 2nd',
      ps,
      read(whoami),
      withCache
    )

    time('OLD Get-Item read, CLI child env', ps, read(whoami), child)
    time('NEW .NET read, no LOCALAPPDATA', ps, dotnet, bare)
    time('NEW .NET read, LOCALAPPDATA set', ps, dotnet, withCache)
    time('NEW .NET read, CLI child env', ps, dotnet, child)
    time('NEW .NET read of the stand-in', ps, dotnet, {
      ...bare,
      EXTENSION_VERSION_READ_PATH: binary
    })

    time('NEW .NET read of a missing file', ps, dotnet, {
      ...bare,
      EXTENSION_VERSION_READ_PATH: join(dir, 'nope.exe')
    })

    time('OLD process table, no LOCALAPPDATA', ps, cim, bare)
    time('OLD process table, LOCALAPPDATA set', ps, cim, withCache)
    time('NEW process table, no LOCALAPPDATA', ps, wmi, bare)
    time('NEW process table, CLI child env', ps, wmi, child)

    const started = Date.now()
    const product = readWindowsProductVersion(whoami)
    lines.push(
      `product read of whoami ${Date.now() - started}ms out=${product}`
    )

    lines.push(`product process rows ${listProcesses().length}`)
    lines.push(
      `LOCALAPPDATA=${process.env.LOCALAPPDATA} tried=${localAppData} PSModulePath=${process.env.PSModulePath}`
    )

    console.log(`STAND-IN TIMING\n${lines.join('\n')}`)
    expect(lines.length).toBeGreaterThan(10)
  },
  600_000
)
