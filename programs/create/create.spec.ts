//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import path from 'path'
import fs from 'fs'
import {ALL_TEMPLATES, DEFAULT_TEMPLATE} from '../../examples/data'
import {extensionCreate} from './dist/module'

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
      expect(error.message).toContain(
        'You need to provide an extension name to create one'
      )
    }
  }, 30000)

  describe('using the --template flag', () => {
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
          ? template.uiFramework === 'vue'
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
            const fileExt = template.uiFramework === 'vue' ? 'vue' : ext

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

        // Expect manifest.json to exist
        expect(fileExists(template.name, 'manifest.json')).toBeTruthy()

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
