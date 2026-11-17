import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {strToU8, zipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  fetchFrom,
  type LoopbackReply,
  type LoopbackServer,
  refusedLoopbackUrl,
  serveLoopback
} from '../../__spec__/loopback-template-server'
import {hasChannelPrefix} from '../../lib/messaging'
import {createDirectory} from '../create-directory'
import {generateExtensionTypes} from '../generate-extension-types'
import {
  type ImportExternalTemplateOptions,
  InsecureTemplateUrlError,
  importExternalTemplate,
  TemplateArchiveDamagedError,
  TemplateArchiveEntryOutsideError,
  type TemplateClone,
  TemplateDownloadError,
  type TemplateFetch,
  TemplateNotFoundError,
  TemplateNotZipError
} from '../import-external-template'
import {installDependencies} from '../install-dependencies'
import {setupBuiltInTests} from '../setup-built-in-tests'
import {writeDenoJsonc} from '../write-deno-jsonc'
import {writeGitignore} from '../write-gitignore'
import {writeManifestJson} from '../write-manifest-json'
import {overridePackageJson} from '../write-package-json'
import {writeReadmeFile} from '../write-readme-file'

const GLYPH = '⏵⏵⏵'
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
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

async function failingImport(
  template: string,
  options: ImportExternalTemplateOptions = {},
  logger = makeLogger()
) {
  const error = (await importExternalTemplate(
    await makeProjectPath(),
    'my-ext',
    template,
    logger,
    {ownsProjectDir: true, allowOfflineFallback: false, ...options}
  ).catch((thrown: Error) => thrown)) as Error

  return {error, logger}
}

const servers: LoopbackServer[] = []

// A loopback server that stands for the remote end. Plain http is allowed
// for the test that asks, as it is for any loopback run of the CLI.
async function serving(routes: Record<string, LoopbackReply>) {
  const server = await serveLoopback(routes)
  servers.push(server)
  process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'

  return server
}

function expectOneFrameAndNoStack(error: Error, logger: {errors: string[]}) {
  expect(hasChannelPrefix(error.message)).toBe(true)
  expect(error.message.match(new RegExp(GLYPH, 'g'))).toHaveLength(1)
  expect(error.message).not.toMatch(STACK_FRAME)
  expect(logger.errors).toEqual([])
}

const savedEnv = {
  EXTENSION_ALLOW_HTTP_TEMPLATE: process.env.EXTENSION_ALLOW_HTTP_TEMPLATE,
  EXTENSION_CREATE_TEMPLATE_URL: process.env.EXTENSION_CREATE_TEMPLATE_URL
}

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

  for (const dir of tmpRoots.splice(0)) {
    await fsp.rm(dir, {recursive: true, force: true})
  }
})

describe('a create refusal travels as one framed message on the thrown error', () => {
  it('for a template name missing from the catalog', async () => {
    const server = await serving({'/catalog.zip': {body: emptyArchive}})

    const {error, logger} = await failingImport('nope-xyz', {
      fetch: fetchFrom(server.url('/catalog.zip'))
    })

    expect(error).toBeInstanceOf(TemplateNotFoundError)
    expect(error.message).toContain('nope-xyz')
    expect(error.message).toContain(
      'is not in the extension-js/templates catalog'
    )

    expectOneFrameAndNoStack(error, logger)
  })

  it('for a catalog download that fails', async () => {
    const server = await serving({})

    const {error, logger} = await failingImport('react', {
      fetch: fetchFrom(server.url('/catalog.zip'))
    })

    expect(error).toBeInstanceOf(TemplateDownloadError)
    expect(server.hits('/catalog.zip')).toBe(1)
    expect(error.message).toContain("Couldn't download the template")
    expect(error.message).toContain('status code 404')
    expectOneFrameAndNoStack(error, logger)
  })

  // The fourth path: a URL is neither a catalog slug nor a catalog download,
  // so an untyped throw here reached the sink that prints a stack. The spawned
  // git reports its own failure with frames pointing inside node_modules.
  it('for a GitHub template URL that cannot be fetched', async () => {
    const clone = vi.fn<TemplateClone>(async () => {
      throw Object.assign(
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
    })

    const {error, logger} = await failingImport(
      'https://github.com/extension-js/exampels/tree/main/examples/react',
      {clone}
    )

    expect(clone).toHaveBeenCalledTimes(1)

    expect(error).toBeInstanceOf(TemplateDownloadError)
    expect(error.message).toContain(
      'https://github.com/extension-js/exampels/tree/main/examples/react'
    )

    expect(error.message).toContain('Repository not found')
    expect(error.message).not.toContain('node_modules')
    expectOneFrameAndNoStack(error, logger)
  })

  it('for a ZIP template URL that answers with something else', async () => {
    const server = await serving({
      '/templates/mine': {type: 'text/html', body: '<html>not found</html>'}
    })
    const url = server.url('/templates/mine')

    const {error, logger} = await failingImport(url)

    expect(error).toBeInstanceOf(TemplateNotZipError)
    expect(error.message).toContain("doesn't point to a ZIP archive")
    expect(error.message).toContain(`URL ${url}`)
    expect(error.message).toContain('GOT text/html')
    expectOneFrameAndNoStack(error, logger)
  })

  // The name and the header both said ZIP, so the unzip was the first thing
  // to notice, and its "invalid zip data" reached the sink with a stack.
  it.each([
    [
      'a page behind a .zip name',
      '/t.zip',
      {
        type: 'text/html; charset=utf-8',
        body: '<!doctype html><html><body>Sign in</body></html>'
      },
      'GOT text/html; charset=utf-8'
    ],
    [
      'an empty body sent as a ZIP',
      '/download',
      {type: 'application/zip', body: Buffer.alloc(0)},
      'GOT application/zip with an empty body'
    ],
    [
      'bytes that are not an archive sent as one',
      '/t.zip',
      {type: 'application/octet-stream', body: 'not an archive'},
      'GOT application/octet-stream that is not ZIP data'
    ]
  ])('for a ZIP template URL that answers with %s', async (_label, pathname, reply, got) => {
    const server = await serving({[pathname]: reply})
    const url = server.url(pathname)

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
    const server = await serving({
      '/catalog.zip': {
        type: 'text/html; charset=utf-8',
        body: '<!doctype html><html><body>Sign in</body></html>'
      }
    })
    const override = server.url('/catalog.zip')
    process.env.EXTENSION_CREATE_TEMPLATE_URL = override

    const {error, logger} = await failingImport('react')

    expect(error).toBeInstanceOf(TemplateNotZipError)
    expect(error.message).toContain("doesn't point to a ZIP archive")
    expect(error.message).toContain(`URL ${override}`)
    expect(error.message).toContain('GOT text/html; charset=utf-8')
    expect(error.message).not.toContain('invalid zip data')
    expectOneFrameAndNoStack(error, logger)
  })

  it.each([
    ['a template URL', undefined],
    ['a catalog override URL', 'react']
  ])('for %s whose archive is damaged', async (_label, catalogName) => {
    const server = await serving({'/t.zip': {body: damagedArchive}})
    const url = server.url('/t.zip')
    if (catalogName) process.env.EXTENSION_CREATE_TEMPLATE_URL = url

    const {error, logger} = await failingImport(catalogName ?? url)

    expect(error).toBeInstanceOf(TemplateArchiveDamagedError)
    expect(error).not.toBeInstanceOf(TemplateDownloadError)
    expect(error.message).toContain(
      'The ZIP archive at the remote URL is damaged.'
    )

    expect(error.message).toContain(`URL ${url}`)
    expect(error.message).toContain('REASON invalid zip data')
    expectOneFrameAndNoStack(error, logger)
  })

  // The path is in the archive itself, so a retry gets the same refusal and
  // none is offered. Every entry is vetted before the first write.
  it.each([
    [
      'a template URL',
      undefined,
      {
        't/manifest.json': strToU8('{}'),
        '../escaped.txt': strToU8('hostile')
      },
      '../escaped.txt'
    ],
    [
      'a catalog override URL',
      'react',
      {
        'examples-main/examples/react/manifest.json': strToU8('{}'),
        'examples-main/examples/react/../../../escaped.txt': strToU8('hostile')
      },
      'examples-main/examples/react/../../../escaped.txt'
    ]
  ])('for %s whose archive has an entry outside its folder', async (_label, catalogName, files, entry) => {
    const server = await serving({
      '/t.zip': {body: Buffer.from(zipSync(files))}
    })
    const url = server.url('/t.zip')
    const template = catalogName ?? url
    if (catalogName) process.env.EXTENSION_CREATE_TEMPLATE_URL = url

    const projectPath = await makeProjectPath()
    const staging = path.join(path.dirname(projectPath), 'staging')
    await fsp.mkdir(staging)
    const priorTmp = process.env.TMPDIR
    process.env.TMPDIR = staging
    const logger = makeLogger()

    const error = (await importExternalTemplate(
      projectPath,
      'my-ext',
      template,
      logger,
      {ownsProjectDir: true, allowOfflineFallback: false}
    )
      .catch((thrown: Error) => thrown)
      .finally(() => {
        if (priorTmp === undefined) delete process.env.TMPDIR
        else process.env.TMPDIR = priorTmp
      })) as Error

    expect(error).toBeInstanceOf(TemplateArchiveEntryOutsideError)
    expect(error).not.toBeInstanceOf(TemplateArchiveDamagedError)
    expect(error.message).toContain(
      'The ZIP archive at the remote URL contains a path outside its folder, so it was refused. Nothing was written.'
    )

    expect(error.message).toContain(`URL ${url}`)
    expect(error.message).toContain(`ENTRY ${entry}`)
    expect(error.message).not.toMatch(/damaged|try again/i)
    expectOneFrameAndNoStack(error, logger)

    // Nothing of the archive is left, in the project or where it was staged.
    expect(await fsp.readdir(path.dirname(projectPath))).toEqual(['staging'])
    expect(await fsp.readdir(staging)).toEqual([])
  })

  it('for a template URL the connection to which is refused', async () => {
    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
    const url = await refusedLoopbackUrl('/t.zip')

    const {error, logger} = await failingImport(url)

    expect(error).toBeInstanceOf(TemplateDownloadError)
    expect(error.message).toContain("Couldn't fetch the template from that URL")
    expect(error.message).toContain(`URL ${url}`)
    expect(error.message).toContain('ECONNREFUSED')
    expectOneFrameAndNoStack(error, logger)
  })

  it('for a plain http template URL', async () => {
    const fetch = vi.fn<TemplateFetch>(async () => {
      throw new Error('the import asked for a download')
    })

    const {error, logger} = await failingImport('http://example.com/t.zip', {
      fetch
    })

    expect(error).toBeInstanceOf(InsecureTemplateUrlError)
    expect(error.message).toContain('plain HTTP')
    expectOneFrameAndNoStack(error, logger)
    expect(fetch).not.toHaveBeenCalled()
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
      'npm',
      undefined,
      async () => ({
        code: 1,
        stdout: '',
        stderr:
          'npm error code ECONNREFUSED\n' +
          'npm error     at ClientRequest.<anonymous> (minipass-fetch/lib/index.js:130:14)\n' +
          'npm error A complete log of this run can be found in: /tmp/debug-0.log\n'
      })
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
    expect((error as {cause?: unknown}).cause).toBeInstanceOf(SyntaxError)
    expectOneFrameAndNoStack(error, logger)
  })

  // A file where the folder must go fails the same on every platform, with no
  // permission bits involved.
  it('for a destination that is a file', async () => {
    const logger = makeLogger()
    const projectPath = await makeProjectPath()
    await fsp.writeFile(projectPath, 'not a folder')

    const error = (await createDirectory(projectPath, 'my-ext', logger).catch(
      (thrown: Error) => thrown
    )) as Error & {cause?: NodeJS.ErrnoException}

    expect(plainLines(error)[0]).toBe(
      `${GLYPH} Couldn't write to the destination directory.`
    )

    expect(plainLines(error)[1]).toBe(`PATH ${projectPath}`)
    expect(error.cause).toMatchObject({code: 'EEXIST', syscall: 'mkdir'})
    expectOneFrameAndNoStack(error, logger)
  })
})

function plainLines(error: Error) {
  return String(error.message).replace(ANSI, '').split('\n')
}

const GECKO_MANIFEST = JSON.stringify({
  name: 'template',
  browser_specific_settings: {gecko: {id: 'template@example.com'}}
})

// What each step is handed so its own write is the call that fails. Every
// fault is a real one the filesystem raises on any platform: a folder where
// the file goes, or a project folder that is not there. Nothing is stubbed.
interface WriteFault {
  step: string
  headline: string
  codes: string[]
  syscall: string
  // A failed read of a folder names no path on the error itself.
  causeNamesPath?: false
  // Answers the path the failed call names.
  arrange: (projectPath: string) => Promise<string>
  run: (
    projectPath: string,
    logger: ReturnType<typeof makeLogger>
  ) => Promise<unknown>
}

const folderInPlaceOf =
  (...segments: string[]) =>
  async (projectPath: string) => {
    const target = path.join(projectPath, ...segments)
    await fsp.mkdir(target, {recursive: true})

    return target
  }

const writeFaults: WriteFault[] = [
  {
    step: 'writeDenoJsonc',
    headline: "Couldn't write deno.jsonc.",
    codes: ['ENOENT'],
    syscall: 'open',
    arrange: async (projectPath) => {
      await fsp.rm(projectPath, {recursive: true})

      return path.join(projectPath, 'deno.jsonc')
    },
    run: (projectPath, logger) => writeDenoJsonc(projectPath, {}, logger)
  },
  {
    step: 'overridePackageJson',
    headline: "Couldn't write package.json.",
    codes: ['ENOENT'],
    syscall: 'open',
    arrange: async (projectPath) => {
      await fsp.rm(projectPath, {recursive: true})

      return path.join(projectPath, 'package.json')
    },
    run: (projectPath, logger) =>
      overridePackageJson(
        projectPath,
        {packageManager: 'npm', probeVersion: () => ({status: 1, stdout: ''})},
        logger
      )
  },
  {
    step: 'writeManifestJson',
    headline: "Couldn't write manifest.json.",
    codes: ['EISDIR'],
    syscall: 'open',
    arrange: async (projectPath) => {
      const target = path.join(projectPath, 'manifest.json')
      await fsp.writeFile(target, GECKO_MANIFEST)

      return target
    },
    // The manifest is read, then written back to the same path, so the id
    // generator that runs between the two is where the folder takes its place.
    run: (projectPath, logger) =>
      writeManifestJson(projectPath, logger, () => {
        const target = path.join(projectPath, 'manifest.json')
        fs.rmSync(target)
        fs.mkdirSync(target)

        return '{00000000-0000-4000-8000-000000000000}'
      })
  },
  {
    step: 'writeReadmeFile',
    headline: "Couldn't write README.md.",
    codes: ['EISDIR'],
    syscall: 'open',
    arrange: async (projectPath) => {
      await fsp.writeFile(path.join(projectPath, 'manifest.json'), '{}')

      return folderInPlaceOf('README.md')(projectPath)
    },
    run: (projectPath, logger) =>
      writeReadmeFile(projectPath, 'my-ext', logger, 'npm')
  },
  {
    step: 'writeGitignore, reading the rules already there',
    headline: "Couldn't write .gitignore.",
    codes: ['EISDIR'],
    syscall: 'read',
    causeNamesPath: false,
    arrange: folderInPlaceOf('.gitignore'),
    run: (projectPath, logger) => writeGitignore(projectPath, logger)
  },
  {
    step: 'writeGitignore, writing the merged rules',
    headline: "Couldn't write .gitignore.",
    codes: ['ENOENT'],
    syscall: 'open',
    arrange: async (projectPath) => {
      await fsp.rm(projectPath, {recursive: true})

      return path.join(projectPath, '.gitignore')
    },
    run: (projectPath, logger) => writeGitignore(projectPath, logger)
  },
  {
    step: 'generateExtensionTypes',
    headline: "Couldn't write the extension type definitions.",
    codes: ['EISDIR'],
    syscall: 'open',
    arrange: folderInPlaceOf('extension-env.d.ts'),
    run: (projectPath, logger) =>
      generateExtensionTypes(projectPath, 'my-ext', logger)
  },
  {
    step: 'setupBuiltInTests',
    headline: "Couldn't set up the built-in tests.",
    // Unlinking a folder is EPERM on macOS and Windows, EISDIR on Linux.
    codes: ['EPERM', 'EISDIR'],
    syscall: 'unlink',
    arrange: folderInPlaceOf('tests', 'templates.spec.ts'),
    run: (projectPath) => setupBuiltInTests(projectPath)
  }
]

describe('a step whose write fails throws one frame and keeps the cause', () => {
  it.each(writeFaults)('$step', async ({
    headline,
    codes,
    syscall,
    causeNamesPath,
    arrange,
    run
  }) => {
    const logger = makeLogger()
    const projectPath = await makeProjectPath()
    await fsp.mkdir(projectPath, {recursive: true})
    const failedPath = await arrange(projectPath)
    const hadDeno = 'Deno' in globalThis
    ;(globalThis as {Deno?: unknown}).Deno = {version: {deno: 'test'}}

    const error = (await run(projectPath, logger)
      .then(() => new Error('the step did not fail'))
      .catch((thrown: Error) => thrown)
      .finally(() => {
        if (!hadDeno) delete (globalThis as {Deno?: unknown}).Deno
      })) as Error & {cause?: NodeJS.ErrnoException}
    const lines = plainLines(error)

    expect(lines[0]).toBe(`${GLYPH} ${headline}`)
    expect(
      lines.filter((line) => /^REASON Error: E[A-Z]+: /.test(line))
    ).toEqual([expect.stringContaining(`, ${syscall}`)])

    // The file the step could not write is named in the frame.
    expect(lines.join('\n')).toContain(failedPath)

    // The filesystem's own error, whole, and not a copy of its text.
    expect(error.cause).toBeInstanceOf(Error)
    expect(codes).toContain(error.cause?.code)
    expect(error.cause?.syscall).toBe(syscall)
    expect(error.cause?.path).toBe(
      causeNamesPath === false ? undefined : failedPath
    )

    expectOneFrameAndNoStack(error, logger)
  })
})
