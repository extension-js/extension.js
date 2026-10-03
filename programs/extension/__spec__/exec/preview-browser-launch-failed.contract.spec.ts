import {spawn} from 'node:child_process'
import {chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
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

function runCli(args: string[], timeoutMs = 60_000) {
  return new Promise<{status: number; stdout: string; stderr: string}>(
    (resolvePromise, reject) => {
      const child = spawn(process.execPath, [cliBin, ...args], {
        cwd: cliRoot,
        stdio: 'pipe',
        env: stripVitestEnv()
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
  }
)
