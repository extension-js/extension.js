import {type ChildProcess, spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {readyContractPath} from '../lib/session-paths'

const roots: string[] = []
const children: ChildProcess[] = []

afterAll(() => {
  for (const child of children) child.kill('SIGKILL')
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(config?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-out-dir-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'out-dir', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'out-dir',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log(1)\n')

  if (config) {
    fs.writeFileSync(path.join(root, 'extension.config.js'), config)
  }

  return root
}

async function build(root: string, options: Record<string, unknown> = {}) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false,
      ...options
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function liveProcess(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore'
  })
  children.push(child)

  return child.pid as number
}

function writeDevContract(root: string, pid: number) {
  const contractPath = readyContractPath(root, 'chrome')
  fs.mkdirSync(path.dirname(contractPath), {recursive: true})
  const body = JSON.stringify({
    schemaVersion: 2,
    schema: 1,
    status: 'ready',
    command: 'dev',
    browser: 'chrome',
    runId: 'dev-run',
    distPath: path.join(root, 'dist', 'chrome'),
    pid
  })
  fs.writeFileSync(contractPath, body)

  return {contractPath, body}
}

function sharedDistWarnings(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((text) =>
    text.startsWith('E_DEV_SESSION_DIST_SHARED:')
  )
}

describe('extension build --out-dir', () => {
  it('writes <outDir>/<browser> and leaves dist/<browser> untouched', async () => {
    const root = project()
    const summary = await build(root, {outDir: 'build'})

    expect(summary.errors_count).toBe(0)
    expect(
      fs.existsSync(path.join(root, 'build', 'chrome', 'manifest.json'))
    ).toBe(true)

    expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
    expect(String(summary.output_path).split(path.sep).join('/')).toMatch(
      /\/build\/chrome$/
    )
  })

  it('puts the zip next to the browser folder under the out dir', async () => {
    const root = project()
    const summary = await build(root, {outDir: 'build', zip: true})

    expect(summary.errors_count).toBe(0)
    const zips = fs
      .readdirSync(path.join(root, 'build'))
      .filter((name) => name.endsWith('.zip'))
    expect(zips).toHaveLength(1)
    expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
  })

  it('reads commands.build.outDir from the project config', async () => {
    const root = project(
      "module.exports = {commands: {build: {outDir: 'out'}}}\n"
    )
    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(
      fs.existsSync(path.join(root, 'out', 'chrome', 'manifest.json'))
    ).toBe(true)
  })

  it('refuses the project root as the out dir', async () => {
    const root = project()

    await expect(build(root, {outDir: '.'})).rejects.toThrow(/--out-dir/)
    expect(fs.existsSync(path.join(root, 'chrome'))).toBe(false)
  })
})

describe('extension build beside a running dev session', () => {
  it('refuses to write the dist a live dev session owns, and names the way out', async () => {
    const root = project()
    const pid = liveProcess()
    const {contractPath, body} = writeDevContract(root, pid)
    const distDir = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(distDir, {recursive: true})
    fs.writeFileSync(path.join(distDir, 'manifest.json'), '{"dev":true}')

    let error: (Error & {code?: string}) | undefined

    try {
      await build(root)
    } catch (caught) {
      error = caught as Error & {code?: string}
    }

    expect(error?.code).toBe('E_DEV_SESSION_DIST_SHARED')
    expect(error?.message).toContain(`PID ${pid}`)
    expect(error?.message).toContain('--out-dir')
    expect(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf-8')).toBe(
      '{"dev":true}'
    )

    expect(fs.readFileSync(contractPath, 'utf-8')).toBe(body)
  })

  it('stays quiet and keeps the dev contract under --out-dir', async () => {
    const root = project()
    const {contractPath, body} = writeDevContract(root, liveProcess())
    const summary = await build(root, {outDir: 'build'})

    expect(summary.errors_count).toBe(0)
    expect(sharedDistWarnings(summary)).toEqual([])
    expect(fs.readFileSync(contractPath, 'utf-8')).toBe(body)
  })

  it('treats a contract whose producer is gone as nobody else', async () => {
    const root = project()
    const child = spawn(process.execPath, ['-e', ''], {stdio: 'ignore'})
    await new Promise((resolve) => child.on('exit', resolve))
    const {contractPath} = writeDevContract(root, child.pid as number)
    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(sharedDistWarnings(summary)).toEqual([])
    expect(JSON.parse(fs.readFileSync(contractPath, 'utf-8')).command).toBe(
      'build'
    )
  })
})
