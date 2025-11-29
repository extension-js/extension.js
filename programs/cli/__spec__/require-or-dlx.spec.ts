import {describe, it, expect, vi, beforeEach} from 'vitest'

// Capture spawn calls
const spawnCalls: Array<{cmd: string; args: string[]; cwd?: string}> = []

vi.mock('node:child_process', async () => {
  return {
    spawnSync: (cmd: string, args: string[], opts?: {cwd?: string}) => {
      spawnCalls.push({cmd, args, cwd: opts?.cwd})
      // Simulate pnpm --version failing so we take npm path,
      // and npm install succeeding with status 0
      if (args?.[0] === '--version') {
        return {status: 1}
      }
      return {status: 0}
    }
  }
})

// Minimal fs mock: first readFileSync throws (module not installed),
// post-install read still throws so requireOrDlx will proceed to fallback.
vi.mock('node:fs', async () => {
  return {
    default: {
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => {
        throw new Error('ENOENT')
      })
    }
  }
})

// pathToFileURL import target won't exist; ignore by letting import fail

describe('requireOrDlx installer', () => {
  beforeEach(() => {
    spawnCalls.length = 0
    delete (process.env as any).EXTENSION_DLX
  })

  it('adds --omit=optional to npm installation args', async () => {
    const {requireOrDlx} = await import('../utils')
    try {
      await requireOrDlx('some-uninstalled-module', '1.2.3')
    } catch {}
    // Find the npm invocation
    const npmCall = spawnCalls.find((c) => c.cmd.includes('npm'))
    expect(npmCall).toBeTruthy()
    expect(npmCall?.args).toContain('--omit=optional')
    expect(npmCall?.args).toContain('--omit=dev')
  })
})
