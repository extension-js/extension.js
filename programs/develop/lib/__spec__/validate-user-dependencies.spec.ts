import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {assertNoManagedDependencyConflicts} from '../validate-user-dependencies'

const MANAGED_IMPORT =
  "const {rspack} = require('@rspack/core')\nmodule.exports = {config: (c) => c}"

const created: string[] = []

function makeProject(
  prefix: string,
  options: {
    dependencies?: Record<string, string>
    configName?: string
    configDir?: 'root' | 'src'
    configSource?: string
    manifestDir?: 'root' | 'src'
  } = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(root)

  const packageJsonPath = path.join(root, 'package.json')
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify({
      dependencies: options.dependencies ?? {'@rspack/core': '^2.0.0'}
    })
  )

  const srcDir = path.join(root, 'src')
  fs.mkdirSync(srcDir)
  fs.writeFileSync(
    path.join(options.manifestDir === 'root' ? root : srcDir, 'manifest.json'),
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

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()

  for (const dir of created.splice(0)) {
    try {
      fs.rmSync(dir, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }
})

function warnings() {
  return warnSpy.mock.calls.map((call: unknown[]) => String(call[0]))
}

describe('assertNoManagedDependencyConflicts', () => {
  it.each([
    [
      'extension.config.js beside a root manifest',
      'extension.config.js',
      'root',
      'root'
    ],
    [
      'extension.config.mjs beside a root manifest',
      'extension.config.mjs',
      'root',
      'root'
    ],
    [
      'extension.config.cjs beside a root manifest',
      'extension.config.cjs',
      'root',
      'root'
    ],
    [
      'a root config of a src/manifest.json project',
      'extension.config.js',
      'root',
      'src'
    ],
    [
      'a config kept beside the manifest in src',
      'extension.config.js',
      'src',
      'src'
    ]
  ] as const)('warns and never throws for %s that imports the bundler', (_name, configName, configDir, manifestDir) => {
    const {root, packageJsonPath} = makeProject('extjs-copy-', {
      configName,
      configDir,
      manifestDir,
      configSource: configName.endsWith('.mjs')
        ? "import {rspack} from '@rspack/core'\nexport default {config: (c) => c}"
        : MANAGED_IMPORT
    })

    expect(() =>
      assertNoManagedDependencyConflicts(packageJsonPath, root)
    ).not.toThrow()

    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toContain('@rspack/core')
    expect(warnings()[0]).toContain(
      path.join(root, configDir === 'src' ? 'src' : '', configName)
    )
  })

  it('names each package with the version Extension.js ships and says the build goes on', () => {
    const {root, packageJsonPath} = makeProject('extjs-text-', {
      dependencies: {'@rspack/core': '^2.0.0', 'sass-loader': '^17.0.0'},
      configName: 'extension.config.js',
      configSource:
        "const {rspack} = require('@rspack/core')\nconst s = require('sass-loader/dist/cjs.js')\nmodule.exports = {config: (c) => c}"
    })

    assertNoManagedDependencyConflicts(packageJsonPath, root)

    const [warning] = warnings()
    expect(warning).toContain(
      'extension.config.js loads its own copy of packages Extension.js already ships'
    )

    expect(warning).toMatch(/- .*@rspack\/core.* \(Extension\.js ships \d/)
    expect(warning).toMatch(/- .*sass-loader.* \(Extension\.js ships \d/)
    expect(warning).toContain('The build goes on')
  })

  it('warns once for the same finding', () => {
    const {root, packageJsonPath} = makeProject('extjs-once-', {
      configName: 'extension.config.js'
    })

    assertNoManagedDependencyConflicts(packageJsonPath, root)
    assertNoManagedDependencyConflicts(packageJsonPath, root)

    expect(warnings()).toHaveLength(1)
  })

  it('warns for babel-loader and not for @babel/core', () => {
    const {root, packageJsonPath} = makeProject('extjs-babel-', {
      dependencies: {'babel-loader': '^10.0.0', '@babel/core': '^7.26.0'},
      configName: 'extension.config.js',
      manifestDir: 'root',
      configSource:
        "module.exports = {config: (c) => { c.module.rules.push({use: require.resolve('babel-loader')}); require('@babel/core'); return c }}"
    })

    expect(() =>
      assertNoManagedDependencyConflicts(packageJsonPath, root)
    ).not.toThrow()

    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toContain('babel-loader')
    expect(warnings()[0]).not.toContain('@babel/core')
  })

  it.each([
    'dotenv',
    'pintor',
    'vue',
    'preact',
    'postcss',
    'less',
    'ws',
    'webpack-merge',
    'webextension-polyfill'
  ])('never flags %s, a package no second copy of can break the build', (dep) => {
    for (const manifestDir of ['root', 'src'] as const) {
      const {root, packageJsonPath} = makeProject('extjs-utility-', {
        dependencies: {[dep]: '*'},
        configName: 'extension.config.js',
        manifestDir,
        configSource: `import x from '${dep}'\nexport default {config: (c) => c}`
      })

      expect(() =>
        assertNoManagedDependencyConflicts(packageJsonPath, root)
      ).not.toThrow()
    }

    expect(warnings()).toEqual([])
  })

  it('stays quiet when the project has no config file', () => {
    const {root, packageJsonPath} = makeProject('extjs-noconfig-', {
      manifestDir: 'root'
    })

    assertNoManagedDependencyConflicts(packageJsonPath, root)

    expect(warnings()).toEqual([])
  })

  it('stays quiet when a build package is only mentioned in a comment', () => {
    const {root, packageJsonPath} = makeProject('extjs-comment-', {
      configName: 'extension.config.js',
      configSource: 'module.exports = {config: (c) => c, /* @rspack/core */ }'
    })

    assertNoManagedDependencyConflicts(packageJsonPath, root)

    expect(warnings()).toEqual([])
  })

  it('stays quiet when a build package name is only a substring of another package', () => {
    const {root, packageJsonPath} = makeProject('extjs-substring-', {
      dependencies: {'less-loader': '^13.0.0', 'less-loader-extras': '^1.0.0'},
      configName: 'extension.config.js',
      configSource:
        "const e = require('less-loader-extras')\nmodule.exports = {config: (c) => c}"
    })

    assertNoManagedDependencyConflicts(packageJsonPath, root)

    expect(warnings()).toEqual([])
  })
})
