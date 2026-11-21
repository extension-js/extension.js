import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()
const locked: string[] = []

afterEach(() => {
  for (const folder of locked.splice(0)) fs.chmodSync(folder, 0o755)
  vi.restoreAllMocks()
})

function project() {
  const root = fs.realpathSync(tempFolder('extjs-read-only-dist-'))

  writeExtensionProject(root, {
    manifest: {name: 'Probe', background: {service_worker: 'background.js'}},
    packageJson: {name: 'probe', version: '1.0.0'}
  })

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log(1)\n')

  return root
}

// Permissions do not bind an administrator, and Windows has no such bit.
const canLock = process.platform !== 'win32' && process.getuid?.() !== 0

describe('a build whose output folder cannot be written', () => {
  it.runIf(canLock)(
    'names the folder and its state, and no bundler',
    async () => {
      const root = project()
      const dist = path.join(root, 'dist')
      const said: string[] = []

      fs.mkdirSync(dist)
      fs.chmodSync(dist, 0o555)
      locked.push(dist)

      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
        said.push(parts.join(' '))
      })

      const failure = await buildProject(root, {silent: false}).then(
        () => undefined,
        (error: Error & {code?: string}) => error
      )

      expect(failure?.code).toBe('E_OUTPUT_NOT_WRITABLE')
      expect(failure?.message).toContain(
        "Couldn't write the build into its output folder."
      )

      expect(failure?.message).toContain(dist)
      expect(failure?.message).toContain('EACCES: permission denied')
      expect(`${failure?.message}\n${said.join('\n')}`).not.toMatch(
        /rspack|IO error|\.extension-build-/i
      )

      expect(fs.readdirSync(dist)).toEqual([])
    },
    60_000
  )
})
