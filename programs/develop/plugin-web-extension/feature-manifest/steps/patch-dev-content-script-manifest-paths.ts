// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import type {Compilation} from '@rspack/core'
import type {Manifest} from '../../../types'
import {parseCanonicalContentScriptAsset} from '../../feature-scripts/contracts'

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
  _groupIndex: number,
  ext: 'js' | 'css',
  assetNames: Set<string>
): string {
  // Parse the numeric index from the declared path itself rather than
  // using the array position.  MAIN world bridge entries are created at
  // canonical indices that differ from their array position, so relying
  // on groupIndex would produce a wrong canonical name and the path
  // would never resolve to its hashed counterpart.
  const parsed = parseCanonicalContentScriptAsset(declaredPath)
  if (!parsed || parsed.extension !== ext) return declaredPath

  const hashed = findHashedContentScriptAsset(assetNames, parsed.index, ext)
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
 *
 * Treats `compilation.getAssets()` as the source of truth for what this
 * compilation just emitted under `content_scripts/`. Anything on disk under
 * that directory matching a `<stem>.<hash>.<ext>` shape that is NOT in the
 * emitted set is a leftover from a prior rebuild and gets unlinked. This
 * covers both the canonical `content-N.<hash>.<ext>` bundle and named CSS
 * chunks like `content-index.<hash>.css` (emitted by content-script CSS
 * imports via `import.meta.url`).
 */
function purgeStaleHashedContentScripts(
  compilation: Compilation,
  currentNames: Set<string>
) {
  const outputPath = compilation.options.output?.path
  if (!outputPath) return
  const csDir = path.join(outputPath, 'content_scripts')
  if (!fs.existsSync(csDir)) return

  const emittedNames = new Set<string>()
  const assets =
    typeof compilation.getAssets === 'function' ? compilation.getAssets() : []
  for (const asset of assets) {
    const name = asset?.name || ''
    if (name.startsWith('content_scripts/')) emittedNames.add(name)
  }

  const hashedRe = /^[A-Za-z0-9._-]+\.[a-f0-9]{6,}\.(js|css)(\.map)?$/i
  try {
    for (const name of fs.readdirSync(csDir)) {
      if (!hashedRe.test(name)) continue
      const rel = `content_scripts/${name}`
      const relNoMap = rel.replace(/\.map$/, '')

      if (currentNames.has(rel) || currentNames.has(relNoMap)) continue
      if (emittedNames.has(rel) || emittedNames.has(relNoMap)) continue

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
