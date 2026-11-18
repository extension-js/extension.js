import {spawnSync} from 'node:child_process'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

// --no-browser installs no launcher handler, so the dev-server's own
// uncaughtException handler is the only thing deciding the exit code.
const childPath = path.join(__dirname, 'fixtures', 'cleanup-exit-code-child.ts')

const runChild = (mode: 'throw' | 'sigint' | 'hang') =>
  spawnSync(process.execPath, ['--import', 'tsx', childPath, mode], {
    cwd: path.resolve(__dirname, '..', '..'),
    encoding: 'utf-8',
    timeout: 30_000,
    // The child handles SIGTERM, so only this ends one that will not stop.
    killSignal: 'SIGKILL'
  })

describe('dev-server cleanup exit code', () => {
  it('exits non-zero when the session dies of an uncaught exception', () => {
    const result = runChild('throw')

    expect(result.stderr).toContain('Uncaught exception in the dev server')
    expect(result.signal).toBeNull()
    expect(result.status).not.toBe(0)
  })

  it('still exits 0 on a clean shutdown', () => {
    const result = runChild('sigint')

    expect(result.signal).toBeNull()
    expect(result.status).toBe(0)
  })

  it('exits 1 with a line when the server never stops', () => {
    const started = Date.now()
    const result = runChild('hang')

    expect(result.signal).toBeNull()
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("didn't shut down within 300 ms")
    expect(Date.now() - started).toBeLessThan(20_000)
  })
})
