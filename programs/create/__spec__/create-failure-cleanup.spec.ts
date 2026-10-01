import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('go-git-it', () => ({default: vi.fn(async () => {})}))
vi.mock('axios', () => ({
  default: {
    get: vi.fn(async () => {
      throw new Error('network is disabled in this test')
    })
  }
}))

// Every step that makes the scaffold the user's own runs after the install, so
// an install failure is the case that left a half-personalized project behind.
vi.mock('../steps/install-dependencies', () => ({
  installDependencies: async () => {
    throw new Error("⏵⏵⏵ Couldn't install the dependencies.")
  }
}))

import {extensionCreate} from '../module'

const noopLogger = {log: () => {}, error: () => {}}

describe('a failed create leaves nothing half-personalized on disk', () => {
  const prevEnv = process.env.EXTENSION_ENV
  const tempRoots: string[] = []

  beforeEach(() => {
    process.env.EXTENSION_ENV = 'test'
  })

  afterEach(async () => {
    process.env.EXTENSION_ENV = prevEnv

    while (tempRoots.length > 0) {
      await fsp.rm(tempRoots.pop()!, {recursive: true, force: true})
    }
  })

  async function makeTempRoot() {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'extjs-create-cleanup-')
    )
    tempRoots.push(tmpRoot)

    return tmpRoot
  }

  it('removes the directory it created, so a retry is not refused', async () => {
    const tmpRoot = await makeTempRoot()
    const projectPath = path.join(tmpRoot, 'proof')

    await expect(
      extensionCreate(projectPath, {install: true, logger: noopLogger})
    ).rejects.toThrow("Couldn't install the dependencies")

    expect(fs.existsSync(projectPath)).toBe(false)
  })

  it('keeps what pre-existed and drops only what the run wrote', async () => {
    const tmpRoot = await makeTempRoot()
    const projectPath = path.join(tmpRoot, 'existing-repo')
    await fsp.mkdir(path.join(projectPath, '.git'), {recursive: true})
    await fsp.writeFile(
      path.join(projectPath, '.git', 'HEAD'),
      'ref: refs/heads/main\n'
    )

    await expect(
      extensionCreate(projectPath, {install: true, logger: noopLogger})
    ).rejects.toThrow("Couldn't install the dependencies")

    expect(fs.existsSync(path.join(projectPath, '.git', 'HEAD'))).toBe(true)
    expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(false)
    expect(fs.existsSync(path.join(projectPath, 'node_modules'))).toBe(false)
  })
})
