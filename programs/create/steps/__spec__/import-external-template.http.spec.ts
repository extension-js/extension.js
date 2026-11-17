import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  buildExamplesArchive,
  fixtureExtensionFiles
} from '../../__spec__/examples-catalog-fixture'
import {
  fetchFrom,
  type LoopbackReply,
  type LoopbackServer,
  serveLoopback,
  zipOf
} from '../../__spec__/loopback-template-server'
import {
  InsecureTemplateUrlError,
  importExternalTemplate,
  refuseHttpRedirect,
  type TemplateClone,
  type TemplateFetch
} from '../import-external-template'

const noopLogger = {log: () => {}, error: () => {}}
const templateZip = zipOf({'manifest.json': '{"manifest_version":3}'})

// Stand-ins that answer nothing, for the cases that must never ask.
function unusedTransport() {
  return {
    fetch: vi.fn<TemplateFetch>(async () => {
      throw new Error('the import asked for a download')
    }),
    clone: vi.fn<TemplateClone>(async () => {
      throw new Error('the import asked for a clone')
    })
  }
}

describe('importExternalTemplate refuses plain HTTP template URLs', () => {
  const savedEnv = {
    EXTENSION_ALLOW_HTTP_TEMPLATE: process.env.EXTENSION_ALLOW_HTTP_TEMPLATE,
    EXTENSION_CREATE_TEMPLATE_URL: process.env.EXTENSION_CREATE_TEMPLATE_URL
  }
  const tempDirs: string[] = []
  const servers: LoopbackServer[] = []

  beforeEach(() => {
    delete process.env.EXTENSION_ALLOW_HTTP_TEMPLATE
    delete process.env.EXTENSION_CREATE_TEMPLATE_URL
  })

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

  async function makeProjectPath() {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-http-'))
    tempDirs.push(tmpRoot)

    return path.join(tmpRoot, 'my-ext')
  }

  async function serving(routes: Record<string, LoopbackReply>) {
    const server = await serveLoopback(routes)
    servers.push(server)

    return server
  }

  it.each([
    'http://example.com/template.zip',
    'HTTP://example.com/template.zip',
    'http://github.com/extension-js/templates/tree/main/examples/content'
  ])('refuses %s before any network request', async (url) => {
    const projectPath = await makeProjectPath()
    const transport = unusedTransport()

    const error = (await importExternalTemplate(
      projectPath,
      'my-ext',
      url,
      noopLogger,
      {ownsProjectDir: true, ...transport}
    ).catch((thrown: Error) => thrown)) as Error

    expect(error).toBeInstanceOf(InsecureTemplateUrlError)
    expect(transport.fetch).not.toHaveBeenCalled()
    expect(transport.clone).not.toHaveBeenCalled()
    expect(fs.existsSync(projectPath)).toBe(false)
    expect(error.message).toContain('plain HTTP')
    expect(error.message).toContain('EXTENSION_ALLOW_HTTP_TEMPLATE=true')
  })

  it('scaffolds from a plain http ZIP URL when EXTENSION_ALLOW_HTTP_TEMPLATE=true', async () => {
    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
    const server = await serving({'/template.zip': {body: templateZip}})
    const projectPath = await makeProjectPath()
    const url = server.url('/template.zip')

    const provenance = await importExternalTemplate(
      projectPath,
      'my-ext',
      url,
      noopLogger,
      {ownsProjectDir: true}
    )

    expect(provenance).toEqual({template: 'template.zip', source: url})
    expect(server.hits('/template.zip')).toBe(1)
    expect(
      await fsp.readFile(path.join(projectPath, 'manifest.json'), 'utf8')
    ).toBe('{"manifest_version":3}')
  })

  it('follows a redirect to plain http when EXTENSION_ALLOW_HTTP_TEMPLATE=true', async () => {
    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
    const server = await serving({
      '/template.zip': {redirectTo: '/moved.zip'},
      '/moved.zip': {body: templateZip}
    })
    const projectPath = await makeProjectPath()

    await importExternalTemplate(
      projectPath,
      'my-ext',
      server.url('/template.zip'),
      noopLogger,
      {ownsProjectDir: true}
    )

    expect(server.hits('/moved.zip')).toBe(1)
    expect(fs.existsSync(path.join(projectPath, 'manifest.json'))).toBe(true)
  })

  // The import is given an https URL, and the loopback server that answers
  // for it redirects to plain http, where a whole archive is waiting.
  async function httpsUrlRedirectingToHttp() {
    const server = await serving({
      '/template.zip': {redirectTo: '/moved.zip'},
      '/moved.zip': {body: templateZip}
    })
    const projectPath = await makeProjectPath()

    const error = (await importExternalTemplate(
      projectPath,
      'my-ext',
      'https://templates.test/template.zip',
      noopLogger,
      {ownsProjectDir: true, fetch: fetchFrom(server.url('/template.zip'))}
    ).catch((thrown: Error) => thrown)) as Error

    return {server, projectPath, error}
  }

  it('never requests the plain http target an https ZIP URL redirects to', async () => {
    const {server, projectPath, error} = await httpsUrlRedirectingToHttp()

    expect(error).toBeInstanceOf(InsecureTemplateUrlError)
    expect(server.hits('/template.zip')).toBe(1)
    expect(server.hits('/moved.zip')).toBe(0)
    expect(fs.existsSync(projectPath)).toBe(false)
  })

  it('names the redirect target in the refusal', async () => {
    const {server, projectPath, error} = await httpsUrlRedirectingToHttp()
    const frame = stripVTControlCharacters(error.message)

    expect(error).toBeInstanceOf(InsecureTemplateUrlError)
    expect((error as InsecureTemplateUrlError).url).toBe(
      server.url('/moved.zip')
    )

    expect(frame).toContain(server.url('/moved.zip'))
    expect(frame).toContain('plain HTTP')
    expect(fs.existsSync(projectPath)).toBe(false)
  })

  it('refuses an http EXTENSION_CREATE_TEMPLATE_URL without the offline fallback', async () => {
    process.env.EXTENSION_CREATE_TEMPLATE_URL =
      'http://mirror.example.com/x.zip'

    const projectPath = await makeProjectPath()
    const transport = unusedTransport()

    const error = (await importExternalTemplate(
      projectPath,
      'my-ext',
      'typescript',
      noopLogger,
      {ownsProjectDir: true, allowOfflineFallback: true, ...transport}
    ).catch((thrown: Error) => thrown)) as Error

    expect(error).toBeInstanceOf(InsecureTemplateUrlError)
    expect(transport.fetch).not.toHaveBeenCalled()
    expect(error.message).toContain('http://mirror.example.com/x.zip')
    expect(fs.existsSync(projectPath)).toBe(false)
  })

  it('stops a catalog download that redirects to http, with no retry or fallback', async () => {
    const server = await serving({
      '/catalog.zip': {redirectTo: '/moved.zip'},
      '/moved.zip': {
        body: buildExamplesArchive({
          typescript: fixtureExtensionFiles('typescript')
        })
      }
    })
    const projectPath = await makeProjectPath()
    const fetch = vi.fn(fetchFrom(server.url('/catalog.zip')))
    const waits: number[] = []

    const error = (await importExternalTemplate(
      projectPath,
      'my-ext',
      'typescript',
      noopLogger,
      {
        ownsProjectDir: true,
        allowOfflineFallback: true,
        fetch,
        downloadRetry: {
          sleep: async (ms) => {
            waits.push(ms)
          }
        }
      }
    ).catch((thrown: Error) => thrown)) as Error

    expect(error).toBeInstanceOf(InsecureTemplateUrlError)
    expect((error as InsecureTemplateUrlError).url).toBe(
      server.url('/moved.zip')
    )

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toContain('https://codeload.github.com/')
    expect(waits).toEqual([])
    expect(server.hits('/moved.zip')).toBe(0)
    expect(fs.existsSync(projectPath)).toBe(false)
  })

  it('lets an https redirect through and holds an http one', () => {
    expect(() =>
      refuseHttpRedirect({
        protocol: 'https:',
        href: 'https://cdn.example/t.zip'
      })
    ).not.toThrow()

    expect(() =>
      refuseHttpRedirect({protocol: 'http:', href: 'http://cdn.example/t.zip'})
    ).toThrow(InsecureTemplateUrlError)

    expect(() => refuseHttpRedirect({protocol: 'http:'})).toThrow(
      InsecureTemplateUrlError
    )

    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
    expect(() =>
      refuseHttpRedirect({protocol: 'http:', href: 'http://cdn.example/t.zip'})
    ).not.toThrow()
  })
})
