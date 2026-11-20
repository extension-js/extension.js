// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export interface DevAddition {
  kind:
    | 'permission'
    | 'host_permission'
    | 'web_accessible_resource'
    | 'manifest_change'
    | 'browser_flag'
    | 'browser_preference'
  value: string
  reason: string
  // The origins a web accessible resource is exposed to. Manifest V2 has none.
  matches?: string[]
  // A browser flag or preference only: whether this session applies it, and
  // how to flip it.
  applied?: boolean
  cause?: string
  change?: string
}

const additionsByCompilation = new WeakMap<object, DevAddition[]>()

function sameAddition(a: DevAddition, b: DevAddition) {
  return a.kind === b.kind && a.value === b.value
}

// Several steps of one compile change the dev build, so each adds to the list
// instead of replacing what an earlier step said, and a repeated entry is said once.
export function appendDevAdditions(
  compilation: object,
  additions: DevAddition[]
) {
  const list = additionsByCompilation.get(compilation) || []

  for (const addition of additions) {
    if (!list.some((entry) => sameAddition(entry, addition))) {
      list.push(addition)
    }
  }

  additionsByCompilation.set(compilation, list)
}

// undefined means this compilation never patched a dev manifest, which is a
// different answer from a dev manifest that added nothing.
export function devAdditionsOf(
  compilation: object | undefined | null
): DevAddition[] | undefined {
  return compilation ? additionsByCompilation.get(compilation) : undefined
}

// The launcher owns the browser flag and preference entries, so a recompile carries them
// over while the manifest entries are replaced by what this compile patched.
export function mergeDevAdditions(
  compiled: DevAddition[] | undefined,
  previous: unknown
): DevAddition[] | undefined {
  const earlier = Array.isArray(previous)
    ? (previous as DevAddition[]).filter(
        (entry) => entry && typeof entry === 'object'
      )
    : []

  if (!compiled) return earlier.length ? earlier : undefined

  return [
    ...compiled,
    ...earlier.filter(
      (entry) =>
        entry.kind === 'browser_flag' || entry.kind === 'browser_preference'
    )
  ]
}
