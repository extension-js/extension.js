import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const developRoot = path.resolve(__dirname, '..', '..')
const libDir = path.join(developRoot, 'lib')

// Plugins and the dev server build on lib, never the other way around.
const OWNER_FOLDERS = /^(?:\.\.\/)+(plugin-[^/]+|dev-server)(\/|$)/

// production-control runs the control bridge for start and preview, so it
// drives that one dev-server folder. Every plugin piece is handed to it.
const BRIDGE_OF_PRODUCTION_CONTROL =
  /^production-control\/index\.ts -> \.\.\/\.\.\/dev-server\/control-bridge\//

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

    expect(
      reaching.filter((reach) => !BRIDGE_OF_PRODUCTION_CONTROL.test(reach))
    ).toEqual([])
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
})
