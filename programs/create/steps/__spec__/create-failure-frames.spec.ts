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
import goGitIt from 'go-git-it'
import {hasChannelPrefix} from '../../lib/messaging'
import {createDirectory} from '../create-directory'
import {
  InsecureTemplateUrlError,
  importExternalTemplate,
  TemplateArchiveDamagedError,
  TemplateDownloadError,
  TemplateNotFoundError,
  TemplateNotZipError
} from '../import-external-template'
import {installDependencies} from '../install-dependencies'
import {writeManifestJson} from '../write-manifest-json'

const GLYPH = '⏵⏵⏵'
const STACK_FRAME = /^\s+at /m
const emptyArchive = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.alloc(18)
])

// The signature of a ZIP over a body that is not one: the first bytes pass
// and the unzip is the first thing to notice.
const damagedArchive = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('cut short on the way down '.repeat(8))
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
  delete process.env.EXTENSION_CREATE_TEMPLATE_URL
  vi.mocked(axios.get).mockReset()
  vi.mocked(goGitIt).mockReset()
})

afterEach(async () => {
  delete process.env.EXTENSION_CREATE_TEMPLATE_URL

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

  // The fourth path: a URL is neither a catalog slug nor a catalog download,
  // so an untyped throw here reached the sink that prints a stack. The spawned
  // git reports its own failure with frames pointing inside node_modules.
  it('for a GitHub template URL that cannot be fetched', async () => {
    vi.mocked(goGitIt).mockRejectedValueOnce(
      Object.assign(
        new Error(
          'Failed to download partial repository: Git command failed\n' +
            'remote: Repository not found.\n' +
            "fatal: repository 'https://github.com/extension-js/exampels/' not found\n"
        ),
        {
          stack:
            'Error: Repository not found\n' +
            '    at downloadPartialRepository (/x/node_modules/go-git-it/dist/index.cjs:372:15)\n'
        }
      )
    )

    const {error, logger} = await failingImport(
      'https://github.com/extension-js/exampels/tree/main/examples/react'
    )

    expect(error).toBeInstanceOf(TemplateDownloadError)
    expect(error.message).toContain(
      'https://github.com/extension-js/exampels/tree/main/examples/react'
    )

    expect(error.message).toContain('Repository not found')
    expect(error.message).not.toContain('node_modules')
    expectOneFrameAndNoStack(error, logger)
  })

  it('for a ZIP template URL that answers with something else', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: Buffer.from('<html>not found</html>'),
      headers: {'content-type': 'text/html'}
    })

    const {error, logger} = await failingImport(
      'https://example.com/templates/mine'
    )

    expect(error).toBeInstanceOf(TemplateNotZipError)
    expect(error.message).toContain("doesn't point to a ZIP archive")
    expect(error.message).toContain('URL https://example.com/templates/mine')
    expect(error.message).toContain('GOT text/html')
    expectOneFrameAndNoStack(error, logger)
  })

  // The name and the header both said ZIP, so the unzip was the first thing
  // to notice, and its "invalid zip data" reached the sink with a stack.
  it.each([
    [
      'a page behind a .zip name',
      'https://example.com/t.zip',
      {
        data: Buffer.from('<!doctype html><html><body>Sign in</body></html>'),
        headers: {'content-type': 'text/html; charset=utf-8'}
      },
      'GOT text/html; charset=utf-8'
    ],
    [
      'an empty body sent as a ZIP',
      'https://example.com/download',
      {data: Buffer.alloc(0), headers: {'content-type': 'application/zip'}},
      'GOT application/zip with an empty body'
    ],
    [
      'bytes that are not an archive sent as one',
      'https://example.com/t.zip',
      {
        data: Buffer.from('not an archive'),
        headers: {'content-type': 'application/octet-stream'}
      },
      'GOT application/octet-stream that is not ZIP data'
    ]
  ])('for a ZIP template URL that answers with %s', async (_label, url, response, got) => {
    vi.mocked(axios.get).mockResolvedValue(response)

    const {error, logger} = await failingImport(url)

    expect(error).toBeInstanceOf(TemplateNotZipError)
    expect(error).not.toBeInstanceOf(TemplateDownloadError)
    expect(error.message).toContain("doesn't point to a ZIP archive")
    expect(error.message).toContain(`URL ${url}`)
    expect(error.message).toContain(got)
    expect(error.message).not.toContain('invalid zip data')
    expectOneFrameAndNoStack(error, logger)
  })

  // The catalog override is a URL someone typed as well, and its reply went
  // to the unzip with no test at all.
  it('for a catalog override URL that answers with a page', async () => {
    process.env.EXTENSION_CREATE_TEMPLATE_URL =
      'https://example.com/catalog.zip'

    vi.mocked(axios.get).mockResolvedValue({
      data: Buffer.from('<!doctype html><html><body>Sign in</body></html>'),
      headers: {'content-type': 'text/html; charset=utf-8'}
    })

    const {error, logger} = await failingImport('react')

    expect(error).toBeInstanceOf(TemplateNotZipError)
    expect(error.message).toContain("doesn't point to a ZIP archive")
    expect(error.message).toContain('URL https://example.com/catalog.zip')
    expect(error.message).toContain('GOT text/html; charset=utf-8')
    expect(error.message).not.toContain('invalid zip data')
    expectOneFrameAndNoStack(error, logger)
  })

  it.each([
    ['a template URL', 'https://example.com/t.zip', undefined],
    ['a catalog override URL', 'react', 'https://example.com/catalog.zip']
  ])('for %s whose archive is damaged', async (_label, template, override) => {
    if (override) process.env.EXTENSION_CREATE_TEMPLATE_URL = override

    vi.mocked(axios.get).mockResolvedValue({
      data: damagedArchive,
      headers: {'content-type': 'application/zip'}
    })

    const {error, logger} = await failingImport(template)

    expect(error).toBeInstanceOf(TemplateArchiveDamagedError)
    expect(error).not.toBeInstanceOf(TemplateDownloadError)
    expect(error.message).toContain(
      'The ZIP archive at the remote URL is damaged.'
    )

    expect(error.message).toContain(`URL ${override ?? template}`)
    expect(error.message).toContain('REASON invalid zip data')
    expectOneFrameAndNoStack(error, logger)
  })

  it('for a template URL the connection to which is refused', async () => {
    vi.mocked(axios.get).mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
        code: 'ECONNREFUSED'
      })
    )

    const {error, logger} = await failingImport('https://127.0.0.1:1/t.zip')

    expect(error).toBeInstanceOf(TemplateDownloadError)
    expect(error.message).toContain("Couldn't fetch the template from that URL")
    expect(error.message).toContain('ECONNREFUSED')
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
  // Only a non-root posix user can deny writes this way. chmod does not make a
  // directory read-only on Windows, and root ignores the mode, so the condition
  // under test cannot exist there and the create would simply succeed.
  const canDenyWrites = process.platform !== 'win32' && process.getuid?.() !== 0
  const itWritable = canDenyWrites ? it : it.skip

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
