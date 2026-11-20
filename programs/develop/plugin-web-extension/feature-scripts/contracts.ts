// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020-present Cezar Augusto - presence implies inheritance

export const EXTENSIONJS_CONTENT_SCRIPT_LAYER = 'extensionjs-content-script'
// What a MAIN world entry imports, at any depth. The name extends the layer
// above because a rule matches a layer by prefix, so every rule still applies.
export const EXTENSIONJS_MAIN_WORLD_IMPORT_LAYER = `${EXTENSIONJS_CONTENT_SCRIPT_LAYER}-main-world-import`
// What a sandboxed page runs, at any depth. A sandboxed page has no extension
// API, and its own name keeps every rule written for pages applying to it.
export const EXTENSIONJS_SANDBOX_LAYER = 'extensionjs-sandbox'

// The scripts/ entries the extension registers into the MAIN world at runtime,
// by entry name, which the manifest never names. Kept per compiler.
const runtimeMainWorldEntries = new WeakMap<
  object,
  ReadonlyMap<string, readonly string[]>
>()

export function setRuntimeMainWorldEntries(
  compiler: object,
  entries: ReadonlyMap<string, readonly string[]>
): void {
  runtimeMainWorldEntries.set(compiler, entries)
}

export function getRuntimeMainWorldEntries(
  compiler: object
): ReadonlyMap<string, readonly string[]> {
  return runtimeMainWorldEntries.get(compiler) || new Map()
}

// The child compilers a dev build gives MAIN world code, where every module
// runs on the page, even one the isolated world also runs.
const mainWorldCompilers = new WeakSet<object>()

export function markMainWorldCompiler(compiler: object): void {
  mainWorldCompilers.add(compiler)
}

export function isMainWorldCompiler(compiler: object | undefined): boolean {
  return Boolean(compiler) && mainWorldCompilers.has(compiler as object)
}

// A browser runs one file once in a frame whatever worlds name it, and each
// world needs its own build, so the MAIN world copy ships beside the file.
export const MAIN_WORLD_COPY_SUFFIX = '.extjs-main-world'

export function mainWorldCopyEntryName(entryName: string): string {
  return `${entryName}${MAIN_WORLD_COPY_SUFFIX}`
}

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

// No browser loads a group with neither js nor css. Prefix resolution leaves
// one behind when every script key was scoped to another browser.
export function isHollowContentScript(entry: unknown): boolean {
  const group = (entry || {}) as {js?: unknown; css?: unknown}
  const js = Array.isArray(group.js) ? group.js : []
  const css = Array.isArray(group.css) ? group.css : []

  return js.length === 0 && css.length === 0
}

// The one rule for where a MAIN world group's isolated world bridge sits:
// after every declared group, in the order of the groups the browser loads.
export function mainWorldBridgeIndexes(
  groups: unknown
): Array<{mainIndex: number; bridgeIndex: number}> {
  const list = Array.isArray(groups) ? groups : []
  const pairs: Array<{mainIndex: number; bridgeIndex: number}> = []

  for (let mainIndex = 0; mainIndex < list.length; mainIndex++) {
    const group = list[mainIndex] as {world?: unknown} | undefined

    if (group?.world !== 'MAIN' || isHollowContentScript(group)) continue

    pairs.push({mainIndex, bridgeIndex: list.length + pairs.length})
  }

  return pairs
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
  // Stable: content_scripts/content-0.js. Dev names each content bundle by
  // its hash, so a second read of the file gets the new bytes.
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

// A dev session ships these beside the content script bundles, and no
// feature may treat them as a file the author wrote.
const DEV_CONTENT_SCRIPT_STAND_IN_ASSET =
  /^content_scripts\/(?:dev-(?:stub|css)-\d+\.js|dev-sheet-\d+\.css)$/

// True for a dev-stub-N.js, dev-css-N.js or dev-sheet-N.css file.
export function isDevContentScriptStandInAsset(assetName: string): boolean {
  return DEV_CONTENT_SCRIPT_STAND_IN_ASSET.test(assetName)
}

// The wrapper loader runs before assets exist, so it cannot know whether the
// bundle gets a sibling stylesheet; it bakes this marker and a processAssets
// pass resolves it to the emitted path, or to nothing, once assets are final.
export const CONTENT_SCRIPT_CSS_PROBE_MARKER_PREFIX =
  '__EXTENSIONJS_CSS_PROBE__'

export function getContentScriptCssProbeMarker(entryName: string): string {
  return `${CONTENT_SCRIPT_CSS_PROBE_MARKER_PREFIX}${entryName}.css__`
}

export function createContentScriptCssProbeMarkerPattern(): RegExp {
  return /__EXTENSIONJS_CSS_PROBE__([^"'`\s\\]+?\.css)__/g
}
