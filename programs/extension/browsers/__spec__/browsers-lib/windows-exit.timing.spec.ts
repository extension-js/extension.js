import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {plantBrowserStandIn} from '../../../__spec__/helpers/browser-stand-in'
import {windowsTaskkillPath} from '../../browsers-lib/process-teardown'
import {
  findLiveBrowserPid,
  parseProcessRows
} from '../../browsers-lib/resolve-live-pid'

// TEMPORARY: experiments on the hosted runner. Removed before this branch
// is handed back.
const WINDOWS = process.platform === 'win32'
const PACKAGE_ROOT = resolve(__dirname, '..', '..', '..')

describe('TIMING experiments', () => {
  const work = mkdtempSync(join(tmpdir(), 'extjs-exit-timing-'))
  const children: ChildProcess[] = []

  afterAll(() => {
    for (const child of children) child.kill('SIGKILL')

    rmSync(work, {recursive: true, force: true, maxRetries: 3})
  })

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)

      return true
    } catch {
      return false
    }
  }

  it.skipIf(!WINDOWS)(
    'prints which pid outlives each way of leaving',
    async () => {
      const script = join(work, 'leaver.cjs')

      writeFileSync(
        script,
        [
          "const {spawn, spawnSync} = require('node:child_process')",
          "const fs = require('node:fs')",
          'const [bin, childPidFile, taskkill, mode] = process.argv.slice(2)',
          "const quiet = {stdio: 'ignore', windowsHide: true}",
          'const tree = spawn(bin, [], quiet)',
          "const force = ['/PID', String(tree.pid), '/T', '/F']",
          "const polite = ['/PID', String(tree.pid), '/T']",
          'const timer = setInterval(() => {',
          "  if (!fs.existsSync(childPidFile) || !fs.readFileSync(childPidFile, 'utf8').trim()) return",
          '  clearInterval(timer)',
          "  if (mode === 'force-then-leave-on-close') {",
          "    tree.on('exit', () => process.exit(0))",
          "    spawn(taskkill, force, quiet).on('error', () => {})",
          '    return',
          '  }',
          "  if (mode === 'polite-then-leave-with-backstop') {",
          "    process.on('exit', () => spawnSync(taskkill, force, quiet))",
          "    spawn(taskkill, polite, quiet).on('error', () => {})",
          '    process.exit(0)',
          '  }',
          "  if (mode === 'polite-then-leave-on-close') {",
          "    tree.on('exit', () => process.exit(0))",
          "    spawn(taskkill, polite, quiet).on('error', () => {})",
          '    setTimeout(() => process.exit(7), 3000)',
          '  }',
          '}, 20)'
        ].join('\n')
      )

      const modes = [
        'force-then-leave-on-close',
        'polite-then-leave-with-backstop',
        'polite-then-leave-on-close'
      ]

      for (const mode of modes) {
        for (const turn of [1, 2, 3, 4]) {
          const dir = mkdtempSync(join(work, 'tree-'))
          const pidFile = join(dir, 'self.pid')
          const childPidFile = join(dir, 'child.pid')
          const bin = plantBrowserStandIn(dir, 'browser', {
            pidFile,
            childPidFile
          })
          const started = Date.now()
          const run = spawnSync(
            process.execPath,
            [script, bin, childPidFile, windowsTaskkillPath(), mode],
            {stdio: 'ignore', windowsHide: true, timeout: 30_000}
          )
          const ms = Date.now() - started

          await new Promise((done) => setTimeout(done, 2000))

          const report = [pidFile, childPidFile].map((file) => {
            const pid = existsSync(file)
              ? Number(readFileSync(file, 'utf8').trim())
              : 0
            const lives = pid > 0 && alive(pid)

            if (lives) process.kill(pid, 'SIGKILL')

            return `${file.endsWith('self.pid') ? 'browser' : 'child'}=${pid}:${lives ? 'ALIVE' : 'gone'}`
          })

          console.log(
            `TIMING leave mode=${mode} turn=${turn} exit=${run.status} ms=${ms} ${report.join(' ')}`
          )
        }
      }

      expect(script).toContain('leaver')
    },
    240_000
  )

  it.skipIf(!WINDOWS)(
    'prints what each output encoding gives a non-ASCII profile',
    () => {
      const profile = mkdtempSync(join(work, 'profile-é漢-'))
      const child = spawn(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)', '--', '-profile', profile],
        {stdio: 'ignore', windowsHide: true}
      )
      children.push(child)

      const shipped =
        "([wmisearcher]'SELECT ProcessId, ParentProcessId, CommandLine FROM Win32_Process').Get() | ForEach-Object { " +
        '"$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }'
      const scripts: Record<string, string> = {
        shipped,
        'utf8-set': `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${shipped}`,
        'utf8-new-no-bom': `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${shipped}`,
        'utf8-try': `try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }; ${shipped}`,
        'code-page':
          '[Console]::Out.WriteLine([Console]::OutputEncoding.CodePage)'
      }

      for (const [label, script] of Object.entries(scripts)) {
        for (const turn of [1, 2]) {
          const started = Date.now()
          const result = spawnSync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', script],
            {
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
              timeout: 45_000,
              maxBuffer: 64 * 1024 * 1024
            }
          )
          const ms = Date.now() - started
          const bytes = result.stdout ?? Buffer.alloc(0)
          const text = bytes.toString('utf8')
          const rows = parseProcessRows(text)
          const mine = rows.find((row) => row.pid === child.pid)
          const found = findLiveBrowserPid({
            profilePath: profile,
            binary: process.execPath,
            launcherPid: child.pid,
            rows
          })

          console.log(
            `TIMING encoding ${label}-${turn} ms=${ms} status=${result.status} rows=${rows.length} ` +
              `found=${found === child.pid} head=${bytes.subarray(0, 8).toString('hex')} ` +
              `mine=${JSON.stringify(mine?.command.slice(-60) ?? null)} out=${JSON.stringify(text.slice(0, 40))} ` +
              `stderr=${JSON.stringify(String(result.stderr || '').slice(0, 300))}`
          )
        }
      }

      console.log(`TIMING encoding profile=${JSON.stringify(profile)}`)
      expect(profile).toContain('profile-')
    },
    300_000
  )

  it('prints what a pack costs in place and in a copy', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
    ) as {files: string[]}
    const copy = mkdtempSync(join(work, 'pack-copy-'))
    const copyStarted = Date.now()

    for (const name of ['package.json', 'README.md', 'LICENSE', '.npmignore']) {
      if (existsSync(join(PACKAGE_ROOT, name))) {
        cpSync(join(PACKAGE_ROOT, name), join(copy, name))
      }
    }

    for (const entry of manifest.files) {
      if (entry.startsWith('!')) continue

      if (existsSync(join(PACKAGE_ROOT, entry))) {
        cpSync(join(PACKAGE_ROOT, entry), join(copy, entry), {recursive: true})
      }
    }

    console.log(`TIMING pack copy-made ms=${Date.now() - copyStarted}`)

    const npm = (label: string, args: string[], cwd: string) => {
      const started = Date.now()
      const run = spawnSync('npm', args, {
        cwd,
        encoding: 'utf8',
        env: {...process.env, npm_config_update_notifier: 'false'},
        shell: WINDOWS,
        timeout: 170_000
      })
      const ms = Date.now() - started
      let files = -1

      try {
        const report = JSON.parse(run.stdout) as Record<
          string,
          {files: unknown[]}
        >

        files = Object.values(report)[0].files.length
      } catch {
        // Not a pack report
      }

      console.log(
        `TIMING pack ${label} ms=${ms} status=${run.status} files=${files} out=${JSON.stringify(run.stdout.slice(0, 20))}`
      )
    }

    const pack = [
      'pack',
      '--dry-run',
      '--json',
      '--ignore-scripts',
      '--offline'
    ]

    npm('version-1', ['--version'], PACKAGE_ROOT)
    npm('version-2', ['--version'], PACKAGE_ROOT)
    npm('in-place-1', pack, PACKAGE_ROOT)
    npm('in-place-2', pack, PACKAGE_ROOT)
    npm('copy-1', pack, copy)
    npm('copy-2', pack, copy)
    npm('in-place-3', pack, PACKAGE_ROOT)

    expect(manifest.files.length).toBeGreaterThan(0)
  }, 900_000)
})
