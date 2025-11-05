import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {
  getInstallCommand,
  installDependencies
} from '../webpack/webpack-lib/install-dependencies'

const created: string[] = []
function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {}
  }
  created.length = 0
})

describe('install-dependencies', () => {
  it('getInstallCommand prefers explicit lockfiles', async () => {
    const tmp = makeTempDir('extjs-installcmd-')
    const cwd = process.cwd()
    try {
      process.chdir(tmp)
      fs.writeFileSync(path.join(tmp, 'pnpm-lock.yaml'), '')
      expect(await getInstallCommand()).toBe('pnpm')
      fs.unlinkSync(path.join(tmp, 'pnpm-lock.yaml'))
      fs.writeFileSync(path.join(tmp, 'yarn.lock'), '')
      expect(await getInstallCommand()).toBe('yarn')
      fs.unlinkSync(path.join(tmp, 'yarn.lock'))
      fs.writeFileSync(path.join(tmp, 'package-lock.json'), '')
      expect(await getInstallCommand()).toBe('npm')
    } finally {
      process.chdir(cwd)
    }
  })

  it('installDependencies spawns a process and resolves', async () => {
    const tmp = makeTempDir('extjs-installdeps-')
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({name: 'x'})
    )
    // mock spawn to immediately emit close 0
    vi.mock('cross-spawn', () => ({
      spawn: (_cmd: string, _args: string[], _opts: any) => {
        const listeners: Record<string, Function[]> = {close: [], error: []}
        return {
          on: (evt: 'close' | 'error', cb: Function) => {
            listeners[evt].push(cb)
          },
          // trigger close on next tick
          _tick: setImmediate(() =>
            listeners.close.forEach((cb) => (cb as any)(0))
          )
        } as any
      }
    }))
    const mod = await import('../webpack/webpack-lib/install-dependencies')
    await mod.installDependencies(tmp)
    expect(fs.existsSync(path.join(tmp, 'node_modules'))).toBe(true)
  })
})
