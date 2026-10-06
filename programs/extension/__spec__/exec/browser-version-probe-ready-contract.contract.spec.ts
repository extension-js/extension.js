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

interface Frame {
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string} | null
}

const EXIT_CEILING_MS = 120_000

function runCli(args: string[], observe: () => string = () => 'no state') {
  return new Promise<{status: number; frames: Frame[]}>(
    (resolvePromise, reject) => {
      const startedAt = Date.now()
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
        stdio: ['ignore', 'pipe', 'ignore'],
        env
      })
      let stdout = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString()))

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        const elapsed = Math.round((Date.now() - startedAt) / 1000)
        reject(
          new Error(
            `CLI did not exit after ${elapsed} s: ${args.join(' ')}\n` +
              `last observed: ${observe()}\nstdout:\n${stdout}`
          )
        )
      }, EXIT_CEILING_MS)

      child.on('close', (code) => {
        clearTimeout(timer)
        resolvePromise({
          status: code ?? 1,
          frames: stdout
            .split('\n')
            .filter((line) => line.trim().startsWith('{'))
            .map((line) => JSON.parse(line) as Frame)
        })
      })
    }
  )
}

// The stand-in is a shell script, which Windows does not run.
describe.skipIf(process.platform === 'win32')(
  'a pin that never answers its version probe, on the ready contract',
  () => {
    const leftovers: string[] = []

    afterEach(() => {
      for (const dir of leftovers.splice(0)) {
        const pidFile = join(dir, 'silent.pid')

        if (existsSync(pidFile)) {
          try {
            process.kill(
              Number(readFileSync(pidFile, 'utf8').trim()),
              'SIGKILL'
            )
          } catch {
            // Already gone
          }
        }

        rmSync(dir, {recursive: true, force: true})
      }
    })

    // Where the CLI got to when it was killed: compiling, probing the pin,
    // or refused in the contract but still running.
    function stage(work: string, readyPath: string) {
      let verdict = 'no ready.json'

      if (existsSync(readyPath)) {
        try {
          const ready = JSON.parse(readFileSync(readyPath, 'utf8'))
          verdict = `ready.json status=${ready.status} code=${ready.code}`
        } catch {
          verdict = 'ready.json unreadable'
        }
      }

      const probe = existsSync(join(work, 'silent.pid'))
        ? 'probe started'
        : 'probe not started'

      return `${probe}, ${verdict}`
    }

    // The card probes a Chromium pin before any launcher runs, which is where
    // the refusal used to leave the contract saying ready or starting.
    it.each([
      ['start', 'chrome', '--chromium-binary'],
      ['preview', 'chrome', '--chromium-binary'],
      ['start', 'firefox', '--gecko-binary'],
      ['preview', 'firefox', '--gecko-binary']
    ])(
      '%s on %s records the refusal a bad pin gets',
      async (command, browser, flag) => {
        const work = mkdtempSync(join(tmpdir(), 'extjs-probe-contract-'))
        leftovers.push(work)
        const projectDir = join(work, 'project')
        mkdirSync(projectDir, {recursive: true})
        writeFileSync(
          join(projectDir, 'manifest.json'),
          JSON.stringify({
            manifest_version: 3,
            name: 'Probe Contract',
            version: '1.0.0'
          })
        )

        const silent = join(work, 'silent')
        writeFileSync(
          silent,
          `#!/bin/sh\necho $$ > "${join(work, 'silent.pid')}"\nexec sleep 600\n`
        )

        chmodSync(silent, 0o755)
        const readyPath = join(
          projectDir,
          'dist',
          'extension-js',
          browser,
          'ready.json'
        )

        const run = await runCli(
          [
            command,
            projectDir,
            '--browser',
            browser,
            flag,
            silent,
            '--no-open',
            '--output',
            'json'
          ],
          () => stage(work, readyPath)
        )

        expect(run.status).toBe(1)
        expect(run.frames.at(-1)?.error?.code).toBe('E_BROWSER_BINARY_INVALID')

        const ready = JSON.parse(readFileSync(readyPath, 'utf8'))

        expect(ready).toMatchObject({
          command,
          status: 'error',
          code: 'browser_launch_failed',
          browserLaunchFailedCode: 'E_BROWSER_BINARY_INVALID'
        })

        expect(ready.message).toContain(silent)

        // A waiter in another process reads the same verdict and never ok.
        if (command === 'start') {
          const waited = await runCli(
            [
              'start',
              projectDir,
              '--browser',
              browser,
              '--wait',
              '--wait-timeout=20000',
              '--output',
              'json'
            ],
            () => stage(work, readyPath)
          )

          expect(waited.status).toBe(1)
          expect(waited.frames).toHaveLength(1)
          expect(waited.frames[0]).toMatchObject({
            ok: false,
            command: 'start',
            status: 'usage',
            error: {code: 'E_BROWSER_BINARY_INVALID'}
          })
        }
      },
      EXIT_CEILING_MS * 2 + 30_000
    )
  }
)
