import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'

let answer: Promise<boolean> | undefined

// Asks the question the PostCSS config reader asks: does a dynamic import of a
// .ts file load here? A Node version or flag cannot answer it under the test runner.
export function canImportTypeScript(): Promise<boolean> {
  answer ??= (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ts-import-'))
    const file = path.join(dir, 'probe.ts')

    fs.writeFileSync(file, 'export default {typed: true as boolean}\n')

    try {
      const mod = await import(pathToFileURL(file).href)

      return mod?.default?.typed === true
    } catch {
      return false
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })()

  return answer
}
