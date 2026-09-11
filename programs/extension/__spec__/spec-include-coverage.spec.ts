import {globSync} from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import vitestConfig from '../vitest.config'

// The include list is hand written, so a spec under a directory nobody added a
// glob for collects zero tests and the suite still reports green.
const packageRoot = path.join(__dirname, '..')

// Read the globs from the config itself so this guard cannot drift from it.
const include = vitestConfig.test?.include ?? []

function isBuildOrVendorPath(entry: string): boolean {
  return /(^|[\\/])(node_modules|dist|\.git)([\\/]|$)/.test(entry)
}

function collect(patterns: readonly string[]): string[] {
  if (patterns.length === 0) return []
  return globSync([...patterns], {
    cwd: packageRoot,
    exclude: isBuildOrVendorPath
  })
}

describe('vitest include globs cover every spec on disk', () => {
  it('reads a non-empty include list from the package config', () => {
    expect(include.length).toBeGreaterThan(0)
  })

  it('leaves no spec file outside every configured include glob', () => {
    const covered = new Set(collect(include))
    const onDisk = collect(['**/*.spec.ts'])

    expect(onDisk.length).toBeGreaterThan(0)
    expect(onDisk.filter((file) => !covered.has(file)).sort()).toEqual([])
  })
})
