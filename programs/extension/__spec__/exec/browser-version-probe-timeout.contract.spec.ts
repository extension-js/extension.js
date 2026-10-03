import {spawn} from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')
const ANSI = /\x1b\[[0-9;]*m/g
const PROBE_SECONDS = 10

// Asked for its version it never answers, through a child of its own, the
// shape of a wrapper script around a browser that hangs.
function plantHangingBinary(dir: string, name: string) {
  const binary = join(dir, name)
  const pidFile = join(dir, `${name}.pid`)
  const childPidFile = join(dir, `${name}.child.pid`)
  mkdirSync(dir, {recursive: true})
  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      `echo $$ > "${pidFile}"`,
      'sleep 600 &',
      `echo $! > "${childPidFile}"`,
      'wait',
      ''
    ].join('\n')
  )

  chmodSync(binary, 0o755)

  return {binary, pidFile, childPidFile}
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

function runCli(args: string[], timeoutMs: number) {
  return new Promise<{status: number; stdout: string; stderr: string}>(
    (resolvePromise, reject) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        EXTENSION_ENV: 'test',
        EXTENSION_TELEMETRY: '0'
      }
      delete env.VITEST
      delete env.VITEST_WORKER_ID

      const child = spawn(process.execPath, [cliBin, ...args], {
        cwd: cliRoot,
        stdio: 'pipe',
        env
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()))

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`CLI did not exit: ${args.join(' ')}\n${stderr}`))
      }, timeoutMs)

      child.on('close', (code) => {
        clearTimeout(timer)
        resolvePromise({
          status: code ?? 1,
          stdout: stdout.replace(ANSI, ''),
          stderr: stderr.replace(ANSI, '')
        })
      })
    }
  )
}

// The stand-in is a shell script, which Windows does not run.
describe.skipIf(process.platform === 'win32')(
  'a browser binary that never answers its version probe',
  () => {
    const leftovers: string[] = []
    const strays: number[] = []

    afterEach(() => {
      for (const pid of strays.splice(0)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Already gone
        }
      }

      for (const dir of leftovers.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    it.each([
      ['firefox', '--gecko-binary'],
      ['chrome', '--chromium-binary']
    ])(
      'ends preview on %s within the bound and leaves nothing running',
      async (browser, flag) => {
        const work = mkdtempSync(join(tmpdir(), 'extjs-version-probe-'))
        leftovers.push(work)
        const projectDir = join(work, 'project')
        mkdirSync(projectDir, {recursive: true})
        writeFileSync(
          join(projectDir, 'manifest.json'),
          JSON.stringify({
            manifest_version: 3,
            name: 'Probe Timeout',
            version: '1.0.0'
          })
        )

        const stand = plantHangingBinary(join(work, 'bin'), browser)
        const started = Date.now()

        const result = await runCli(
          [
            'preview',
            projectDir,
            '--browser',
            browser,
            flag,
            stand.binary,
            '--output',
            'json'
          ],
          120_000
        )

        const elapsed = Date.now() - started

        for (const file of [stand.pidFile, stand.childPidFile]) {
          if (existsSync(file)) {
            strays.push(Number(readFileSync(file, 'utf8').trim()))
          }
        }

        expect(result.status, result.stderr).toBe(1)
        // The bound plus the time a loaded machine takes to start the CLI.
        expect(elapsed).toBeLessThan((PROBE_SECONDS + 30) * 1000)

        const lines = result.stdout.split('\n').filter((line) => line.trim())
        expect(lines, result.stdout).toHaveLength(1)

        const frame = JSON.parse(lines[0])
        expect(frame).toMatchObject({ok: false, command: 'preview'})
        expect(frame.error.code).toBe('E_BROWSER_BINARY_INVALID')
        expect(frame.error.message).toContain(stand.binary)
        expect(frame.error.message).toContain(
          `did not answer within ${PROBE_SECONDS} seconds`
        )

        // Both the probed process and the child it started are gone.
        expect(strays).toHaveLength(2)

        for (const pid of strays) {
          expect(isAlive(pid), `pid ${pid} still running`).toBe(false)
        }
      },
      150_000
    )
  }
)
