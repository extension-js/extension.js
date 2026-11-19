// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

type Env = Record<string, string | undefined>

interface HeldVariable {
  // What the host had before any live session wrote the variable.
  had: boolean
  original: string | undefined
  // What each live session wrote, oldest first.
  writes: Array<{value: string}>
}

const heldByEnv = new WeakMap<Env, Map<string, HeldVariable>>()

// Writes a variable a session's compilers read and returns its undo, after
// which it reads as the newest live session wrote it, or as the host had it.
export function exportSessionEnv(
  name: string,
  value: string,
  env: Env = process.env
): () => void {
  const held = heldByEnv.get(env) ?? new Map<string, HeldVariable>()
  heldByEnv.set(env, held)

  const variable = held.get(name) ?? {
    had: Object.prototype.hasOwnProperty.call(env, name),
    original: env[name],
    writes: []
  }

  held.set(name, variable)
  const write = {value}
  variable.writes.push(write)
  env[name] = value

  return () => {
    const index = variable.writes.indexOf(write)
    if (index < 0) return

    variable.writes.splice(index, 1)

    const newest = variable.writes[variable.writes.length - 1]

    if (newest) {
      env[name] = newest.value

      return
    }

    held.delete(name)

    if (variable.had) env[name] = variable.original
    else Reflect.deleteProperty(env, name)
  }
}
