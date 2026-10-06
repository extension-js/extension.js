import {type ChildProcess, spawn} from 'node:child_process'
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

interface Run {
  status: number
  frames: Frame[]
}

function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    EXTENSION_ENV: 'test',
    EXTENSION_TELEMETRY: '0'
  }
  delete env.VITEST
  delete env.VITEST_WORKER_ID

  return env
}

function parseFrames(stdout: string): Frame[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Frame)
}

function startCli(args: string[]): {child: ChildProcess; done: Promise<Run>} {
  const child = spawn(process.execPath, [cliBin, ...args], {
    cwd: cliRoot,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: cliEnv()
  })
  let stdout = ''
  child.stdout?.on('data', (chunk) => (stdout += chunk.toString()))

  const done = new Promise<Run>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`CLI did not exit: ${args.join(' ')}\n${stdout}`))
    }, 100_000)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({status: code ?? 1, frames: parseFrames(stdout)})
    })
  })

  return {child, done}
}

function readContract(readyPath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(readyPath, 'utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}

async function waitForCompiledContract(
  readyPath: string
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 60_000

  while (Date.now() < deadline) {
    const contract = readContract(readyPath)

    if (contract && typeof contract.compiledAt === 'string') return contract

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }

  throw new Error(`no compiled contract at ${readyPath}`)
}

// The stand-in is a shell script, which Windows does not run.
describe.skipIf(process.platform === 'win32')(
  'start --wait while the first process still probes a bad pin',
  () => {
    const leftovers: string[] = []
    const children: ChildProcess[] = []

    afterEach(() => {
      for (const child of children.splice(0)) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
      }

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

    it.each([
      ['chrome', '--chromium-binary'],
      ['firefox', '--gecko-binary']
    ])(
      'on %s keeps waiting through the probe and reports the refusal',
      async (browser, flag) => {
        const work = mkdtempSync(join(tmpdir(), 'extjs-probe-wait-'))
        leftovers.push(work)
        const projectDir = join(work, 'project')
        mkdirSync(projectDir, {recursive: true})
        writeFileSync(
          join(projectDir, 'manifest.json'),
          JSON.stringify({
            manifest_version: 3,
            name: 'Probe Wait Window',
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

        const first = startCli([
          'start',
          projectDir,
          '--browser',
          browser,
          flag,
          silent,
          '--no-open',
          '--output',
          'json'
        ])
        children.push(first.child)

        const compiled = await waitForCompiledContract(readyPath)

        expect(compiled).toMatchObject({command: 'start', status: 'starting'})

        const waited = await startCli([
          'start',
          projectDir,
          '--browser',
          browser,
          '--wait',
          '--wait-timeout=30000',
          '--output',
          'json'
        ]).done

        expect(waited.status).toBe(1)
        expect(waited.frames).toHaveLength(1)
        expect(waited.frames[0]).toMatchObject({
          ok: false,
          command: 'start',
          status: 'usage',
          error: {code: 'E_BROWSER_BINARY_INVALID'}
        })

        expect(waited.frames[0].error?.message).toContain(silent)

        const run = await first.done

        expect(run.status).toBe(1)
        expect(run.frames.at(-1)?.error?.code).toBe('E_BROWSER_BINARY_INVALID')

        expect(readContract(readyPath)).toMatchObject({
          command: 'start',
          status: 'error',
          code: 'browser_launch_failed',
          browserLaunchFailedCode: 'E_BROWSER_BINARY_INVALID'
        })
      },
      150_000
    )
  }
)
