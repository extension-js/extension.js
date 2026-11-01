// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

// macOS reports watched files and resolved modules by their real path
// (/private/var/...) while the project context can keep the symlinked spelling
// (/var/...). A path that no longer exists resolves through its nearest
// existing ancestor.
export function resolveReal(absolute: string): string {
  let head = absolute
  const tail: string[] = []

  while (true) {
    try {
      return path.join(fs.realpathSync.native(head), ...tail)
    } catch {
      const parent = path.dirname(head)
      if (parent === head) return absolute

      tail.unshift(path.basename(head))
      head = parent
    }
  }
}

function forwardSlashed(rel: string): string {
  return rel.replace(/\\/g, '/')
}

function isInside(rel: string): boolean {
  return rel !== '..' && !rel.startsWith('../') && !path.isAbsolute(rel)
}

// The one project-relative spelling of an absolute path. The changed-file
// tracker and the chunk-graph source index both name files through it, so a
// changed file always finds its owner in the index whichever side of a
// symlink either of them was handed.
export function projectRelative(contextDir: string, absolute: string): string {
  const direct = forwardSlashed(path.relative(contextDir, absolute))
  if (!contextDir || isInside(direct)) return direct

  return forwardSlashed(
    path.relative(resolveReal(contextDir), resolveReal(absolute))
  )
}
