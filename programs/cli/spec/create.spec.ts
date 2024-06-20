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
  const extensionPath = path.join(__dirname, '..', 'dist', 'my-extension')

  beforeEach(async () => {
    await removeDir(extensionPath)
  })

  afterAll(async () => {
    await removeDir(extensionPath)
  })

  it('throws an error if target directory has conflicting files', async () => {
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

  it('creates a new extension via "init" (default) template', async () => {
    await extensionProgram(`create ${extensionPath}`)

    // Expect folder to exist
    expect(fs.existsSync(extensionPath)).toBeTruthy()

    // Expect .gitignore to exist
    expect(fs.existsSync(path.join(extensionPath, '.gitignore'))).toBeTruthy()

    // Expect README.md to exist
    expect(fs.existsSync(path.join(extensionPath, 'README.md'))).toBeTruthy()

    // Expect package.json to exist
    expect(fs.existsSync(path.join(extensionPath, 'package.json'))).toBeTruthy()

    // Expect manifest.json to exist
    expect(
      fs.existsSync(path.join(extensionPath, 'manifest.json'))
    ).toBeTruthy()
  }, 50000)

  const TEMPLATE_NAME = 'chatgpt'
  const UI_CONTEXT = 'sidebar'
  const LOCK_FILE = 'yarn.lock'

  it(`creates a new extension via "${TEMPLATE_NAME}" template`, async () => {
    await extensionProgram(
      `create ${extensionPath} --template="${TEMPLATE_NAME}"`
    )

    // For all: Expect template folder to exist
    expect(fs.existsSync(extensionPath)).toBeTruthy()

    // For all: Expect public/icons/icon_16.png and expect public/icons/icon_16.png
    expect(
      fs.existsSync(path.join(extensionPath, 'public', 'icons', 'icon_16.png'))
    ).toBeTruthy()
    expect(
      fs.existsSync(path.join(extensionPath, 'public', 'icons', 'icon_48.png'))
    ).toBeTruthy()

    // For all: Expect public/[feature].png
    expect(
      fs.existsSync(path.join(extensionPath, 'public', `${TEMPLATE_NAME}.png`))
    ).toBeTruthy()

    // For all: Expect public/extension.png
    expect(
      fs.existsSync(path.join(extensionPath, 'public', 'extension.png'))
    ).toBeTruthy()

    // For all: Expect [uiContext]/index.html
    expect(
      fs.existsSync(path.join(extensionPath, UI_CONTEXT, 'index.html'))
    ).toBeTruthy()

    // For all: Expect [uiContext]/[uiContext].ts
    expect(
      fs.existsSync(path.join(extensionPath, UI_CONTEXT, 'sidebar.jsx'))
    ).toBeTruthy()

    // For all: Expect [UiContextApp].ts
    expect(
      fs.existsSync(path.join(extensionPath, UI_CONTEXT, 'SidebarApp.jsx'))
    ).toBeTruthy()

    // For all: Expect [uiContext]/styles.css
    expect(
      fs.existsSync(path.join(extensionPath, UI_CONTEXT, 'styles.css'))
    ).toBeTruthy()

    // For those who need it: Expect .env.sample
    expect(fs.existsSync(path.join(extensionPath, '.env.example'))).toBeTruthy()

    // For all: Expect manifest.json to exist
    expect(
      fs.existsSync(path.join(extensionPath, 'manifest.json'))
    ).toBeTruthy()

    // For tailwind-related: Expect postcss.config.js
    expect(
      fs.existsSync(path.join(extensionPath, 'postcss.config.js'))
    ).toBeTruthy()

    // Expect README.md to exist
    expect(fs.existsSync(path.join(extensionPath, 'README.md'))).toBeTruthy()

    // For tailwind-related: Expect tailwind.config.js
    expect(
      fs.existsSync(path.join(extensionPath, 'tailwind.config.js'))
    ).toBeTruthy()

    // Expect .gitignore to exist
    expect(fs.existsSync(path.join(extensionPath, '.gitignore'))).toBeTruthy()

    // Expect lock file to exist
    expect(fs.existsSync(path.join(extensionPath, LOCK_FILE))).toBeTruthy()

    // TODO: Expect project to be a .git project
    // See https://github.com/extension-js/extension.js/issues/54
  }, 50000)
})
