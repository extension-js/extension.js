import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

// A package.json is read by the build, by the bundler's resolver and by
// Node.js. One they cannot parse is refused by name before any work, the
// byte order mark some editors add included: the resolver stops on it.
const tempFolder = trackTempFolders()
const GOOD = JSON.stringify({name: 'probe', version: '1.0.0', private: true})

function project(packageJson: string | Buffer) {
  const root = fs.realpathSync(tempFolder('extjs-package-json-'))

  fs.writeFileSync(path.join(root, 'package.json'), packageJson)
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Probe',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log(1)\n')

  return root
}

afterEach(() => vi.restoreAllMocks())

describe('a build of a project whose package.json cannot be read', () => {
  it.each([
    [
      'is cut short',
      '{"name": "probe",',
      /Couldn't read package\.json as JSON/
    ],
    [
      'opens with a byte order mark',
      `\uFEFF${GOOD}`,
      /saved as UTF-8 with a byte order mark.*without a byte order mark/s
    ],
    [
      'is saved as UTF-16 with its mark',
      Buffer.from(`﻿${GOOD}`, 'utf16le'),
      /saved as UTF-16 LE.*Save the file as UTF-8/s
    ],
    [
      'is saved as UTF-16 with no mark',
      Buffer.from(GOOD, 'utf16le'),
      /saved as UTF-16 LE/
    ]
  ])(
    'refuses one that %s, once and by its own code',
    async (_label, contents, says) => {
      const root = project(contents)
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})

      vi.spyOn(console, 'error').mockImplementation(() => {})

      const failure = await buildProject(root).then(
        () => undefined,
        (error: Error & {code?: string}) => error
      )

      expect(failure?.code).toBe('E_PACKAGE_JSON_INVALID')
      expect(failure?.message).toMatch(says)
      expect(failure?.message).toContain(path.join(root, 'package.json'))
      expect(warned).not.toHaveBeenCalled()
      expect(fs.existsSync(path.join(root, 'dist'))).toBe(false)
    },
    60_000
  )
})
