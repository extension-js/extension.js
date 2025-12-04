import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execSync, spawnSync} from 'node:child_process'
import crypto from 'node:crypto'

function cliRoot(): string {
  return path.resolve(__dirname, '..')
}

function packCLI(): string {
  // Ensure the CLI is compiled so the packed tarball includes dist/
  execSync('pnpm run compile', {
    cwd: cliRoot(),
    stdio: ['ignore', 'inherit', 'inherit']
  })

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

function auditFile(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg
    ? path.join(xdg, 'extensionjs')
    : process.platform === 'win32' && process.env.APPDATA
      ? path.join(process.env.APPDATA!, 'extensionjs')
      : path.join(os.homedir(), '.config', 'extensionjs')
  return path.join(base, 'telemetry', 'events.jsonl')
}

it('writes local audit even without PostHog keys', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cli-'))
  fs.writeFileSync(
    path.join(work, 'package.json'),
    JSON.stringify({name: 'w', private: true}, null, 2)
  )
  const tgz = packCLI()
  execSync(`npm i --no-fund --no-audit --omit=dev ${tgz}`, {
    cwd: work,
    stdio: 'inherit'
  })

  const before = fs.existsSync(auditFile())
    ? fs.readFileSync(auditFile(), 'utf8')
    : ''
  const r = spawnSync(
    process.execPath,
    [
      path.join(work, 'node_modules', 'extension', 'dist', 'cli.js'),
      '--version'
    ],
    {
      cwd: work,
      env: {
        ...process.env,
        EXTENSION_PUBLIC_POSTHOG_KEY: '',
        EXTENSION_PUBLIC_POSTHOG_HOST: ''
      },
      stdio: 'ignore'
    }
  )
  expect(r.status).toBe(0)
  const after = fs.existsSync(auditFile())
    ? fs.readFileSync(auditFile(), 'utf8')
    : ''
  expect(after.length).toBeGreaterThan(before.length)
}, 120000)
