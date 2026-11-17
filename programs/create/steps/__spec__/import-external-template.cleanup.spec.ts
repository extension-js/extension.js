import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
  type LoopbackServer,
  serveLoopback
} from '../../__spec__/loopback-template-server'
import {extensionCreate} from '../../module'
import {
  cleanupFailedImport,
  importExternalTemplate
} from '../import-external-template'

const noopLogger = {log: () => {}, error: () => {}}
const OWNER_GITIGNORE = 'owner-only-rule\n'
const OWNER_MCP_CONFIG = '{"mcpServers":{"mine":{"command":"true"}}}'
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

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
  const savedEnv = {
    EXTENSION_ENV: process.env.EXTENSION_ENV,
    EXTENSION_ALLOW_HTTP_TEMPLATE: process.env.EXTENSION_ALLOW_HTTP_TEMPLATE,
    EXTENSION_CREATE_TEMPLATE_URL: process.env.EXTENSION_CREATE_TEMPLATE_URL
  }
  const tempDirs: string[] = []
  let catalog: LoopbackServer

  // The catalog is a loopback server with no archive, so every download is a
  // real 404, which the retry policy does not wait on.
  beforeEach(async () => {
    catalog = await serveLoopback({})
    process.env.EXTENSION_ENV = 'test'
    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
    process.env.EXTENSION_CREATE_TEMPLATE_URL = catalog.url('/catalog.zip')
  })

  afterEach(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }

    await catalog.close()

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
    ).rejects.toMatchObject({
      name: 'TemplateDownloadError',
      cause: {response: {status: 404}}
    })

    expect(catalog.hits('/catalog.zip')).toBe(1)

    expect(fs.existsSync(path.join(projectPath, '.git', 'HEAD'))).toBe(true)
    expect(fs.existsSync(path.join(projectPath, 'LICENSE'))).toBe(true)
  })

  it('the full create flow never deletes a pre-existing repo on failure', async () => {
    const tmpRoot = await makeTempRoot()
    const projectPath = path.join(tmpRoot, 'existing-repo')
    await seedExistingRepo(projectPath)

    await expect(
      extensionCreate(projectPath, {template: 'content', logger: noopLogger})
    ).rejects.toMatchObject({
      name: 'TemplateDownloadError',
      cause: {response: {status: 404}}
    })

    expect(catalog.hits('/catalog.zip')).toBe(1)

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
    ).rejects.toMatchObject({
      name: 'TemplateDownloadError',
      cause: {response: {status: 404}}
    })

    expect(catalog.hits('/catalog.zip')).toBe(1)

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

describe('a create that fails partway in an existing folder', () => {
  let root: string
  let project: string
  let template: string
  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-failed-import-'))
    project = path.join(root, 'project')
    template = path.join(root, 'template')

    await fsp.mkdir(project)
    await fsp.writeFile(path.join(project, '.gitignore'), OWNER_GITIGNORE)
    await fsp.writeFile(path.join(project, '.mcp.json'), OWNER_MCP_CONFIG)

    // The hidden files copy first, then the copy stops on a file it cannot read.
    await fsp.mkdir(template)
    await fsp.writeFile(path.join(template, '.gitignore'), 'template-rule\n')
    await fsp.writeFile(path.join(template, '.mcp.json'), '{"shipped":true}\n')
    await fsp.writeFile(path.join(template, 'manifest.json'), '{}')
    await fsp.writeFile(path.join(template, 'zz-unreadable.txt'), 'x')
    await fsp.chmod(path.join(template, 'zz-unreadable.txt'), 0o000)
  })

  afterEach(async () => {
    await fsp
      .chmod(path.join(template, 'zz-unreadable.txt'), 0o644)
      .catch(() => {})

    await fsp.rm(root, {recursive: true, force: true})
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'puts the owner files back byte for byte and removes what it added',
    async () => {
      const errors: unknown[] = []
      const error = (await importExternalTemplate(
        project,
        'project',
        template,
        {log() {}, error: (...args: unknown[]) => errors.push(args)}
      ).catch((thrown: Error) => thrown)) as Error & {cause?: unknown}
      const frame = String(error.message).replace(ANSI, '')

      // One frame on the error, nothing logged, the copy failure as its cause.
      expect(frame.split('\n')[0]).toBe(
        "⏵⏵⏵ Couldn't find the template template."
      )

      expect(frame.match(/⏵⏵⏵/g)).toHaveLength(1)
      expect(frame).toContain('REASON Error: EACCES')
      expect(error.cause).toMatchObject({code: 'EACCES', syscall: 'copyfile'})
      expect(errors).toEqual([])

      expect(await fsp.readFile(path.join(project, '.gitignore'), 'utf8')).toBe(
        OWNER_GITIGNORE
      )

      expect(await fsp.readFile(path.join(project, '.mcp.json'), 'utf8')).toBe(
        OWNER_MCP_CONFIG
      )

      expect((await fsp.readdir(project)).sort()).toEqual([
        '.gitignore',
        '.mcp.json'
      ])
    }
  )
})
