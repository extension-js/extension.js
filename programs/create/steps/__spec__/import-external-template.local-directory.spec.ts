import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {strToU8, zipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {
  type LoopbackServer,
  serveLoopback
} from '../../__spec__/loopback-template-server'
import {
  importExternalTemplate,
  type TemplateClone,
  type TemplateFetch
} from '../import-external-template'

// The catalog has an entry whose name is also the basename of the local
// directory under test, which is the collision the defect lived in.
const CATALOG_ARCHIVE = Buffer.from(
  zipSync({
    'examples-main/examples/widget/package.json': strToU8('{"name":"widget"}'),
    'examples-main/examples/widget/REMOTE.md': strToU8('# from the catalog\n')
  })
)

const tempDirs: string[] = []

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)

  return dir
}

// A template directory on this machine, named `widget` like the catalog entry.
function makeLocalTemplate() {
  const root = makeTempDir('extjs-local-template-')
  const templateDir = path.join(root, 'widget')
  fs.mkdirSync(path.join(templateDir, 'src'), {recursive: true})
  fs.writeFileSync(path.join(templateDir, 'LOCAL.md'), '# from this machine\n')
  fs.writeFileSync(
    path.join(templateDir, 'src', 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Local Widget',
      version: '1.0.0'
    })
  )

  return templateDir
}

const logger = {log: () => {}, error: () => {}}

const savedEnv = {
  EXTENSION_ALLOW_HTTP_TEMPLATE: process.env.EXTENSION_ALLOW_HTTP_TEMPLATE,
  EXTENSION_CREATE_TEMPLATE_URL: process.env.EXTENSION_CREATE_TEMPLATE_URL
}
let catalog: LoopbackServer

// The catalog override points the real download at a loopback archive.
beforeEach(async () => {
  catalog = await serveLoopback({
    '/catalog.zip': {body: CATALOG_ARCHIVE},
    '/no-examples.zip': {
      body: Buffer.from(zipSync({'examples-main/README.md': strToU8('x')}))
    }
  })

  process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
  process.env.EXTENSION_CREATE_TEMPLATE_URL = catalog.url('/catalog.zip')
})

afterEach(async () => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  await catalog.close()

  while (tempDirs.length > 0) {
    await fsp.rm(tempDirs.pop()!, {recursive: true, force: true})
  }
})

describe('a --template that names a directory on this machine', () => {
  it('scaffolds from that directory, never the catalog entry of the same name', async () => {
    const templateDir = makeLocalTemplate()
    const projectPath = path.join(makeTempDir('extjs-local-out-'), 'my-ext')

    const fetch = vi.fn<TemplateFetch>(async () => {
      throw new Error('the import asked for a download')
    })
    const clone = vi.fn<TemplateClone>(async () => {
      throw new Error('the import asked for a clone')
    })

    const provenance = await importExternalTemplate(
      projectPath,
      'my-ext',
      templateDir,
      logger,
      {ownsProjectDir: true, fetch, clone}
    )

    expect(provenance).toEqual({template: 'widget', source: 'local'})
    expect(fs.existsSync(path.join(projectPath, 'LOCAL.md'))).toBe(true)
    expect(fs.existsSync(path.join(projectPath, 'REMOTE.md'))).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(clone).not.toHaveBeenCalled()
    expect(catalog.hits('/catalog.zip')).toBe(0)
  })

  it('reads a relative path against the working directory', async () => {
    const templateDir = makeLocalTemplate()
    const cwd = process.cwd()
    const projectPath = path.join(makeTempDir('extjs-local-out-'), 'my-ext')

    try {
      process.chdir(path.dirname(templateDir))

      const provenance = await importExternalTemplate(
        projectPath,
        'my-ext',
        './widget',
        logger,
        {ownsProjectDir: true}
      )

      expect(provenance).toEqual({template: 'widget', source: 'local'})

      expect(fs.existsSync(path.join(projectPath, 'LOCAL.md'))).toBe(true)
      expect(fs.existsSync(path.join(projectPath, 'REMOTE.md'))).toBe(false)
    } finally {
      process.chdir(cwd)
    }
  })

  it('refuses an output path inside the template it would copy', async () => {
    const templateDir = makeLocalTemplate()
    const projectPath = path.join(templateDir, 'my-ext')

    const error = (await importExternalTemplate(
      projectPath,
      'my-ext',
      templateDir,
      logger,
      {ownsProjectDir: true}
    ).catch((thrown: Error) => thrown)) as Error

    expect(error.message).toContain(
      "Can't scaffold a project inside the template it copies"
    )

    expect(error.message).toContain(templateDir)
    expect(fs.existsSync(projectPath)).toBe(false)
  })

  // Symlinks need a privilege on Windows that a default account lacks.
  it.skipIf(process.platform === 'win32')(
    'refuses that output path when the template is named through a symlink',
    async () => {
      const templateDir = makeLocalTemplate()
      const link = path.join(makeTempDir('extjs-local-link-'), 'linked')
      fs.symlinkSync(templateDir, link, 'dir')
      const projectPath = path.join(templateDir, 'my-ext')

      const error = (await importExternalTemplate(
        projectPath,
        'my-ext',
        link,
        logger,
        {ownsProjectDir: true}
      ).catch((thrown: Error) => thrown)) as Error

      expect(error.message).toContain(
        "Can't scaffold a project inside the template it copies"
      )

      expect(fs.existsSync(projectPath)).toBe(false)
    }
  )

  it('names the value it was given when no such directory exists', async () => {
    process.env.EXTENSION_CREATE_TEMPLATE_URL = catalog.url('/no-examples.zip')

    const projectPath = path.join(makeTempDir('extjs-local-out-'), 'my-ext')

    const error = (await importExternalTemplate(
      projectPath,
      'my-ext',
      './my-templates/not-a-real-template',
      logger,
      {ownsProjectDir: true}
    ).catch((thrown: Error) => thrown)) as Error

    expect(error.name).toBe('TemplateNotFoundError')
    expect(error.message).toContain('./my-templates/not-a-real-template')
    expect(catalog.hits('/no-examples.zip')).toBe(1)
  })

  // A bare word is a catalog name even when the working directory happens to
  // hold a folder of that name, so no scaffold changes meaning by location.
  it('still reads a bare name as a catalog entry', async () => {
    const templateDir = makeLocalTemplate()
    const cwd = process.cwd()
    const projectPath = path.join(makeTempDir('extjs-local-out-'), 'my-ext')

    try {
      process.chdir(path.dirname(templateDir))

      const provenance = await importExternalTemplate(
        projectPath,
        'my-ext',
        'widget',
        logger,
        {ownsProjectDir: true}
      )

      expect(provenance.template).toBe('widget')
      expect(fs.existsSync(path.join(projectPath, 'REMOTE.md'))).toBe(true)
      expect(fs.existsSync(path.join(projectPath, 'LOCAL.md'))).toBe(false)
    } finally {
      process.chdir(cwd)
    }
  })

  // The catalog takes the basename of a path-shaped value, which is how
  // `examples/<name>` resolves. A path that does not exist keeps that reading.
  it('keeps resolving a path-shaped catalog reference', async () => {
    const projectPath = path.join(makeTempDir('extjs-local-out-'), 'my-ext')

    const provenance = await importExternalTemplate(
      projectPath,
      'my-ext',
      'examples/widget',
      logger,
      {ownsProjectDir: true}
    )

    expect(provenance.template).toBe('widget')
    expect(fs.existsSync(path.join(projectPath, 'REMOTE.md'))).toBe(true)
  })
})
