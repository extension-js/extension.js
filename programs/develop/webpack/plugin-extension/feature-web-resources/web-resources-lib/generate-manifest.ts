import {Compilation, sources} from '@rspack/core'
import {getManifestContent} from '../../../webpack-lib/manifest'
import {resolveUserDeclaredWAR} from './resolve-war'
import {cleanMatches} from './clean-matches'
import type {Manifest} from '../../../webpack-types'

export function generateManifestPatches(
  compilation: Compilation,
  manifestPath: string,
  excludeList: Record<string, string | string[]> | undefined,
  entryImports: Record<string, string[]>,
  browser?: string
) {
  const manifest = getManifestContent(compilation, manifestPath)

  const resolved = resolveUserDeclaredWAR(
    compilation,
    manifestPath,
    manifest,
    excludeList,
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
          const merged = Array.from(
            new Set([...existingResource.resources, ...filteredResources])
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
