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
    | 'browser_flag'
  value: string
  reason: string
  // The origins a web accessible resource is exposed to. Manifest V2 has none.
  matches?: string[]
  // A browser flag only: whether this session passes it, and how to flip it.
  applied?: boolean
  cause?: string
  change?: string
}

const additionsByCompilation = new WeakMap<object, DevAddition[]>()

export function recordDevAdditions(
  compilation: object,
  additions: DevAddition[]
) {
  additionsByCompilation.set(compilation, additions)
}

// undefined means this compilation never patched a dev manifest, which is a
// different answer from a dev manifest that added nothing.
export function devAdditionsOf(
  compilation: object | undefined | null
): DevAddition[] | undefined {
  return compilation ? additionsByCompilation.get(compilation) : undefined
}

// The launcher owns the browser flag entries, so a recompile carries them
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
    ...earlier.filter((entry) => entry.kind === 'browser_flag')
  ]
}
