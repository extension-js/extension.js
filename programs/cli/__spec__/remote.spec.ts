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
import {describe, it, expect, beforeAll, afterEach} from 'vitest'

const execFileAsync = promisify(execFile)

export async function extensionProgram(command: string = '') {
  const args = [
    'dlx',
    'extension@latest',
    ...(command ? command.split(' ') : [])
  ]
  return await execFileAsync('pnpm', args)
}

async function removeDirectory(dir: string) {
  if (fs.existsSync(dir)) {
    try {
      // First try to remove any Git-related files
      const gitDir = path.join(dir, '.git')
      if (fs.existsSync(gitDir)) {
        fs.rmSync(gitDir, {recursive: true, force: true})
      }

      // Then remove the directory
      fs.rmSync(dir, {recursive: true, force: true})
    } catch (error) {
      // If the first attempt fails, try with a delay
      await new Promise((resolve) => setTimeout(resolve, 1000))
      try {
        fs.rmSync(dir, {recursive: true, force: true})
      } catch (retryError) {
        console.error(`Failed to remove directory ${dir}:`, retryError)
      }
    }
  }
}

async function ensureDirectoryExists(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true})
  }
}

describe('CLI Commands', () => {
  const projectPath = path.join(__dirname, '..', 'dist', 'test-extension')

  beforeAll(async () => {
    // Ensure the parent directory exists
    await ensureDirectoryExists(path.dirname(projectPath))
    await removeDirectory(projectPath)
  })

  afterEach(async () => {
    await removeDirectory(projectPath)
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
    // Ensure the directory exists before running the command
    await ensureDirectoryExists(projectPath)

    try {
      await extensionProgram(`create ${projectPath} --template content-react`)
      expect(fs.existsSync(projectPath)).toBeTruthy()
    } catch (error: any) {
      console.error('Error creating extension:', error)
      throw error
    }
  }, 30000)

  it('should build the content-react template', async () => {
    // Ensure the directory exists before running the command
    await ensureDirectoryExists(projectPath)

    try {
      await extensionProgram(`create ${projectPath} --template content-react`)

      await execFileAsync('pnpm', ['install', '--ignore-workspace'], {
        cwd: projectPath
      })

      await execFileAsync('pnpm', ['build'], {cwd: projectPath})

      expect(
        fs.existsSync(path.join(projectPath, 'dist', 'chrome'))
      ).toBeTruthy()
    } catch (error: any) {
      console.error('Error building extension:', error)
      throw error
    }
  }, 30000)
})
