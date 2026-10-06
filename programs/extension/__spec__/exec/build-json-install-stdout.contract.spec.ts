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

describe('build --output json on a project whose dependencies are not installed', () => {
  let projectDir = ''

  beforeAll(() => {
    expect(existsSync(cliBin)).toBe(true)

    projectDir = mkdtempSync(join(tmpdir(), 'extjs-json-install-stdout-'))
    mkdirSync(join(projectDir, 'content'))
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'json-install-stdout',
        private: true,
        version: '1.0.0',
        dependencies: {picocolors: '1.1.1'}
      })
    )

    writeFileSync(join(projectDir, '.npmrc'), 'offline=true\n')

    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'JSON Install Stdout',
        version: '1.0.0',
        content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
      })
    )

    writeFileSync(
      join(projectDir, 'content', 'scripts.js'),
      "console.log('json-install-stdout-fixture')\n"
    )
  })

  afterAll(() => {
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('keeps the package manager output off stdout', async () => {
    const run = await runCli(
      ['build', '.', '--browser=chromium', '--output', 'json'],
      projectDir
    )

    expect(run.status).toBe(0)
    expect(existsSync(join(projectDir, 'node_modules', 'picocolors'))).toBe(
      true
    )

    const emitted = frames(run.stdout)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].ok).toBe(true)
    expect(emitted[0].command).toBe('build')
    expect(emitted[0].status).toBe('built')

    expect(run.stderr).toContain('Installing the project dependencies')
  }, 180_000)
})
