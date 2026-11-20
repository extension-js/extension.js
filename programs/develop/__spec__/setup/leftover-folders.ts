import * as fs from 'node:fs'
import * as path from 'node:path'
import glob from 'tiny-glob'

const packageRoot = path.join(__dirname, '..', '..')

// Runs once after the last worker ended. A per-file sweep could remove a
// fixture another worker was still building in.
export default function setup() {
  return async () => {
    let leftovers: string[] = []

    try {
      leftovers = await glob('**/__spec__/.tmp-*', {
        cwd: packageRoot,
        dot: true
      })
    } catch {
      return
    }

    for (const folder of leftovers) {
      try {
        fs.rmSync(path.join(packageRoot, folder), {
          recursive: true,
          force: true,
          maxRetries: 3
        })
      } catch {
        // A folder a child still holds open stays until the next run.
      }
    }
  }
}
