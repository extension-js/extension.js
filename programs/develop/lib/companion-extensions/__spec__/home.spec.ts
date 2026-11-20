import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const developRoot = path.resolve(__dirname, '..', '..', '..')

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (['node_modules', 'dist'].includes(entry.name)) continue
    if (entry.name.startsWith('.')) continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) sources(full, found)
    else if (entry.name.endsWith('.ts')) found.push(full)
  }

  return found
}

// Build, preview and the dev server all resolve companions, and none of them
// is the special folders plugin, so the code they share lives in lib.
describe('where companion extensions are resolved', () => {
  it('is lib, with no copy left in the special folders plugin', () => {
    expect(
      fs.existsSync(
        path.join(developRoot, 'plugin-special-folders', 'folder-extensions')
      )
    ).toBe(false)

    for (const file of ['resolve-config', 'resolve-dirs', 'types', 'utils']) {
      expect(
        fs.existsSync(
          path.join(developRoot, 'lib', 'companion-extensions', `${file}.ts`)
        )
      ).toBe(true)
    }
  })

  it('is imported from lib by every file that needs it', () => {
    const old = ['folder', 'extensions/'].join('-')
    const reaching = sources(developRoot)
      .filter((file) => fs.readFileSync(file, 'utf8').includes(old))
      .map((file) => path.relative(developRoot, file))

    expect(reaching).toEqual([])
  })
})
