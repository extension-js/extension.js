import * as fs from 'node:fs'
import * as path from 'node:path'

const STATIC_SPECIFIER =
  /(?:^|[;\n])\s*(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?["']([^"']+)["']/g

export interface StaticGraph {
  files: string[]
  packages: Map<string, string[]>
}

// Follows static import and export-from statements only. A dynamic import()
// is left out on purpose: it runs after the body of the file that holds it.
export function staticGraphOf(entryFile: string): StaticGraph {
  const reachedFrom = new Map<string, string | undefined>()
  const packages = new Map<string, string[]>()
  const queue: Array<[string, string | undefined]> = [[entryFile, undefined]]

  const chainTo = (file: string): string[] => {
    const chain: string[] = []
    let current: string | undefined = file

    while (current) {
      chain.unshift(path.basename(current))
      current = reachedFrom.get(current)
    }

    return chain
  }

  while (queue.length > 0) {
    const [file, parent] = queue.shift() as [string, string | undefined]
    if (reachedFrom.has(file)) continue

    reachedFrom.set(file, parent)

    for (const match of fs
      .readFileSync(file, 'utf8')
      .matchAll(STATIC_SPECIFIER)) {
      const specifier = match[1]

      if (specifier.startsWith('.')) {
        queue.push([path.resolve(path.dirname(file), specifier), file])
      } else if (!packages.has(specifier)) {
        packages.set(specifier, chainTo(file))
      }
    }
  }

  return {files: [...reachedFrom.keys()], packages}
}
