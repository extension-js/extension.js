import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const developRoot = path.resolve(__dirname, '..', '..')
const libDir = path.join(developRoot, 'lib')

// Plugins and the dev server build on lib, never the other way around.
const OWNER_FOLDERS = /^(?:\.\.\/)+(plugin-[^/]+|dev-server)(\/|$)/

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (['node_modules', 'dist', '__spec__'].includes(entry.name)) continue
    if (entry.name.startsWith('.')) continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) walk(full, found)
    else if (/\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      found.push(full)
    }
  }

  return found
}

describe('lib', () => {
  it('imports nothing from a plugin folder or the dev server', () => {
    const reaching: string[] = []

    for (const file of walk(libDir)) {
      const source = fs.readFileSync(file, 'utf8')
      const name = path.relative(libDir, file).split(path.sep).join('/')

      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        if (OWNER_FOLDERS.test(match[1])) {
          reaching.push(`${name} -> ${match[1]}`)
        }
      }
    }

    expect(reaching).toEqual([])
  })

  it('keeps one workspace root finder for the env files', () => {
    const defining = walk(developRoot)
      .filter((file) =>
        /function findNearestWorkspaceRoot\b/.test(
          fs.readFileSync(file, 'utf8')
        )
      )
      .map((file) => path.relative(developRoot, file).split(path.sep).join('/'))

    expect(defining).toEqual(['lib/config-loader.ts'])
  })

  it('names the stock companion folder once', () => {
    const literal = walk(developRoot)
      .filter((file) =>
        fs.readFileSync(file, 'utf8').includes("'./extensions'")
      )
      .map((file) => path.relative(developRoot, file).split(path.sep).join('/'))

    expect(literal).toEqual(['lib/constants.ts'])
  })

  // The printer and the color stripper are lib's. A command that took them
  // from the dev server would load the whole session code to print a line.
  it('is where every file outside the dev server gets its printer', () => {
    const through = walk(developRoot)
      .concat(walk(path.join(developRoot, '__spec__')))
      .filter((file) => !file.startsWith(path.join(developRoot, 'dev-server')))
      .filter((file) =>
        /import \{[^}]*\b(?:humanLine|stripAnsi)\b[^}]*\} from '[^']*lifecycle-stream'/.test(
          fs.readFileSync(file, 'utf8')
        )
      )
      .map((file) => path.relative(developRoot, file).split(path.sep).join('/'))

    expect(through).toEqual([])
    expect(
      fs.readFileSync(
        path.join(developRoot, 'dev-server', 'lifecycle-stream.ts'),
        'utf8'
      )
    ).not.toMatch(/^export \{[^}]*\} from /m)
  })
})
