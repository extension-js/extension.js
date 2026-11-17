import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {sync as spawnSync} from 'cross-spawn'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  fixtureExtensionFiles,
  serveExamplesCatalog
} from './__spec__/examples-catalog-fixture'
import {DEFAULT_TEMPLATE_NAME} from './steps/import-external-template'

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

// The one spec that runs the compiled bundle, the file a consumer installs.
const {extensionCreate} = createRequire(import.meta.url)(
  './dist/module.cjs'
) as {
  extensionCreate: (
    projectName: string | undefined,
    opts: {template?: string; install?: boolean}
  ) => Promise<unknown>
}

let workDir: string

describe('extension create', () => {
  beforeAll(async () => {
    workDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'extjs-create-dist-')
    )
  })

  afterAll(async () => {
    await fs.promises.rm(workDir, {recursive: true, force: true})
  })

  it('throws an error if no project name is provided', async () => {
    const error = await extensionCreate(undefined, {
      template: DEFAULT_TEMPLATE_NAME
    }).then(
      () => undefined,
      (reason: unknown) => reason
    )

    expect(error).toBeInstanceOf(Error)
    expect(stripVTControlCharacters((error as Error).message)).toBe(
      '⏵⏵⏵ A project name is required.\n' +
        'Pass a name, for example extension create my-extension.\n' +
        'Run extension create --help for the full usage.'
    )
  }, 30000)

  it('creates a default project when template is omitted', async () => {
    const projectPath = path.join(workDir, 'default-project')
    const catalog = await serveExamplesCatalog({
      [DEFAULT_TEMPLATE_NAME]: fixtureExtensionFiles(DEFAULT_TEMPLATE_NAME)
    })
    const savedUrl = process.env.EXTENSION_CREATE_TEMPLATE_URL
    const savedHttp = process.env.EXTENSION_ALLOW_HTTP_TEMPLATE
    process.env.EXTENSION_CREATE_TEMPLATE_URL = catalog.url
    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'

    try {
      await extensionCreate(projectPath, {
        install: false
      })
    } finally {
      restoreEnv('EXTENSION_CREATE_TEMPLATE_URL', savedUrl)
      restoreEnv('EXTENSION_ALLOW_HTTP_TEMPLATE', savedHttp)
      await catalog.close()
    }

    for (const file of ['package.json', 'src/manifest.json', 'README.md']) {
      expect(fs.existsSync(path.join(projectPath, file)), file).toBe(true)
    }

    const provenance = JSON.parse(
      fs.readFileSync(path.join(projectPath, '.extension-create.json'), 'utf-8')
    )
    expect(provenance.template).toBe(DEFAULT_TEMPLATE_NAME)
    expect(provenance.source).toBe(catalog.url)
  }, 30000)

  // The published entry hands `install` on to the create. The template ships a
  // file named node_modules, so the install step stops at its own first line,
  // before any package manager is asked. An empty PATH makes sure of that.
  it('forwards install: true, which reaches the install step', async () => {
    const template = path.join(workDir, 'template-with-a-node-modules-file')
    const projectPath = path.join(workDir, 'install-forwarded')
    const emptyBin = path.join(workDir, 'empty-bin')
    await fs.promises.mkdir(template)
    await fs.promises.mkdir(emptyBin)
    await fs.promises.writeFile(
      path.join(template, 'manifest.json'),
      JSON.stringify({name: 'seed', manifest_version: 3, version: '1.0.0'})
    )

    await fs.promises.writeFile(path.join(template, 'node_modules'), '')
    const savedPath = process.env.PATH
    process.env.PATH = emptyBin

    const run = (install: boolean) =>
      extensionCreate(projectPath, {template, install}).then(
        () => undefined,
        (reason: Error & {cause?: NodeJS.ErrnoException}) => reason
      )

    try {
      const withInstall = await run(true)

      expect(
        stripVTControlCharacters(String(withInstall?.message)).split('\n')[0]
      ).toBe("⏵⏵⏵ Couldn't install the dependencies for install-forwarded.")

      expect(withInstall?.cause).toMatchObject({
        code: 'EEXIST',
        syscall: 'mkdir',
        path: path.join(projectPath, 'node_modules')
      })

      expect(fs.existsSync(projectPath)).toBe(false)

      // The same template scaffolds when no install is asked for, so the
      // failure above can only have come from the flag.
      expect(await run(false)).toBeUndefined()
      expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(true)
    } finally {
      restoreEnv('PATH', savedPath)
    }
  }, 30000)

  it('rejects a URL as project path', async () => {
    await expect(
      extensionCreate('http://example.com', {
        template: DEFAULT_TEMPLATE_NAME
      })
    ).rejects.toThrow('A URL is not a valid project path')
  }, 30000)
})

// The file list npm would publish, read from a dry run that packs nothing and
// asks no registry. npm prints an array before version 11 and a map after.
function publishedFiles(): string[] {
  const run = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'],
    {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      env: {...process.env, npm_config_update_notifier: 'false'}
    }
  )

  expect(run.status, run.stderr).toBe(0)

  const report: unknown = JSON.parse(run.stdout)
  const [entry] = Object.values(report as Record<string, unknown>) as Array<{
    files: Array<{path: string}>
  }>

  return entry.files.map((file) => file.path)
}

describe('the published extension-create package', () => {
  // A template is the product, so its config and sources ship on purpose.
  it('ships no spec, config or TypeScript source beside the templates', () => {
    const files = publishedFiles()
    const ours = files.filter((file) => !file.startsWith('templates/'))

    expect(files).toContain('dist/module.cjs')
    expect(ours.filter((file) => file.includes('__spec__'))).toEqual([])
    expect(ours.filter((file) => /\.(?:spec|config)\./.test(file))).toEqual([])
    expect(
      ours.filter(
        (file) => /\.[cm]?tsx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file)
      )
    ).toEqual([])
  }, 30000)

  it('ships every file its exports, main and types name', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8')
    ) as {
      main: string
      types: string
      exports: Record<string, Record<string, string>>
    }

    // The development condition names source on purpose and is never shipped.
    const named = Object.values(manifest.exports).flatMap((entry) =>
      Object.entries(entry)
        .filter(([condition]) => condition !== 'development')
        .map(([, target]) => target)
    )

    const targets = [...new Set([manifest.main, manifest.types, ...named])]
    const files = publishedFiles()

    expect(targets).toContain('./dist/module.d.ts')
    expect(
      targets.filter((target) => !files.includes(target.replace(/^\.\//, '')))
    ).toEqual([])
  }, 30000)
})
