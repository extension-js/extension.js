//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import path from 'path'
import fs from 'fs'
import {execFile} from 'child_process'
import {promisify} from 'util'
import {describe, it, expect} from 'vitest'

const execFileAsync = promisify(execFile)

function getDirname(importMetaUrl: string) {
  return path.dirname(importMetaUrl)
}

const __dirname = getDirname(import.meta.url)

export async function extensionProgram(command: string = '') {
  const cliDirectory = path.resolve(__dirname, '..', 'dist', 'cli.js')
  const args = command ? command.split(' ') : []
  return await execFileAsync('node', [cliDirectory, ...args])
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

  it('should output the types/ folder by default', async () => {
    const typesDirectory = path.resolve(__dirname, '..', 'dist', 'types')
    expect(fs.existsSync(typesDirectory)).toBeTruthy()
  })
})
