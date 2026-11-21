import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const developRoot = path.resolve(__dirname, '..', '..', '..')
const pluginDir = path.join(developRoot, 'plugin-special-folders')

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

const named = (file: string) =>
  path.relative(developRoot, file).split(path.sep).join('/')

// The commands, the dev server and four plugins ask where public/ is and
// what the folders config says, so the answers live where all may read them.
describe('where the folders config and the public folder are resolved', () => {
  it('is lib, with no copy left in the special folders plugin', () => {
    for (const file of ['folders-config', 'resolve-public-folder']) {
      expect(fs.existsSync(path.join(pluginDir, `${file}.ts`))).toBe(false)
      expect(
        fs.existsSync(
          path.join(developRoot, 'lib', 'special-folders', `${file}.ts`)
        )
      ).toBe(true)
    }
  })

  it('is imported from lib by every file that needs it', () => {
    const reaching = sources(developRoot)
      .filter((file) =>
        /from '(?:\.{1,2}\/)+(?:plugin-special-folders\/)?(?:folders-config|resolve-public-folder)'/.test(
          fs.readFileSync(file, 'utf8')
        )
      )
      .filter(
        (file) => !file.startsWith(path.join(developRoot, 'lib') + path.sep)
      )
      .map(named)

    expect(reaching).toEqual([])
  })

  it('is handed out by no module of the plugin a second time', () => {
    const handingOut: string[] = []

    for (const file of sources(pluginDir)) {
      if (file.includes('__spec__')) continue

      const source = fs.readFileSync(file, 'utf8')

      if (/^export [^\n]*from '[^']*lib\/special-folders\//m.test(source)) {
        handingOut.push(named(file))
        continue
      }

      for (const taken of source.matchAll(
        /import \{([^}]*)\} from '[^']*lib\/special-folders\/[^']*'/g
      )) {
        for (const part of taken[1].split(',')) {
          const name = part.replace('type ', '').trim()

          if (name && source.includes(`export {${name}}`)) {
            handingOut.push(`${named(file)} -> ${name}`)
          }
        }
      }
    }

    expect(handingOut).toEqual([])
  })
})
