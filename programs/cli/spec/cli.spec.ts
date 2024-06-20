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

// TODO: These tests take too long. They
// should run locally during development
// and in CI only when there is a release.

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

describe('CLI Commands', () => {
  describe.skip('extension ...args', () => {
    it('returns usage instructions if no command is provided', async () => {
      try {
        await extensionProgram()
      } catch (error: any) {
        expect(error).toBeTruthy()
        expect(error.message).toContain('Usage: extension [options] [command]')
      }
    })

    it('should display the help message', async () => {
      const {stdout} = await extensionProgram('--help')
      expect(stdout).toContain('Usage:')
    })
  })

  describe('extension create', () => {
    const extensionPath = path.join(__dirname, '..', 'dist', 'my-extension')

    beforeEach(async () => {
      // await removeDir(extensionPath)
    })

    afterAll(async () => {
      // await removeDir(extensionPath)
    })

    it.skip('throws an error if target directory has conflicting files', async () => {
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

    it.skip('throws an error if no project name is provided', async () => {
      try {
        await extensionProgram('create')
      } catch (error: any) {
        expect(error).toBeTruthy()
        expect(error.message).toContain(
          "missing required argument 'project-name|project-path"
        )
      }
    })

    it.skip('creates a new extension via "init" (default) template', async () => {
      await extensionProgram(`create ${extensionPath}`)

      // Expect folder to exist
      expect(fs.existsSync(extensionPath)).toBeTruthy()

      // Expect README.md to exist
      expect(fs.existsSync(path.join(extensionPath, 'README.md'))).toBeTruthy()

      // Expect manifest.json to exist
      expect(
        fs.existsSync(path.join(extensionPath, 'manifest.json'))
      ).toBeTruthy()
    }, 30000)

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
        fs.existsSync(
          path.join(extensionPath, 'public', 'icons', 'icon_16.png')
        )
      ).toBeTruthy()
      expect(
        fs.existsSync(
          path.join(extensionPath, 'public', 'icons', 'icon_48.png')
        )
      ).toBeTruthy()

      // For all: Expect public/[feature].png
      expect(
        fs.existsSync(
          path.join(extensionPath, 'public', `${TEMPLATE_NAME}.png`)
        )
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
      expect(
        fs.existsSync(path.join(extensionPath, '.env.example'))
      ).toBeTruthy()

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
    }, 100000)

    // it('creates a new extension via react template', async () => {
    //   await extensionProgram('create my-extension --template react')
    //   expect(fs.existsSync(extensionPath)).toBeTruthy()
    // })

    // it('creates a new extension via typescript template', async () => {
    //   await extensionProgram('create my-extension --template typescript')
    //   expect(fs.existsSync(extensionPath)).toBeTruthy()
    // })

    // it('creates a new extension via react-typescript template', async () => {
    //   await extensionProgram('create my-extension --template react-typescript')
    //   expect(fs.existsSync(extensionPath)).toBeTruthy()
    // })

    // it('creates a new extension in a custom output directory', async () => {
    //   const extensionPath = path.join(__dirname, '..', 'my-custom-path')
    //   await extensionProgram('create my-custom-path/my-extension')
    //   expect(fs.existsSync(extensionPath)).toBeTruthy()
    // })

    // it('creates a new extension via template in a custom output directory.', async () => {
    //   const extensionPath = path.join(__dirname, '..', 'my-custom-path')
    //   await extensionProgram('create my-custom-path/my-extension --template react')
    //   expect(fs.existsSync(extensionPath)).toBeTruthy()
    // })
  })

  // describe.skip('Dev Command', () => {
  //   /**
  //    * can develop an extension
  //    * can develop an extension via remote url
  //    * can start an extension in a custom output directory
  //    * can launch using chrome
  //    * can launch using edge
  //    * can launch using firefox
  //    * can launch with a custom user data dir
  //    * can launch without a polyfill (TODO)
  //    * can launch with a custom port
  //    */
  // })

  // describe.skip('Start Command', () => {
  //   /**
  //    * can start an extension
  //    * can start an extension via remote url
  //    * can start an extension in a custom output directory
  //    * can launch using chrome
  //    * can launch using edge
  //    * can launch using firefox
  //    * can launch with a custom user data dir
  //    * can launch without a polyfill
  //    * can launch with a custom port
  //    */
  // })

  // describe.skip('Build Command', () => {
  //   /**
  //    * can build an extension
  //    * can build an extension with chrome
  //    * can build an extension with edge
  //    * can build an extension with firefox
  //    * can build without a polyfill
  //    */
  // })
})
