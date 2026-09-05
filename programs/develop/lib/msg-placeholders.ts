// ███████╗███████╗███████╗███████╗██╗ ██████╗ ███╗   ██╗      ██████╗  █████╗ ████████╗██╗  ██╗███████╗
// ██╔════╝██╔════╝██╔════╝██╔════╝██║██╔═══██╗████╗  ██║      ██╔══██╗██╔══██╗╚══██╔══╝██║  ██║██╔════╝
// ███████╗█████╗  ███████╗███████╗██║██║   ██║██╔██╗ ██║█████╗██████╔╝███████║   ██║   ███████║███████╗
// ╚════██║██╔══╝  ╚════██║╚════██║██║██║   ██║██║╚██╗██║╚════╝██╔═══╝ ██╔══██║   ██║   ██╔══██║╚════██║
// ███████║███████╗███████║███████║██║╚██████╔╝██║ ╚████║      ██║     ██║  ██║   ██║   ██║  ██║███████║
// ╚══════╝╚══════╝╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// One reading of a __MSG_name__ reference for the build gate and the
// pre-launch check, matching what the browsers do: the placeholder closes at
// the first __ (Chrome's lazy scan, so __MSG_a__b__ names "a"), a name may
// carry @ and case is ignored when the catalog is looked up, and the
// @@predefined names the platform supplies are never looked up at all.
//
// This file is duplicated, on purpose, between programs/develop/lib and
// programs/extension/helpers; a spec keeps the copies byte-identical.

const MSG_REFERENCE = /__MSG_([A-Za-z0-9_@]+?)__/g

export function collectMsgReferences(value: unknown): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const visit = (node: unknown) => {
    if (typeof node === 'string') {
      MSG_REFERENCE.lastIndex = 0
      let match: RegExpExecArray | null = MSG_REFERENCE.exec(node)
      while (match !== null) {
        const name = match[1]
        if (name && !name.startsWith('@@') && !seen.has(name)) {
          seen.add(name)
          found.push(name)
        }
        match = MSG_REFERENCE.exec(node)
      }
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (node && typeof node === 'object') {
      for (const item of Object.values(node as Record<string, unknown>)) {
        visit(item)
      }
    }
  }
  visit(value)
  return found
}

// References with no catalog entry, spelled the way the author wrote them.
export function findUndefinedMsgReferences(
  value: unknown,
  catalogKeys: Iterable<string>
): string[] {
  const lower = new Set<string>()
  for (const key of catalogKeys) lower.add(String(key).toLowerCase())
  return collectMsgReferences(value).filter(
    (name) => !lower.has(name.toLowerCase())
  )
}
