import {type ManifestData} from './types.js'

type ContentScript = Array<{css?: string[]; js?: string[]}>
export default function contentScript(manifest: ManifestData): ManifestData {
  if (!manifest || !manifest.content_scripts)
    return {[`content_scripts/content-0.js`]: undefined}

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

  const contentScriptsData: Record<string, string[]> = {}

  const contentScripts: ContentScript = manifest.content_scripts

  for (const [index, content] of contentScripts.entries()) {
    const js = contentJs(content)
    const css = contentCss(content)

    contentScriptsData[`content_scripts/content-${index}`] = [
      ...(js || []).filter((js) => js != null),
      ...(css || []).filter((css) => css != null)
    ]
  }

  return contentScriptsData
}
