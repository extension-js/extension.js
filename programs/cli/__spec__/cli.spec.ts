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
import {describe, it, expect} from 'vitest'

const execFileAsync = promisify(execFile)

async function waitForFile(
  filePath: string,
  timeoutMs: number = 5000,
  intervalMs: number = 50
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`File not found in time: ${filePath}`)
}

export async function extensionProgram(command: string = '') {
  const cliDirectory = path.join(__dirname, '..', 'dist', 'cli.js')
  const args = command ? command.split(' ') : []
  return await execFileAsync('node', [cliDirectory, ...args])
}

async function extensionProgramWithPnpm(command: string = '') {
  const args = ['extension']
  if (command) {
    args.push(...command.split(' '))
  }
  // Execute from repo root to ensure root script is resolved
  const cwd = path.resolve(__dirname, '..', '..', '..')
  return await execFileAsync('pnpm', args, {cwd})
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

  it('pnpm extension --help prints help', async () => {
    const {stdout} = await extensionProgramWithPnpm('--help')
    expect(stdout).toContain('Usage: extension')
  }, 30000)

  it('pnpm extension --ai-help prints AI guidance', async () => {
    const {stdout} = await extensionProgramWithPnpm('--ai-help')
    expect(stdout).toContain('Development tips')
    expect(stdout).toContain('Source Inspection')
    expect(stdout).toContain('Special Folders')
  }, 30000)

  it('pnpm extension build works on an example (chrome)', async () => {
    const exampleDir = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'examples',
      'content-typescript'
    )
    const {stdout} = await extensionProgramWithPnpm(
      `build ${exampleDir} --browser chrome --silent true`
    )
    expect(stdout).toBeTypeOf('string')
    const manifest = path.join(exampleDir, 'dist', 'chrome', 'manifest.json')
    await waitForFile(manifest)
    expect(fs.existsSync(manifest)).toBeTruthy()
  }, 60000)

  it('pnpm extension build handles comma-separated vendors', async () => {
    const exampleDir = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'examples',
      'content-typescript'
    )
    const {stdout} = await extensionProgramWithPnpm(
      `build ${exampleDir} --browser chrome,edge`
    )
    expect(stdout).toBeTypeOf('string')
    const manifest = path.join(exampleDir, 'dist', 'chrome', 'manifest.json')
    await waitForFile(manifest)
    expect(fs.existsSync(manifest)).toBeTruthy()
  }, 60000)
})
