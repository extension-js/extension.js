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

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')
const ANSI = /\x1b\[[0-9;]*m/g
const STACK_FRAME = /^\s+at /m

function stripVitestEnv(): NodeJS.ProcessEnv {
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

// A file that exists but cannot be executed. spawn refuses it with EACCES, so
// nothing is on screen and no browser is needed.
function plantUnexecutableBinary(dir: string, name: string): string {
  const binary = join(dir, name)
  mkdirSync(dir, {recursive: true})
  writeFileSync(binary, 'not a browser\n')
  chmodSync(binary, 0o644)

  return binary
}

// A browser that starts and leaves at once, with nothing on screen.
function plantExitingBinary(dir: string, name: string): string {
  const binary = join(dir, name)
  mkdirSync(dir, {recursive: true})
  writeFileSync(binary, '#!/bin/sh\nexit 0\n')
  chmodSync(binary, 0o755)

  return binary
}

// A browser that stays up and never opens its debugger. It answers the
// version probe, then records its pid so the spec can see it was reaped.
function plantSilentBinary(dir: string, name: string, pidFile: string) {
  const binary = join(dir, name)
  mkdirSync(dir, {recursive: true})
  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      'case "$1" in --version|-v) echo "Mozilla Firefox 130.0"; exit 0;; esac',
      `echo $$ > "${pidFile}"`,
      'exec sleep 60',
      ''
    ].join('\n')
  )

  chmodSync(binary, 0o755)

  return binary
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

function runCli(
  args: string[],
  timeoutMs = 60_000,
  extraEnv: Record<string, string> = {}
) {
  return new Promise<{status: number; stdout: string; stderr: string}>(
    (resolvePromise, reject) => {
      const child = spawn(process.execPath, [cliBin, ...args], {
        cwd: cliRoot,
        stdio: 'pipe',
        env: {...stripVitestEnv(), ...extraEnv}
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()))

      // A launch that fails ends the command. One that hangs here did not.
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(
          new Error(
            `CLI did not exit: ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        )
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

function frames(stdout: string): Array<{
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string} | null
}> {
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

// The contract of the session that ran in projectDir. A project with no
// build keeps it under dist all the same, beside nothing else.
function readContract(
  projectDir: string,
  browser: string
): {
  status?: string
  code?: string
  message?: string
  browserPid?: number
  browserExitedAt?: string
} {
  return JSON.parse(
    readFileSync(
      join(projectDir, 'dist', 'extension-js', browser, 'ready.json'),
      'utf8'
    )
  )
}

// The stand-in binaries lean on posix permission bits, which Windows does
// not model, so the contract runs on posix only.
describe.skipIf(process.platform === 'win32')(
  'a run-only command whose browser never spawns',
  () => {
    const leftovers: string[] = []

    afterEach(() => {
      for (const dir of leftovers.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    function makeWorkspace() {
      const work = mkdtempSync(join(tmpdir(), 'extjs-preview-launch-'))
      leftovers.push(work)
      const projectDir = join(work, 'project')
      mkdirSync(projectDir, {recursive: true})
      writeFileSync(
        join(projectDir, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Launch Probe',
          version: '1.0.0'
        })
      )

      return {work, projectDir}
    }

    it('preview prints one frame for a chromium spawn refusal, with no stack', async () => {
      const {work, projectDir} = makeWorkspace()
      const binary = plantUnexecutableBinary(join(work, 'bin'), 'chrome')

      const result = await runCli([
        'preview',
        projectDir,
        '--browser',
        'chrome',
        '--chromium-binary',
        binary
      ])

      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).not.toMatch(STACK_FRAME)
      expect(result.stderr.match(/⏵⏵⏵/g), result.stderr).toHaveLength(1)
      expect(result.stderr).toContain(
        "Chrome couldn't start, so the extension isn't running."
      )

      expect(result.stderr).toContain(`spawn ${binary} EACCES`)
    }, 90_000)

    it('preview codes it E_BROWSER_LAUNCH under --output json', async () => {
      const {work, projectDir} = makeWorkspace()
      const binary = plantUnexecutableBinary(join(work, 'bin'), 'chrome')

      const result = await runCli([
        'preview',
        projectDir,
        '--browser',
        'chrome',
        '--chromium-binary',
        binary,
        '--output',
        'json'
      ])

      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).not.toMatch(STACK_FRAME)

      const all = frames(result.stdout)
      expect(all, result.stdout).toHaveLength(1)
      expect(all[0]).toMatchObject({
        schema: 1,
        ok: false,
        command: 'preview',
        status: 'failed'
      })

      expect(all[0].error?.code).toBe('E_BROWSER_LAUNCH')
      expect(all[0].error?.message).toContain("couldn't start")
      expect(all[0].error?.message).toContain('EACCES')
      expect(all[0].error?.message).not.toContain('⏵')
    }, 90_000)

    it('preview reports a firefox spawn refusal the same way', async () => {
      const {work, projectDir} = makeWorkspace()
      const binary = plantUnexecutableBinary(join(work, 'bin'), 'firefox')

      const result = await runCli([
        'preview',
        projectDir,
        '--browser',
        'firefox',
        '--gecko-binary',
        binary,
        '--output',
        'json'
      ])

      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).not.toMatch(STACK_FRAME)

      const all = frames(result.stdout)
      expect(all, result.stdout).toHaveLength(1)
      expect(all[0].error?.code).toBe('E_BROWSER_LAUNCH')
      expect(all[0].error?.message).toContain(
        "Firefox couldn't start, so the extension isn't running."
      )

      expect(all[0].error?.message).toContain('EACCES')
    }, 90_000)

    it('start prints the same frame after its build, with no stack', async () => {
      const {work, projectDir} = makeWorkspace()
      const binary = plantUnexecutableBinary(join(work, 'bin'), 'chrome')

      const result = await runCli([
        'start',
        projectDir,
        '--browser',
        'chrome',
        '--chromium-binary',
        binary
      ])

      expect(result.status, result.stderr).toBe(1)
      expect(result.stdout).toMatch(/built for production/)
      expect(result.stderr).not.toMatch(STACK_FRAME)
      expect(result.stderr.match(/⏵⏵⏵/g), result.stderr).toHaveLength(1)
      expect(result.stderr).toContain(
        "Chrome couldn't start, so the extension isn't running."
      )

      expect(result.stderr).toContain('EACCES')
    }, 120_000)

    // A pin that names nothing is refused before any spawn, with its own
    // frame and code. The launch frame must not swallow that verdict.
    it('preview keeps the pin refusal for a path that does not exist', async () => {
      const {work, projectDir} = makeWorkspace()
      const missing = join(work, 'nowhere', 'chrome')

      const result = await runCli([
        'preview',
        projectDir,
        '--browser',
        'chrome',
        '--chromium-binary',
        missing,
        '--output',
        'json'
      ])

      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).not.toMatch(STACK_FRAME)

      const all = frames(result.stdout)
      expect(all, result.stdout).toHaveLength(1)
      expect(all[0].error?.code).toBe('E_BROWSER_BINARY_INVALID')
      expect(all[0].error?.message).toContain(missing)
      expect(all[0].error?.message).not.toContain("couldn't start")
    }, 90_000)

    // The Chromium launcher throws this refusal. The Gecko one ended the
    // process instead, which left a json consumer with exit 1 and no frame.
    it('preview frames a gecko pin that names nothing, as chromium does', async () => {
      const {work, projectDir} = makeWorkspace()
      const missing = join(work, 'nowhere', 'firefox')

      const result = await runCli([
        'preview',
        projectDir,
        '--browser',
        'firefox',
        '--gecko-binary',
        missing,
        '--output',
        'json'
      ])

      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).not.toMatch(STACK_FRAME)

      const all = frames(result.stdout)
      expect(all, result.stdout).toHaveLength(1)
      expect(all[0]).toMatchObject({ok: false, command: 'preview'})
      expect(all[0].error?.code).toBe('E_BROWSER_BINARY_INVALID')
      expect(all[0].error?.message).toContain(missing)
      expect(all[0].error?.message).not.toContain('⏵')
    }, 90_000)

    it('preview prints that gecko pin refusal once in text, with no stack', async () => {
      const {work, projectDir} = makeWorkspace()
      const missing = join(work, 'nowhere', 'firefox')

      const result = await runCli([
        'preview',
        projectDir,
        '--browser',
        'firefox',
        '--gecko-binary',
        missing
      ])

      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).not.toMatch(STACK_FRAME)
      expect(result.stderr.match(/⏵⏵⏵/g), result.stderr).toHaveLength(1)
      expect(result.stderr).toContain(
        "Can't find a Firefox or Gecko binary at the given path."
      )

      expect(result.stderr).toContain(missing)
    }, 90_000)

    // The project has no build, so the browser loads the source folder and
    // the contract path cannot be derived from the loaded directory.
    it.each([
      ['chrome', '--chromium-binary', 'EACCES'],
      ['firefox', '--gecko-binary', 'EACCES']
    ])(
      'preview of a project with no dist stamps the failed %s launch on its contract',
      async (browser, flag, reason) => {
        const {work, projectDir} = makeWorkspace()
        const binary = plantUnexecutableBinary(join(work, 'bin'), browser)

        const result = await runCli([
          'preview',
          projectDir,
          '--browser',
          browser,
          flag,
          binary
        ])

        expect(result.status, result.stderr).toBe(1)
        expect(existsSync(join(projectDir, 'dist', browser))).toBe(false)

        const contract = readContract(projectDir, browser)
        expect(contract.status).toBe('error')
        expect(contract.code).toBe('browser_launch_failed')
        expect(contract.message).toContain(reason)
        expect(contract.message).not.toContain('⏵')
      },
      90_000
    )

    it('preview of a project with no dist stamps a pin that names nothing', async () => {
      const {work, projectDir} = makeWorkspace()
      const missing = join(work, 'nowhere', 'firefox')

      const result = await runCli([
        'preview',
        projectDir,
        '--browser',
        'firefox',
        '--gecko-binary',
        missing
      ])

      expect(result.status, result.stderr).toBe(1)

      const contract = readContract(projectDir, 'firefox')
      expect(contract.status).toBe('error')
      expect(contract.code).toBe('browser_launch_failed')
      expect(contract.message).toContain(missing)
    }, 90_000)

    // start used to print an ok "started" frame before it built or launched
    // anything, so a failed run read as a success followed by a failure.
    it.each([
      ['chrome', '--chromium-binary', 'E_BROWSER_LAUNCH', true],
      ['chrome', '--chromium-binary', 'E_BROWSER_BINARY_INVALID', false],
      ['firefox', '--gecko-binary', 'E_BROWSER_BINARY_INVALID', false]
    ])(
      'start prints one failure frame for a %s launch refused by %s as %s',
      async (browser, flag, code, planted) => {
        const {work, projectDir} = makeWorkspace()
        const binary = planted
          ? plantUnexecutableBinary(join(work, 'bin'), browser)
          : join(work, 'nowhere', browser)

        const result = await runCli(
          [
            'start',
            projectDir,
            '--browser',
            browser,
            flag,
            binary,
            '--output',
            'json'
          ],
          120_000
        )

        expect(result.status, result.stderr).toBe(1)
        expect(result.stderr).not.toMatch(STACK_FRAME)

        const all = frames(result.stdout)
        expect(all, result.stdout).toHaveLength(1)
        expect(all[0]).toMatchObject({ok: false, command: 'start'})
        expect(all[0].error?.code).toBe(code)
        expect(all[0].error?.message).toContain(binary)
        expect(all[0].error?.message).not.toContain('⏵')
      },
      150_000
    )

    // Every stamp follows the contract the session owns, not only the launch
    // failure: a browser that came up and left has to show on it too.
    it('preview of a project with no dist records a chromium browser that launched and left', async () => {
      const {work, projectDir} = makeWorkspace()
      const binary = plantExitingBinary(join(work, 'bin'), 'chrome')

      const result = await runCli([
        'preview',
        projectDir,
        '--browser',
        'chrome',
        '--chromium-binary',
        binary
      ])

      expect(result.stderr).not.toMatch(STACK_FRAME)
      expect(existsSync(join(projectDir, 'dist', 'chrome'))).toBe(false)

      const contract = readContract(projectDir, 'chrome')
      expect(typeof contract.browserPid).toBe('number')
      expect(typeof contract.browserExitedAt).toBe('string')
      expect(contract.status).not.toBe('starting')
      expect(contract.status).not.toBe('ready')
    }, 90_000)

    // The debugger dial used to go on for minutes after the process had
    // left, then fail as an internal error with a stack.
    it('preview stops waiting on a firefox that left before its debugger answered', async () => {
      const {work, projectDir} = makeWorkspace()
      const binary = plantExitingBinary(join(work, 'bin'), 'firefox')

      const result = await runCli([
        'preview',
        projectDir,
        '--browser',
        'firefox',
        '--gecko-binary',
        binary,
        '--output',
        'json'
      ])

      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).not.toMatch(STACK_FRAME)

      const all = frames(result.stdout)
      expect(all, result.stdout).toHaveLength(1)
      expect(all[0]).toMatchObject({ok: false, status: 'failed'})
      expect(all[0].error?.code).toBe('E_BROWSER_LAUNCH')
      expect(all[0].error?.message).toContain(
        'Firefox exited before its debugger answered'
      )

      const contract = readContract(projectDir, 'firefox')
      expect(contract.status).toBe('error')
      expect(contract.code).toBe('browser_exited')
      expect(typeof contract.browserPid).toBe('number')
    }, 90_000)

    it('preview frames a firefox whose debugger never answers, once, and reaps it', async () => {
      const {work, projectDir} = makeWorkspace()
      const pidFile = join(work, 'browser.pid')
      const binary = plantSilentBinary(join(work, 'bin'), 'firefox', pidFile)
      let pid = 0

      try {
        const result = await runCli(
          [
            'preview',
            projectDir,
            '--browser',
            'firefox',
            '--gecko-binary',
            binary,
            '--output',
            'json'
          ],
          60_000,
          {
            EXTENSION_RDP_MAX_RETRIES: '1',
            EXTENSION_RDP_RETRY_INTERVAL_MS: '50'
          }
        )

        pid = Number(readFileSync(pidFile, 'utf8').trim())

        expect(result.status, result.stderr).toBe(1)
        expect(result.stderr).not.toMatch(STACK_FRAME)
        expect(result.stderr).not.toContain("Can't connect to Firefox")

        const all = frames(result.stdout)
        expect(all, result.stdout).toHaveLength(1)
        expect(all[0]).toMatchObject({ok: false, status: 'failed'})
        expect(all[0].error?.code).toBe('E_BROWSER_CONNECT')
        expect(all[0].error?.message).toContain("Can't connect to Firefox")

        const contract = readContract(projectDir, 'firefox')
        expect(contract.status).toBe('error')
        expect(contract.code).toBe('browser_launch_failed')
        expect(isAlive(pid)).toBe(false)
      } finally {
        if (pid && isAlive(pid)) process.kill(pid, 'SIGKILL')
      }
    }, 90_000)
  }
)
