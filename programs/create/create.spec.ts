//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {createRequire} from 'module'
import {describe, it, expect, beforeAll} from 'vitest'

// Resolve extensionCreate from local dist (standalone) or monorepo fallback
let extensionCreate: (
  projectName: string | undefined,
  opts: any
) => Promise<void>
{
  const require = createRequire(import.meta.url)
  try {
    // Standalone repo path
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    extensionCreate = require('./dist/module.js').extensionCreate
  } catch {
    // Monorepo fallback
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    extensionCreate =
      require('../../programs/create/dist/module.js').extensionCreate
  }
}

// In the monorepo we import templates metadata from ../../examples/data.
// For the standalone package/CI, fall back to a minimal set.
type TemplateMeta = {
  name: string
  uiFramework?: string
  uiContext?: string[]
  css?: string
  configFiles?: string[]
  hasEnv?: boolean
}

let ALL_TEMPLATES: TemplateMeta[] = []
let DEFAULT_TEMPLATE: TemplateMeta = {name: 'init'}
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
  ALL_TEMPLATES = [{name: 'init'}]
  DEFAULT_TEMPLATE = {name: 'init'}
}
import {execFile} from 'child_process'
import {promisify} from 'util'

const execFileAsync = promisify(execFile)

async function waitForFile(
  filePath: string,
  timeoutMs: number = 5000,
  intervalMs: number = 50
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`File not found in time: ${filePath}`)
}

function fileExists(templateName: string, filePath?: string): boolean {
  const templatePath = path.resolve(
    __dirname,
    'dist',
    'test-template-' + templateName
  )
  return fs.existsSync(path.join(templatePath, filePath || ''))
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
        'test-template-' + template.name
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
      expect(error.message).toContain('Project name is required')
    }
  }, 30000)

  it('creates a default project using without template flag', async () => {
    const templatePath = path.resolve(__dirname, 'dist', 'test-template-init')
    await extensionCreate(templatePath, {
      template: 'init'
    })

    expect(fileExists('init', 'package.json')).toBeTruthy()
    expect(fileExists('init', 'src/manifest.json')).toBeTruthy()
    expect(fileExists('init', 'README.md')).toBeTruthy()
  }, 30000)

  it('rejects a URL as project path', async () => {
    await expect(
      extensionCreate('http://example.com', {
        template: DEFAULT_TEMPLATE.name
      })
    ).rejects.toThrow('URLs are not allowed as a project path')
  }, 30000)

  const monorepoCliPath = path.resolve(
    __dirname,
    '..',
    '..',
    'programs',
    'cli',
    'dist',
    'cli.js'
  )
  const itCli = fs.existsSync(monorepoCliPath) ? it : it.skip

  itCli(
    'pnpm extension create creates a project (local template) and build succeeds',
    async () => {
      const uniqueSuffix = Date.now().toString()
      const projectPath = path.resolve(
        __dirname,
        'dist',
        `user-create-init-${uniqueSuffix}`
      )
      const cwd = path.resolve(__dirname, '..', '..')
      const env = {
        ...process.env,
        EXTENSION_ENV: 'development'
      } as unknown as NodeJS.ProcessEnv

      // Ensure target path does not exist
      fs.rmSync(projectPath, {recursive: true, force: true})

      await execFileAsync(
        'pnpm',
        ['extension', 'create', projectPath, '--template', 'init'],
        {cwd, env}
      )
      expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBeTruthy()
      await execFileAsync(
        'pnpm',
        [
          'extension',
          'build',
          projectPath,
          '--browser',
          'chrome',
          '--silent',
          'true'
        ],
        {cwd, env}
      )
      const manifestPath = path.join(
        projectPath,
        'dist',
        'chrome',
        'manifest.json'
      )
      await waitForFile(manifestPath)
      expect(fs.existsSync(manifestPath)).toBeTruthy()
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      expect(manifest.name).toBeTruthy()
      expect(manifest.version).toBeTruthy()
      expect(manifest.manifest_version).toBeTruthy()

      // Cleanup
      fs.rmSync(projectPath, {recursive: true, force: true})
    },
    120000
  )

  describe.skip('using the --template flag', () => {
    it.each(ALL_TEMPLATES)(
      `creates the "$name" extension template`,
      async (template) => {
        const templatePath = path.join(
          __dirname,
          'dist',
          'test-template-' + template.name
        )

        await extensionCreate(templatePath, {
          template: template.name,
          install: true
        })

        // UI frameworks will use either tsx or jsx files.
        // Non-UI frameworks will use either ts or js files.
        // TODO: cezaraugusto this is not going to scale well
        // but better than nothing for now.
        const ext = template.uiFramework
          ? template.uiFramework === 'vue' || template.uiFramework === 'svelte'
            ? 'ts'
            : 'tsx'
          : template.configFiles?.includes('tsconfig.json')
            ? 'ts'
            : 'js'

        template.uiContext?.forEach((context: string) => {
          // Expect [context]/index.html for all contexts except 'content'
          if (!context.includes('content')) {
            expect(
              fileExists(template.name, `${context.toLowerCase()}/index.html`)
            ).toBeTruthy()
          }

          if (template.name.includes('esm')) {
            expect(
              fileExists(template.name, `${context.toLowerCase()}/scripts.mjs`)
            ).toBeTruthy()
            // Expect [uiContext]/[uiContext].[ext] for scripts
          } else {
            expect(
              fileExists(
                template.name,
                `${context.toLowerCase()}/scripts.${ext}`
              )
            ).toBeTruthy()
          }

          // Expect [uiContext]/styles.sass|less|css for styles
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

          // Expect [ContextApp].[ext] for all contexts using frameworks
          if (template.uiFramework) {
            const capitalizedtemplate =
              context?.charAt(0).toUpperCase() + context?.slice(1)

            // Vue uses its own file extension
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

        // Expect images/extension_16.png and expect images/extension_16.png
        if (template.name !== 'init') {
          expect(
            fileExists(template.name, 'images/extension_48.png')
          ).toBeTruthy()
        }

        if (template.uiContext?.includes('action')) {
          expect(
            fileExists(template.name, 'images/extension_16.png')
          ).toBeTruthy()
        }

        // Expect manifest.json to exist (templates store it under src/)
        expect(fileExists(template.name, 'src/manifest.json')).toBeTruthy()

        // Expect package.json to exist
        expect(fileExists(template.name, 'package.json')).toBeTruthy()

        // Expect README.md to exist
        expect(fileExists(template.name, 'README.md')).toBeTruthy()

        // Expect .gitignore to exist
        expect(fileExists(template.name, '.gitignore')).toBeTruthy()

        // Expect project to be a .git project
        expect(fileExists(template.name, '.git')).toBeTruthy()

        if (template.hasEnv) {
          // For those who need it: Expect .env.sample
          expect(fileExists(template.name, '.env.example')).toBeTruthy()
        }

        if (template.configFiles) {
          template.configFiles.forEach((configFile) => {
            // Expect every config file declared in the template to exist
            expect(fileExists(template.name, configFile)).toBeTruthy()
          })
        }
      },
      60000
    )
  })
})
