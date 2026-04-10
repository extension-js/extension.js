// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020-present Cezar Augusto - presence implies inheritance

export const EXTENSIONJS_CONTENT_SCRIPT_LAYER = 'extensionjs-content-script'

export const CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX = 'content_scripts/content-'

export function getCanonicalContentScriptEntryName(index: number): string {
  return `${CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX}${index}`
}

export function getCanonicalContentScriptJsAssetName(index: number): string {
  return `${getCanonicalContentScriptEntryName(index)}.js`
}

export function getCanonicalContentScriptCssAssetName(index: number): string {
  return `${getCanonicalContentScriptEntryName(index)}.css`
}

export function parseCanonicalContentScriptEntryIndex(
  entryName: string
): number | undefined {
  const match = /^content_scripts\/content-(\d+)$/.exec(String(entryName || ''))
  if (!match) return undefined

  const index = Number(match[1])
  return Number.isInteger(index) ? index : undefined
}

export function isCanonicalContentScriptEntryName(entryName: string): boolean {
  return parseCanonicalContentScriptEntryIndex(entryName) !== undefined
}

export function parseCanonicalContentScriptAsset(
  assetName: string
): {index: number; extension: 'js' | 'css'} | undefined {
  // Stable dev/prod: content_scripts/content-0.js
  // Development (fullhash): content_scripts/content-0.a1b2c3d4.js — avoids Chrome
  // caching extension resources by URL after live reinject updated the file on disk.
  const match =
    /^content_scripts\/content-(\d+)(?:\.[a-f0-9]+)?\.(js|css)$/i.exec(
      String(assetName || '')
    )
  if (!match) return undefined

  const index = Number(match[1])
  if (!Number.isInteger(index)) return undefined

  return {
    index,
    extension: match[2] as 'js' | 'css'
  }
}

export function isCanonicalContentScriptAsset(assetName: string): boolean {
  return parseCanonicalContentScriptAsset(assetName) !== undefined
}
