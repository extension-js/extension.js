// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {
  getCanonicalContentScriptCssAssetName,
  getCanonicalContentScriptJsAssetName,
  parseCanonicalContentScriptAsset
} from '../../../feature-scripts/contracts'
import {getFilename} from '../../../shared/paths'

interface ContentObj {
  js?: string[] | undefined
  css?: string[] | undefined
  // Chromium-only (MV3+) field
  world?: 'MAIN' | 'ISOLATED' | string | undefined
}

function isBundledContentPath(filePath: string, ext: 'js' | 'css') {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  const bundledAsset = parseCanonicalContentScriptAsset(normalized)
  return bundledAsset?.extension === ext
}

function isAlreadyBundledContentScripts(contentScripts: unknown[]) {
  if (!Array.isArray(contentScripts) || contentScripts.length === 0)
    return false

  return (contentScripts as Array<{js?: unknown; css?: unknown}>).every(
    (contentObj) => {
      const js = Array.isArray(contentObj?.js) ? contentObj.js : []
      const css = Array.isArray(contentObj?.css) ? contentObj.css : []

      return (
        js.every((filePath: string) => isBundledContentPath(filePath, 'js')) &&
        css.every((filePath: string) => isBundledContentPath(filePath, 'css'))
      )
    }
  )
}

export function contentScripts(manifest: Manifest, manifestPath?: string) {
  if (!manifest.content_scripts) return undefined

  const original = manifest.content_scripts

  // Idempotency guard: re-applying the bridge insertion to an already-bundled
  // manifest would inflate the array and reference non-existent bundles.
  if (isAlreadyBundledContentScripts(original)) {
    return {content_scripts: original}
  }

  const originalCount = original.length
  const result: Array<Record<string, unknown>> = []

  // Keep user content-script indices stable; insert MAIN-world bridges before
  // their entries so MAIN world reads the base URL before HMR initializes.
  let bridgeOrdinal = 0
  for (let index = 0; index < original.length; index++) {
    const contentObj: ContentObj & Record<string, unknown> =
      original[index] || {}
    // The compilation bundles all files into a single script plus public
    // paths; dedupe below prevents multiple bundles with the same name.
    const contentJs = [...new Set(contentObj.js || [])]
    const contentCss = [...new Set(contentObj.css || [])]

    if (contentObj.world === 'MAIN') {
      const bridgeIndex = originalCount + bridgeOrdinal++
      const {
        world: _ignoredWorld,
        js: _ignoredJs,
        css: _ignoredCss,
        ...rest
      } = contentObj

      result.push({
        ...rest,
        // Default world (isolated) – omit "world" for cross-browser compatibility.
        js: [
          getFilename(
            getCanonicalContentScriptJsAssetName(bridgeIndex),
            'main-world-bridge.js'
          )
        ],
        css: []
      })
    }

    result.push({
      ...(original[index] || {}),
      js: [
        ...new Set(
          contentJs.map((js: string) =>
            getFilename(getCanonicalContentScriptJsAssetName(index), js)
          )
        )
      ],
      css: [
        ...new Set(
          contentCss.map((css: string) =>
            getFilename(getCanonicalContentScriptCssAssetName(index), css)
          )
        )
      ]
    })
  }

  return {content_scripts: result}
}
