//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {readManifest} from '../../lib/manifest/source-manifest'
import {filterKeysForThisBrowser} from '../../lib/manifest-utils'
import {canonicalizeResourcePath} from '../../lib/resource-path'
import {
  getRuntimeMainWorldEntries,
  parseCanonicalContentScriptEntryIndex
} from '../../plugin-web-extension/feature-scripts/contracts'
import type {DevOptions} from '../../types'

export function resourceKey(resource: string): string {
  const file = String(resource || '').split('?')[0]

  return path.isAbsolute(file) ? canonicalizeResourcePath(file) : ''
}

function filesOfEntry(value: unknown): string[] {
  const imports =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as {import?: unknown}).import
      : value
  const list = Array.isArray(imports) ? imports : [imports]

  return list
    .filter((file): file is string => typeof file === 'string')
    .map(resourceKey)
    .filter(Boolean)
}

type ContentScriptGroup = {world?: unknown; js?: unknown}

function contentScriptGroups(
  manifestPath: string,
  browser: DevOptions['browser']
): ContentScriptGroup[] {
  try {
    const manifest = filterKeysForThisBrowser(
      readManifest(manifestPath),
      browser
    )

    return Array.isArray(manifest.content_scripts)
      ? (manifest.content_scripts as ContentScriptGroup[])
      : []
  } catch {
    return []
  }
}

// The files a MAIN world script or a sandboxed page runs directly.
// A file another entry also runs keeps what that entry needs.
export function filesWithNoExtensionApi(
  compiler: Compiler,
  manifestPath: string,
  browser: DevOptions['browser']
): Set<string> {
  const groups = contentScriptGroups(manifestPath, browser)
  const manifestDir = path.dirname(manifestPath)
  const without = new Set<string>()
  const within = new Set<string>()

  // A dev build compiles MAIN world groups apart, so the manifest names them.
  for (const group of groups) {
    if (group?.world !== 'MAIN' || !Array.isArray(group.js)) continue

    for (const file of group.js) {
      if (typeof file !== 'string' || !file) continue

      const key = resourceKey(
        path.resolve(manifestDir, file.replace(/^\//, ''))
      )
      if (key) without.add(key)
    }
  }

  // A dev build compiles these apart too, so their files are named here.
  const runtimeMainWorld = getRuntimeMainWorldEntries(compiler)

  for (const files of runtimeMainWorld.values()) {
    for (const file of files) {
      const key = resourceKey(file)
      if (key) without.add(key)
    }
  }

  const entries = compiler.options.entry

  if (entries && typeof entries === 'object') {
    for (const [name, value] of Object.entries(entries)) {
      const index = parseCanonicalContentScriptEntryIndex(name)
      const noApi =
        name.startsWith('sandbox/') ||
        runtimeMainWorld.has(name) ||
        (index !== undefined && groups[index]?.world === 'MAIN')

      const target = noApi ? without : within

      for (const file of filesOfEntry(value)) target.add(file)
    }
  }

  for (const file of within) without.delete(file)

  return without
}
