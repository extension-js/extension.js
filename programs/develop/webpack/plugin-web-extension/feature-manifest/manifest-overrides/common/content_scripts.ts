// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {getFilename} from '../../manifest-lib/paths'
import {type Manifest} from '../../../../webpack-types'

interface ContentObj {
  js?: string[] | undefined
  css?: string[] | undefined
  // Chromium-only (MV3+) field
  world?: 'MAIN' | 'ISOLATED' | string | undefined
}

export function contentScripts(manifest: Manifest, manifestPath?: string) {
  if (!manifest.content_scripts) return undefined

  const original = manifest.content_scripts as any[]
  const originalCount = original.length
  const result: any[] = []

  // 1) Keep user-defined content scripts indices stable and
  // insert MAIN-world bridges *before* their MAIN-world entries.
  //
  // Bridge order matters: it must run first so MAIN world can read the
  // extension base URL before HMR initializes.
  let bridgeOrdinal = 0
  for (let index = 0; index < original.length; index++) {
    const contentObj: ContentObj & Record<string, any> = original[index] || {}
    // Manifest overrides work by getting the manifest.json
    // before compilation and re-naming the files to be
    // bundled. But in reality the compilation returns here
    // all the bundled files into a single script plus the
    // public files path. The hack below is to prevent having
    // multiple bundles with the same name.
    const contentJs = [...new Set(contentObj.js || [])]
    const contentCss = [...new Set(contentObj.css || [])]

    if (contentObj.world === 'MAIN') {
      const bridgeIndex = originalCount + bridgeOrdinal++
      const {
        world: _ignoredWorld,
        js: _ignoredJs,
        css: _ignoredCss,
        ...rest
      } = contentObj as any

      result.push({
        ...rest,
        // Default world (isolated) – omit "world" for cross-browser compatibility.
        js: [
          getFilename(
            `content_scripts/content-${bridgeIndex}.js`,
            'main-world-bridge.js'
          )
        ],
        css: []
      })
    }

    result.push({
      ...(original[index] || {}),
      js: contentJs.map((js: string) =>
        getFilename(`content_scripts/content-${index}.js`, js)
      ),
      css: contentCss.map((css: string) =>
        getFilename(`content_scripts/content-${index}.css`, css)
      )
    })
  }

  return {content_scripts: result}
}
