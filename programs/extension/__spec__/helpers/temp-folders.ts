import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll} from 'vitest'

// Call once at the top of a spec file. Every folder the returned function
// makes is removed when the file ends, whether its tests passed or failed.
export function useTempFolders(): (prefix: string) => string {
  const folders: string[] = []

  afterAll(() => {
    for (const folder of folders.splice(0)) {
      try {
        fs.rmSync(folder, {recursive: true, force: true, maxRetries: 3})
      } catch {
        // A folder still held open by a child is left for the next run.
      }
    }
  })

  return (prefix: string) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), prefix))

    folders.push(folder)

    return folder
  }
}
