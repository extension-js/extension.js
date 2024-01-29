import path from 'path'
import {type ManifestData} from '../resolver-module/types'

export default function contentScript(
  manifestPath: string,
  manifest: ManifestData
): ManifestData {
  if (!manifest || !manifest.content_scripts)
    return {[`content_scripts-0`]: undefined}

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

    contentScriptsData[`content_scripts-${index}`] = [
      // contentScriptsData.content_scripts = [
      ...(js || []).filter((js) => js != null),
      ...(css || []).filter((css) => css != null)
    ]
  }

  return contentScriptsData
}
