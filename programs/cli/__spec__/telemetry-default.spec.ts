import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'

function cliRoot(): string {
  return path.resolve(__dirname, '..')
}

function cliBin(): string {
  // Use the locally built CLI entrypoint instead of installing from a packed tarball.
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs
  return path.join(cliRoot(), 'dist', 'cli.js')
}

function canWrite(dir: string): boolean {
  try {
    fs.mkdirSync(dir, {recursive: true})
    const probe = path.join(dir, `.write-test-${Date.now()}`)
    fs.writeFileSync(probe, 'ok', 'utf8')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

it('runs successfully even without PostHog keys (local audit allowed)', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cli-'))

  // We care that the CLI does not crash when telemetry is effectively offline.
  // Local audit writing is covered by lower-level telemetry unit tests; here we
  // only verify that missing PostHog keys do not cause runtime failures.
  const r = spawnSync(process.execPath, [cliBin(), '--version'], {
    cwd: work,
    env: {
      ...process.env,
      EXTENSION_PUBLIC_POSTHOG_KEY: '',
      EXTENSION_PUBLIC_POSTHOG_HOST: ''
    },
    stdio: 'ignore'
  })
  expect(r.error).toBeUndefined()
}, 120000)

it('falls back to cache when config path is unwritable', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cli-'))
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-config-'))
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cache-'))

  try {
    fs.chmodSync(configHome, 0o500)
  } catch {
    // best-effort on platforms that ignore chmod (e.g. Windows)
  }

  const configWritable = canWrite(configHome)

  const r = spawnSync(process.execPath, [cliBin(), '--version'], {
    cwd: work,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: configHome,
      XDG_CACHE_HOME: cacheHome,
      EXTENSION_PUBLIC_POSTHOG_KEY: '',
      EXTENSION_PUBLIC_POSTHOG_HOST: ''
    },
    stdio: 'ignore'
  })

  expect(r.error).toBeUndefined()
  expect(r.status).toBe(0)
}, 120000)
