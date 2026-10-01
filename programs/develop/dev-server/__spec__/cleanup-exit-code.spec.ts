import {spawnSync} from 'node:child_process'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

// --no-browser installs no launcher handler, so the dev-server's own
// uncaughtException handler is the only thing deciding the exit code.
const childPath = path.join(__dirname, 'fixtures', 'cleanup-exit-code-child.ts')

const runChild = (mode: 'throw' | 'sigint') =>
  spawnSync(process.execPath, ['--import', 'tsx', childPath, mode], {
    cwd: path.resolve(__dirname, '..', '..'),
    encoding: 'utf-8',
    timeout: 30_000
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
})
