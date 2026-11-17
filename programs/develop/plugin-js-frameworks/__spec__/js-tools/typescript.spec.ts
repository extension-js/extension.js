import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  defaultTypeScriptConfig,
  ensureTypeScriptConfig,
  getUserTypeScriptConfigFile,
  isUsingTypeScript
} from '../../js-tools/typescript'
import {makeProject} from '../project-fixture'

// The scaffold prints a line, so each case starts quiet and with its own record.
const fresh = () => ({delivered: false})
const scaffoldAt = (dir: string) => path.join(dir, 'tsconfig.json')

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getUserTypeScriptConfigFile', () => {
  it('finds tsconfig.json next to package.json', () => {
    const root = makeProject({'package.json': {}, 'tsconfig.json': {}})

    expect(getUserTypeScriptConfigFile(path.join(root, 'src'))).toBe(
      scaffoldAt(root)
    )
  })

  // Regression: a manifest-only project has no package.json to sit beside, so
  // the lookup found nothing while writeTsConfig had already scaffolded at the
  // project root. TypeScript detection stayed false and every .ts source hit
  // the JS parser as 'const declarations must be initialized'.
  it('finds a project-root tsconfig with no package.json', () => {
    const root = makeProject({'tsconfig.json': {}, 'manifest.json': {}})

    expect(getUserTypeScriptConfigFile(root)).toBe(scaffoldAt(root))
  })
})

describe('ensureTypeScriptConfig', () => {
  it('sees TypeScript in a manifest-only project once the scaffold is written', () => {
    const root = makeProject({'scripts.ts': 'export {}\n'})

    expect(isUsingTypeScript(root)).toBe(false)

    ensureTypeScriptConfig(root, undefined, fresh())

    expect(fs.existsSync(scaffoldAt(root))).toBe(true)
    expect(isUsingTypeScript(root)).toBe(true)
  })

  it('scaffolds the default tsconfig when TypeScript files are present without one', () => {
    const root = makeProject({
      'package.json': {dependencies: {}},
      'file.ts': 'export {}\n'
    })

    expect(isUsingTypeScript(root)).toBe(false)

    ensureTypeScriptConfig(root, undefined, fresh())

    expect(JSON.parse(fs.readFileSync(scaffoldAt(root), 'utf-8'))).toEqual(
      defaultTypeScriptConfig(root)
    )
  })

  it('scaffolds beside the nearest package.json for src/-layout projects', () => {
    const root = makeProject({'package.json': {}, 'src/app.ts': 'export {}\n'})

    ensureTypeScriptConfig(path.join(root, 'src'), undefined, fresh())

    expect(fs.existsSync(scaffoldAt(root))).toBe(true)
    expect(fs.existsSync(scaffoldAt(path.join(root, 'src')))).toBe(false)
  })

  it('finds TypeScript sources in any surface folder, never in node_modules', () => {
    const surface = makeProject({
      'package.json': {},
      'newtab/index.tsx': 'export {}\n'
    })
    const vendored = makeProject({
      'package.json': {},
      'node_modules/lib/index.ts': 'export {}\n'
    })

    ensureTypeScriptConfig(surface, undefined, fresh())
    ensureTypeScriptConfig(vendored, undefined, fresh())

    expect(fs.existsSync(scaffoldAt(surface))).toBe(true)
    expect(fs.existsSync(scaffoldAt(vendored))).toBe(false)
  })

  it('counts a .cts source and skips its declaration and spec siblings', () => {
    const source = makeProject({'package.json': {}, 'helper.cts': ''})
    const siblings = makeProject({
      'package.json': {},
      'globals.d.cts': '',
      'helper.spec.cts': ''
    })

    ensureTypeScriptConfig(source, undefined, fresh())
    ensureTypeScriptConfig(siblings, undefined, fresh())

    expect(fs.existsSync(scaffoldAt(source))).toBe(true)
    expect(fs.existsSync(scaffoldAt(siblings))).toBe(false)
  })

  it('a call that finds nothing does not spend the record a later setup needs', () => {
    const empty = makeProject({'package.json': {}})
    const root = makeProject({'package.json': {}, 'a.ts': 'export {}\n'})
    const record = fresh()

    ensureTypeScriptConfig(empty, undefined, record)
    expect(record).toEqual({delivered: false})

    ensureTypeScriptConfig(root, undefined, record)
    expect(fs.existsSync(scaffoldAt(root))).toBe(true)
    expect(record).toEqual({delivered: true})
  })

  it('writes no tsconfig into a JavaScript project with a typescript dependency', () => {
    const root = makeProject({
      'package.json': {name: 'js-only', devDependencies: {typescript: '5.0.0'}},
      'background.js': ''
    })

    ensureTypeScriptConfig(root, undefined, fresh())

    expect(fs.existsSync(scaffoldAt(root))).toBe(false)
  })
})

describe('isUsingTypeScript', () => {
  it('is true with a tsconfig and a typescript dependency', () => {
    const root = makeProject({
      'package.json': {devDependencies: {typescript: '^5'}},
      'tsconfig.json': {}
    })

    expect(isUsingTypeScript(root)).toBe(true)
  })

  it('is true with a tsconfig and sources but no typescript dependency', () => {
    const root = makeProject({
      'package.json': {dependencies: {}, devDependencies: {}},
      'tsconfig.json': {},
      'index.ts': ''
    })

    expect(isUsingTypeScript(root)).toBe(true)
  })

  it('is false with a tsconfig alone', () => {
    const root = makeProject({'package.json': {}, 'tsconfig.json': {}})

    expect(isUsingTypeScript(root)).toBe(false)
  })
})

describe('defaultTypeScriptConfig', () => {
  it('scaffolds a moduleResolution TypeScript 7 accepts', () => {
    const {compilerOptions} = defaultTypeScriptConfig(
      makeProject({'package.json': {}})
    )

    expect(compilerOptions.moduleResolution).toBe('bundler')
    expect(compilerOptions.module).toBe('esnext')
  })

  // One case per framework: tsc reads jsxImportSource to find the JSX runtime,
  // so it has to name the package the project installed, not react by default.
  it.each([
    ['solid-js', 'solid-js'],
    ['react', 'react'],
    ['preact', 'preact'],
    ['vue', 'vue']
  ])('names %s as the JSX runtime of a %s project', (dependency, source) => {
    const root = makeProject({
      'package.json': {dependencies: {[dependency]: '*'}}
    })
    const {compilerOptions} = defaultTypeScriptConfig(root) as {
      compilerOptions: Record<string, unknown>
    }

    expect(compilerOptions.jsx).toBe('react-jsx')
    expect(compilerOptions.jsxImportSource).toBe(source)
  })

  it('leaves jsxImportSource out without a JS framework', () => {
    const {compilerOptions} = defaultTypeScriptConfig(
      makeProject({'package.json': {}})
    ) as {compilerOptions: Record<string, unknown>}

    expect(compilerOptions.jsx).toBe('preserve')
    expect(compilerOptions.jsxImportSource).toBeUndefined()
  })
})
