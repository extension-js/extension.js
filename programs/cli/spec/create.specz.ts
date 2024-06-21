//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import path from 'path'
import fs from 'fs'
import {exec} from 'child_process'
import {promisify} from 'util'
import {
  ALL_TEMPLATES,
  BROWSERS,
  CUSTOM_TEMPLATES,
  DEFAULT_TEMPLATES
} from './constants'

const execAsync = promisify(exec)

async function extensionProgram(command: string = '') {
  const cliCommand = `ts-node ${path.join(
    __dirname,
    '..',
    'dist',
    'cli.js'
  )} ${command}`
  return await execAsync(cliCommand)
}

async function removeDir(dirPath: string) {
  if (fs.existsSync(dirPath)) {
    await fs.promises.rm(dirPath, {recursive: true})
  }
}

describe('extension create', () => {
  beforeEach(async () => {
    ALL_TEMPLATES.map(async (template) => {
      const templatePath = path.join(
        __dirname,
        'fixtures',
        template,
        'dist',
        BROWSERS[0]
      )

      await removeDir(templatePath)
      return true
    })
  })

  it('throws an error if target directory has conflicting files', async () => {
    const extensionPath = path.join(__dirname, '..', 'dist', 'init')

    try {
      // Create first
      await extensionProgram(`create ${extensionPath}`)

      // Try recreating on top of existing directory.
      await extensionProgram(`create ${extensionPath}`)
    } catch (error: any) {
      expect(error).toBeTruthy()
      expect(error.message).toContain('includes conflicting files')
    }
  }, 30000)

  it('throws an error if no project name is provided', async () => {
    try {
      await extensionProgram('create')
    } catch (error: any) {
      expect(error).toBeTruthy()
      expect(error.message).toContain(
        "missing required argument 'project-name|project-path"
      )
    }
  })

  it.each(DEFAULT_TEMPLATES)(
    'creates a new default extension via "%s" template',
    async (template) => {
      const templatePath = path.join(__dirname, 'fixtures', template)

      await extensionProgram(`create ${templatePath}`)

      // Expect folder to exist
      expect(fs.existsSync(templatePath)).toBeTruthy()

      // Expect .gitignore to exist
      expect(fs.existsSync(path.join(templatePath, '.gitignore'))).toBeTruthy()

      // Expect README.md to exist
      expect(fs.existsSync(path.join(templatePath, 'README.md'))).toBeTruthy()

      // Expect package.json to exist
      expect(
        fs.existsSync(path.join(templatePath, 'package.json'))
      ).toBeTruthy()

      // Expect manifest.json to exist
      expect(
        fs.existsSync(path.join(templatePath, 'manifest.json'))
      ).toBeTruthy()
    },
    50000
  )

  const UI_CONTEXT = 'sidebar'
  const LOCK_FILE = 'yarn.lock'

  it.each(CUSTOM_TEMPLATES)(
    `creates a new extension via "%s" template`,
    async (template) => {
      const templatePath = path.join(__dirname, 'fixtures', template)

      await extensionProgram(`create ${templatePath} --template="${template}"`)

      // For all: Expect template folder to exist
      expect(fs.existsSync(templatePath)).toBeTruthy()

      // For all: Expect public/icons/icon_16.png and expect public/icons/icon_16.png
      expect(
        fs.existsSync(path.join(templatePath, 'public', 'icons', 'icon_16.png'))
      ).toBeTruthy()
      expect(
        fs.existsSync(path.join(templatePath, 'public', 'icons', 'icon_48.png'))
      ).toBeTruthy()

      // For all: Expect public/[feature].png
      expect(
        fs.existsSync(path.join(templatePath, 'public', `${template}.png`))
      ).toBeTruthy()

      // For all: Expect public/extension.png
      expect(
        fs.existsSync(path.join(templatePath, 'public', 'extension.png'))
      ).toBeTruthy()

      // For all: Expect [uiContext]/index.html
      expect(
        fs.existsSync(path.join(templatePath, UI_CONTEXT, 'index.html'))
      ).toBeTruthy()

      // For all: Expect [uiContext]/[uiContext].ts
      expect(
        fs.existsSync(path.join(templatePath, UI_CONTEXT, 'sidebar.jsx'))
      ).toBeTruthy()

      // For all: Expect [UiContextApp].ts
      expect(
        fs.existsSync(path.join(templatePath, UI_CONTEXT, 'SidebarApp.jsx'))
      ).toBeTruthy()

      // For all: Expect [uiContext]/styles.css
      expect(
        fs.existsSync(path.join(templatePath, UI_CONTEXT, 'styles.css'))
      ).toBeTruthy()

      // For those who need it: Expect .env.sample
      expect(
        fs.existsSync(path.join(templatePath, '.env.example'))
      ).toBeTruthy()

      // For all: Expect manifest.json to exist
      expect(
        fs.existsSync(path.join(templatePath, 'manifest.json'))
      ).toBeTruthy()

      // For tailwind-related: Expect postcss.config.js
      expect(
        fs.existsSync(path.join(templatePath, 'postcss.config.js'))
      ).toBeTruthy()

      // Expect README.md to exist
      expect(fs.existsSync(path.join(templatePath, 'README.md'))).toBeTruthy()

      // For tailwind-related: Expect tailwind.config.js
      expect(
        fs.existsSync(path.join(templatePath, 'tailwind.config.js'))
      ).toBeTruthy()

      // Expect .gitignore to exist
      expect(fs.existsSync(path.join(templatePath, '.gitignore'))).toBeTruthy()

      // Expect lock file to exist
      expect(fs.existsSync(path.join(templatePath, LOCK_FILE))).toBeTruthy()

      // TODO: Expect project to be a .git project
      // See https://github.com/extension-js/extension.js/issues/54
    },
    50000
  )
})
