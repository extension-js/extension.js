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

const SHARED = [
  'folders-config',
  'resolve-public-folder',
  'get-data',
  'entry-folders',
  'walked-entries'
]

// The commands, the dev server and four plugins ask where public/ is, what
// the folders config says and which files pages/ and scripts/ enroll, so the
// answers live where all may read them.
describe('where the special folder rules are resolved', () => {
  it('is lib, with no copy left in the special folders plugin', () => {
    for (const file of SHARED) {
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
        /from '(?:\.{1,2}\/)+(?:plugin-special-folders\/)?(?:folders-config|resolve-public-folder|get-data|entry-folders|walked-entries)'/.test(
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

  // The config builder mounts the plugin. Every other file, a spec included,
  // reads lib, so no plugin depends on the source of this one.
  it('leaves the plugin read by the config builder alone', () => {
    const reaching: string[] = []

    for (const file of sources(developRoot)) {
      if (file.startsWith(pluginDir + path.sep)) continue
      if (file === __filename) continue

      for (const match of fs
        .readFileSync(file, 'utf8')
        .matchAll(/from '([^']*plugin-special-folders[^']*)'/g)) {
        reaching.push(`${named(file)} -> ${match[1]}`)
      }
    }

    expect(reaching).toEqual(['rspack-config.ts -> ./plugin-special-folders'])
  })
})
