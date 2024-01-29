import fs from 'fs'
import path from 'path'

interface PagesPath {
  [key: string]: (any & {html: string}) | undefined
}

function findHtmlFiles(
  dir: string,
  pagesPath: Record<string, any> = {}
): PagesPath | undefined {
  if (!fs.existsSync(dir)) return undefined

  const files = fs.readdirSync(dir)

  files.forEach((file) => {
    const filePath = path.join(dir, file)
    const fileStat = fs.statSync(filePath)

    if (fileStat.isDirectory()) {
      findHtmlFiles(filePath, pagesPath)
    } else if (file.endsWith('.html')) {
      const name = path.basename(file, '.html')
      const dirName = path.basename(dir)
      const pageName = name === 'index' ? dirName : name

      pagesPath[`pages/${pageName}`] = {
        html: filePath
      }
    }
  })

  return pagesPath
}

export default function getPagesPath(pagePath?: string): PagesPath | undefined {
  if (!pagePath) return {}

  const pagesPath = findHtmlFiles(pagePath)

  return pagesPath
}
