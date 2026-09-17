import type {ChildProcess} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  buildInstallCommand,
  resolveNpmPackageManager,
  spawnInstallCommand
} from '../package-manager'

// Nothing is mocked here on purpose: the sibling spec mocks cross-spawn, so
// only a real spawn proves the .cmd shims resolve on the Windows lane.
const VERSION = /^\d+\.\d+\.\d+/

type Outcome = {code: number | null; stdout: string; stderr: string}

function onPath(name: string): boolean {
  const suffixes =
    process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  const dirs = (process.env.PATH || '').split(path.delimiter)

  return dirs.some(
    (dir) =>
      dir &&
      suffixes.some((suffix) => fs.existsSync(path.join(dir, name + suffix)))
  )
}

function finished(child: ChildProcess): Promise<Outcome> {
  let stdout = ''
  let stderr = ''

  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString()
  })

  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  return new Promise((resolve, reject) => {
    child.on('close', (code) => resolve({code, stdout, stderr}))
    child.on('error', reject)
  })
}

describe('package-manager spawnInstallCommand (real spawn)', () => {
  it('runs npm --version through its .cmd shim with no shell', async () => {
    // npm ignores the trailing argument. A shell would run "b" after "&"
    // and turn the exit code non-zero, so a zero exit proves no shell ran.
    const cmd = buildInstallCommand({name: 'npm'}, ['--version', 'a & b'])
    const result = await finished(
      spawnInstallCommand(cmd.command, cmd.args, {
        cwd: process.cwd(),
        stdio: 'pipe'
      })
    )

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toMatch(VERSION)
    expect(result.stderr).not.toMatch(/not recognized|not found/i)
  })

  it('runs the npm the fallback install resolves on this machine', async () => {
    // The hydrated resolution is the one a failed install retries with, so
    // the resolved path must run as-is, a .cmd path on Windows included.
    const cmd = buildInstallCommand(resolveNpmPackageManager(), ['--version'])
    const result = await finished(
      spawnInstallCommand(cmd.command, cmd.args, {
        cwd: process.cwd(),
        stdio: 'pipe'
      })
    )

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toMatch(VERSION)
  })

  it.skipIf(!onPath('pnpm'))(
    'runs pnpm --version through its .cmd shim',
    async () => {
      const cmd = buildInstallCommand({name: 'pnpm'}, ['--version'])
      const result = await finished(
        spawnInstallCommand(cmd.command, cmd.args, {
          cwd: process.cwd(),
          stdio: 'pipe'
        })
      )

      expect(result.code).toBe(0)
      expect(result.stdout.trim()).toMatch(VERSION)
    }
  )
})
