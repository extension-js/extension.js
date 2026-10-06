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
const cliBin = resolve(__dirname, '../..', 'dist', 'cli.cjs')
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g

interface Frame {
  ok: boolean
  command: string
  status: string
  warnings: string[]
  value: {summaries: Array<{warnings?: string[]; warnings_count: number}>}
}

function runCli(args: string[], cwd: string, timeoutMs = 120_000) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EXTENSION_ENV: 'test',
    EXTENSION_TELEMETRY: '0',
    EXTENSION_DEBUG: '0'
  }
  delete env.VITEST
  delete env.VITEST_WORKER_ID

  return new Promise<{status: number; stdout: string; stderr: string}>(
    (resolvePromise, reject) => {
      const child = spawn(process.execPath, [cliBin, ...args], {
        cwd,
        stdio: 'pipe',
        env
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()))

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`CLI did not exit: ${args.join(' ')}\n${stdout}`))
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

function frames(stdout: string): Frame[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Frame)
}

describe('build --output json on a project whose config loads a managed package', () => {
  let projectDir = ''

  beforeAll(() => {
    expect(existsSync(cliBin)).toBe(true)

    projectDir = mkdtempSync(join(tmpdir(), 'extjs-json-coded-warnings-'))
    mkdirSync(join(projectDir, 'node_modules', '.pnpm'), {recursive: true})
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'json-coded-warnings',
        private: true,
        version: '1.0.0',
        dependencies: {'@rspack/core': '^2.0.0'}
      })
    )

    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'JSON Coded Warnings',
        version: '1.0.0',
        background: {service_worker: 'background.js'}
      })
    )

    writeFileSync(
      join(projectDir, 'background.js'),
      "console.log('json-coded-warnings-fixture')\n"
    )

    writeFileSync(
      join(projectDir, 'extension.config.js'),
      "const lazy = () => require('@rspack/core')\nmodule.exports = {}\n"
    )
  })

  afterAll(() => {
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('names the managed copy with its code on the frame and in the summary', async () => {
    const run = await runCli(
      ['build', '.', '--browser=chromium', '--output', 'json'],
      projectDir
    )

    expect(run.status).toBe(0)

    const emitted = frames(run.stdout)
    expect(emitted).toHaveLength(1)

    const [frame] = emitted
    expect(frame.ok).toBe(true)
    expect(frame.status).toBe('built')
    expect(frame.warnings).toHaveLength(1)
    expect(frame.warnings[0]).toMatch(
      /^E_MANAGED_DEP_CONFLICT: extension\.config\.js loads its own copy of @rspack\/core \(Extension\.js ships \S+\)\.$/
    )

    const [summary] = frame.value.summaries
    expect(summary.warnings).toContain(frame.warnings[0])
    expect(summary.warnings_count).toBe(summary.warnings?.length)

    expect(run.stderr).toContain('loads its own copy of a package')
  }, 180_000)
})
