// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import type {Compilation} from '@rspack/core'
import type {Manifest} from '../../../webpack-types'
import {
  getCanonicalContentScriptCssAssetName,
  getCanonicalContentScriptJsAssetName
} from '../../feature-scripts/contracts'

/**
 * After each dev compile, canonical content bundles emit as
 * `content_scripts/content-N.<fullhash>.js`. Point manifest `content_scripts` at those
 * filenames so page reloads load the same bytes as reinject (avoids stale cache).
 *
 * Also removes stale hashed files from previous builds so resolveEmittedContentScriptFile
 * always finds the current bundle unambiguously.
 */
export function patchDevContentScriptManifestPaths(
  compilation: Compilation,
  manifest: Manifest
): Manifest {
  if (compilation.options.mode !== 'development') return manifest
  const cs = manifest.content_scripts
  if (!Array.isArray(cs)) return manifest

  const assetNames = new Set(
    (compilation.getAssets?.() || []).map((a) => a.name || '').filter(Boolean)
  )

  const currentHashedNames = new Set<string>()
  const next = cs.map((group: Record<string, unknown>, groupIndex: number) => {
    const js = Array.isArray(group.js) ? [...(group.js as string[])] : []
    const css = Array.isArray(group.css) ? [...(group.css as string[])] : []
    const resolvedJs = js.map((p) =>
      resolveDevContentScriptDeclaredPath(p, groupIndex, 'js', assetNames)
    )
    const resolvedCss = css.map((p) =>
      resolveDevContentScriptDeclaredPath(p, groupIndex, 'css', assetNames)
    )
    for (const n of [...resolvedJs, ...resolvedCss]) currentHashedNames.add(n)
    return {...group, js: resolvedJs, css: resolvedCss}
  })

  purgeStaleHashedContentScripts(compilation, currentHashedNames)
  return {...manifest, content_scripts: next}
}

function resolveDevContentScriptDeclaredPath(
  declaredPath: string,
  groupIndex: number,
  ext: 'js' | 'css',
  assetNames: Set<string>
): string {
  const canonical =
    ext === 'js'
      ? getCanonicalContentScriptJsAssetName(groupIndex)
      : getCanonicalContentScriptCssAssetName(groupIndex)
  if (declaredPath !== canonical) return declaredPath

  const hashed = findHashedContentScriptAsset(assetNames, groupIndex, ext)
  return hashed || declaredPath
}

function findHashedContentScriptAsset(
  assetNames: Set<string>,
  groupIndex: number,
  ext: 'js' | 'css'
): string | undefined {
  const plain = `content_scripts/content-${groupIndex}.${ext}`
  if (assetNames.has(plain)) return plain

  const re = new RegExp(
    `^content_scripts/content-${groupIndex}\\.[a-f0-9]+\\.${ext}$`,
    'i'
  )
  for (const name of assetNames) {
    if (re.test(name)) return name
  }
  return undefined
}

/**
 * Delete hashed content script files from previous builds that are no longer
 * referenced by the manifest. Prevents ambiguity when resolving files by glob
 * and avoids unbounded disk growth during long dev sessions.
 */
function purgeStaleHashedContentScripts(
  compilation: Compilation,
  currentNames: Set<string>
) {
  const outputPath = compilation.options.output?.path
  if (!outputPath) return
  const csDir = path.join(outputPath, 'content_scripts')
  if (!fs.existsSync(csDir)) return

  const hashedRe = /^content-\d+\.[a-f0-9]+\.(js|css)(\.map)?$/i
  try {
    for (const name of fs.readdirSync(csDir)) {
      if (!hashedRe.test(name)) continue
      const rel = `content_scripts/${name}`
      if (currentNames.has(rel)) continue
      if (currentNames.has(rel.replace(/\.map$/, ''))) continue
      try {
        fs.unlinkSync(path.join(csDir, name))
      } catch {
        // Best-effort cleanup; ignore errors.
      }
    }
  } catch {
    // Ignore readdir failures.
  }
}
