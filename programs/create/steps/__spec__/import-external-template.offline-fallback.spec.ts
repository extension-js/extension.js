import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {
  fetchFrom,
  refusedLoopbackUrl
} from '../../__spec__/loopback-template-server'
import {
  DEFAULT_TEMPLATE_NAME,
  importExternalTemplate,
  OFFLINE_FALLBACK_TEMPLATE,
  TemplateDownloadError
} from '../import-external-template'

// Skips the real backoff between the two attempts, which both still run.
const noWait = {sleep: async () => {}}

function makeLogger() {
  const lines: string[] = []

  return {
    lines,
    log: (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(' '))
    },
    error: (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(' '))
    }
  }
}

describe('the scaffold default template name', () => {
  it('stays pinned to typescript', () => {
    expect(DEFAULT_TEMPLATE_NAME).toBe('typescript')
  })
})

describe('the default template falls back to the bundled template when offline', () => {
  const prevEnv = process.env.EXTENSION_ENV
  let workDir: string

  // The pinned catalog is asked for, and the connection to it is refused.
  async function unreachableCatalog() {
    return vi.fn(fetchFrom(await refusedLoopbackUrl('/catalog.zip')))
  }

  beforeEach(async () => {
    process.env.EXTENSION_ENV = 'test'
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'offline-fallback-'))
  })

  afterEach(async () => {
    process.env.EXTENSION_ENV = prevEnv
    await fsp.rm(workDir, {recursive: true, force: true})
  })

  it('scaffolds the bundled template and names the network failure', async () => {
    const projectPath = path.join(workDir, 'my-extension')
    const logger = makeLogger()
    const fetch = await unreachableCatalog()

    const provenance = await importExternalTemplate(
      projectPath,
      'my-extension',
      'typescript',
      logger,
      {
        ownsProjectDir: true,
        allowOfflineFallback: true,
        downloadRetry: noWait,
        fetch
      }
    )

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(provenance.template).toBe(OFFLINE_FALLBACK_TEMPLATE)
    expect(provenance.source).toBe('bundled')
    expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(true)

    const output = logger.lines.join('\n')
    expect(output).toContain('typescript')
    expect(output).toContain('offline')
    expect(output).toContain('ECONNREFUSED')
  })

  it('refuses the bundled template when what the download left cannot be removed', async () => {
    const projectPath = path.join(workDir, 'stale-extension')
    const logger = makeLogger()
    const fetch = await unreachableCatalog()

    await fsp.mkdir(projectPath)
    await fsp.writeFile(path.join(projectPath, 'half-unpacked.js'), '')

    const error = (await importExternalTemplate(
      projectPath,
      'stale-extension',
      'typescript',
      logger,
      {
        ownsProjectDir: true,
        allowOfflineFallback: true,
        downloadRetry: noWait,
        fetch,
        remove: async () => {
          throw Object.assign(new Error('busy'), {code: 'EBUSY'})
        }
      }
    ).catch((thrown: Error) => thrown)) as Error & {cause?: {code?: string}}

    expect(error).toBeInstanceOf(TemplateDownloadError)
    expect(error.cause?.code).toBe('ECONNREFUSED')
    expect(error.message).toContain("Couldn't remove the new project files")
    expect(error.message).toContain(projectPath)
    expect(error.message).not.toContain('The new project files were removed')
    expect(fs.readdirSync(projectPath)).toEqual(['half-unpacked.js'])
    expect(logger.lines.join('\n')).not.toContain('offline')
  })

  it('fails loudly instead of swapping when the template is explicit', async () => {
    const projectPath = path.join(workDir, 'explicit-extension')
    const logger = makeLogger()
    const fetch = await unreachableCatalog()

    const error = (await importExternalTemplate(
      projectPath,
      'explicit-extension',
      'typescript',
      logger,
      {
        ownsProjectDir: true,
        allowOfflineFallback: false,
        downloadRetry: noWait,
        fetch
      }
    ).catch((thrown: Error) => thrown)) as Error & {cause?: {code?: string}}

    expect(error).toBeInstanceOf(TemplateDownloadError)
    expect(error.cause?.code).toBe('ECONNREFUSED')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fs.existsSync(projectPath)).toBe(false)
    expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(false)
  })
})

describe('an offline machine falls back at once', () => {
  const prevEnv = {
    EXTENSION_ENV: process.env.EXTENSION_ENV,
    EXTENSION_CREATE_TEMPLATE_REF: process.env.EXTENSION_CREATE_TEMPLATE_REF
  }
  let workDir: string

  beforeEach(async () => {
    process.env.EXTENSION_ENV = 'test'
    // A branch name resolves to two archive URLs, the branch then the tag.
    process.env.EXTENSION_CREATE_TEMPLATE_REF = 'main'
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'offline-at-once-'))
  })

  afterEach(async () => {
    for (const [name, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }

    await fsp.rm(workDir, {recursive: true, force: true})
  })

  // What axios rejects with when the request never left this machine: a
  // system error code and no response.
  function failingWith(code: string) {
    return vi.fn(async () => {
      throw Object.assign(
        new Error(`getaddrinfo ${code} codeload.github.com`),
        {
          code
        }
      )
    })
  }

  function scaffold(fetch: ReturnType<typeof failingWith>, waits: number[]) {
    return importExternalTemplate(
      path.join(workDir, 'my-extension'),
      'my-extension',
      'typescript',
      makeLogger(),
      {
        ownsProjectDir: true,
        allowOfflineFallback: true,
        downloadRetry: {
          sleep: async (ms) => {
            waits.push(ms)
          }
        },
        fetch
      }
    )
  }

  it.each([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENETUNREACH',
    'ENETDOWN',
    'EHOSTUNREACH'
  ])('asks once and never waits when the request fails with %s', async (code) => {
    const fetch = failingWith(code)
    const waits: number[] = []

    const provenance = await scaffold(fetch, waits)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(waits).toEqual([])
    expect(provenance).toEqual({
      template: OFFLINE_FALLBACK_TEMPLATE,
      source: 'bundled'
    })
  })

  // A dropped connection reached the server, so the network is up and one
  // more attempt is worth its wait.
  it('still retries a connection that was reset', async () => {
    const fetch = failingWith('ECONNRESET')
    const waits: number[] = []

    const provenance = await scaffold(fetch, waits)

    expect(waits).toEqual([400, 400])
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(provenance.source).toBe('bundled')
  })
})
