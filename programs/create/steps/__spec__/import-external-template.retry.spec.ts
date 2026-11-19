import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as http from 'node:http'
import type {AddressInfo} from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {
  buildExamplesArchive,
  fixtureExtensionFiles
} from '../../__spec__/examples-catalog-fixture'
import {
  type DownloadRetryOptions,
  type ImportExternalTemplateOptions,
  importExternalTemplate,
  type TemplateClone,
  type TemplateFetch
} from '../import-external-template'

// One scripted reply per request, in order. `hang` accepts the request and
// never answers it, which is what a silent server looks like to the client.
type Reply = number | 'archive' | 'hang'

interface ScriptedCatalog {
  url: string
  hits(): number
  close(): Promise<void>
}

const archive = buildExamplesArchive({
  content: fixtureExtensionFiles('content')
})

async function serveReplies(replies: Reply[]): Promise<ScriptedCatalog> {
  let hits = 0
  const server = http.createServer((_request, response) => {
    const reply = replies[hits++] ?? 500

    if (reply === 'hang') return

    if (reply === 'archive') {
      response.writeHead(200, {'content-type': 'application/zip'})
      response.end(archive)

      return
    }

    response.writeHead(reply, {'content-type': 'text/plain'})
    response.end(`scripted ${reply}`)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const {port} = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}/examples.zip`,
    hits: () => hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

function makeLogger() {
  const lines: string[] = []

  const record = (...args: unknown[]) => {
    lines.push(stripVTControlCharacters(args.map(String).join(' ')))
  }

  return {lines, log: record, error: record}
}

// Records every wait the retry asks for and returns at once.
function recordingSleep() {
  const waits: number[] = []
  const retry: DownloadRetryOptions = {
    sleep: async (ms) => {
      waits.push(ms)
    }
  }

  return {waits, retry}
}

type Failure = Error & {
  cause?: Error & {code?: string; response?: {status?: number}}
}

describe('the template catalog download', () => {
  const savedEnv = {
    EXTENSION_ENV: process.env.EXTENSION_ENV,
    EXTENSION_ALLOW_HTTP_TEMPLATE: process.env.EXTENSION_ALLOW_HTTP_TEMPLATE,
    EXTENSION_CREATE_TEMPLATE_URL: process.env.EXTENSION_CREATE_TEMPLATE_URL,
    EXTENSION_CREATE_TIMEOUT_MS: process.env.EXTENSION_CREATE_TIMEOUT_MS
  }
  const catalogs: ScriptedCatalog[] = []
  let workDir: string
  let projectPath: string

  beforeEach(async () => {
    process.env.EXTENSION_ENV = 'test'
    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
    delete process.env.EXTENSION_CREATE_TEMPLATE_URL
    delete process.env.EXTENSION_CREATE_TIMEOUT_MS
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-retry-'))
    projectPath = path.join(workDir, 'my-ext')
  })

  afterEach(async () => {
    vi.useRealTimers()

    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }

    for (const catalog of catalogs.splice(0)) await catalog.close()

    await fsp.rm(workDir, {recursive: true, force: true})
  })

  // The override points the catalog fetch at the scripted loopback server.
  async function catalogAnswering(replies: Reply[]) {
    const catalog = await serveReplies(replies)
    catalogs.push(catalog)
    process.env.EXTENSION_CREATE_TEMPLATE_URL = catalog.url

    return catalog
  }

  function importing(
    template: string,
    options: ImportExternalTemplateOptions = {},
    logger = makeLogger()
  ) {
    return importExternalTemplate(projectPath, 'my-ext', template, logger, {
      ownsProjectDir: true,
      ...options
    })
  }

  async function failing(
    template: string,
    options: ImportExternalTemplateOptions = {},
    logger = makeLogger()
  ): Promise<Failure> {
    return importing(template, options, logger).then(
      () => new Error('the import was expected to fail and did not') as Failure,
      (thrown: Failure) => thrown
    )
  }

  describe('retry policy', () => {
    it('scaffolds after exactly one retry when a 503 is followed by a 200', async () => {
      const catalog = await catalogAnswering([503, 'archive'])
      const {waits, retry} = recordingSleep()

      const provenance = await importing('content', {downloadRetry: retry})

      expect(catalog.hits()).toBe(2)
      expect(waits).toEqual([400])
      expect(provenance).toEqual({template: 'content', source: catalog.url})
      expect(fs.existsSync(path.join(projectPath, 'src/manifest.json'))).toBe(
        true
      )
    })

    it('retries a 429', async () => {
      const catalog = await catalogAnswering([429, 'archive'])
      const {waits, retry} = recordingSleep()

      const provenance = await importing('content', {downloadRetry: retry})

      expect(catalog.hits()).toBe(2)
      expect(waits).toHaveLength(1)
      expect(provenance.source).toBe(catalog.url)
    })

    it('retries a connection that is refused', async () => {
      const catalog = await catalogAnswering([])
      await catalog.close()
      const {waits, retry} = recordingSleep()

      const error = await failing('content', {downloadRetry: retry})

      expect(waits).toHaveLength(1)
      expect(error.name).toBe('TemplateDownloadError')
      expect(error.cause?.code).toBe('ECONNREFUSED')
    })

    it('does not retry a 404', async () => {
      const catalog = await catalogAnswering([404, 'archive'])
      const {waits, retry} = recordingSleep()

      const error = await failing('content', {downloadRetry: retry})

      expect(catalog.hits()).toBe(1)
      expect(waits).toEqual([])
      expect(error.name).toBe('TemplateDownloadError')
      expect(error.cause?.response?.status).toBe(404)
      expect(fs.existsSync(projectPath)).toBe(false)
    })

    it('stops at the default attempt count and reports the last error', async () => {
      const catalog = await catalogAnswering([500, 502, 'archive'])
      const {waits, retry} = recordingSleep()

      const error = await failing('content', {downloadRetry: retry})

      expect(catalog.hits()).toBe(2)
      expect(waits).toEqual([400])
      expect(error.name).toBe('TemplateDownloadError')
      expect(error.cause?.response?.status).toBe(502)
      expect(stripVTControlCharacters(error.message)).toContain(
        'REASON Request failed with status code 502'
      )
    })

    it('waits through the default sleep when none is injected', async () => {
      const catalog = await catalogAnswering([503, 'archive'])

      const provenance = await importing('content', {
        downloadRetry: {backoffMs: 1}
      })

      expect(catalog.hits()).toBe(2)
      expect(provenance.source).toBe(catalog.url)
    })
  })

  describe('fetch budget', () => {
    // The injected sleep moves the clock past the deadline, so the budget is
    // spent between attempts without a real wait.
    function sleepPastTheBudget(): DownloadRetryOptions {
      vi.useFakeTimers({toFake: ['Date']})

      return {
        sleep: async () => {
          vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
        }
      }
    }

    it('fails with the budget message when the budget runs out between attempts', async () => {
      const catalog = await catalogAnswering([503, 'archive'])

      const error = await failing('content', {
        downloadRetry: sleepPastTheBudget()
      })

      expect(catalog.hits()).toBe(1)
      expect(error.name).toBe('TemplateDownloadError')
      expect(error.cause?.message).toBe(
        'No answer within 60 seconds (EXTENSION_CREATE_TIMEOUT_MS)'
      )
    })

    it('fails inside the budget when the catalog never answers', async () => {
      process.env.EXTENSION_CREATE_TIMEOUT_MS = '80'
      const catalog = await catalogAnswering(['hang', 'archive'])
      const {waits, retry} = recordingSleep()
      const startedAt = Date.now()

      const error = await failing('content', {downloadRetry: retry})

      expect(Date.now() - startedAt).toBeLessThan(2_000)
      expect(catalog.hits()).toBe(1)
      expect(waits).toEqual([])
      expect(error.name).toBe('TemplateDownloadError')
      // A budget under a second reads in milliseconds, never "0 seconds".
      expect(error.cause?.message).toBe(
        'No answer within 80 ms (EXTENSION_CREATE_TIMEOUT_MS)'
      )
    })

    it('reads a one second budget in the singular', async () => {
      process.env.EXTENSION_CREATE_TIMEOUT_MS = '1000'
      await catalogAnswering([503, 'archive'])

      const error = await failing('content', {
        downloadRetry: sleepPastTheBudget()
      })

      expect(error.cause?.message).toBe(
        'No answer within 1 second (EXTENSION_CREATE_TIMEOUT_MS)'
      )
    })

    it('fails inside the budget when a ZIP URL never answers', async () => {
      process.env.EXTENSION_CREATE_TIMEOUT_MS = '80'
      const catalog = await serveReplies(['hang'])
      catalogs.push(catalog)
      const startedAt = Date.now()

      const error = await failing(catalog.url)
      const frame = stripVTControlCharacters(error.message)

      expect(Date.now() - startedAt).toBeLessThan(2_000)
      expect(catalog.hits()).toBe(1)
      expect(error.name).toBe('TemplateDownloadError')
      expect(frame).toContain("Couldn't fetch the template from that URL.")
      expect(frame).toContain(`URL ${catalog.url}`)
      expect(frame).toContain(
        'REASON No answer within 80 ms (EXTENSION_CREATE_TIMEOUT_MS)'
      )
    })

    it('reads the timeout when the fetch starts, not when the module loads', async () => {
      process.env.EXTENSION_CREATE_TIMEOUT_MS = '5000'
      await catalogAnswering([503, 'archive'])

      const error = await failing('content', {
        downloadRetry: sleepPastTheBudget()
      })

      expect(error.cause?.message).toBe(
        'No answer within 5 seconds (EXTENSION_CREATE_TIMEOUT_MS)'
      )
    })
  })

  describe('ZIP URL', () => {
    async function zipUrlAnswering(replies: Reply[]) {
      const server = await serveReplies(replies)
      catalogs.push(server)

      return server
    }

    it('retries a 503 once, the way the catalog download does', async () => {
      const server = await zipUrlAnswering([503, 'archive'])
      const {waits, retry} = recordingSleep()

      const provenance = await importing(server.url, {downloadRetry: retry})

      expect(server.hits()).toBe(2)
      expect(waits).toEqual([400])
      expect(provenance.source).toBe(server.url)
    })

    it('does not retry a 404', async () => {
      const server = await zipUrlAnswering([404, 'archive'])
      const {waits, retry} = recordingSleep()

      const error = await failing(server.url, {downloadRetry: retry})

      expect(server.hits()).toBe(1)
      expect(waits).toEqual([])
      expect(error.name).toBe('TemplateDownloadError')
      expect(error.cause?.response?.status).toBe(404)
    })

    it('aborts the request when the budget runs out', async () => {
      process.env.EXTENSION_CREATE_TIMEOUT_MS = '80'
      const signals: Array<AbortSignal | undefined> = []

      const fetch: TemplateFetch = (_url, config) => {
        signals.push(config.signal as AbortSignal | undefined)

        return new Promise(() => {})
      }

      const error = await failing('https://example.test/template.zip', {
        fetch
      })

      expect(error.name).toBe('TemplateDownloadError')
      expect(error.cause?.message).toBe(
        'No answer within 80 ms (EXTENSION_CREATE_TIMEOUT_MS)'
      )

      // The socket goes with the budget, it does not live on behind it.
      expect(signals).toHaveLength(1)
      expect(signals[0]?.aborted).toBe(true)
    })
  })

  describe('GitHub clone', () => {
    it('yields the timeout frame when the clone exceeds the timeout', async () => {
      const url =
        'https://github.com/extension-js/templates/tree/main/examples/content'

      let cloneSignal: AbortSignal | undefined

      const clone = vi.fn<TemplateClone>((_url, _dest, _message, signal) => {
        cloneSignal = signal

        return new Promise<void>(() => {})
      })

      vi.useFakeTimers()

      const outcome = failing(url, {clone})
      await vi.waitFor(() => expect(clone).toHaveBeenCalledTimes(1))
      expect(cloneSignal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(60_000)
      const error = await outcome

      // The clone is told to stop, so whatever it started can be ended.
      expect(cloneSignal?.aborted).toBe(true)

      const frame = stripVTControlCharacters(error.message)

      expect(error.name).toBe('TemplateDownloadError')
      expect(error.cause?.message).toBe(
        'No answer within 60 seconds (EXTENSION_CREATE_TIMEOUT_MS)'
      )

      // One frame: the REASON row is the cause, never a second frame.
      expect(frame.match(/⏵⏵⏵/g)).toHaveLength(1)
      expect(frame).toContain("Couldn't fetch the template from that URL.")
      expect(frame).toContain(`URL ${url}`)
      expect(frame).toContain(
        'REASON No answer within 60 seconds (EXTENSION_CREATE_TIMEOUT_MS)\n'
      )

      expect(fs.existsSync(projectPath)).toBe(false)
    })
  })

  describe('catalog override', () => {
    it('names the override and never falls back to the default catalog', async () => {
      const catalog = await catalogAnswering([404])
      const {retry} = recordingSleep()
      const logger = makeLogger()

      const error = await failing(
        'typescript',
        {allowOfflineFallback: true, downloadRetry: retry},
        logger
      )
      const frame = stripVTControlCharacters(error.message)

      expect(error.name).toBe('TemplateDownloadError')
      expect(frame).toContain(
        "Couldn't fetch the template catalog from EXTENSION_CREATE_TEMPLATE_URL."
      )

      expect(frame).toContain(`URL ${catalog.url}`)
      expect(frame).toContain('REASON Request failed with status code 404')
      expect(frame).not.toContain('github.com/extension-js/templates')
      expect(catalog.hits()).toBe(1)
      expect(logger.lines).toEqual([])
      expect(fs.existsSync(projectPath)).toBe(false)
    })
  })

  describe('production defaults', () => {
    it('makes two attempts with a 400 ms wait between them', async () => {
      const catalog = await catalogAnswering([503, 503, 503, 503])
      const {waits, retry} = recordingSleep()

      await failing('content', {downloadRetry: retry})

      expect(catalog.hits()).toBe(2)
      expect(waits).toEqual([400])
    })

    it('grows the wait by 400 ms for each further attempt', async () => {
      const catalog = await catalogAnswering([503, 503, 503, 503])
      const {waits, retry} = recordingSleep()

      await failing('content', {downloadRetry: {...retry, attempts: 3}})

      expect(catalog.hits()).toBe(3)
      expect(waits).toEqual([400, 800])
    })

    it.each([
      ['unset', undefined],
      ['not a number', 'soon'],
      ['zero', '0'],
      ['negative', '-5']
    ])('allows 60 seconds when EXTENSION_CREATE_TIMEOUT_MS is %s', async (_label, value) => {
      if (value !== undefined) process.env.EXTENSION_CREATE_TIMEOUT_MS = value

      await catalogAnswering([503, 'archive'])
      vi.useFakeTimers({toFake: ['Date']})

      const error = await failing('content', {
        downloadRetry: {
          sleep: async () => {
            vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
          }
        }
      })

      expect(error.cause?.message).toBe(
        'No answer within 60 seconds (EXTENSION_CREATE_TIMEOUT_MS)'
      )
    })
  })
})
