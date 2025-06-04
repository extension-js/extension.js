//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import * as path from 'path'
import * as fs from 'fs'
import {execFile} from 'child_process'
import {promisify} from 'util'
import {describe, it, expect, beforeAll} from 'vitest'

const execFileAsync = promisify(execFile)

export async function extensionProgram(command: string = '') {
  const args = [
    'dlx',
    'extension@latest',
    ...(command ? command.split(' ') : [])
  ]
  return await execFileAsync('pnpm', args)
}

describe.skip('CLI Commands', () => {
  beforeAll(async () => {
    // Clean up dist folder
    fs.rmSync(path.join(__dirname, '..', 'dist', 'test-extension'), {
      recursive: true,
      force: true
    })
  })

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

  it('should create a new extension project', async () => {
    const projectPath = path.join(__dirname, '..', 'dist', 'test-extension')
    await extensionProgram(`create ${projectPath} --template content-react`)
    expect(fs.existsSync(projectPath)).toBeTruthy()

    // Clean up
    fs.rmSync(projectPath, {recursive: true, force: true})
  }, 30000)

  it('should build the content-react template', async () => {
    const projectPath = path.join(__dirname, '..', 'dist', 'test-extension')

    await extensionProgram(`create ${projectPath} --template content-react`)

    const files = fs.readdirSync(projectPath)
    for (const file of files) {
      if (fs.statSync(path.join(projectPath, file)).isDirectory()) {
        await execFileAsync('pnpm', ['install', '--ignore-workspace'], {
          cwd: path.join(projectPath, file)
        })
      }
    }

    await execFileAsync('pnpm', ['build'], {cwd: projectPath})

    expect(fs.existsSync(path.join(projectPath, 'dist', 'chrome'))).toBeTruthy()

    fs.rmSync(projectPath, {recursive: true, force: true})
  }, 30000)
})
