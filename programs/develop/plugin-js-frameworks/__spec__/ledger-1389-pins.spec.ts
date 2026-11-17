import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {resolveReactRefreshEntry} from '../js-tools/react'
import {
  compileProject,
  configure,
  fakePackage,
  linkWorkspaceReact,
  MANIFEST,
  makeProject,
  swcOptionsFor,
  swcRules
} from './project-fixture'

const fromDevelop = createRequire(path.join(__dirname, '..', '..', 'x.js'))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a loader options file that throws', () => {
  it.each([
    ['vue', '3.5.0'],
    ['svelte', '99.0.0']
  ])('is printed once and rethrown uncoded for %s', async (framework, version) => {
    // Pins today's behavior. Ledger 1389 D4.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = makeProject({
      'package.json': {dependencies: {[framework]: version}},
      'manifest.json': MANIFEST,
      [`${framework}.loader.mjs`]: "throw new Error('boom in loader file')\n"
    })
    fakePackage(root, framework, {version, main: 'index.js'}, {'index.js': ''})

    const rejection = await configure(root).then(
      () => undefined,
      (reason: Error & {code?: string}) => reason
    )

    expect(rejection?.message).toBe('boom in loader file')
    expect(rejection?.code).toBeUndefined()
    expect(error.mock.calls).toEqual([
      [`Error loading ${framework} loader options: boom in loader file`]
    ])

    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('SWC targets outside the chromium family', () => {
  it.each([
    ['safari', {}],
    ['firefox', {}],
    ['firefox', {browser_specific_settings: {gecko: {id: 'a@b'}}}]
  ])('compiles a %s build with no engine floor for chrome >= 100', async (browser, extra) => {
    // Pins today's behavior. Ledger 1389 D10.
    const root = makeProject({
      'package.json': {},
      'manifest.json': {...MANIFEST, ...extra}
    })
    const {pages} = swcRules(
      await configure(root, {browser: browser as 'safari' | 'firefox'})
    )

    expect(swcOptionsFor(pages, '/x/a.js').env.targets).toEqual([
      'chrome >= 100'
    ])
  })
})

describe('React refresh and the background script in development', () => {
  it('sets refresh on the rule a background script compiles through', async () => {
    // Pins today's behavior. Ledger 1389 D12.
    const root = makeProject({
      'package.json': {dependencies: {react: '19.0.0'}},
      'manifest.json': {...MANIFEST, background: {service_worker: 'sw.ts'}}
    })
    fakePackage(
      root,
      'react',
      {version: '19.0.0', main: 'index.js'},
      {
        'index.js': ''
      }
    )

    const {pages, contentByPath} = swcRules(await configure(root))

    expect(callableIncludes(contentByPath, path.join(root, 'sw.ts'))).toBe(
      false
    )

    expect(
      swcOptionsFor(pages, path.join(root, 'sw.ts')).jsc.transform.react.refresh
    ).toBe(true)
  })

  it('ships the refresh transform and runtime in the background bundle, without the entry', async () => {
    // Pins today's behavior. Ledger 1389 D12.
    const root = makeProject({
      'package.json': {dependencies: {react: '19', 'react-dom': '19'}},
      'manifest.json': {...MANIFEST, background: {service_worker: 'sw.ts'}},
      'tsconfig.json': {},
      'sw.ts':
        'export function Badge() {\n  return null\n}\nconsole.log(Badge)\n'
    })
    linkWorkspaceReact(root)

    const {errors, read} = await compileProject(root, {background: './sw.ts'})
    const background = read('background')

    expect(errors).toEqual([])
    expect(background).toContain('$RefreshReg$')
    expect(background).toMatch(/client[\\/]reactRefresh\.js/)
    expect(background).not.toContain('reactRefreshEntry')
  })
})

describe('TypeScript decorators', () => {
  it('parse in a .ts file', async () => {
    // Ledger 1389 D1, fixed: this pinned the syntax error until then.
    const root = makeProject({
      'package.json': {},
      'manifest.json': MANIFEST,
      'tsconfig.json': {},
      'main.ts':
        'const log = (target: unknown) => target\n@log class A {}\nconsole.log(A)\n'
    })

    const {errors} = await compileProject(root, {main: './main.ts'})

    expect(errors).toEqual([])
  })
})

describe('where the React refresh entry is read from', () => {
  it('finds by path string the same file the package exports as ./react-refresh-entry', () => {
    // Pins today's behavior. Ledger 1389 D9.
    const root = makeProject({'package.json': {dependencies: {react: '19'}}})
    const found = resolveReactRefreshEntry(root)
    const exported = fromDevelop.resolve(
      '@rspack/plugin-react-refresh/react-refresh-entry'
    )

    expect(found).toBeDefined()
    expect(fs.realpathSync(found as string)).toBe(fs.realpathSync(exported))
  })
})

function callableIncludes(
  rule: {include?: unknown} | undefined,
  file: string
): boolean {
  return (rule?.include as (resource: string) => boolean)(file)
}
