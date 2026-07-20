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
import type {Manifest} from '../../../types'
import {parseCanonicalContentScriptAsset} from '../../feature-scripts/contracts'

// Point manifest content_scripts at the hashed dev bundles so page reloads
// load the same bytes as reinject; stale prior-build files are removed.
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

// Delete hashed content-script files no longer referenced by the manifest;
// getAssets() is the source of truth for what this compile emitted.
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
      } catch {}
    }
  } catch {}
}
