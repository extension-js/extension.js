import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// A folder mode refuses nothing on Windows, and nothing to root anywhere.
const modeIsEnforced = process.platform !== 'win32' && process.getuid?.() !== 0

const tempFolder = trackTempFolders()
const locked: string[] = []

afterEach(() => {
  // Writable again so the temp folder can be removed.
  for (const folder of locked.splice(0)) fs.chmodSync(folder, 0o755)
})

function project() {
  return writeExtensionProject(tempFolder('extjs-unwritable-output-'), {
    name: 'unwritable-output',
    manifest: {background: {service_worker: 'background.js'}},
    files: {'background.js': 'console.log("started")\n'}
  })
}

function lock(folder: string) {
  fs.mkdirSync(folder, {recursive: true})
  fs.chmodSync(folder, 0o555)
  locked.push(folder)
}

describe.skipIf(!modeIsEnforced)(
  'a build whose output cannot be written',
  () => {
    it('fails with a code when dist is read-only, and leaves nothing behind', async () => {
      const root = project()
      const dist = path.join(root, 'dist')

      lock(dist)

      const failure = await buildProject(root).then(
        () => undefined,
        (error: Error & {code?: string}) => error
      )

      expect(failure?.code).toMatch(/^E_[A-Z_]+$/)
      expect(String(failure?.message)).toContain(dist)
      expect(fs.readdirSync(dist)).toEqual([])
    })

    it('fails with a code when the project folder itself is read-only', async () => {
      const root = project()

      lock(root)

      const failure = await buildProject(root).then(
        () => undefined,
        (error: Error & {code?: string}) => error
      )

      expect(failure?.code).toMatch(/^E_[A-Z_]+$/)
      expect(fs.existsSync(path.join(root, 'dist'))).toBe(false)
    })
  }
)
