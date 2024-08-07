//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import path from 'path'
import {ALL_TEMPLATES} from './fixtures/constants'
import {
  extensionProgram,
  fileExists,
  removeAllTemplateFolders
} from './fixtures/helpers'

describe('extension create', () => {
  beforeEach(async () => {
    await removeAllTemplateFolders()
  })

  it('throws an error if target directory has conflicting files', async () => {
    const templatePath = path.join(__dirname, '..', 'dist', 'init-newest')

    expect.assertions(2)

    try {
      // Create first extension.
      await extensionProgram(`create ${templatePath}`)

      // Try recreating on top of existing directory.
      await extensionProgram(`create ${templatePath}`)
    } catch (error: any) {
      expect(error).toBeTruthy()
      expect(error.message).toContain('includes conflicting files')
    }
  }, 60000)

  it('throws an error if no project name is provided', async () => {
    try {
      await extensionProgram('create')
    } catch (error: any) {
      expect(error).toBeTruthy()
      expect(error.message).toContain(
        "missing required argument 'project-name|project-path"
      )
    }
  }, 30000)

  describe('using the --template flag', () => {
    it.each(ALL_TEMPLATES)(
      `creates the "$name" extension template`,
      async (template) => {
        const extensionPath = path.join(__dirname, '..', 'dist', template.name)
        await extensionProgram(
          `create ${extensionPath} --template="${template.name}"`
        )

        // UI frameworks will use either tsx or jsx files.
        // Non-UI frameworks will use either ts or js files.
        // TODO: cezaraugusto this is not going to scale well
        // but better than nothing for now.
        const ext = template.uiFramework
          ? template.configFiles?.includes('tsconfig.json')
            ? template.uiFramework === 'vue'
              ? 'ts'
              : 'tsx'
            : template.uiFramework === 'vue'
              ? 'js'
              : 'jsx'
          : template.configFiles?.includes('tsconfig.json')
            ? 'ts'
            : 'js'

        template.uiContext?.forEach((context: string) => {
          // Expect [context]/index.html for all contexts except 'content'
          if (context !== 'content') {
            expect(
              fileExists(template.name, `${context.toLowerCase()}/index.html`)
            ).toBeTruthy()
          }

          // Expect [uiContext]/[uiContext].[ext] for scripts
          expect(
            fileExists(template.name, `${context.toLowerCase()}/scripts.${ext}`)
          ).toBeTruthy()

          // Expect [uiContext]/styles.css for styles
          expect(
            fileExists(template.name, `${context.toLowerCase()}/styles.css`)
          ).toBeTruthy()

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

        // Expect images/icons/icon_16.png and expect images/icons/icon_16.png
        if (template.name !== 'init') {
          expect(
            fileExists(template.name, 'images/icons/icon_16.png')
          ).toBeTruthy()
          expect(
            fileExists(template.name, 'images/icons/icon_48.png')
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

        // TODO: Expect project to be a .git project
        // See https://github.com/extension-js/extension.js/issues/54
        // expect(fileExists(template.name, '.git')).toBeTruthy()

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
      ALL_TEMPLATES.length * 50000
    )
  })
})
