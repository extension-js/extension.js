import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {extensionCreate} from '../module'
import {
  type LoopbackReply,
  type LoopbackServer,
  serveLoopback,
  zipOf
} from './loopback-template-server'

const noopLogger = {log: () => {}, error: () => {}}

const manifest = JSON.stringify({
  name: 'Remote Created',
  version: '0.0.1',
  manifest_version: 3
})

// A whole create per case, which a loaded Windows runner stretches.
describe('create scaffolds from a ZIP template URL', {timeout: 30_000}, () => {
  const savedEnv = {
    EXTENSION_ENV: process.env.EXTENSION_ENV,
    EXTENSION_ALLOW_HTTP_TEMPLATE: process.env.EXTENSION_ALLOW_HTTP_TEMPLATE,
    EXTENSION_CREATE_TEMPLATE_URL: process.env.EXTENSION_CREATE_TEMPLATE_URL
  }
  let workDir = ''
  let server: LoopbackServer | undefined

  beforeEach(async () => {
    process.env.EXTENSION_ENV = 'test'
    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
    delete process.env.EXTENSION_CREATE_TEMPLATE_URL
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-zip-url-'))
  })

  afterEach(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }

    await server?.close()
    server = undefined
    await fsp.rm(workDir, {recursive: true, force: true})
  })

  async function serving(routes: Record<string, LoopbackReply>) {
    server = await serveLoopback(routes)

    return server
  }

  async function readManifest(file: string) {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  }

  it('scaffolds a manifest at the archive root and names it after the project', async () => {
    const served = await serving({
      '/template.zip': {body: zipOf({'manifest.json': manifest})}
    })
    const dest = path.join(workDir, 'my-remote-ext')
    const url = served.url('/template.zip')

    const result = await extensionCreate(dest, {
      template: url,
      logger: noopLogger
    })

    expect(result.template).toBe('template.zip')
    expect(result.templateProvenance).toEqual({
      template: 'template.zip',
      source: url
    })

    expect(served.hits('/template.zip')).toBe(1)

    const written = await readManifest(path.join(dest, 'manifest.json'))
    expect(written.name).toBe('my-remote-ext')
    expect(written.manifest_version).toBe(3)
  })

  it('keeps a nested manifest where the archive put it', async () => {
    const served = await serving({
      '/template.zip': {body: zipOf({'extension/manifest.json': manifest})}
    })
    const dest = path.join(workDir, 'my-remote-nested-ext')

    await extensionCreate(dest, {
      template: served.url('/template.zip'),
      logger: noopLogger
    })

    const nested = path.join(dest, 'extension', 'manifest.json')
    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(false)
    expect((await readManifest(nested)).name).toBe('my-remote-nested-ext')
  })

  it('unwraps a root folder named after the archive, as release zips are', async () => {
    const served = await serving({
      '/content-react.edge.zip': {
        body: zipOf({'content-react.edge/manifest.json': manifest})
      }
    })
    const dest = path.join(workDir, 'my-remote-browser-suffix-ext')

    await extensionCreate(dest, {
      template: served.url('/content-react.edge.zip'),
      logger: noopLogger
    })

    expect(
      (await readManifest(path.join(dest, 'manifest.json'))).manifest_version
    ).toBe(3)

    expect(fs.existsSync(path.join(dest, 'content-react.edge'))).toBe(false)
  })

  it('unwraps that folder when the URL carries a query string', async () => {
    const served = await serving({
      '/content-react.edge.zip?download=1': {
        body: zipOf({'content-react.edge/manifest.json': manifest})
      }
    })
    const dest = path.join(workDir, 'my-remote-query-ext')

    await extensionCreate(dest, {
      template: served.url('/content-react.edge.zip?download=1'),
      logger: noopLogger
    })

    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'content-react.edge'))).toBe(false)
  })

  it('refuses plain http unless the opt-in is set, and scaffolds nothing', async () => {
    delete process.env.EXTENSION_ALLOW_HTTP_TEMPLATE
    const served = await serving({
      '/template.zip': {body: zipOf({'manifest.json': manifest})}
    })
    const dest = path.join(workDir, 'my-refused-ext')

    const error = (await extensionCreate(dest, {
      template: served.url('/template.zip'),
      logger: noopLogger
    }).catch((thrown: Error) => thrown)) as Error

    expect(error.name).toBe('InsecureTemplateUrlError')
    expect(stripVTControlCharacters(error.message)).toContain('plain HTTP')
    expect(served.hits('/template.zip')).toBe(0)
    expect(fs.existsSync(dest)).toBe(false)
  })
})
