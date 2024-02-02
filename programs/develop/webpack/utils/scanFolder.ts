import fs from 'fs'
import path from 'path'
import {getScriptResolveExtensions} from '../config/getPath'

interface PagesPath {
  [key: string]: string | undefined
}

interface ScriptsPath extends PagesPath {}

export function findHtmlFiles(
  dir: string,
  pagesPath: Record<string, any> = {}
): PagesPath | undefined {
  if (!pagesPath) return {}
  if (!fs.existsSync(dir)) return undefined

  const files = fs.readdirSync(dir)
  const basename = path.basename(dir)

  files.forEach((file) => {
    const filePath = path.join(dir, file)
    const fileStat = fs.statSync(filePath)

    if (fileStat.isDirectory()) {
      findHtmlFiles(filePath, pagesPath)
    } else if (file.endsWith('.html')) {
      const name = path.basename(file, '.html')
      const dirName = path.basename(dir)
      const pageName = name === 'index' ? dirName : name

      // Like "pages/my_file_name"
      pagesPath[`${basename}/${pageName}`] = filePath
    }
  })

  return pagesPath
}

export function findScriptFiles(
  projectPath: string,
  dir: string,
  scriptsPath: Record<string, any> = {}
): ScriptsPath | undefined {
  if (!scriptsPath) return {}
  if (!fs.existsSync(dir)) return undefined

  const files = fs.readdirSync(dir)
  const basename = path.basename(dir)

  files.forEach((file) => {
    const filePath = path.join(dir, file)
    const fileStat = fs.statSync(filePath)
    const ext = path.extname(file)
    const hasValidExt = getScriptResolveExtensions(projectPath).includes(ext)

    if (fileStat.isDirectory()) {
      findScriptFiles(projectPath, filePath, scriptsPath)
    } else if (hasValidExt) {
      const name = path.basename(file, ext)
      const dirName = path.basename(dir)
      const scriptName = name === 'index' ? dirName : name

      scriptsPath[`${basename}/${scriptName}`] = filePath
    }
  })

  return scriptsPath
}
