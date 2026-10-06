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
    EXTENSION_DEBUG: '1'
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

function lines(output: string): string[] {
  return output.split('\n').filter((line) => line.trim().length > 0)
}

describe('build --output json under EXTENSION_DEBUG on a TypeScript project', () => {
  let projectDir = ''

  beforeAll(() => {
    expect(existsSync(cliBin)).toBe(true)

    projectDir = mkdtempSync(join(tmpdir(), 'extjs-json-debug-ts-'))
    mkdirSync(join(projectDir, 'content'))
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({name: 'json-debug-ts', private: true, version: '1.0.0'})
    )

    writeFileSync(
      join(projectDir, 'tsconfig.json'),
      JSON.stringify({compilerOptions: {strict: true}})
    )

    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'JSON Debug TS',
        version: '1.0.0',
        content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.ts']}]
      })
    )

    writeFileSync(
      join(projectDir, 'content', 'scripts.ts'),
      "const token: string = 'json-debug-ts-fixture'\nconsole.log(token)\n"
    )
  })

  afterAll(() => {
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('keeps the using TypeScript debug line off stdout and ends on the built envelope', async () => {
    const run = await runCli(
      ['build', '.', '--browser=chromium', '--output', 'json'],
      projectDir
    )

    expect(run.status).toBe(0)

    const out = lines(run.stdout)
    expect(out.some((line) => /use=TypeScript/.test(line))).toBe(false)
    expect(run.stderr).toMatch(/use=TypeScript/)

    const last = JSON.parse(out[out.length - 1]) as Frame
    expect(last).toMatchObject({ok: true, command: 'build', status: 'built'})
  }, 180_000)
})
