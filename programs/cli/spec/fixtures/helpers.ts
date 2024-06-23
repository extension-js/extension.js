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
import {ALL_TEMPLATES} from './constants'

const execAsync = promisify(exec)

export async function extensionProgram(command: string = '') {
  const cliCommand = `ts-node ${path.join(
    __dirname,
    '..',
    '..',
    'dist',
    'cli.js'
  )} ${command}`
  return await execAsync(cliCommand)
}

export function fileExists(template: string, filePath?: string): boolean {
  const templatePath = path.join(__dirname, '..', '..', 'dist', template)
  return fs.existsSync(path.join(templatePath, filePath || ''))
}

export function distFileExists(template: string, 
  browser: string,
  filePath?: string): boolean {
  const templatePath = path.join(
    __dirname,
    template,
    'dist',
    browser
  )

  return fs.existsSync(path.join(templatePath, filePath || ''))
}

export async function removeDir(dirPath: string) {
  if (fs.existsSync(dirPath)) {
    await fs.promises.rm(dirPath, {recursive: true})
  }
}

export async function removeAllTemplateFolders() {
  await Promise.all(
    ALL_TEMPLATES.map(async (template) => {
      const templatePath = path.join(
        __dirname,
        '..',
        '..',
        'dist',
        template.name
      )

      await removeDir(templatePath)
      return true
    })
  )
}

export async function removeAllTemplateDistFolders() {
  await Promise.all(
    ALL_TEMPLATES.map(async (template) => {
      const templatePath = path.join(
        __dirname,
        'fixtures',
        template.name,
        'dist'
      )

      await removeDir(templatePath)
      return true
    })
  )
}
