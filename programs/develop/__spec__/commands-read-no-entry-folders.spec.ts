import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {STOCK_COMPANION_EXTENSIONS} from '../lib/constants'

const packageDir = path.resolve(__dirname, '..')

// The compile walks pages/ and scripts/ once, in its own plugin. A command
// that walked them again only read back where companions live by default.
describe('the folder a project keeps its companion extensions in', () => {
  it('is the extensions folder beside the manifest', () => {
    expect(STOCK_COMPANION_EXTENSIONS).toEqual({dir: './extensions'})
  })

  it.each([
    'command-steps/build-companions.ts',
    'command-preview.ts',
    'dev-server/index.ts'
  ])('is read by %s with no walk of the entry folders', (file) => {
    const source = fs.readFileSync(path.join(packageDir, file), 'utf8')

    expect(source).toContain('STOCK_COMPANION_EXTENSIONS')
    expect(source).not.toContain('getSpecialFoldersData')
  })
})
