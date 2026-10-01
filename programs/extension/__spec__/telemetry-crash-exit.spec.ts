import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

function cliRoot(): string {
  return path.resolve(__dirname, '..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs

  return path.join(cliRoot(), 'dist', 'cli.js')
}

// A rejection that exists before the CLI loads reaches Node from outside the
// awaited command promise, which is the path a telemetry listener swallowed.
const CRASH_PRELOAD = 'Promise.reject(new Error("injected async crash"))\n'

interface CrashRun {
  status: number | null
  stderr: string
}

function runWithInjectedCrash(telemetry: '0' | '1'): Promise<CrashRun> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-crash-'))
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-config-'))
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cache-'))
  const preload = path.join(work, 'crash.cjs')
  fs.writeFileSync(preload, CRASH_PRELOAD, 'utf8')

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--require',
        preload,
        cliBin(),
        'create',
        './crashing-extension',
        '--template',
        'javascript'
      ],
      {
        cwd: work,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          EXTENSION_TELEMETRY: telemetry,
          // Nothing may leave the machine for a spec, and a refused connect
          // keeps the flush deadline out of the measurement.
          POSTHOG_HOST: 'http://127.0.0.1:1',
          XDG_CONFIG_HOME: configHome,
          XDG_CACHE_HOME: cacheHome
        }
      }
    )

    let stderr = ''
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)))
    child.on('close', (status) =>
      resolve({status, stderr: normalize(stderr, work)})
    )
  })
}

// Every run gets its own temp dir and its own pid, so paths and the pid Node
// stamps on its own warnings are the two things that legitimately differ.
function normalize(stderr: string, work: string): string {
  let out = stderr

  for (const dir of new Set([work, realpath(work)])) {
    out = out.split(dir).join('<work>')
  }

  return out.replace(/\(node:\d+\)/g, '(node:<pid>)').trim()
}

function realpath(dir: string): string {
  try {
    return fs.realpathSync(dir)
  } catch {
    return dir
  }
}

describe('telemetry never changes what a crashing command does', () => {
  it('dies the same way with telemetry on as with telemetry off', async () => {
    const [on, off] = await Promise.all([
      runWithInjectedCrash('1'),
      runWithInjectedCrash('0')
    ])

    // The opted-out run is the reference: Node prints the stack and exits 1.
    expect(off.status).toBe(1)
    expect(off.stderr).toContain('injected async crash')

    expect(on.status).toBe(off.status)
    expect(on.stderr).toBe(off.stderr)
  }, 120000)
})
