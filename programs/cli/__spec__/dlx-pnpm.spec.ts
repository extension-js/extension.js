import {execSync, spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

function cliRoot(): string {
  return path.resolve(__dirname, '..')
}

function packCLI(): string {
  const out = execSync('npm pack --json', {
    cwd: cliRoot(),
    stdio: ['ignore', 'pipe', 'pipe']
  }).toString()
  const {filename} = JSON.parse(out)[0]
  const src = path.join(cliRoot(), filename)
  const tgz = path.join(
    os.tmpdir(),
    `cli-${crypto.randomBytes(4).toString('hex')}.tgz`
  )
  fs.copyFileSync(src, tgz)
  try {
    fs.unlinkSync(src)
  } catch {}
  return tgz
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
        background: {service_worker: 'background.js'}
      },
      null,
      2
    )
  )
  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")')
}

function hasPnpm(): boolean {
  try {
    execSync('pnpm -v', {stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}
function canReachRegistry(): boolean {
  try {
    execSync('npm view extension-develop@2 version --json', {
      timeout: 8000,
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
}

const enabled = hasPnpm() && canReachRegistry()

describe('dlx via pnpm', () => {
  if (!enabled) {
    it.skip('skipped: pnpm missing or registry unreachable', () => {})
    return
  }
  it('builds using pnpm as installer', () => {
    const work = mkTmp('extjs-cli')
    fs.writeFileSync(
      path.join(work, 'package.json'),
      JSON.stringify({name: 'w', private: true}, null, 2)
    )
    const tgz = packCLI()
    execSync(`npm i --no-fund --no-audit --omit=dev ${tgz}`, {
      cwd: work,
      stdio: 'inherit'
    })

    const proj = mkTmp('extjs-proj')
    writeFixture(proj)

    const r = spawnSync(
      process.execPath,
      [
        path.join(work, 'node_modules', 'extension', 'dist', 'cli.js'),
        'build',
        proj,
        '--browser=chrome',
        '--silent=true'
      ],
      {cwd: work, env: {...process.env, EXTJS_DLX: 'pnpm'}, stdio: 'inherit'}
    )
    expect(r.status).toBe(0)
  }, 180000)
})
