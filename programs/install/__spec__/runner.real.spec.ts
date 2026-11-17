import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {runCommand} from '../lib/runner'

// The one case that needs the machine's own npx: on Windows it is npx.cmd,
// and only starting it shows the name the installer builds is found and run.
describe('runCommand with the real npx', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs npx --version by the name the installer uses on this platform', async () => {
    // The trailing argument is ignored by npx. Through npx.cmd an unescaped
    // "&" would run "b" as a second command and the exit would not be 0.
    const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const result = await runCommand(command, ['--version', 'a & b'], {
      cwd: process.cwd(),
      env: {...process.env}
    })

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
    expect(result.stderr).not.toMatch(/not recognized|not found/i)
  }, 60_000)
})
