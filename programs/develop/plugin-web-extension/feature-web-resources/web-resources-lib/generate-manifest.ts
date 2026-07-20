// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, sources} from '@rspack/core'
import type {Manifest} from '../../../types'
import {
  getManifestContent,
  setCurrentManifestContent
} from '../../feature-manifest/manifest-lib/manifest'
import {cleanMatches} from './clean-matches'
import {warPatchedSummary} from './messages'
import {resolveUserDeclaredWAR} from './resolve-war'

type AssetSource =
  | string
  | {source: () => string}
  | {source: string | {source: () => string}}

function getAssetSource(compilation: Compilation, filename: string) {
  const byGet =
    typeof compilation.getAsset === 'function'
      ? compilation.getAsset(filename)
      : undefined
  const byAssets =
    !byGet && compilation.assets ? compilation.assets[filename] : undefined
  const asset = byGet || byAssets

  if (!asset) return ''

  const source = asset.source as AssetSource

  if (!source) return ''

  if (typeof source === 'string') return source

  if (typeof source.source === 'function') {
    const out = source.source()
    return typeof out === 'string' ? out : ''
  }

  const nestedSource = source.source

  if (typeof nestedSource === 'string') return nestedSource

  if (nestedSource && typeof nestedSource.source === 'function') {
    const out = nestedSource.source()
    return typeof out === 'string' ? out : ''
  }
  return ''
}

function hasWildcardPattern(pattern: string) {
  return /[*?[\]]/.test(pattern)
}

function escapeRegex(s: string) {
  return s.replace(/[.+^${}()|\\]/g, '\\$&')
}

function globToRegex(pattern: string) {
  const escaped = pattern
    .split('*')
    .map((seg) => escapeRegex(seg))
    .join('.*')
  return new RegExp(`^${escaped}$`)
}

function isCoveredByExistingGlobs(
  existingPatterns: string[],
  candidate: string
) {
  for (const existingPattern of existingPatterns) {
    if (hasWildcardPattern(existingPattern)) {
      try {
        const re = globToRegex(existingPattern)
        if (re.test(candidate)) return true
      } catch {
        // ignore invalid glob
      }
    }
  }
  return false
}

// Groups carry user-declared fields like use_dynamic_url and extension_ids
// through to the final write untouched.
type WarV3Group = {
  resources: string[]
  matches: string[]
  [key: string]: unknown
}

export function mergeIntoV3Group(
  groups: WarV3Group[],
  normalizedMatches: string[],
  resources: string[],
  options?: {createGroupWhenMissing?: boolean}
): void {
  if (resources.length === 0) return

  const createGroupWhenMissing = options?.createGroupWhenMissing ?? true
  const target = [...normalizedMatches].sort()

  const existing = groups.find((group) => {
    const current = [...group.matches].sort()

    return (
      current.length === target.length &&
      current.every((value, index) => value === target[index])
    )
  })

  if (existing) {
    const candidates = resources.filter(
      (resource) =>
        !existing.resources.includes(resource) &&
        !isCoveredByExistingGlobs(existing.resources, resource)
    )

    existing.resources = Array.from(
      new Set([...existing.resources, ...candidates])
    ).sort()

    return
  }

  if (createGroupWhenMissing) {
    groups.push({
      resources: Array.from(new Set(resources)).sort(),
      matches: [...normalizedMatches].sort()
    })
  }
}

const assetScanCache = new WeakMap<object, string[]>()

function isCanonicalContentScriptCss(resource: string) {
  return /^content_scripts\/content-\d+\.css$/.test(resource)
}

function toCanonicalContentScriptCss(jsFile: string) {
  const normalized = String(jsFile || '')
  if (!/^content_scripts\/content-\d+\.js$/.test(normalized)) return undefined
  return normalized.replace(/\.js$/, '.css')
}

export function generateManifestPatches(
  compilation: Compilation,
  manifestPath: string,
  entryImports: Record<string, string[]>,
  browser?: string
) {
  const canonicalManifest = getManifestContent(compilation, manifestPath)

  const resolved = resolveUserDeclaredWAR(
    compilation,
    manifestPath,
    canonicalManifest,
    browser
  )

  const webAccessibleResourcesV3: WarV3Group[] =
    canonicalManifest.manifest_version === 3
      ? resolved.v3.map((g) => ({
          ...(g.extra || {}),
          matches: g.matches,
          resources: Array.from(g.resources)
        }))
      : []
  const webAccessibleResourcesV2: string[] =
    canonicalManifest.manifest_version === 2 ? Array.from(resolved.v2) : []

  // Fallback scan: inspect emitted JS for content_scripts to discover referenced assets (e.g., assets/*.png)
  if (
    canonicalManifest.manifest_version === 3 &&
    Array.isArray(canonicalManifest.content_scripts)
  ) {
    for (const contentScript of canonicalManifest.content_scripts) {
      const matches = contentScript.matches || []
      const normalizedMatches = cleanMatches(matches)
      const jsFiles: string[] = Array.isArray(contentScript.js)
        ? contentScript.js
        : []

      for (const jsFile of jsFiles) {
        // Watch-mode rebuilds reuse the same Source instance for unchanged
        // assets, so cache the scan per instance instead of re-materializing
        // and re-scanning megabytes of bundle text on every compilation.
        const assetForCache =
          typeof compilation.getAsset === 'function'
            ? compilation.getAsset(jsFile)
            : undefined
        const cacheKey =
          assetForCache && typeof assetForCache.source === 'object'
            ? (assetForCache.source as object)
            : undefined

        let filtered = cacheKey ? assetScanCache.get(cacheKey) : undefined

        if (!filtered) {
          const source = getAssetSource(compilation, jsFile)

          if (!source) continue

          const re = /assets\/[A-Za-z0-9._-]+/g
          const found = source.match(re) || []
          filtered = Array.from(
            new Set(
              found.filter((r) => !r.endsWith('.js') && !r.endsWith('.map'))
            )
          ).sort()

          if (cacheKey) assetScanCache.set(cacheKey, filtered)
        }

        if (filtered.length === 0) continue

        mergeIntoV3Group(webAccessibleResourcesV3, normalizedMatches, filtered)
      }
    }
  }

  for (const [entryName, resources] of Object.entries(entryImports)) {
    const contentScript = canonicalManifest.content_scripts?.find(
      (script: any) =>
        script.js?.some((jsFile: string) => jsFile.includes(entryName))
    )

    if (contentScript) {
      const matches = contentScript.matches || []
      const filteredResources = resources.filter(
        (resource) => !resource.endsWith('.map') && !resource.endsWith('.js')
      )
      const importedContentCss = filteredResources
        .filter((resource) => resource.endsWith('.css'))
        .filter(isCanonicalContentScriptCss)

      if (importedContentCss.length > 0) {
        contentScript.css = Array.from(
          new Set([...(contentScript.css || []), ...importedContentCss])
        ).sort()
      }

      if (filteredResources.length === 0) continue

      if (canonicalManifest.manifest_version === 3) {
        const normalizedMatches = cleanMatches(matches)
        mergeIntoV3Group(
          webAccessibleResourcesV3,
          normalizedMatches,
          filteredResources
        )
      } else {
        filteredResources.forEach((resource) => {
          if (!webAccessibleResourcesV2.includes(resource)) {
            webAccessibleResourcesV2.push(resource)
          }
        })
      }
    }
  }

  // Last-resort fallback: expose emitted static assets under assets/ to the union of content_scripts matches
  if (canonicalManifest.manifest_version === 3) {
    const assetKeys: string[] = Object.keys(compilation.assets || {})
    const staticAssets = assetKeys
      .filter((k) => k.startsWith('assets/'))
      .filter((k) => !k.endsWith('.js') && !k.endsWith('.map'))
      .sort()

    if (staticAssets.length > 0) {
      const allMatches: string[] = Array.from(
        new Set(
          (canonicalManifest.content_scripts || []).flatMap(
            (cs: {matches?: string[]}) => cs.matches || []
          )
        )
      )
      const normalizedMatches = cleanMatches(allMatches)
      mergeIntoV3Group(
        webAccessibleResourcesV3,
        normalizedMatches,
        staticAssets,
        {createGroupWhenMissing: normalizedMatches.length > 0}
      )
    }
  }

  // Last-resort fallback: expose emitted font files (e.g. `fonts/*.woff2` copied from public/)
  // to the union of content_scripts matches. This covers common patterns like:
  // - `public/fonts/MyFont.woff2` copied to output as `fonts/MyFont.woff2`
  // - CSS referencing `url("/fonts/MyFont.woff2")` (which will NOT be bundled into `assets/`)
  //
  // We intentionally exclude files already emitted under `assets/` (bundled) or `content_scripts/`.
  const fontExtRe = /\.(woff2?|eot|ttf|otf)$/i
  if (canonicalManifest.manifest_version === 3) {
    const assetKeys: string[] = Object.keys(compilation.assets || {})
    const fontAssets = assetKeys
      .filter((k) => fontExtRe.test(k))
      .filter((k) => !k.startsWith('assets/'))
      .filter((k) => !k.startsWith('content_scripts/'))
      .sort()

    if (fontAssets.length > 0) {
      const allMatches: string[] = Array.from(
        new Set(
          (canonicalManifest.content_scripts || []).flatMap(
            (cs: {matches?: string[]}) => cs.matches || []
          )
        )
      )
      const normalizedMatches = cleanMatches(allMatches)

      if (normalizedMatches.length > 0) {
        mergeIntoV3Group(
          webAccessibleResourcesV3,
          normalizedMatches,
          fontAssets
        )
      }
    }
  } else if (canonicalManifest.manifest_version === 2) {
    const assetKeys: string[] = Object.keys(compilation.assets || {})
    const fontAssets = assetKeys.filter((k) => fontExtRe.test(k)).sort()
    if (fontAssets.length > 0) {
      for (const r of fontAssets) {
        if (!webAccessibleResourcesV2.includes(r)) {
          webAccessibleResourcesV2.push(r)
        }
      }
    }
  }

  // Also expose emitted CSS under content_scripts/ to content scripts directly.
  // This covers CSS imported by content scripts that end up emitted as files.
  const assetKeys: string[] = Object.keys(compilation.assets || {})
  const emittedCssUnderContentScripts = assetKeys
    .filter((k) => k.startsWith('content_scripts/'))
    .filter((k) => k.endsWith('.css'))

  // Dev mode runs with `output.clean: false`, so prior compilations leave
  // hashed CSS chunks (e.g. `content-index.<hash>.css`) behind in the output
  // directory. A tab still running a pre-rebuild content script will resolve
  // its `import.meta.url` fetch against one of those leftover chunks; without
  // a WAR entry the fetch hits a 403 and the Shadow DOM renders unstyled
  // until the tab reloads. Union the emitted CSS with whatever CSS is on
  // disk so those stragglers stay reachable in their lifetime
  const onDiskCssUnderContentScripts: string[] = []
  const outputPath = compilation.options.output?.path
  // The leftover-chunk problem this scan covers only exists in dev, where
  // output.clean is false; production cleans dist before compiling, so the
  // directory read is skipped there.
  const isDevModeBuild =
    (compilation.options?.mode || 'development') !== 'production'

  if (outputPath && isDevModeBuild) {
    try {
      const csDir = path.join(outputPath, 'content_scripts')

      if (fs.existsSync(csDir)) {
        for (const name of fs.readdirSync(csDir)) {
          if (name.endsWith('.css')) {
            onDiskCssUnderContentScripts.push(`content_scripts/${name}`)
          }
        }
      }
    } catch {
      // Fall back to emitted-only list.
    }
  }

  const cssUnderContentScripts = Array.from(
    new Set([...emittedCssUnderContentScripts, ...onDiskCssUnderContentScripts])
  ).sort()

  if (Array.isArray(canonicalManifest.content_scripts)) {
    for (const contentScript of canonicalManifest.content_scripts) {
      const jsFiles = Array.isArray(contentScript.js) ? contentScript.js : []
      const canonicalCss = jsFiles
        .map(toCanonicalContentScriptCss)
        .filter((resource): resource is string =>
          Boolean(resource && cssUnderContentScripts.includes(resource))
        )

      if (canonicalCss.length > 0) {
        contentScript.css = Array.from(
          new Set([...(contentScript.css || []), ...canonicalCss])
        ).sort()
      }
    }
  }

  if (canonicalManifest.manifest_version === 3) {
    if (cssUnderContentScripts.length > 0) {
      const allMatches: string[] = Array.from(
        new Set(
          (canonicalManifest.content_scripts || []).flatMap(
            (cs: {matches?: string[]}) => cs.matches || []
          )
        )
      )

      const normalizedMatches = cleanMatches(allMatches)

      if (normalizedMatches.length > 0) {
        mergeIntoV3Group(
          webAccessibleResourcesV3,
          normalizedMatches,
          cssUnderContentScripts
        )
      }
    }
  } else if (canonicalManifest.manifest_version === 2) {
    for (const resource of cssUnderContentScripts) {
      if (!webAccessibleResourcesV2.includes(resource)) {
        webAccessibleResourcesV2.push(resource)
      }
    }
  }

  if (canonicalManifest.manifest_version === 3) {
    if (webAccessibleResourcesV3.length > 0) {
      canonicalManifest.web_accessible_resources = webAccessibleResourcesV3
        .map((entry) => ({
          ...entry,
          resources: Array.from(new Set(entry.resources)).sort(),
          matches: Array.from(new Set(entry.matches)).sort()
        }))
        .sort((a, b) =>
          a.matches.join(',').localeCompare(b.matches.join(','))
        ) as Manifest['web_accessible_resources']
    }
  } else {
    if (webAccessibleResourcesV2.length > 0) {
      canonicalManifest.web_accessible_resources = Array.from(
        new Set(webAccessibleResourcesV2)
      ).sort() as Manifest['web_accessible_resources']
    }
  }

  const source = JSON.stringify(canonicalManifest, null, 2)
  const rawSource = new sources.RawSource(source)
  setCurrentManifestContent(compilation, source)

  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    try {
      const v3Groups =
        canonicalManifest.manifest_version === 3
          ? webAccessibleResourcesV3.length
          : 0
      const v3ResourcesTotal =
        canonicalManifest.manifest_version === 3
          ? webAccessibleResourcesV3.reduce(
              (sum, g) => sum + (g.resources?.length || 0),
              0
            )
          : 0
      const v2Resources =
        canonicalManifest.manifest_version === 2
          ? webAccessibleResourcesV2.length
          : 0
      console.log(warPatchedSummary(v3Groups, v3ResourcesTotal, v2Resources))
    } catch {
      // ignore
    }
  }

  if (compilation.getAsset('manifest.json')) {
    compilation.updateAsset('manifest.json', rawSource)
  }
}
