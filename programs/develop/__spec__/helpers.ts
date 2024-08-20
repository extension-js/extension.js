import path from 'path'
import fs from 'fs'
import {ALL_TEMPLATES} from '../../../examples/data'

export async function removeDir(dirPath: string) {
  if (fs.existsSync(dirPath)) {
    await fs.promises.rm(dirPath, {recursive: true})
  }
}

export async function removeAllTemplateDistFolders() {
  await Promise.all(
    ALL_TEMPLATES.map(async (template) => {
      const templatePath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'examples',
        template.name,
        'dist'
      )

      await removeDir(templatePath)
      return true
    })
  )
}
