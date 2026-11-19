import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {strToU8, zipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
  type LoopbackServer,
  serveLoopback
} from '../../__spec__/loopback-template-server'
import {importExternalTemplate} from '../import-external-template'

// The one catalog template that committed lockfiles upstream. create adds the
// `extension` devDependency after the copy, so a copied lockfile breaks `npm ci`.
function makeCatalogZipWithLockfiles(): Buffer {
  const root = 'examples-main/examples/sidebar-monorepo-turborepo'

  return Buffer.from(
    zipSync({
      [`${root}/package.json`]: strToU8(
        '{"name":"sidebar-monorepo-turborepo"}'
      ),
      [`${root}/package-lock.json`]: strToU8(
        '{"lockfileVersion":3,"packages":{}}'
      ),
      [`${root}/pnpm-lock.yaml`]: strToU8('lockfileVersion: 9'),
      [`${root}/deno.lock`]: strToU8('{"version":"4"}'),
      [`${root}/packages/extension/src/manifest.json`]: strToU8(
        '{"manifest_version":3}'
      )
    })
  )
}

describe('importExternalTemplate strips upstream lockfiles', () => {
  const savedEnv = {
    EXTENSION_ENV: process.env.EXTENSION_ENV,
    EXTENSION_ALLOW_HTTP_TEMPLATE: process.env.EXTENSION_ALLOW_HTTP_TEMPLATE,
    EXTENSION_CREATE_TEMPLATE_URL: process.env.EXTENSION_CREATE_TEMPLATE_URL
  }
  const tempDirs: string[] = []
  const servers: LoopbackServer[] = []

  beforeEach(() => {
    process.env.EXTENSION_ENV = 'test'
    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
  })

  // The catalog override points the real download at a loopback archive.
  async function catalogServing(archive: Buffer) {
    const server = await serveLoopback({'/catalog.zip': {body: archive}})
    servers.push(server)
    process.env.EXTENSION_CREATE_TEMPLATE_URL = server.url('/catalog.zip')
  }

  afterEach(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }

    for (const server of servers.splice(0)) await server.close()

    while (tempDirs.length > 0) {
      await fsp.rm(tempDirs.pop()!, {recursive: true, force: true})
    }
  })

  it('a template that commits a lockfile upstream scaffolds without it', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-lock-'))
    tempDirs.push(tmpRoot)
    const projectPath = path.join(tmpRoot, 'my-ext')

    await catalogServing(makeCatalogZipWithLockfiles())

    const logs: string[] = []
    await importExternalTemplate(
      projectPath,
      'my-ext',
      'sidebar-monorepo-turborepo',
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

    await catalogServing(
      Buffer.from(
        zipSync({
          'examples-main/examples/react/package.json':
            strToU8('{"name":"react"}')
        })
      )
    )

    const logs: string[] = []
    await importExternalTemplate(projectPath, 'my-ext', 'react', {
      log: (...args: unknown[]) => logs.push(args.join(' ')),
      error: () => {}
    })

    expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(true)
    expect(logs.find((line) => line.includes('lock'))).toBeUndefined()
  })
})
