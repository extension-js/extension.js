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

vi.mock('../../lib/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/utils')>()),
  isDirectoryWriteable: vi.fn(async () => false)
}))

import axios from 'axios'
import {hasChannelPrefix} from '../../lib/messaging'
import {createDirectory} from '../create-directory'
import {
  importExternalTemplate,
  InsecureTemplateUrlError,
  TemplateDownloadError,
  TemplateNotFoundError
} from '../import-external-template'

const GLYPH = '⏵⏵⏵'
const STACK_FRAME = /^\s+at /m
const emptyArchive = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.alloc(18)
])

const tmpRoots: string[] = []

function makeLogger() {
  const errors: string[] = []

  return {
    errors,
    log: () => {},
    error: (...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    }
  }
}

async function makeProjectPath() {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-frames-'))
  tmpRoots.push(tmpRoot)

  return path.join(tmpRoot, 'my-ext')
}

async function failingImport(template: string, logger = makeLogger()) {
  const error = (await importExternalTemplate(
    await makeProjectPath(),
    'my-ext',
    template,
    logger,
    {ownsProjectDir: true, allowOfflineFallback: false}
  ).catch((thrown: Error) => thrown)) as Error

  return {error, logger}
}

function expectOneFrameAndNoStack(error: Error, logger: {errors: string[]}) {
  expect(hasChannelPrefix(error.message)).toBe(true)
  expect(error.message.match(new RegExp(GLYPH, 'g'))).toHaveLength(1)
  expect(error.message).not.toMatch(STACK_FRAME)
  expect(logger.errors).toEqual([])
}

beforeEach(() => {
  delete process.env.EXTENSION_ALLOW_HTTP_TEMPLATE
  vi.mocked(axios.get).mockReset()
})

afterEach(async () => {
  for (const dir of tmpRoots.splice(0)) {
    await fsp.rm(dir, {recursive: true, force: true})
  }
})

describe('a create refusal travels as one framed message on the thrown error', () => {
  it('for a template name missing from the catalog', async () => {
    vi.mocked(axios.get).mockResolvedValue({data: emptyArchive, headers: {}})

    const {error, logger} = await failingImport('nope-xyz')

    expect(error).toBeInstanceOf(TemplateNotFoundError)
    expect(error.message).toContain('nope-xyz')
    expect(error.message).toContain('is not in the extension-js/examples catalog')
    expectOneFrameAndNoStack(error, logger)
  })

  it('for a catalog download that fails', async () => {
    vi.mocked(axios.get).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 404'), {
        response: {status: 404}
      })
    )

    const {error, logger} = await failingImport('react')

    expect(error).toBeInstanceOf(TemplateDownloadError)
    expect(error.message).toContain("Couldn't download the template")
    expect(error.message).toContain('status code 404')
    expectOneFrameAndNoStack(error, logger)
  })

  it('for a plain http template URL', async () => {
    const {error, logger} = await failingImport('http://example.com/t.zip')

    expect(error).toBeInstanceOf(InsecureTemplateUrlError)
    expect(error.message).toContain('plain HTTP')
    expectOneFrameAndNoStack(error, logger)
    expect(axios.get).not.toHaveBeenCalled()
  })

  it('for a destination that is not writeable', async () => {
    const logger = makeLogger()

    const error = (await createDirectory(
      await makeProjectPath(),
      'my-ext',
      logger
    ).catch((thrown: Error) => thrown)) as Error

    expect(error.message).toContain("Couldn't write to the destination directory")
    expectOneFrameAndNoStack(error, logger)
  })
})
