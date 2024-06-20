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

describe('CLI Commands', () => {
  describe('The CLI itself', () => {
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

  // describe.skip('Create Command', () => {
  //   const extensionPath = path.join(__dirname, '..', 'my-extension')
  //   const customPath = path.join(__dirname, '..', 'my-custom-path')

  //   beforeEach(async () => {
  //     await removeDir(extensionPath)
  //     await removeDir(customPath)
  //     mockFs.restore()
  //   })

  //   afterAll(async () => {
  //     await removeDir(extensionPath)
  //     await removeDir(customPath)
  //   })

  //   it('throws an error if target directory has conflicting files', async () => {
  //     mockFs({
  //       'my-extension': {
  //         'package.json': 'some content'
  //       }
  //     })

  //     try {
  //       await extensionProgram('create my-extension')
  //     } catch (error: any) {
  //       expect(error).toBeTruthy()
  //       expect(error.message).toContain('includes conflicting files')
  //     }
  //   })

  //   it('throws an error if no project name is provided', async () => {
  //     try {
  //       await extensionProgram('create')
  //     } catch (error: any) {
  //       expect(error).toBeTruthy()
  //       expect(error.message).toContain(
  //         "missing required argument 'project-name|project-path"
  //       )
  //     }
  //   })

  //   it('creates a new extension', async () => {
  //     const extensionPath = path.join(__dirname, '..', 'my-extension')
  //     await extensionProgram('create my-extension')
  //     expect(fs.existsSync(extensionPath)).toBeTruthy()
  //   })

  //   it('creates a new extension from a react template', async () => {
  //     const extensionPath = path.join(__dirname, '..', 'my-extension')
  //     await extensionProgram('create my-extension --template react')
  //     expect(fs.existsSync(extensionPath)).toBeTruthy()
  //   })

  //   it('creates a new extension from a typescript template', async () => {
  //     const extensionPath = path.join(__dirname, '..', 'my-extension')
  //     await extensionProgram('create my-extension --template typescript')
  //     expect(fs.existsSync(extensionPath)).toBeTruthy()
  //   })

  //   it('creates a new extension from a react-typescript template', async () => {
  //     const extensionPath = path.join(__dirname, '..', 'my-extension')
  //     await extensionProgram('create my-extension --template react-typescript')
  //     expect(fs.existsSync(extensionPath)).toBeTruthy()
  //   })

  //   it('creates a new extension in a custom output directory', async () => {
  //     const extensionPath = path.join(__dirname, '..', 'my-custom-path')
  //     await extensionProgram('create my-custom-path/my-extension')
  //     expect(fs.existsSync(extensionPath)).toBeTruthy()
  //   })

  //   it('creates a new extension from a template in a custom output directory.', async () => {
  //     const extensionPath = path.join(__dirname, '..', 'my-custom-path')
  //     await extensionProgram('create my-custom-path/my-extension --template react')
  //     expect(fs.existsSync(extensionPath)).toBeTruthy()
  //   })
  // })

  // describe.skip('Dev Command', () => {
  //   /**
  //    * can develop an extension
  //    * can develop an extension from a remote url
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
  //    * can start an extension from a remote url
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
