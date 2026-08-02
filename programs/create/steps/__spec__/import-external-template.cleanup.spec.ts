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

import axios from 'axios'
import {extensionCreate} from '../../module'
import {
  cleanupFailedImport,
  importExternalTemplate
} from '../import-external-template'

const noopLogger = {log: () => {}, error: () => {}}

// A pre-existing repo directory that passes the create conflict check: only
// dotfiles and allowlisted names, exactly the `extension create .` shape.
async function seedExistingRepo(projectPath: string) {
  await fsp.mkdir(path.join(projectPath, '.git'), {recursive: true})
  await fsp.writeFile(
    path.join(projectPath, '.git', 'HEAD'),
    'ref: refs/heads/main\n'
  )
  await fsp.writeFile(path.join(projectPath, 'LICENSE'), 'MIT\n')
}

describe('importExternalTemplate failure cleanup', () => {
  const prevEnv = process.env.EXTENSION_ENV
  const tempDirs: string[] = []

  beforeEach(() => {
    process.env.EXTENSION_ENV = 'test'
    vi.mocked(axios.get).mockReset()
    vi.mocked(axios.get).mockRejectedValue(
      new Error('network is disabled in this test')
    )
  })

  afterEach(async () => {
    process.env.EXTENSION_ENV = prevEnv
    while (tempDirs.length > 0) {
      await fsp.rm(tempDirs.pop()!, {recursive: true, force: true})
    }
  })

  async function makeTempRoot() {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-cleanup-'))
    tempDirs.push(tmpRoot)
    return tmpRoot
  }

  it('a download failure in a pre-existing directory keeps .git intact', async () => {
    const tmpRoot = await makeTempRoot()
    const projectPath = path.join(tmpRoot, 'existing-repo')
    await seedExistingRepo(projectPath)

    await expect(
      importExternalTemplate(
        projectPath,
        'existing-repo',
        'content',
        noopLogger
      )
    ).rejects.toThrow()

    expect(fs.existsSync(path.join(projectPath, '.git', 'HEAD'))).toBe(true)
    expect(fs.existsSync(path.join(projectPath, 'LICENSE'))).toBe(true)
  })

  it('the full create flow never deletes a pre-existing repo on failure', async () => {
    const tmpRoot = await makeTempRoot()
    const projectPath = path.join(tmpRoot, 'existing-repo')
    await seedExistingRepo(projectPath)

    await expect(
      extensionCreate(projectPath, {template: 'content', logger: noopLogger})
    ).rejects.toThrow()

    // The directory and everything the user already had must survive.
    expect(fs.existsSync(projectPath)).toBe(true)
    expect(fs.existsSync(path.join(projectPath, '.git', 'HEAD'))).toBe(true)
    expect(fs.existsSync(path.join(projectPath, 'LICENSE'))).toBe(true)
  })

  it('still removes a directory the scaffolder created itself', async () => {
    const tmpRoot = await makeTempRoot()
    const projectPath = path.join(tmpRoot, 'brand-new')

    await expect(
      extensionCreate(projectPath, {template: 'content', logger: noopLogger})
    ).rejects.toThrow()

    // A retry into the same name starts clean, the old contract.
    expect(fs.existsSync(projectPath)).toBe(false)
  })

  it('cleanupFailedImport removes only what the import added', async () => {
    const tmpRoot = await makeTempRoot()
    const projectPath = path.join(tmpRoot, 'partial')
    await seedExistingRepo(projectPath)
    const preExisting = await fsp.readdir(projectPath)

    // Entries a partial import could have written before failing.
    await fsp.mkdir(path.join(projectPath, 'src'), {recursive: true})
    await fsp.writeFile(path.join(projectPath, 'src', 'index.js'), '// x\n')
    await fsp.writeFile(path.join(projectPath, 'package.json'), '{}\n')

    await cleanupFailedImport(projectPath, false, preExisting)

    expect(fs.existsSync(path.join(projectPath, 'src'))).toBe(false)
    expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(false)
    expect(fs.existsSync(path.join(projectPath, '.git', 'HEAD'))).toBe(true)
    expect(fs.existsSync(path.join(projectPath, 'LICENSE'))).toBe(true)
  })
})
