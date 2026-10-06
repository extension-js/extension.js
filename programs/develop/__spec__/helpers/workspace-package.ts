import * as fs from 'node:fs'
import * as path from 'node:path'

export function workspacePackage(name: string): string | undefined {
  let dir = path.resolve(__dirname, '..', '..')

  while (true) {
    for (const modules of [
      path.join(dir, 'node_modules'),
      path.join(dir, 'node_modules', '.pnpm', 'node_modules')
    ]) {
      const candidate = path.join(modules, name)
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    }

    const parent = path.dirname(dir)
    if (parent === dir) return undefined

    dir = parent
  }
}
