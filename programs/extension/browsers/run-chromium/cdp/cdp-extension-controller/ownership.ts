// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

// Ownership is a tri-state, not a boolean: a fresh profile may not have
// flushed Preferences yet. 'unknown' is NOT a yes; callers resolve it explicitly.
export type OwnershipVerdict = 'mine' | 'not_mine' | 'unknown'

function normalizePath(input: string): string {
  try {
    return fs.realpathSync(path.resolve(input))
  } catch {
    return path.resolve(input)
  }
}

// Every Preferences file Chrome may have written (root, Default, Profile N);
// shared by ownership classification and stale-load detection.
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
    // Ignore
  }
  return prefCandidates
}

// The dist ancestor every build of ONE project shares; uses the INNERMOST
// dist segment so an ancestor dir named dist can't widen the root.
function distRootOf(outPath: string): string | null {
  const parts = normalizePath(outPath).split(path.sep)
  const idx = parts.lastIndexOf('dist')
  if (idx === -1) return null
  return parts.slice(0, idx + 1).join(path.sep)
}

function isUnder(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep)
}

// Ids of unpacked extensions the profile remembers that are PRIOR builds of
// this project (same dist root, different path); evicting leaves one copy.
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
        // The current build stays; only sibling builds under the same dist root are
        // stale. Store installs and other projects are never touched.
        if (normalizedStored === normalizedOutPath) continue
        if (isUnder(normalizedStored, distRoot)) stale.add(id)
      }
    } catch {
      // Ignore
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
      return normalizePath(storedPath) === normalizedOutPath
        ? 'mine'
        : 'not_mine'
    } catch {
      // Ignore
    }
  }

  return 'unknown'
}
