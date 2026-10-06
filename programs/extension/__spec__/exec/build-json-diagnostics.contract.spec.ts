import {spawn} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')

interface Diagnostic {
  code?: string
  message: string
  file?: string
  line?: number
  column?: number
  severity: string
  name?: string
}

interface Frame {
  ok: boolean
  command: string
  status: string
  value: {output?: string} | null
  error: {code: string; message: string; details?: Diagnostic[]} | null
  truncated?: boolean
  warnings: string[]
}

function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    EXTENSION_ENV: 'test',
    EXTENSION_TELEMETRY: '0',
    EXTENSION_DEBUG: '0'
  }
  delete env.VITEST
  delete env.VITEST_WORKER_ID

  return env
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function parseFrames(stdout: string): Frame[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Frame)
}

function createFixture(): string {
  const projectDir = mkdtempSync(join(tmpdir(), 'extjs-json-diagnostics-'))
  mkdirSync(join(projectDir, 'content'), {recursive: true})
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({name: 'json-diagnostics', private: true, version: '1.0.0'})
  )

  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'JSON Diagnostics',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    })
  )

  writeFileSync(
    join(projectDir, 'background.js'),
    "import './missing-dep-token'\nconsole.log('json-diagnostics')\n"
  )

  writeFileSync(
    join(projectDir, 'content', 'scripts.js'),
    'const brokenToken = ;\n'
  )

  return projectDir
}

function expectCodedDetails(details: Diagnostic[] | undefined) {
  expect(details).toHaveLength(2)

  const notFound = details?.find((d) => d.code === 'E_MODULE_NOT_FOUND')
  expect(notFound).toMatchObject({
    file: 'background.js',
    line: 1,
    column: 1,
    severity: 'error'
  })

  expect(notFound?.message).toContain("Can't resolve './missing-dep-token'")

  const syntax = details?.find((d) => d.code === 'E_CONTENT_SCRIPT_SYNTAX')
  expect(syntax).toMatchObject({
    file: 'content/scripts.js',
    severity: 'error',
    name: 'ModuleBuildError'
  })

  expect(syntax?.message).toContain('const brokenToken = ;')
}

describe('a failed compile under --output json lists each diagnostic with its code', () => {
  let projectDir = ''

  beforeAll(() => {
    expect(existsSync(cliBin)).toBe(true)
    projectDir = createFixture()
  })

  afterAll(() => {
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('build ends with one build-failed frame whose error carries details', async () => {
    const run = await new Promise<{status: number | null; stdout: string}>(
      (resolvePromise) => {
        const child = spawn(
          process.execPath,
          [cliBin, 'build', '.', '--browser=chromium', '--output', 'json'],
          {cwd: projectDir, stdio: 'pipe', env: cliEnv()}
        )
        let stdout = ''
        child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
        child.stderr.on('data', () => {})
        child.on('close', (status) => resolvePromise({status, stdout}))
      }
    )

    expect(run.status).toBe(1)

    const frames = parseFrames(run.stdout)
    expect(frames).toHaveLength(1)

    const [frame] = frames
    expect(frame.ok).toBe(false)
    expect(frame.status).toBe('build-failed')
    expect(frame.error?.code).toBe('E_COMPILE')
    expect(frame.truncated).toBeUndefined()
    expectCodedDetails(frame.error?.details)
  }, 180_000)

  it.skipIf(process.platform === 'win32')(
    'dev --no-browser emits a compile-failed frame whose error carries details',
    async () => {
      const child = spawn(
        process.execPath,
        [
          cliBin,
          'dev',
          projectDir,
          '--browser',
          'chrome',
          '--no-browser',
          '--output',
          'json'
        ],
        {cwd: cliRoot, stdio: 'pipe', env: cliEnv()}
      )
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
      const closed = new Promise<number | null>((resolvePromise) =>
        child.once('close', (code) => resolvePromise(code))
      )

      const deadline = Date.now() + 90_000

      while (
        Date.now() < deadline &&
        !parseFrames(stdout).some((frame) => frame.status === 'compile-failed')
      ) {
        await sleep(250)
      }

      child.kill('SIGTERM')
      await Promise.race([
        closed,
        sleep(15_000).then(() => child.kill('SIGKILL'))
      ])

      const frame = parseFrames(stdout).find(
        (candidate) => candidate.status === 'compile-failed'
      )
      expect(frame, stderr).toBeDefined()
      expect(frame?.ok).toBe(false)
      expect(frame?.error?.code).toBe('E_FIRST_COMPILE')
      expect(frame?.value?.output).toContain('missing-dep-token')
      expectCodedDetails(frame?.error?.details)
    },
    180_000
  )
})
