import path from 'path'
import {type Manifest} from '../../../../webpack-types'

export function contentScripts(
  context: string,
  manifest: Manifest
): Record<string, string[] | undefined> {
  if (!manifest || !manifest.content_scripts)
    return {[`content_scripts/content-0`]: undefined}

  const contentJs = (content: {css?: string[]; js?: string[]}) => {
    if (content.js?.length === 0) return undefined

    return content.js?.map((js) => {
      const contentPath = path.join(context, js)

      return contentPath
    })
  }

  const contentCss = (content: {css?: string[]; js?: string[]}) => {
    if (content.css?.length === 0) return undefined

    return content.css?.map((css) => {
      const contentPath = path.join(context, css)

      return contentPath
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
