import {type ManifestData} from './types.js'

export default function contentScript(manifest: ManifestData): ManifestData {
  if (!manifest || !manifest.content_scripts)
    return {[`content_scripts/script-0.js`]: undefined}

  const contentJs = (content: {css?: string[]; js?: string[]}) => {
    if (content.js?.length === 0) return undefined

    return content.js?.map((js) => {
      const contentAbsolutePath = js

      return contentAbsolutePath
    })
  }

  const contentCss = (content: {css?: string[]; js?: string[]}) => {
    if (content.css?.length === 0) return undefined

    return content.css?.map((css) => {
      const contentAbsolutePath = css

      return contentAbsolutePath
    })
  }

  const contentScriptsData: {[key: string]: string[]} = {}

  for (const [index, content] of manifest.content_scripts.entries()) {
    const js = contentJs(content)
    const css = contentCss(content)

    contentScriptsData[`content_scripts/script-${index}`] = [
      ...(js || []).filter((js) => js != null),
      ...(css || []).filter((css) => css != null)
    ]
  }

  return contentScriptsData
}
