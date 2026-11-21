// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {
  getCanonicalContentScriptEntryName,
  getCanonicalContentScriptJsAssetName,
  isCanonicalContentScriptAsset,
  parseCanonicalContentScriptAsset,
  parseHashedContentScriptAsset
} from '../../../plugin-web-extension/feature-scripts/contracts'
import type {ManifestExtension} from '../../../plugin-web-extension/shared/manifest-extensions'
import type {Manifest} from '../../../types'

// A content script group with only CSS gets the script its entry holds in
// development, so its styles load through a script.
function nameScriptOfCssOnlyGroups(manifest: Manifest): Manifest {
  if (!manifest.content_scripts) return manifest

  return {
    ...manifest,
    content_scripts: manifest.content_scripts.map((contentObj, index) => {
      const css = contentObj.css ?? []
      const js = contentObj.js ?? []

      if (css.length && !js.length) {
        // The script is named after the canonical group index, which can
        // differ from the array position, so it is read from the css path.
        const canonicalIndex =
          parseCanonicalContentScriptAsset(css[0])?.index ?? index
        contentObj.js = [getCanonicalContentScriptJsAssetName(canonicalIndex)]
      }

      return contentObj
    })
  }
}

// What a development compile changes in the manifest the build resolved.
// The script names come first: the hashed paths are resolved from them.
export const devContentScriptManifest: ManifestExtension = {
  manifestResolved: (compilation, manifest) =>
    patchDevContentScriptManifestPaths(
      compilation,
      nameScriptOfCssOnlyGroups(manifest)
    )
}

// Point manifest content_scripts at the hashed dev bundles so every read
// loads the current bytes. Stale prior-build files go once it is done.
export function patchDevContentScriptManifestPaths(
  compilation: Compilation,
  manifest: Manifest
): Manifest {
  if (compilation.options.mode !== 'development') return manifest

  const cs = manifest.content_scripts

  // No entry is left to name a bundle, so the last removed one's files go
  // here. Only a file named like an entry bundle can be such a leftover.
  if (!Array.isArray(cs)) {
    purgeStaleWhenDone(compilation, new Set(), isCanonicalContentScriptAsset)

    return manifest
  }

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

  purgeStaleWhenDone(compilation, currentHashedNames)

  return {...manifest, content_scripts: next}
}

function resolveDevContentScriptDeclaredPath(
  declaredPath: string,
  _groupIndex: number,
  ext: 'js' | 'css',
  assetNames: Set<string>
): string {
  // Parse the numeric index from the declared path, not the array position:
  // MAIN world bridge entries sit at canonical indices that differ from it.
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
  const plain = `${getCanonicalContentScriptEntryName(groupIndex)}.${ext}`
  if (assetNames.has(plain)) return plain

  for (const name of assetNames) {
    if (parseHashedContentScriptAsset(name, ext)?.index === groupIndex) {
      return name
    }
  }

  return undefined
}

interface StalePurge {
  currentNames: Set<string>
  isPurgeable: (assetName: string) => boolean
}

const purgeByCompilation = new WeakMap<object, StalePurge>()
const compilersWithPurge = new WeakSet<object>()

// The manifest and the registry on disk name the last build's files until
// this build is written, so the purge waits for the compiler to finish.
function purgeStaleWhenDone(
  compilation: Compilation,
  currentNames: Set<string>,
  isPurgeable: (assetName: string) => boolean = () => true
) {
  const compiler = compilation.compiler
  if (!compiler?.hooks?.done) return

  purgeByCompilation.set(compilation, {currentNames, isPurgeable})

  if (compilersWithPurge.has(compiler)) return

  compilersWithPurge.add(compiler)

  compiler.hooks.done.tap('manifest:purge-stale-content-scripts', (stats) => {
    const finished = stats.compilation
    const purge = purgeByCompilation.get(finished)
    // A failed build wrote nothing new, so the last build's files stay.
    if (!purge || finished.errors.length > 0) return

    purgeStaleHashedContentScripts(
      finished,
      purge.currentNames,
      purge.isPurgeable
    )
  })
}

// Delete hashed content-script files no longer referenced by the manifest;
// getAssets() is the source of truth for what this compile emitted.
function purgeStaleHashedContentScripts(
  compilation: Compilation,
  currentNames: Set<string>,
  isPurgeable: (assetName: string) => boolean
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

      if (!isPurgeable(relNoMap)) continue
      if (currentNames.has(rel) || currentNames.has(relNoMap)) continue
      if (emittedNames.has(rel) || emittedNames.has(relNoMap)) continue

      try {
        fs.unlinkSync(path.join(csDir, name))
      } catch {
        // A file in use stays and the next build retries it: pruning must
        // never fail a compile.
      }
    }
  } catch {
    // A folder that cannot be listed is pruned on the next build instead.
  }
}
