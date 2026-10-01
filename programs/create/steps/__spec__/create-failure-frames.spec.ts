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

vi.mock('../../lib/install-runner', () => ({
  runInstall: vi.fn(async () => ({
    code: 1,
    stdout: '',
    stderr:
      'npm error code ECONNREFUSED\n' +
      'npm error     at ClientRequest.<anonymous> (minipass-fetch/lib/index.js:130:14)\n' +
      'npm error A complete log of this run can be found in: /tmp/debug-0.log\n'
  }))
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
import {installDependencies} from '../install-dependencies'
import {writeManifestJson} from '../write-manifest-json'

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
    expect(error.message).toContain(
      'is not in the extension-js/examples catalog'
    )

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

  // A real read-only parent, never a stubbed writability probe: the probe is
  // where the second frame came from, so stubbing it hid the whole defect.
  const itWritable = process.getuid?.() === 0 ? it.skip : it

  itWritable('for a destination inside a read-only parent', async () => {
    const logger = makeLogger()
    const parent = path.dirname(await makeProjectPath())
    await fsp.mkdir(parent, {recursive: true})
    await fsp.chmod(parent, 0o555)
    const projectPath = path.join(parent, 'proof')

    try {
      const error = (await createDirectory(projectPath, 'proof', logger).catch(
        (thrown: Error) => thrown
      )) as Error

      expect(error.message).toContain(
        "Couldn't write to the destination directory"
      )

      expect(error.message).toContain(projectPath)
      expect(error.message).toContain('EACCES')
      expectOneFrameAndNoStack(error, logger)
    } finally {
      await fsp.chmod(parent, 0o755)
    }
  })

  it('for a dependency install the package manager refuses', async () => {
    const logger = makeLogger()
    const projectPath = await makeProjectPath()
    await fsp.mkdir(projectPath, {recursive: true})
    await fsp.writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify({name: 'my-ext', devDependencies: {extension: '4.0.0'}})
    )

    const error = (await installDependencies(
      projectPath,
      'my-ext',
      logger,
      'npm'
    ).catch((thrown: Error) => thrown)) as Error

    expect(error.message).toContain("Couldn't install the dependencies")
    // The package manager's own cause, without the stack it re-throws.
    expect(error.message).toContain('ECONNREFUSED')
    expect(error.message).not.toContain('minipass-fetch')
    expectOneFrameAndNoStack(error, logger)
  })

  it('for a template that ships no manifest.json', async () => {
    const logger = makeLogger()
    const projectPath = await makeProjectPath()
    await fsp.mkdir(projectPath, {recursive: true})
    await fsp.writeFile(path.join(projectPath, 'package.json'), '{}\n')

    const error = (await writeManifestJson(projectPath, logger).catch(
      (thrown: Error) => thrown
    )) as Error

    expect(error.message).toContain("Couldn't read a manifest.json")
    expect(error.message).toContain(projectPath)
    expect(error.message).toContain('depth 3')
    expectOneFrameAndNoStack(error, logger)
  })

  it('for a manifest.json that cannot be parsed', async () => {
    const logger = makeLogger()
    const projectPath = await makeProjectPath()
    await fsp.mkdir(projectPath, {recursive: true})
    const manifestPath = path.join(projectPath, 'manifest.json')
    await fsp.writeFile(manifestPath, '{"manifest_version": 3,\n')

    const error = (await writeManifestJson(projectPath, logger).catch(
      (thrown: Error) => thrown
    )) as Error

    expect(error.message).toContain("Couldn't read a manifest.json")
    expect(error.message).toContain(manifestPath)
    expectOneFrameAndNoStack(error, logger)
  })
})
