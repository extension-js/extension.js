import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {
  fixtureExtensionFiles,
  serveExamplesCatalog
} from './__spec__/examples-catalog-fixture'
import {DEFAULT_TEMPLATE_NAME} from './steps/import-external-template'

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

let extensionCreate: (
  projectName: string | undefined,
  opts: any
) => Promise<void>

{
  const require = createRequire(import.meta.url)

  try {
    // Standalone repo path
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    extensionCreate = require('./dist/module.cjs').extensionCreate
  } catch {
    try {
      // Monorepo fallback
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      extensionCreate =
        require('../../programs/create/dist/module.cjs').extensionCreate
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      extensionCreate = require('./dist/module.js').extensionCreate
    }
  }
}

type TemplateMeta = {
  name: string
  uiFramework?: string
  uiContext?: string[]
  css?: string
  configFiles?: string[]
  hasEnv?: boolean
}

let ALL_TEMPLATES: TemplateMeta[] = []
let DEFAULT_TEMPLATE: TemplateMeta = {name: 'javascript'}

try {
  const require = createRequire(import.meta.url)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const m = require('../../examples/data') as {
    ALL_TEMPLATES: TemplateMeta[]
    DEFAULT_TEMPLATE: TemplateMeta
  }
  ALL_TEMPLATES = m.ALL_TEMPLATES
  DEFAULT_TEMPLATE = m.DEFAULT_TEMPLATE
} catch {
  ALL_TEMPLATES = [{name: 'javascript'}]
  DEFAULT_TEMPLATE = {name: 'javascript'}
}

function fileExists(templateName: string, filePath?: string): boolean {
  const templatePath = path.resolve(
    __dirname,
    'dist',
    `test-template-${templateName}`
  )

  return fs.existsSync(path.join(templatePath, filePath || ''))
}

function manifestExists(templateName: string): boolean {
  const candidates = [
    'manifest.json',
    path.join('src', 'manifest.json'),
    path.join('extension', 'manifest.json'),
    path.join('extension', 'src', 'manifest.json')
  ]

  return candidates.some((candidate) => fileExists(templateName, candidate))
}

async function removeDir(dirPath: string) {
  if (fs.existsSync(dirPath)) {
    await fs.promises.rm(dirPath, {recursive: true})
  }
}

async function removeAllTemplateFolders() {
  await Promise.all(
    ALL_TEMPLATES.map(async (template) => {
      const templatePath = path.resolve(
        __dirname,
        'dist',
        `test-template-${template.name}`
      )

      console.log('Removing template:', templatePath)

      await removeDir(templatePath)

      return true
    })
  )
}

describe('extension create', () => {
  beforeAll(async () => {
    await removeAllTemplateFolders()
  })

  it('throws an error if no project name is provided', async () => {
    try {
      await extensionCreate(undefined, {
        template: DEFAULT_TEMPLATE.name
      })
    } catch (error: any) {
      expect(error).toBeTruthy()
      expect(error.message).toContain('A project name is required')
    }
  }, 30000)

  it('creates a default project when template is omitted', async () => {
    const templatePath = path.resolve(
      __dirname,
      'dist',
      'test-template-javascript'
    )
    const catalog = await serveExamplesCatalog({
      [DEFAULT_TEMPLATE_NAME]: fixtureExtensionFiles(DEFAULT_TEMPLATE_NAME)
    })
    const savedUrl = process.env.EXTENSION_CREATE_TEMPLATE_URL
    const savedHttp = process.env.EXTENSION_ALLOW_HTTP_TEMPLATE
    process.env.EXTENSION_CREATE_TEMPLATE_URL = catalog.url
    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'

    try {
      await extensionCreate(templatePath, {
        install: false
      })
    } finally {
      restoreEnv('EXTENSION_CREATE_TEMPLATE_URL', savedUrl)
      restoreEnv('EXTENSION_ALLOW_HTTP_TEMPLATE', savedHttp)
      await catalog.close()
    }

    expect(fileExists('javascript', 'package.json')).toBeTruthy()
    expect(manifestExists('javascript')).toBeTruthy()
    expect(fileExists('javascript', 'README.md')).toBeTruthy()

    const provenance = JSON.parse(
      fs.readFileSync(
        path.join(templatePath, '.extension-create.json'),
        'utf-8'
      )
    )
    expect(provenance.template).toBe(DEFAULT_TEMPLATE_NAME)
    expect(provenance.source).toBe(catalog.url)
  }, 30000)

  it('rejects a URL as project path', async () => {
    await expect(
      extensionCreate('http://example.com', {
        template: DEFAULT_TEMPLATE.name
      })
    ).rejects.toThrow('A URL is not a valid project path')
  }, 30000)

  describe.skip('using the --template flag', () => {
    it.each(
      ALL_TEMPLATES
    )(`creates the "$name" extension template`, async (template) => {
      const templatePath = path.join(
        __dirname,
        'dist',
        `test-template-${template.name}`
      )

      await extensionCreate(templatePath, {
        template: template.name,
        install: true
      })

      const ext = template.uiFramework
        ? template.uiFramework === 'vue' || template.uiFramework === 'svelte'
          ? 'ts'
          : 'tsx'
        : template.configFiles?.includes('tsconfig.json')
          ? 'ts'
          : 'js'

      template.uiContext?.forEach((context: string) => {
        if (!context.includes('content')) {
          expect(
            fileExists(template.name, `${context.toLowerCase()}/index.html`)
          ).toBeTruthy()
        }

        if (template.name.includes('esm')) {
          expect(
            fileExists(template.name, `${context.toLowerCase()}/scripts.mjs`)
          ).toBeTruthy()
        } else {
          expect(
            fileExists(template.name, `${context.toLowerCase()}/scripts.${ext}`)
          ).toBeTruthy()
        }

        if (template.css === 'sass') {
          expect(
            fileExists(template.name, `${context.toLowerCase()}/styles.scss`)
          ).toBeTruthy()
        } else if (template.name?.includes('less')) {
          expect(
            fileExists(template.name, `${context.toLowerCase()}/styles.less`)
          ).toBeTruthy()
        } else {
          expect(
            fileExists(template.name, `${context.toLowerCase()}/styles.css`)
          ).toBeTruthy()
        }

        if (template.uiFramework) {
          const capitalizedtemplate =
            context?.charAt(0).toUpperCase() + context?.slice(1)

          const fileExt =
            template.uiFramework === 'vue'
              ? 'vue'
              : template.uiFramework === 'svelte'
                ? 'svelte'
                : ext

          expect(
            fileExists(
              template.name,
              `${context.toLowerCase()}/${capitalizedtemplate}App.${fileExt}`
            )
          ).toBeTruthy()
        }
      })

      if (template.name !== 'init' && template.name !== 'javascript') {
        expect(
          fileExists(template.name, 'images/extension_48.png')
        ).toBeTruthy()
      }

      if (template.uiContext?.includes('action')) {
        expect(
          fileExists(template.name, 'images/extension_16.png')
        ).toBeTruthy()
      }

      expect(manifestExists(template.name)).toBeTruthy()

      expect(fileExists(template.name, 'package.json')).toBeTruthy()

      expect(fileExists(template.name, 'README.md')).toBeTruthy()

      expect(fileExists(template.name, '.gitignore')).toBeTruthy()

      expect(fileExists(template.name, '.git')).toBeTruthy()

      if (template.hasEnv) {
        expect(fileExists(template.name, '.env.example')).toBeTruthy()
      }

      if (template.configFiles) {
        template.configFiles.forEach((configFile) => {
          expect(fileExists(template.name, configFile)).toBeTruthy()
        })
      }
    }, 60000)
  })
})
