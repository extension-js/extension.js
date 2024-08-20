//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import path from 'path'
import {exec} from 'child_process'
import {promisify} from 'util'

const execAsync = promisify(exec)

export async function extensionProgram(command: string = '') {
  const cliDir = path.resolve(__dirname, '..', 'dist', 'cli.js')
  const cliCommand = `node ${cliDir} ${command}`
  return await execAsync(cliCommand)
}

describe('CLI Commands', () => {
  it('returns usage instructions if no command is provided', async () => {
    try {
      await extensionProgram()
    } catch (error: any) {
      expect(error).toBeTruthy()
      expect(error.message).toContain('Usage: extension [options] [command]')
    }
  }, 30000)

  it('should display the help message', async () => {
    const {stdout} = await extensionProgram('--help')
    expect(stdout).toContain('Usage:')
  }, 30000)
})
