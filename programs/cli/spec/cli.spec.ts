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
import mockFs from 'mock-fs'

const execAsync = promisify(exec)

async function executeCLI(command: string = '', options: string[] = []) {
  const cliCommand = `ts-node ${path.join(
    __dirname,
    '..',
    'dist',
    'cli.js'
  )} ${command} ${options.join(' ')}`
  return await execAsync(cliCommand)
}

async function removeDir(dirPath: string) {
  if (fs.existsSync(dirPath)) {
    await fs.promises.rmdir(dirPath, {recursive: true})
  }
}

describe('CLI Commands', () => {
  describe('The CLI itself', () => {
    const extensionPath = path.join(__dirname, '..', 'my-extension')
    const customPath = path.join(__dirname, '..', 'my-custom-path')

    beforeEach(async () => {
      await removeDir(extensionPath)
      await removeDir(customPath)
      mockFs.restore()
    })

    it('throws an error if no command is provided', async () => {
      try {
        await executeCLI()
      } catch (error: any) {
        expect(error).toBeTruthy()
        expect(error.message).toContain(
          "missing required argument 'project-name'"
        )
      }
    })

    it('should exit if Node version is less than 18', async () => {
      Object.defineProperty(process, 'version', {value: 'v17.0.0'})

      try {
        await executeCLI('create my-extension')
      } catch (error: any) {
        expect(error).toBeTruthy()
        expect(error.message).toContain('unsupportedNodeVersion')
      }

      Object.defineProperty(process, 'version', {value: 'v18.0.0'})
    })

    it('should display the help message', async () => {
      const {stdout} = await executeCLI('', ['--help'])
      expect(stdout).toContain('Usage:')
    })
  })

  describe('Create Command', () => {
    const extensionPath = path.join(__dirname, '..', 'my-extension')
    const customPath = path.join(__dirname, '..', 'my-custom-path')

    beforeEach(async () => {
      await removeDir(extensionPath)
      await removeDir(customPath)
      mockFs.restore()
    })

    it('throws an error if target directory has conflicting files', async () => {
      mockFs({
        'my-extension': {
          'package.json': 'some content'
        }
      })

      try {
        await executeCLI('create my-extension')
      } catch (error: any) {
        expect(error).toBeTruthy()
        expect(error.message).toContain('includes conflicting files')
      }
    })

    it('throws an error if no project name is provided', async () => {
      try {
        await executeCLI('create')
      } catch (error: any) {
        expect(error).toBeTruthy()
        expect(error.message).toContain(
          "missing required argument 'project-name'"
        )
      }
    })

    it('creates a new extension', async () => {
      const extensionPath = path.join(__dirname, '..', 'my-extension')
      await executeCLI('create my-extension')
      expect(fs.existsSync(extensionPath)).toBeTruthy()
    })

    it('creates a new extension from a react template', async () => {
      const extensionPath = path.join(__dirname, '..', 'my-extension')
      await executeCLI('create my-extension --template react')
      expect(fs.existsSync(extensionPath)).toBeTruthy()
    })

    it('creates a new extension from a typescript template', async () => {
      const extensionPath = path.join(__dirname, '..', 'my-extension')
      await executeCLI('create my-extension --template typescript')
      expect(fs.existsSync(extensionPath)).toBeTruthy()
    })

    it('creates a new extension from a react-typescript template', async () => {
      const extensionPath = path.join(__dirname, '..', 'my-extension')
      await executeCLI('create my-extension --template react-typescript')
      expect(fs.existsSync(extensionPath)).toBeTruthy()
    })

    it('creates a new extension in a custom output directory', async () => {
      const extensionPath = path.join(__dirname, '..', 'my-custom-path')
      await executeCLI('create my-custom-path/my-extension')
      expect(fs.existsSync(extensionPath)).toBeTruthy()
    })

    it('creates a new extension from a template in a custom output directory.', async () => {
      const extensionPath = path.join(__dirname, '..', 'my-custom-path')
      await executeCLI('create my-custom-path/my-extension --template react')
      expect(fs.existsSync(extensionPath)).toBeTruthy()
    })
  })

  describe.skip('Dev Command', () => {
    // beforeAll(async () => {
    //   // Create an extension we can work with
    //   await executeCLI('create my-extension')
    // })

    // afterAll(async () => {
    //   // Remove the extension we created
    //   await removeDir(path.join(__dirname, '..', 'my-extension'))
    // })

    // it('should start extension in development mode', async () => {
    //   const {stdout} = await executeCLI('dev my-extension')
    //   expect(stdout).toContain('Starting development server')
    // })

    /**
     * can develop an extension (assert updating html outptus the update part)
     * can develop an extension from a remote url
     * can start an extension in a custom output directory
     * can launch without a browser
     * can launch using chrome
     * can launch using edge
     * can launch with a custom user data dir
     * can launch without a polyfill (TODO)
     * can launch with a custom port
     */
  })

  describe.skip('Start Command', () => {
  /**
   * can start an extension
   * can start an extension from a remote url
   * can start an extension in a custom output directory
   * can launch without a browser
   * can launch using chrome
   * can launch using edge
   * can launch with a custom user data dir
   * can launch without a polyfill
   * can launch with a custom port
   */
  })

  describe.skip('Build Command', () => {
    /**
     * can build an extension
     * can build an extension with chrome
     * can build an extension with edge
     * can build without a polyfill
     */
  })
})
