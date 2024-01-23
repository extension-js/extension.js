import fs from 'fs'
import path from 'path'
import getAssetsFromHtml, {ParsedHtmlAsset} from '../lib/getAssetsFromHtml'

interface PagesPath {
  [key: string]: (ParsedHtmlAsset & {html?: string}) | undefined
}

function findHtmlFiles(
  dir: string,
  pagesPath: Record<string, any> = {}
): PagesPath {
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
        ...getAssetsFromHtml(filePath),
        html: filePath
      }
    }
  })

  return pagesPath
}

export default function getPagesPath(pagePath?: string): PagesPath {
  if (!pagePath) return {}

  const pagesPath = findHtmlFiles(pagePath)

  return pagesPath
}
