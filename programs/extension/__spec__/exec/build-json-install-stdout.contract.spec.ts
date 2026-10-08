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
import {
  type OfflineRegistryFixture,
  offlineRegistryEnv,
  offlineRegistryFiles,
  serveOfflineRegistry,
  withoutInheritedRegistry
} from '../../../create/__spec__/offline-registry-fixture'

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

function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs = 120_000
) {
  const childEnv: NodeJS.ProcessEnv = {
    ...withoutInheritedRegistry(process.env),
    ...env,
    EXTENSION_ENV: 'test',
    EXTENSION_TELEMETRY: '0',
    EXTENSION_DEBUG: '0'
  }
  delete childEnv.VITEST
  delete childEnv.VITEST_WORKER_ID

  return new Promise<{status: number; stdout: string; stderr: string}>(
    (resolvePromise, reject) => {
      const child = spawn(process.execPath, [cliBin, ...args], {
        cwd,
        stdio: 'pipe',
        env: childEnv
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
  let registry: OfflineRegistryFixture

  beforeAll(async () => {
    expect(existsSync(cliBin)).toBe(true)

    registry = await serveOfflineRegistry()

    projectDir = mkdtempSync(join(tmpdir(), 'extjs-json-install-stdout-'))
    mkdirSync(join(projectDir, 'content'))
    mkdirSync(join(projectDir, 'vendor', 'picocolors'), {recursive: true})
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'json-install-stdout',
        private: true,
        version: '1.0.0',
        dependencies: {picocolors: 'file:./vendor/picocolors'}
      })
    )
    writeFileSync(
      join(projectDir, 'vendor', 'picocolors', 'package.json'),
      JSON.stringify({name: 'picocolors', version: '1.1.1', main: 'index.js'})
    )
    writeFileSync(
      join(projectDir, 'vendor', 'picocolors', 'index.js'),
      'module.exports = {}\n'
    )

    for (const [file, content] of Object.entries(
      offlineRegistryFiles(registry.url)
    )) {
      writeFileSync(join(projectDir, file), content)
    }
    writeFileSync(join(projectDir, '.npmrc'), 'offline=true\n', {flag: 'a'})

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
  }, 60_000)

  afterAll(async () => {
    await registry?.close()
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('keeps the package manager output off stdout', async () => {
    const run = await runCli(
      ['build', '.', '--browser=chromium', '--output', 'json'],
      projectDir,
      offlineRegistryEnv(registry.url)
    )
    const transcript = [
      `exit ${run.status}`,
      `the loopback registry saw: ${registry.requests().join(' ') || 'nothing'}`,
      `stdout:\n${run.stdout}`,
      `stderr:\n${run.stderr}`
    ].join('\n')

    expect(run.status, transcript).toBe(0)
    expect(
      existsSync(join(projectDir, 'node_modules', 'picocolors')),
      transcript
    ).toBe(true)
    expect(
      registry.requests().filter((url) => url.includes('picocolors')),
      transcript
    ).toEqual([])

    const emitted = frames(run.stdout)
    expect(emitted, transcript).toHaveLength(1)
    expect(emitted[0].ok).toBe(true)
    expect(emitted[0].command).toBe('build')
    expect(emitted[0].status).toBe('built')

    expect(run.stderr, transcript).toContain(
      'Installing the project dependencies'
    )
  }, 180_000)
})
