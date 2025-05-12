import * as path from 'path'
import * as fs from 'fs'

export function getLocales(manifestPath: string): string[] | undefined {
  const localesFolder = path.join(path.dirname(manifestPath), '_locales')

  const localeFiles: string[] = []

  if (fs.existsSync(localesFolder)) {
    // Iterate over all major locale folders
    for (const locale of fs.readdirSync(localesFolder)) {
      const localeDir = path.join(localesFolder, locale)

      if (localeDir && fs.statSync(localeDir).isDirectory()) {
        for (const localeEntity of fs.readdirSync(localeDir)) {
          localeFiles.push(
            path.join(
              path.dirname(manifestPath),
              '_locales',
              locale,
              localeEntity
            )
          )
        }
      }
    }
  }

  return localeFiles
}
