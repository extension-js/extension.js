import {globSync} from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import vitestConfig from '../vitest.config.mts'

// The include list is hand written, so a spec under a directory nobody added a
// glob for collects zero tests and the suite still reports green.
const packageRoot = path.join(__dirname, '..')

// Read both lists from the config itself so this guard cannot drift from it.
const include = vitestConfig.test?.include ?? []

// Build output holds compiled copies of specs, so the walk has to skip
// everything the run skips. A predicate rather than glob strings: string
// excludes only landed in Node 22.14 and the engine floor is 22.12.
function isExcludedPath(entry: string): boolean {
  return (
    /(^|[\\/])(node_modules|dist|\.git|\.tmp-tests)([\\/]|$)/.test(entry) ||
    /(^|[\\/])__spec__[\\/]\.tmp-/.test(entry)
  )
}

function collect(patterns: readonly string[]): string[] {
  if (patterns.length === 0) return []
  return globSync([...patterns], {cwd: packageRoot, exclude: isExcludedPath})
}

describe('vitest include globs cover every spec on disk', () => {
  it('reads a non-empty include list from the package config', () => {
    expect(include.length).toBeGreaterThan(0)
  })

  it('leaves no spec file outside every configured include glob', () => {
    const covered = new Set(collect(include))
    // The config collects four spec extensions, so the walk has to look for all
    // four or an orphan in the other three stays invisible.
    const onDisk = collect(['**/*.spec.{ts,tsx,js,jsx}'])

    expect(onDisk.length).toBeGreaterThan(0)
    expect(onDisk.filter((file) => !covered.has(file)).sort()).toEqual([])
  })
})
