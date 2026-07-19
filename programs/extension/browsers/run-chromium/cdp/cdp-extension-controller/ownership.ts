// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'

// The single answer the tooling gets when it asks whether an extension id
// belongs to the extension being developed. Ownership is a tri-state, not a
// boolean: there is a real moment — a freshly created profile that has not
// flushed its `Preferences` yet — where the answer is legitimately not yet
// knowable. `unknown` is NOT a yes; callers must resolve it explicitly
// (defer, retry, re-derive) rather than adopt an id on trust.
export type OwnershipVerdict = 'mine' | 'not_mine' | 'unknown'

function normalizePath(input: string): string {
  try {
    return fs.realpathSync(path.resolve(input))
  } catch {
    return path.resolve(input)
  }
}

// Every `Preferences` file Chrome may have written for this profile (root,
// Default, and numbered `Profile N` dirs). Shared by ownership classification
// and stale-load detection so both read the profile the same way.
function collectPreferenceFiles(profilePath: string): string[] {
  const prefCandidates: string[] = []
  const addPrefCandidate = (dir: string) => {
    const prefPath = path.join(dir, 'Preferences')
    if (fs.existsSync(prefPath)) prefCandidates.push(prefPath)
  }
  try {
    addPrefCandidate(profilePath)
    addPrefCandidate(path.join(profilePath, 'Default'))
    for (const entry of fs.readdirSync(profilePath)) {
      if (!/^Profile\s+\d+$/i.test(entry)) continue
      addPrefCandidate(path.join(profilePath, entry))
    }
  } catch {
    // Ignore profile listing errors.
  }
  return prefCandidates
}

// The `dist` ancestor of an output path — the root every per-browser and
// per-version build of ONE project shares. `/proj/dist/chrome` and the legacy
// `/proj/dist/extension-js/chrome` both resolve to `/proj/dist`, which is how we
// recognize a sibling build of the same project without touching other projects.
// Uses the INNERMOST `dist` segment: an ancestor directory that happens to be
// named `dist` (e.g. a home path like `/Users/dist/...`) must NOT widen the root
// to something that would sweep in unrelated extensions.
function distRootOf(outPath: string): string | null {
  const parts = normalizePath(outPath).split(path.sep)
  const idx = parts.lastIndexOf('dist')
  if (idx === -1) return null
  return parts.slice(0, idx + 1).join(path.sep)
}

function isUnder(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep)
}

// Ids of unpacked extensions the persistent profile still remembers that are
// PRIOR builds of the project now at `outPath`: a stored path under the same
// `dist` root but not equal to the current output. `extension dev` loads a
// fresh build into the persistent profile without evicting the previous load,
// so when the dist path shifts (a different CLI resolution) the profile keeps
// both — two extension IDs / two service workers for one project (#49).
// Evicting these before loading the current build leaves exactly one copy.
export function findStaleUnpackedExtensionIds(
  profilePath: string | undefined,
  outPath: string
): string[] {
  if (!profilePath) return []
  const distRoot = distRootOf(outPath)
  if (!distRoot) return []
  const normalizedOutPath = normalizePath(outPath)

  const stale = new Set<string>()
  for (const prefPath of collectPreferenceFiles(profilePath)) {
    try {
      const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf-8'))
      const settings = prefs?.extensions?.settings
      if (!settings || typeof settings !== 'object') continue
      for (const [id, info] of Object.entries(settings)) {
        const storedPath = String((info as {path?: unknown})?.path || '')
        if (!storedPath) continue
        const normalizedStored = normalizePath(storedPath)
        // The current build stays; only sibling builds under the same dist root
        // are stale. Extensions installed from the store (paths outside dist)
        // and other projects (different dist roots) are never touched.
        if (normalizedStored === normalizedOutPath) continue
        if (isUnder(normalizedStored, distRoot)) stale.add(id)
      }
    } catch {
      // Ignore malformed preference files.
    }
  }
  return [...stale]
}

// Decide whether `extensionId`, as recorded in the on-disk Chrome profile,
// belongs to the extension built at `outPath`.
//
//  - 'mine'      a `Preferences` file maps the id to `outPath`.
//  - 'not_mine'  a `Preferences` file maps the id to a DIFFERENT path
//                (verifiably someone else's extension).
//  - 'unknown'   cannot tell yet: no profile path, no `Preferences` file on
//                disk, or the id is absent from every `Preferences` file (a
//                freshly created profile has not written its bookkeeping).
//
// This is the one place the question is answered. Every call site resolves
// through this decision so the tri-state is never re-interpreted per spot.
export function classifyExtensionOwnership(
  profilePath: string | undefined,
  outPath: string,
  extensionId: string
): OwnershipVerdict {
  if (!profilePath || !extensionId) return 'unknown'

  const prefCandidates = collectPreferenceFiles(profilePath)

  if (prefCandidates.length === 0) return 'unknown'

  const normalizedOutPath = normalizePath(outPath)
  for (const prefPath of prefCandidates) {
    try {
      const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf-8'))
      const settings = prefs?.extensions?.settings
      const info = settings?.[extensionId]
      const storedPath = String(info?.path || '')
      if (!storedPath) continue
      return normalizePath(storedPath) === normalizedOutPath ? 'mine' : 'not_mine'
    } catch {
      // Ignore malformed preference files.
    }
  }

  return 'unknown'
}
