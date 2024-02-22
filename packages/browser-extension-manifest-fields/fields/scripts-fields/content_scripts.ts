import path from 'path'
import {type Manifest, type ManifestData} from '../../types'

export default function contentScript(
  manifestPath: string,
  manifest: Manifest
): Record<string, ManifestData> {
  if (!manifest || !manifest.content_scripts)
    return {[`content_scripts/content-0`]: undefined}

  const contentJs = (content: {css?: string[]; js?: string[]}) => {
    if (content.js?.length === 0) return undefined

    return content.js?.map((js) => {
      const contentAbsolutePath = path.join(path.dirname(manifestPath), js)

      return contentAbsolutePath
    })
  }

  const contentCss = (content: {css?: string[]; js?: string[]}) => {
    if (content.css?.length === 0) return undefined

    return content.css?.map((css) => {
      const contentAbsolutePath = path.join(path.dirname(manifestPath), css)

      return contentAbsolutePath
    })
  }

  const contentScriptsData: any = {}

  for (const [index, content] of manifest.content_scripts.entries()) {
    const js = contentJs(content)
    const css = contentCss(content)

    contentScriptsData[`content_scripts/content-${index}`] = [
      ...(js || []).filter((js) => js != null),
      ...(css || []).filter((css) => css != null)
    ]
  }

  return contentScriptsData
}
