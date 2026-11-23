import {spawnSync} from 'node:child_process'
import {join} from 'node:path'
import {expect, it} from 'vitest'
import {plantBrowserStandIn} from '../helpers/browser-stand-in'
import {cliEnv} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTemp = trackTempFolders()

// Temporary: times what a version read costs on the Windows runner, in the
// worker's environment and in the one a CLI child gets. Removed before merge.
it.runIf(process.platform === 'win32')(
  'times the version read',
  () => {
    const dir = makeTemp('extjs-stand-in-timing-')
    const plantStarted = Date.now()
    const binary = plantBrowserStandIn(join(dir, 'a'), 'canary', {
      version: 'Canary 999.0.1234.5'
    })
    const lines = [`plant (compile) ${Date.now() - plantStarted}ms`]
    const copyStarted = Date.now()
    plantBrowserStandIn(join(dir, 'b'), 'canary', {version: 'Canary 1.2.3.4'})
    lines.push(`plant (copy) ${Date.now() - copyStarted}ms`)

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
        `${label} ${Date.now() - started}ms status=${run.status} out=${JSON.stringify(String(run.stdout).trim().slice(0, 80))} err=${JSON.stringify(String(run.stderr).trim().slice(0, 200))}`
      )
    }

    const read = (file: string) => [
      '-NoProfile',
      '-Command',
      `(Get-Item -LiteralPath '${file}').VersionInfo.ProductVersion`
    ]
    const worker = {...process.env}
    const realTemp = process.env.EXTJS_SPEC_REAL_TMPDIR
    const workerRealTemp = {...worker, TEMP: realTemp, TMP: realTemp}
    const child = cliEnv()
    const whoami = 'C:\\Windows\\System32\\whoami.exe'

    time('stand-in --version, worker env', binary, ['--version'], worker)
    time('stand-in --version, again', binary, ['--version'], worker)
    time('stand-in --version, child env', binary, ['--version'], child)
    time(
      'powershell 1, worker env',
      'powershell.exe',
      ['-NoProfile', '-Command', '1'],
      worker
    )

    time(
      'powershell 1, again',
      'powershell.exe',
      ['-NoProfile', '-Command', '1'],
      worker
    )

    time(
      'powershell 1, worker env real temp',
      'powershell.exe',
      ['-NoProfile', '-Command', '1'],
      workerRealTemp
    )

    time(
      'powershell 1, child env',
      'powershell.exe',
      ['-NoProfile', '-Command', '1'],
      child
    )

    time('read stand-in, worker env', 'powershell.exe', read(binary), worker)
    time('read stand-in, again', 'powershell.exe', read(binary), worker)
    time(
      'read stand-in, real temp',
      'powershell.exe',
      read(binary),
      workerRealTemp
    )

    time('read stand-in, child env', 'powershell.exe', read(binary), child)
    time('read whoami, worker env', 'powershell.exe', read(whoami), worker)
    time('read whoami, child env', 'powershell.exe', read(whoami), child)
    time(
      'read missing, worker env',
      'powershell.exe',
      read(join(dir, 'nope.exe')),
      worker
    )

    time('where powershell', 'where.exe', ['powershell.exe'], worker)

    lines.push(
      `TEMP=${process.env.TEMP} REAL=${realTemp} LOCALAPPDATA=${process.env.LOCALAPPDATA} PSModulePath=${process.env.PSModulePath}`
    )

    console.log(`STAND-IN TIMING\n${lines.join('\n')}`)
    expect(lines.length).toBeGreaterThan(10)
  },
  600_000
)
