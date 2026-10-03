import {spawn} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliBin = resolve(__dirname, '../..', 'dist', 'cli.cjs')
const GLYPH = '⏵⏵⏵'
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g

interface Frame {
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string} | null
}

function runCli(args: string[], timeoutMs = 120_000) {
  // Debug off: a debug run prints the stack on purpose.
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
          stdout,
          stderr: stderr.replace(ANSI, '')
        })
      })
    }
  )
}

function frames(stdout: string): Frame[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Frame)
}

const count = (text: string, needle: string) => text.split(needle).length - 1

// A config file that throws is the author's mistake, so every command that
// reads it answers with the documented code and says it once.
describe('a throwing extension.config.js', () => {
  let work = ''
  let projectDir = ''

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'extjs-config-throws-'))
    projectDir = join(work, 'project')
    mkdirSync(projectDir, {recursive: true})
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({private: true, name: 'config-throws', version: '0.0.0'})
    )

    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Config Throws',
        version: '1.0.0',
        background: {service_worker: 'background.js'}
      })
    )

    writeFileSync(join(projectDir, 'background.js'), 'console.log("bg")\n')
    writeFileSync(
      join(projectDir, 'extension.config.js'),
      "throw new Error('CONFIG_BOOM_MARK')\n"
    )
  })

  afterAll(() => {
    rmSync(work, {recursive: true, force: true})
  })

  const commands: Array<[string, string[]]> = [
    ['dev', ['--no-browser']],
    ['build', []],
    ['start', ['--no-browser']],
    ['preview', ['--no-browser']]
  ]

  it.each(
    commands
  )('answers %s --output json with one E_CONFIG_LOAD frame', async (command, flags) => {
    const run = await runCli([
      command,
      projectDir,
      ...flags,
      '--output',
      'json'
    ])
    const emitted = frames(run.stdout)

    expect(run.status).toBe(1)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].ok).toBe(false)
    expect(emitted[0].command).toBe(command)
    expect(emitted[0].status).not.toBe('usage')
    expect(emitted[0].error?.code).toBe('E_CONFIG_LOAD')

    const message = String(emitted[0].error?.message)
    expect(message).toContain('extension.config.js')
    expect(count(message, 'CONFIG_BOOM_MARK')).toBe(1)
    expect(message).not.toContain('⏵')
    expect(message).not.toMatch(/\n\s+at /)
  })

  it.each(
    commands
  )('prints %s one block that names the file and the reason', async (command, flags) => {
    const run = await runCli([command, projectDir, ...flags])

    expect(run.status).toBe(1)
    expect(count(run.stderr, "Couldn't load extension.config.js")).toBe(1)
    expect(count(run.stderr, 'CONFIG_BOOM_MARK')).toBe(1)
    expect(run.stderr).toMatch(/PATH .*extension\.config\.js/)
    expect(run.stderr).not.toMatch(/\n\s+at /)

    // A build adds its own closing line, the other commands print one head.
    const heads = count(run.stderr, GLYPH)
    expect(heads).toBe(command === 'build' || command === 'start' ? 2 : 1)
  })
})

// A config that loads but exports something other than an object is the same
// author mistake, so it takes the same code on every command.
describe('an extension.config.js that does not export an object', () => {
  let work = ''
  let projectDir = ''

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'extjs-config-shape-'))
    projectDir = join(work, 'project')
    mkdirSync(projectDir, {recursive: true})
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({private: true, name: 'config-shape', version: '0.0.0'})
    )

    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Config Shape',
        version: '1.0.0',
        background: {service_worker: 'background.js'}
      })
    )

    writeFileSync(join(projectDir, 'background.js'), 'console.log("bg")\n')
    writeFileSync(
      join(projectDir, 'extension.config.js'),
      "module.exports = ['not', 'an', 'object']\n"
    )
  })

  afterAll(() => {
    rmSync(work, {recursive: true, force: true})
  })

  it.each([
    ['build', []],
    ['preview', ['--no-browser']]
  ])('answers %s --output json with E_CONFIG_LOAD', async (command, flags) => {
    const run = await runCli([
      command,
      projectDir,
      ...flags,
      '--output',
      'json'
    ])
    const emitted = frames(run.stdout)

    expect(run.status).toBe(1)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].status).not.toBe('usage')
    expect(emitted[0].error?.code).toBe('E_CONFIG_LOAD')
    expect(String(emitted[0].error?.message)).toContain(
      'must export an object, found'
    )
  })
})
