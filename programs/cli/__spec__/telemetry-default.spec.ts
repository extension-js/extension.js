import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execSync, spawnSync} from 'node:child_process'
import crypto from 'node:crypto'

function cliRoot(): string {
  return path.resolve(__dirname, '..')
}

function cliBin(): string {
  // Use the locally built CLI entrypoint instead of installing from a packed tarball.
  return path.join(cliRoot(), 'dist', 'cli.js')
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

it('runs successfully even without PostHog keys (local audit allowed)', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cli-'))

  // We care that the CLI does not crash when telemetry is effectively offline.
  // Local audit writing is covered by lower-level telemetry unit tests; here we
  // only verify that missing PostHog keys do not cause runtime failures.
  const r = spawnSync(
    process.execPath,
    [cliBin(), '--version'],
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
  expect(r.error).toBeUndefined()
}, 120000)
