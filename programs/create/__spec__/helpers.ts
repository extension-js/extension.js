import path from 'path'
import fs from 'fs'
import {ALL_TEMPLATES} from '../../../examples/data'

export function fileExists(templateName: string, filePath?: string): boolean {
  const templatePath = path.resolve(__dirname, '..', 'dist', templateName)
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
      const templatePath = path.resolve(__dirname, '..', 'dist', template.name)

      console.log('Removing template:', templatePath)

      await removeDir(templatePath)
      return true
    })
  )
}
