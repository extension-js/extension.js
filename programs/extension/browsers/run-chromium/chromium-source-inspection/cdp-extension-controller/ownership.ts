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
