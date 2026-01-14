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

export function contentScripts(manifest: Manifest) {
  if (!manifest.content_scripts) return undefined

  const original = manifest.content_scripts as any[]
  const originalCount = original.length
  const result: any[] = []

  // 1) Keep user-defined content scripts indices stable
  for (let index = 0; index < original.length; index++) {
    const contentObj: ContentObj = original[index] || {}
    // Manifest overrides work by getting the manifest.json
    // before compilation and re-naming the files to be
    // bundled. But in reality the compilation returns here
    // all the bundled files into a single script plus the
    // public files path. The hack below is to prevent having
    // multiple bundles with the same name.
    const contentJs = [...new Set(contentObj.js || [])]
    const contentCss = [...new Set(contentObj.css || [])]

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

  // 2) For each MAIN world content script, append an isolated-world bridge script
  // so MAIN world can still load async chunks without chrome/browser globals.
  //
  // Important: we append bridges to avoid renaming user indices, and compute bridge
  // output filenames based on their appended index (originalCount + bridgeOrdinal).
  let bridgeOrdinal = 0
  for (let i = 0; i < original.length; i++) {
    const cs = original[i] as ContentObj & Record<string, any>
    if (!cs || cs.world !== 'MAIN') continue

    const bridgeIndex = originalCount + bridgeOrdinal++
    const {
      world: _ignoredWorld,
      js: _ignoredJs,
      css: _ignoredCss,
      ...rest
    } = cs as any

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

  return {content_scripts: result}
}
