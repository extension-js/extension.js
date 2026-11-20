import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const developRoot = path.resolve(__dirname, '..', '..')
const libDir = path.join(developRoot, 'lib')

// Plugins and the dev server build on lib, never the other way around.
// production-control still drives the dev server's bridge and is not counted.
const OWNER_FOLDERS = /^\.\.\/(plugin-[^/]+|dev-server)(\/|$)/

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, {withFileTypes: true})
    .filter((entry) => entry.isFile() && /\.ts$/.test(entry.name))
    .filter((entry) => !entry.name.endsWith('.d.ts'))
    .map((entry) => path.join(dir, entry.name))
}

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

    for (const file of sourceFiles(libDir)) {
      const source = fs.readFileSync(file, 'utf8')

      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        if (OWNER_FOLDERS.test(match[1])) {
          reaching.push(`${path.basename(file)} -> ${match[1]}`)
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
})
