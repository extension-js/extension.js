import {execFileSync, spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

function cliRoot(): string {
  return path.resolve(__dirname, '..')
}

function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// For reliability in CI/workspaces, install from the package folder directly
function pathToCLI(): string {
  return cliRoot()
}

function mkTmp(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

function writeFixture(root: string) {
  fs.mkdirSync(root, {recursive: true})
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'tmp-ext',
        version: '0.0.0',
        action: {default_title: 'tmp'},
        background: {service_worker: 'background.js'}
      },
      null,
      2
    )
  )
  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")')
}

function canReachRegistry(): boolean {
  try {
    execFileSync('npm', ['view', 'extension-develop@2', 'version', '--json'], {
      timeout: 8000,
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
}

const online = canReachRegistry()

describe('dynamic install', () => {
  if (!online) {
    it.skip('skipped: npm registry unreachable', () => {})
    return
  }
  it('installs extension-develop on demand and builds a local extension', () => {
    const proj = mkTmp('extjs-proj')
    writeFixture(proj)

    const work = mkTmp('extjs-cli')
    fs.writeFileSync(
      path.join(work, 'package.json'),
      JSON.stringify({name: 'w', private: true}, null, 2)
    )

    const cliPath = pathToCLI()
    execFileSync(
      'npm',
      ['i', '--no-fund', '--no-audit', '--omit=dev', cliPath],
      {
      cwd: work,
      stdio: 'inherit'
      }
    )

    expect(
      fs.existsSync(path.join(work, 'node_modules', 'extension-develop'))
    ).toBe(false)

    const r = spawnSync(
      process.execPath,
      [
        path.join(work, 'node_modules', 'extension', 'dist', 'cli.js'),
        'build',
        proj,
        '--browser=chrome',
        '--silent=true'
      ],
      {cwd: work, env: {...process.env, EXTJS_DLX: 'npm'}, stdio: 'inherit'}
    )
    expect(r.status).toBe(0)

    const cacheRoot = path.join(os.tmpdir(), 'extensionjs-cache')
    const entries = fs.existsSync(cacheRoot) ? fs.readdirSync(cacheRoot) : []
    const hasCached = entries.some((e) => e.startsWith('extension-develop@'))
    expect(hasCached).toBe(true)
  }, 180000)
})
