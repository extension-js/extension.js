import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {computeBinariesBaseDir} from '../../browsers-lib/output-binaries-resolver'
import {
  claimReadyPath,
  managedProfileBaseDir
} from '../../browsers-lib/ready-stamp'

const project = path.resolve('/', 'work', 'project')
const compilationAt = (outputPath: string) => ({
  options: {output: {path: outputPath}}
})

// Binaries kept in dist sit in the session root beside the build, the folder
// that holds ready.json and the profiles, never inside the loaded extension.
describe('binaries kept in dist', () => {
  let previous: string | undefined

  beforeEach(() => {
    previous = process.env.EXTENSIONJS_BINARIES_IN_DIST
    process.env.EXTENSIONJS_BINARIES_IN_DIST = '1'
  })

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.EXTENSIONJS_BINARIES_IN_DIST
    } else {
      process.env.EXTENSIONJS_BINARIES_IN_DIST = previous
    }
  })

  for (const browser of ['chrome', 'brave', 'waterfox', 'chromium-based']) {
    it(`sits beside the profiles for a ${browser} build`, () => {
      const outputPath = path.join(project, 'dist', browser)

      expect(computeBinariesBaseDir(compilationAt(outputPath))).toBe(
        path.join(project, 'dist', 'extension-js', 'binaries')
      )

      expect(
        path.dirname(path.dirname(managedProfileBaseDir(outputPath, browser)))
      ).toBe(path.join(project, 'dist', 'extension-js'))
    })
  }

  it('follows a run-only session to the record it claimed', () => {
    const source = path.join(project, 'src')
    claimReadyPath(
      source,
      path.join(project, 'dist', 'extension-js', 'chrome', 'ready.json')
    )

    expect(computeBinariesBaseDir(compilationAt(source))).toBe(
      path.join(project, 'dist', 'extension-js', 'binaries')
    )
  })
})
