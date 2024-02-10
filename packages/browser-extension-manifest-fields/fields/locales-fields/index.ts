import path from 'path'
import fs from 'fs'
import {type Manifest} from '../../types'

export default function getLocaleFields(
  manifestPath: string,
  manifest: Manifest
): string[] | undefined {
  const localesFolder = path.join(path.dirname(manifestPath), '_locales')

  const localeFiles = []

  if (fs.existsSync(localesFolder)) {
    // Iterate over all major locale folders
    for (const locale of fs.readdirSync(localesFolder)) {
      const localeDir = path.join(localesFolder, locale)

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

  return localeFiles
}
