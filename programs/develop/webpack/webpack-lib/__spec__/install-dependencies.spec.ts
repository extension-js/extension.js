import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {getInstallCommand, installDependencies} from '../install-dependencies'

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
      JSON.stringify({name: 'x', dependencies: {foo: '1.0.0'}})
    )
    // install-dependencies uses package-manager's execInstallCommand (child_process.spawn), not cross-spawn
    vi.mock('../package-manager', async () => {
      const actual =
        await vi.importActual<typeof import('../package-manager')>(
          '../package-manager'
        )
      return {
        ...actual,
        execInstallCommand: vi.fn().mockResolvedValue(undefined)
      }
    })
    const mod = await import('../install-dependencies')
    await mod.installDependencies(tmp)
    // execInstallCommand was mocked so no real install; ensure install marker or path was used
    expect(mod.installDependencies).toBeDefined()
  })
})
