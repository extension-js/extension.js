import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {assertNoManagedDependencyConflicts} from '../validate-user-dependencies'

const MANAGED_IMPORT =
  "const p = require('pintor')\nmodule.exports = {config: (c) => c}"

const created: string[] = []

function makeProject(
  prefix: string,
  options: {
    dependencies?: Record<string, string>
    configName?: string
    configDir?: 'root' | 'src'
    configSource?: string
  } = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(root)

  const packageJsonPath = path.join(root, 'package.json')
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify({dependencies: options.dependencies ?? {pintor: '^0.3.0'}})
  )

  const srcDir = path.join(root, 'src')
  fs.mkdirSync(srcDir)
  fs.writeFileSync(
    path.join(srcDir, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'p', version: '1.0.0'})
  )

  if (options.configName) {
    const configDir = options.configDir === 'src' ? srcDir : root
    fs.writeFileSync(
      path.join(configDir, options.configName),
      options.configSource ?? MANAGED_IMPORT
    )
  }

  return {root, srcDir, packageJsonPath}
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    try {
      fs.rmSync(dir, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }
})

describe('assertNoManagedDependencyConflicts', () => {
  it('throws when the root config imports a managed dependency and the manifest lives in src (never process.exit, library hosts embed this path)', () => {
    const {root, packageJsonPath} = makeProject('extjs-conflict-', {
      configName: 'extension.config.js'
    })

    expect(() =>
      assertNoManagedDependencyConflicts(packageJsonPath, root)
    ).toThrowError(/pintor/)
  })

  it('scans an extension.config.cjs like its siblings', () => {
    const {root, packageJsonPath} = makeProject('extjs-cjs-', {
      configName: 'extension.config.cjs'
    })

    expect(() =>
      assertNoManagedDependencyConflicts(packageJsonPath, root)
    ).toThrowError(/pintor/)
  })

  it('scans an extension.config.mjs at the package root', () => {
    const {root, packageJsonPath} = makeProject('extjs-mjs-', {
      configName: 'extension.config.mjs',
      configSource: "import p from 'pintor'\nexport default {config: (c) => c}"
    })

    expect(() =>
      assertNoManagedDependencyConflicts(packageJsonPath, root)
    ).toThrowError(/pintor/)
  })

  it('scans a config kept beside the manifest when the package root has none', () => {
    const {root, packageJsonPath} = makeProject('extjs-beside-', {
      configName: 'extension.config.js',
      configDir: 'src'
    })

    expect(() =>
      assertNoManagedDependencyConflicts(packageJsonPath, root)
    ).toThrowError(/pintor/)
  })

  it('does not throw when the project has no config file', () => {
    const {root, packageJsonPath} = makeProject('extjs-noconfig-')

    expect(() =>
      assertNoManagedDependencyConflicts(packageJsonPath, root)
    ).not.toThrow()
  })

  it('does not throw when a managed dependency is only mentioned in a comment', () => {
    const {root, packageJsonPath} = makeProject('extjs-comment-', {
      configName: 'extension.config.js',
      configSource: 'module.exports = {config: (c) => c, /* pintor */ }'
    })

    expect(() =>
      assertNoManagedDependencyConflicts(packageJsonPath, root)
    ).not.toThrow()
  })

  it('does not throw when a managed name is only a substring of another package', () => {
    const {root, packageJsonPath} = makeProject('extjs-substring-', {
      dependencies: {pintor: '^0.3.0', 'pintor-extras': '^1.0.0'},
      configName: 'extension.config.js',
      configSource:
        "const e = require('pintor-extras')\nmodule.exports = {config: (c) => c}"
    })

    expect(() =>
      assertNoManagedDependencyConflicts(packageJsonPath, root)
    ).not.toThrow()
  })
})
