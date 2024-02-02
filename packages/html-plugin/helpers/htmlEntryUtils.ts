import path from 'path'
import manifestFields from 'browser-extension-manifest-fields'
import {getFilepath} from './getResourceName'

export function isManifestHtmlEntry(manifestPath: string, filePath: string) {
  const manifestHtmlEntries = Object.values(manifestFields(manifestPath).html)
  const htmlEntries = manifestHtmlEntries.map(
    (entry: any) => entry && entry.html
  )
  const htmlValues = htmlEntries.filter(Boolean)

  return htmlValues.includes(filePath)
}

export function getManifestHtmlEntry(manifestPath: string, filePath: string) {
  const manifestHtmlEntries = Object.entries(manifestFields(manifestPath).html)
  const manifestHtmlEntry = manifestHtmlEntries.find(
    ([key, value]) => value?.html === filePath
  )
  if (!manifestHtmlEntry?.length) return filePath

  return '/' + getFilepath(manifestHtmlEntry[0], filePath)
}
