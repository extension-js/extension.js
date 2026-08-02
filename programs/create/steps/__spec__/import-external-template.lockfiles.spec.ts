import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import AdmZip from 'adm-zip'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('go-git-it', () => ({default: vi.fn(async () => {})}))
vi.mock('axios', () => ({
  default: {
    get: vi.fn(async () => {
      throw new Error('no response configured for this test')
    })
  }
}))

import axios from 'axios'
import {importExternalTemplate} from '../import-external-template'

// The sidebar-monorepo-turbopack shape from BUGS_TO_FIX 123: the one catalog
// template that committed a package-lock.json upstream. create injects the
// `extension` devDependency after the copy, so a copied lockfile can only be
// stale and `npm ci` fails on Missing: extension@<version> from lock file.
function makeCatalogZipWithLockfiles(): Buffer {
  const zip = new AdmZip()
  zip.addFile(
    'examples-main/examples/sidebar-monorepo-turbopack/package.json',
    Buffer.from('{"name":"sidebar-monorepo-turbopack"}')
  )
  zip.addFile(
    'examples-main/examples/sidebar-monorepo-turbopack/package-lock.json',
    Buffer.from('{"lockfileVersion":3,"packages":{}}')
  )
  zip.addFile(
    'examples-main/examples/sidebar-monorepo-turbopack/pnpm-lock.yaml',
    Buffer.from('lockfileVersion: 9')
  )
  zip.addFile(
    'examples-main/examples/sidebar-monorepo-turbopack/deno.lock',
    Buffer.from('{"version":"4"}')
  )
  zip.addFile(
    'examples-main/examples/sidebar-monorepo-turbopack/packages/extension/src/manifest.json',
    Buffer.from('{"manifest_version":3}')
  )
  return zip.toBuffer()
}

describe('importExternalTemplate strips upstream lockfiles (BUGS_TO_FIX 123)', () => {
  const prevEnv = process.env.EXTENSION_ENV
  const tempDirs: string[] = []

  beforeEach(() => {
    process.env.EXTENSION_ENV = 'test'
    vi.mocked(axios.get).mockReset()
  })

  afterEach(async () => {
    process.env.EXTENSION_ENV = prevEnv
    while (tempDirs.length > 0) {
      await fsp.rm(tempDirs.pop()!, {recursive: true, force: true})
    }
  })

  it('a template that commits a lockfile upstream scaffolds without it', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-lock-'))
    tempDirs.push(tmpRoot)
    const projectPath = path.join(tmpRoot, 'my-ext')

    vi.mocked(axios.get).mockResolvedValue({
      data: makeCatalogZipWithLockfiles(),
      headers: {'content-type': 'application/zip'}
    } as never)

    const logs: string[] = []
    await importExternalTemplate(
      projectPath,
      'my-ext',
      'sidebar-monorepo-turbopack',
      {log: (...args: unknown[]) => logs.push(args.join(' ')), error: () => {}}
    )

    // The project files survive, the root lockfiles do not.
    expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(true)
    expect(
      fs.existsSync(
        path.join(projectPath, 'packages', 'extension', 'src', 'manifest.json')
      )
    ).toBe(true)
    expect(fs.existsSync(path.join(projectPath, 'package-lock.json'))).toBe(
      false
    )
    expect(fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))).toBe(false)
    expect(fs.existsSync(path.join(projectPath, 'deno.lock'))).toBe(false)

    // One notice names what was dropped, so the removal is never silent.
    const notice = logs.find((line) => line.includes('package-lock.json'))
    expect(notice).toBeDefined()
    expect(notice).toContain('pnpm-lock.yaml')
    expect(notice).toContain('deno.lock')
  })

  it('prints no lockfile notice when the template ships none', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-lock-'))
    tempDirs.push(tmpRoot)
    const projectPath = path.join(tmpRoot, 'my-ext')

    const zip = new AdmZip()
    zip.addFile(
      'examples-main/examples/react/package.json',
      Buffer.from('{"name":"react"}')
    )
    vi.mocked(axios.get).mockResolvedValue({
      data: zip.toBuffer(),
      headers: {'content-type': 'application/zip'}
    } as never)

    const logs: string[] = []
    await importExternalTemplate(projectPath, 'my-ext', 'react', {
      log: (...args: unknown[]) => logs.push(args.join(' ')),
      error: () => {}
    })

    expect(logs.find((line) => line.includes('lock'))).toBeUndefined()
  })
})
