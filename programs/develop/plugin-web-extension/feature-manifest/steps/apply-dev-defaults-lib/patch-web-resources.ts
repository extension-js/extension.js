// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {cleanMatches} from '../../../feature-web-resources/web-resources-lib/clean-matches'

// The only files the dev runtime itself fetches from a page context: the HMR
// update chunks a content script pulls on save, and the control-port file the
// bridge re-reads after a dev-server restart. A wider list would make bundled
// files page-reachable in development that the production build never exposes.
export const DEV_RUNTIME_RESOURCES = ['hot/*', 'extension-js-control.json']

function contentScriptMatches(manifest: Manifest): string[] {
  const scripts = (manifest.content_scripts || []) as Array<{
    matches?: string[]
  }>

  // A content script may match a path, which web_accessible_resources
  // rejects, so the same normalizer the built manifest uses runs here too.
  return Array.from(
    new Set(cleanMatches(scripts.flatMap((script) => script.matches || [])))
  ).sort()
}

function patchWebResourcesV2(manifest: Manifest) {
  const resources = manifest.web_accessible_resources as string[] | null
  const webResources = new Set(resources || [])

  // A manifest v2 entry carries no matches, so every page can read it. Only
  // an extension that runs in pages at all earns the dev runtime files.
  if (contentScriptMatches(manifest).length === 0) {
    return Array.from(webResources)
  }

  for (const resource of DEV_RUNTIME_RESOURCES) {
    webResources.add(resource)
  }

  return Array.from(webResources)
}

function patchWebResourcesV3(manifest: Manifest) {
  const existing = (manifest.web_accessible_resources || []) as unknown[]
  const matches = contentScriptMatches(manifest)

  // No content script means nothing of ours runs in a page, so the dev
  // runtime never fetches these from a page origin.
  if (matches.length === 0) return existing

  return [...existing, {resources: [...DEV_RUNTIME_RESOURCES], matches}]
}

// Returns the manifest slice rather than a value so an extension with no web
// accessible resources keeps the key absent instead of gaining an empty array.
export function patchWebResources(manifest: Manifest) {
  const patched =
    manifest.manifest_version === 3
      ? patchWebResourcesV3(manifest)
      : patchWebResourcesV2(manifest)

  if (!patched.length) return {}

  return {
    web_accessible_resources: patched as Manifest['web_accessible_resources']
  }
}

export {patchWebResourcesV2, patchWebResourcesV3}
