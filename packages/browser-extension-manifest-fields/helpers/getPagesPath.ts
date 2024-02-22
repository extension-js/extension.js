import fs from 'fs'
import path from 'path'
import getAssetsFromHtml, {type ParsedHtmlAsset} from './getHtmlFileResources'

type PagesPath = Record<string, (ParsedHtmlAsset & {html: string}) | undefined>

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
      const filename = path.basename(file, '.html')

      pagesPath[`pages/${filename}`] = {
        ...getAssetsFromHtml(filePath),
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
