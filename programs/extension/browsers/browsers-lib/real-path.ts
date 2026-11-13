// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

const MAX_REMEMBERED = 4096
const remembered = new Map<string, string>()

function resolveLinks(target: string): string {
  return (fs.realpathSync.native || fs.realpathSync)(target)
}

// The real spelling of a path. One that does not exist yet resolves through
// its nearest existing ancestor and keeps the rest as given.
export function realPath(target: string): string {
  const absolute = path.resolve(target)
  const known = remembered.get(absolute)

  if (known !== undefined) return known

  let head = absolute
  const tail: string[] = []

  while (true) {
    try {
      const real = path.join(resolveLinks(head), ...tail)

      // Only a path that exists is remembered: a missing one can appear.
      if (tail.length === 0) {
        if (remembered.size >= MAX_REMEMBERED) remembered.clear()

        remembered.set(absolute, real)
      }

      return real
    } catch {
      const parent = path.dirname(head)

      if (parent === head) return absolute

      tail.unshift(path.basename(head))
      head = parent
    }
  }
}

function placeOf(parent: string, child: string): 'same' | 'inside' | 'outside' {
  const relative = path.relative(parent, child)

  if (relative === '') return 'same'

  return relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
    ? 'outside'
    : 'inside'
}

// The spelling as given answers first. Only a miss pays for the real paths,
// which is where a link on either side would have hidden the match.
function place(parent: string, child: string): 'same' | 'inside' | 'outside' {
  const given = placeOf(path.resolve(parent), path.resolve(child))

  if (given !== 'outside') return given

  const real = placeOf(realPath(parent), realPath(child))

  return real === 'outside' ? given : real
}

export function isSamePath(a: string, b: string): boolean {
  if (!a || !b) return false

  return path.resolve(a) === path.resolve(b) || realPath(a) === realPath(b)
}

// True for a path below the folder, never for the folder itself.
export function isInsidePath(parent: string, child: string): boolean {
  if (!parent || !child) return false

  return place(parent, child) === 'inside'
}

export function isSameOrInsidePath(parent: string, child: string): boolean {
  if (!parent || !child) return false

  return place(parent, child) !== 'outside'
}
