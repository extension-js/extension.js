// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import type {Compilation} from '@rspack/core'
import type {Manifest} from '../../types'
import {parseJsonSafe} from '../parse-json-safe'

// The manifest as the author wrote it rides per compilation, since later
// steps rewrite the asset and the checks on authored fields need the source.
const authoredManifestStore = new WeakMap<
  Compilation,
  {text: string; parsed?: Manifest}
>()

function readAssetSource(asset: {source?: unknown} | null | undefined): string {
  if (!asset) return ''

  const source = asset.source

  if (typeof source === 'string') return source

  if (typeof source === 'function') {
    const out = source()

    return typeof out === 'string' ? out : String(out || '')
  }

  if (source && typeof (source as {source?: unknown}).source === 'function') {
    const out = (source as {source: () => unknown}).source()

    return typeof out === 'string' ? out : String(out || '')
  }

  return ''
}

// The manifest.json asset is the one copy every step and every project
// plugin shares, so whatever edited it last is what the next reader gets.
export function readManifestAssetText(
  compilation: Compilation
): string | undefined {
  const getAsset = compilation.getAsset

  if (typeof getAsset === 'function') {
    const text = readAssetSource(
      getAsset.call(compilation, 'manifest.json') as
        | {source?: unknown}
        | null
        | undefined
    )

    if (text) return text
  }

  return readAssetSource(compilation.assets?.['manifest.json']) || undefined
}

export function setOriginalManifestContent(
  compilation: Compilation,
  source: string
): void {
  authoredManifestStore.set(compilation, {text: source})
}

export function getOriginalManifestContent(
  compilation: Compilation
): string | undefined {
  return authoredManifestStore.get(compilation)?.text
}

// One parse serves every check that only reads the authored manifest.
// Callers must not change the object they get.
export function getOriginalManifest(
  compilation: Compilation
): Manifest | undefined {
  const entry = authoredManifestStore.get(compilation)
  if (!entry) return undefined

  entry.parsed ??= parseJsonSafe(entry.text) as Manifest

  return entry.parsed
}

export function getManifestContent(
  compilation: Compilation,
  manifestPath: string
): Manifest {
  const text =
    readManifestAssetText(compilation) ??
    getOriginalManifestContent(compilation)

  if (text) return parseJsonSafe(text)

  // No step has emitted a manifest for this compilation yet, so the file
  // the author saved is the only copy there is.
  return parseJsonSafe(fs.readFileSync(manifestPath, 'utf8'))
}
