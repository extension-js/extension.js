import {Compilation, sources} from '@rspack/core'
import {getManifestContent} from '../../feature-manifest/manifest-lib/manifest'
import {resolveUserDeclaredWAR} from './resolve-war'
import {cleanMatches} from './clean-matches'
import type {Manifest} from '../../../webpack-types'

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
  return /[*?\[\]]/.test(pattern)
}

function escapeRegex(s: string) {
  return s.replace(/[.+^${}()|\\]/g, '\\$&')
}

function globToRegex(pattern: string) {
  const escaped = pattern
    .split('*')
    .map((seg) => escapeRegex(seg))
    .join('.*')
  return new RegExp('^' + escaped + '$')
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

export function generateManifestPatches(
  compilation: Compilation,
  manifestPath: string,
  entryImports: Record<string, string[]>,
  browser?: string
) {
  const manifest = getManifestContent(compilation, manifestPath)

  const resolved = resolveUserDeclaredWAR(
    compilation,
    manifestPath,
    manifest,
    browser
  )

  const webAccessibleResourcesV3: {resources: string[]; matches: string[]}[] =
    manifest.manifest_version === 3
      ? resolved.v3.map((g) => ({
          matches: g.matches,
          resources: Array.from(g.resources)
        }))
      : []
  const webAccessibleResourcesV2: string[] =
    manifest.manifest_version === 2 ? Array.from(resolved.v2) : []

  // Fallback scan: inspect emitted JS for content_scripts to discover referenced assets (e.g., assets/*.png)
  if (
    manifest.manifest_version === 3 &&
    Array.isArray(manifest.content_scripts)
  ) {
    for (const contentScript of manifest.content_scripts) {
      const matches = contentScript.matches || []
      const normalizedMatches = cleanMatches(matches)
      const jsFiles: string[] = Array.isArray(contentScript.js)
        ? contentScript.js
        : []

      for (const jsFile of jsFiles) {
        const source = getAssetSource(compilation, jsFile)

        if (!source) continue

        const re = /assets\/[A-Za-z0-9._-]+/g
        const found = source.match(re) || []
        const filtered = Array.from(
          new Set(
            found.filter((r) => !r.endsWith('.js') && !r.endsWith('.map'))
          )
        ).sort()

        if (filtered.length === 0) continue

        const existingResource = webAccessibleResourcesV3.find((entry) => {
          const a = [...entry.matches].sort()
          const b = [...normalizedMatches].sort()
          return a.length === b.length && a.every((v, i) => v === b[i])
        })

        if (existingResource) {
          const candidates = filtered.filter(
            (resource) =>
              !existingResource.resources.includes(resource) &&
              !isCoveredByExistingGlobs(existingResource.resources, resource)
          )
          existingResource.resources = Array.from(
            new Set([...(existingResource.resources || []), ...candidates])
          ).sort()
        } else {
          webAccessibleResourcesV3.push({
            resources: filtered,
            matches: [...normalizedMatches].sort()
          })
        }
      }
    }
  }

  for (const [entryName, resources] of Object.entries(entryImports)) {
    const contentScript = manifest.content_scripts?.find((script: any) =>
      script.js?.some((jsFile: string) => jsFile.includes(entryName))
    )

    if (contentScript) {
      const matches = contentScript.matches || []
      const filteredResources = resources.filter(
        (resource) => !resource.endsWith('.map') && !resource.endsWith('.js')
      )
      if (filteredResources.length === 0) continue

      if (manifest.manifest_version === 3) {
        const normalizedMatches = cleanMatches(matches)
        const existingResource = webAccessibleResourcesV3.find(
          (resourceEntry) => {
            const a = [...resourceEntry.matches].sort()
            const b = [...normalizedMatches].sort()
            return a.length === b.length && a.every((v, i) => v === b[i])
          }
        )

        if (existingResource) {
          const candidates = filteredResources.filter(
            (resource) =>
              !existingResource.resources.includes(resource) &&
              !isCoveredByExistingGlobs(existingResource.resources, resource)
          )
          const merged = Array.from(
            new Set([...existingResource.resources, ...candidates])
          ).sort()
          existingResource.resources = merged
          existingResource.matches = [...existingResource.matches].sort()
        } else {
          webAccessibleResourcesV3.push({
            resources: Array.from(new Set(filteredResources)).sort(),
            matches: [...normalizedMatches].sort()
          })
        }
      } else {
        filteredResources.forEach((resource) => {
          if (!webAccessibleResourcesV2.includes(resource)) {
            webAccessibleResourcesV2.push(resource)
          }
        })
      }
    }
  }

  // TODO: cezaraugusto this is not needed since for prod we skip teh content_script
  // wrapper code. This is only commented out because I'm not sure whether its fully fixed
  // and too busy at the moment w/ v3 release to test this out
  // Production-only: include JS chunks produced by content_scripts entries in WAR
  // Dynamic imports in content scripts create additional JS files (e.g., 86.js).
  // These are injected via <script> into the page, so Chrome requires them to be
  // declared in web_accessible_resources. We scope each chunk to the content
  // script's matches to minimize exposure.
  // if (
  //   manifest.manifest_version === 3 &&
  //   compilation.options.mode === 'production'
  // ) {
  //   const entryNameToMatches: Record<string, string[]> = {}

  //   // Map entryName -> matches by correlating manifest content_scripts to logical output names
  //   const contentScripts = Array.isArray(manifest.content_scripts)
  //     ? manifest.content_scripts
  //     : []

  //   for (const contentScript of contentScripts) {
  //     const jsFiles = Array.isArray(contentScript.js) ? contentScript.js : []
  //     const matches = cleanMatches(contentScript.matches || [])

  //     for (const jsFile of jsFiles) {
  //       // Logical output names for entries follow "content_scripts/<name>.js"
  //       // Derive the entry name without .js to correlate with compilation entrypoints
  //       if (typeof jsFile === 'string' && jsFile.endsWith('.js')) {
  //         const withoutExt = jsFile.slice(0, -3) // remove ".js"
  //         entryNameToMatches[withoutExt] = matches
  //       }
  //     }
  //   }

  //   // For each content_scripts entrypoint, collect its additional JS chunk files
  //   compilation.entrypoints.forEach((entry, entryName) => {
  //     const entryNameStr = String(entryName)

  //     if (!entryNameStr.startsWith('content_scripts/')) {
  //       return
  //     }

  //     const matches = entryNameToMatches[entryNameStr] || []

  //     if (matches.length === 0) {
  //       return
  //     }

  //     const logicalMain = `${entryNameStr}.js`
  //     const chunkJsFiles: string[] = []

  //     entry.chunks.forEach((chunk) => {
  //       const files = chunk.files as unknown as string[] | undefined

  //       if (!Array.isArray(files)) return

  //       for (const file of files) {
  //         const fileName = String(file)

  //         if (!fileName.endsWith('.js')) continue
  //         if (fileName === logicalMain) continue

  //         chunkJsFiles.push(fileName)
  //       }
  //     })

  //     if (chunkJsFiles.length === 0) {
  //       // Fallback: scan the entry main JS for dynamic import chunk ids like r.e("86")
  //       const mainSource = getAssetSource(compilation, logicalMain)

  //       if (mainSource) {
  //         const ids: string[] = []
  //         const reDyn = /(?:^|[^A-Za-z0-9_$])r\.e\(\s*["']([^"']+)["']\s*\)/g

  //         let match: RegExpExecArray | null = null
  //         while ((match = reDyn.exec(mainSource)) !== null) {
  //           const id = String(match[1]).trim()

  //           if (id && !/[^A-Za-z0-9_-]/.test(id)) {
  //             ids.push(id)
  //           }
  //         }

  //         for (const id of Array.from(new Set(ids))) {
  //           const candidate = `${id}.js`

  //           if (candidate !== `${entryNameStr}.js`) {
  //             chunkJsFiles.push(candidate)
  //           }
  //         }
  //       }

  //       if (chunkJsFiles.length === 0) {
  //         return
  //       }
  //     }

  //     // Merge into existing group for these matches or create a new one
  //     const existing = webAccessibleResourcesV3.find((entry) => {
  //       const a = [...entry.matches].sort()
  //       const b = [...matches].sort()

  //       return a.length === b.length && a.every((v, i) => v === b[i])
  //     })

  //     if (existing) {
  //       const candidates = chunkJsFiles.filter(
  //         (resource) =>
  //           !existing.resources.includes(resource) &&
  //           !isCoveredByExistingGlobs(existing.resources, resource)
  //       )

  //       existing.resources = Array.from(
  //         new Set([...(existing.resources || []), ...candidates])
  //       ).sort()
  //     } else {
  //       webAccessibleResourcesV3.push({
  //         resources: Array.from(new Set(chunkJsFiles)).sort(),
  //         matches: [...matches].sort()
  //       })
  //     }
  //   })
  // }

  // Last-resort fallback: expose emitted static assets under assets/ to the union of content_scripts matches
  if (manifest.manifest_version === 3) {
    const assetKeys: string[] = Object.keys(compilation.assets || {})
    const staticAssets = assetKeys
      .filter((k) => k.startsWith('assets/'))
      .filter((k) => !k.endsWith('.js') && !k.endsWith('.map'))
      .sort()

    if (staticAssets.length > 0) {
      const allMatches: string[] = Array.from(
        new Set(
          (manifest.content_scripts || []).flatMap(
            (cs: {matches?: string[]}) => cs.matches || []
          )
        )
      )
      const normalizedMatches = cleanMatches(allMatches)
      const existing = webAccessibleResourcesV3.find(
        (entry: {resources: string[]; matches: string[]}) => {
          const a: string[] = [...entry.matches].sort()
          const b: string[] = [...normalizedMatches].sort()
          return a.length === b.length && a.every((v, i) => v === b[i])
        }
      )

      if (existing) {
        const candidates = staticAssets.filter(
          (r) =>
            !existing.resources.includes(r) &&
            !isCoveredByExistingGlobs(existing.resources, r)
        )
        existing.resources = Array.from(
          new Set([...(existing.resources || []), ...candidates])
        ).sort()
      } else if (normalizedMatches.length > 0) {
        webAccessibleResourcesV3.push({
          resources: staticAssets,
          matches: [...normalizedMatches].sort()
        })
      }
    }
  }

  if (manifest.manifest_version === 3) {
    if (webAccessibleResourcesV3.length > 0) {
      manifest.web_accessible_resources = webAccessibleResourcesV3
        .map((entry) => ({
          resources: Array.from(new Set(entry.resources)).sort(),
          matches: Array.from(new Set(entry.matches)).sort()
        }))
        .sort((a, b) =>
          a.matches.join(',').localeCompare(b.matches.join(','))
        ) as Manifest['web_accessible_resources']
    }
  } else {
    if (webAccessibleResourcesV2.length > 0) {
      manifest.web_accessible_resources = Array.from(
        new Set(webAccessibleResourcesV2)
      ).sort() as Manifest['web_accessible_resources']
    }
  }

  const source = JSON.stringify(manifest, null, 2)
  const rawSource = new sources.RawSource(source)

  if (compilation.getAsset('manifest.json')) {
    compilation.updateAsset('manifest.json', rawSource)
  }
}
