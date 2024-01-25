import path from 'path'
import webpack from 'webpack'
import manifestFields from 'browser-extension-manifest-fields'
import {getFilepath} from './getResourceName'

// Example utility function
export function logMessage(message: string): void {
  console.log(message)
}

export function isUrl(path: string) {
  try {
    new URL(path)
    return true
  } catch (_) {
    return false
  }
}

export function isPublicPath(context: string, relativePath: string) {
  const publicDir = path.resolve(context, 'public')
  const absolutePath = path.resolve(context, relativePath)
  return absolutePath.startsWith(publicDir)
}

export function isPagesPath(context: string, relativePath: string) {
  const pagesDir = path.resolve(context, 'pages')
  const resultResolvedPath = path.resolve(context, relativePath)
  return resultResolvedPath.startsWith(pagesDir)
}

export function errorMessage(
  resultAbsolutePath: string,
  result: {path: string},
  resourcePath: string
) {
  return new webpack.WebpackError(
    `\nFile path ${resultAbsolutePath} not found. ` +
      `Check the request for ${result.path} in ${resourcePath}.`
  )
}

export function transformHtmlData(htmlData: {
  [key: string]:
    | {
        css: string[]
        html: string
        js: string[]
        static: string[]
      }
    | undefined
}) {
  const transformed = []

  for (const key in htmlData) {
    if (htmlData.hasOwnProperty(key) && htmlData[key]) {
      const css = htmlData[key]?.css || []
      const js = htmlData[key]?.js || []
      const staticFiles = htmlData[key]?.static || []
      const html = htmlData[key]?.html

      if (html) {
        transformed.push({
          [key]: [...css, ...js, ...staticFiles, html]
        })
      }
    }
  }

  return transformed
}

export function transformManifestData(manifestData: {
  [key: string]: string[] | string | undefined
}) {
  const transformed = []

  for (const key in manifestData) {
    if (manifestData.hasOwnProperty(key) && manifestData[key]) {
      let dataItems = manifestData[key] || []

      // If the property is not an array, convert it to an array
      if (!Array.isArray(dataItems)) {
        dataItems = [dataItems]
      }

      // Filter out any undefined values
      dataItems = dataItems.filter((item) => item !== undefined)

      if (dataItems.length > 0) {
        transformed.push({[key]: dataItems})
      }
    }
  }

  return transformed
}

export function getFlatManifestFields(context: string) {
  const manifestPath = path.join(context, 'manifest.json')

  const html = transformHtmlData(manifestFields(manifestPath).html)[0]
  const json = transformManifestData(manifestFields(manifestPath).json)[0]
  const scripts = transformManifestData(manifestFields(manifestPath).scripts)[0]

  return Object.entries({
    ...html,
    ...json,
    ...scripts
  })
}

export function assetAsManifestAsset(
  context: string,
  absolutePath: string,
  relativePath: string
) {
  const flatManifestFields = getFlatManifestFields(context)
  const assetAsManifestAsset = flatManifestFields.map(([feature, itemsArr]) => {
    if (itemsArr?.includes(absolutePath)) {
      return getFilepath(feature, relativePath)
    }

    return null
  })

  return assetAsManifestAsset.filter((item) => item !== null)[0]
}

export function isManifestAsset(context: string, absolutePath: string) {
  const flatManifestFields = getFlatManifestFields(context)
  const isManifestAsset = flatManifestFields.some(([feature, itemsArr]) =>
    itemsArr?.includes(absolutePath)
  )

  return isManifestAsset
}
