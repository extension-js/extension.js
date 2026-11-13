import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {createLocalImportResolver, rememberBuildResolve} from '../script-graph'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) fs.rmSync(root, {recursive: true, force: true})
  }
})

function project(files: Record<string, string>) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-script-graph-'))
  )
  roots.push(root)

  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, contents, 'utf8')
  }

  return {root, at: (...parts: string[]) => path.join(root, ...parts)}
}

describe('a specifier only one dependency kind resolves', () => {
  const files = {
    'background.js': '',
    'src/base/register.js': '',
    'src/esm/register.js': '',
    'src/esm/only.js': '',
    'src/cjs/legacy.js': '',
    'src/lib/entry.custom.js': ''
  }

  it('resolves an alias held under the esm or the commonjs condition', () => {
    const {root, at} = project(files)

    rememberBuildResolve(root, {
      byDependency: {
        esm: {alias: {'@esm': at('src', 'esm')}},
        commonjs: {alias: {'@cjs': at('src', 'cjs')}}
      }
    })

    const resolve = createLocalImportResolver(root)

    expect(resolve(at('background.js'), '@esm/only.js')).toBe(
      at('src', 'esm', 'only.js')
    )

    expect(resolve(at('background.js'), '@cjs/legacy.js')).toBe(
      at('src', 'cjs', 'legacy.js')
    )

    expect(resolve(at('background.js'), '@none/only.js')).toBeUndefined()
  })

  it('keeps the answer the block gives without a condition', () => {
    const {root, at} = project(files)

    rememberBuildResolve(root, {
      alias: {'@reg': at('src', 'base')},
      byDependency: {esm: {alias: {'@reg': at('src', 'esm')}}}
    })

    expect(
      createLocalImportResolver(root)(at('background.js'), '@reg/register.js')
    ).toBe(at('src', 'base', 'register.js'))
  })

  it('merges a condition into the block and expands its three dots', () => {
    const {root, at} = project(files)

    rememberBuildResolve(root, {
      alias: {'@lib': at('src', 'lib')},
      extensions: ['.js'],
      byDependency: {esm: {extensions: ['.custom.js', '...']}}
    })

    const resolve = createLocalImportResolver(root)

    // The alias comes from the block, the extension from the condition.
    expect(resolve(at('background.js'), '@lib/entry')).toBe(
      at('src', 'lib', 'entry.custom.js')
    )

    expect(resolve(at('background.js'), './src/esm/only')).toBe(
      at('src', 'esm', 'only.js')
    )
  })

  it('still resolves when a condition holds what the resolver cannot take', () => {
    const {root, at} = project(files)

    rememberBuildResolve(root, {
      alias: {'@reg': at('src', 'base')},
      byDependency: {esm: 7, commonjs: {alias: 7, modules: {}}, wasm: null}
    })

    const resolve = createLocalImportResolver(root)

    expect(resolve(at('background.js'), '@reg/register.js')).toBe(
      at('src', 'base', 'register.js')
    )

    expect(resolve(at('background.js'), '@gone/register.js')).toBeUndefined()
  })
})

describe('a package linked from outside the project', () => {
  // The extension in ext/ and a package beside it, under no workspace.
  const linked = (spec: string | undefined, target = 'shared') => {
    const {at} = project({
      'ext/package.json': JSON.stringify({
        name: 'ext',
        private: true,
        ...(spec ? {dependencies: {'@probe/shared': spec}} : {})
      }),
      'ext/background.js': '',
      'shared/package.json': '{"name": "@probe/shared", "main": "index.js"}',
      'shared/index.js': 'export {start} from "./register.js"\n',
      'shared/register.js': 'export function start() {}\n',
      'elsewhere/package.json': '{"name": "@probe/shared", "main": "index.js"}',
      'elsewhere/index.js': 'export function start() {}\n'
    })
    const link = at('ext', 'node_modules', '@probe', 'shared')

    fs.mkdirSync(path.dirname(link), {recursive: true})
    fs.symlinkSync(at(target), link, 'junction')

    const resolve = createLocalImportResolver(at('ext'))

    return {at, resolved: resolve(at('ext', 'background.js'), '@probe/shared')}
  }

  it.each([
    'link:../shared',
    'file:../shared',
    'portal:../shared'
  ])('follows a %s dependency to its own source', (spec) => {
    const {at, resolved} = linked(spec)

    expect(resolved).toBe(at('shared', 'index.js'))

    // The package's own imports are then read from where it lives.
    expect(
      createLocalImportResolver(at('ext'))(
        at('shared', 'index.js'),
        './register.js'
      )
    ).toBe(at('shared', 'register.js'))
  })

  it('leaves a link the project does not declare that way alone', () => {
    expect(linked(undefined).resolved).toBeUndefined()
    expect(linked('^1.0.0').resolved).toBeUndefined()
    expect(linked('workspace:*').resolved).toBeUndefined()
  })

  it('leaves a link that leads somewhere other than the declared folder alone', () => {
    expect(linked('link:../shared', 'elsewhere').resolved).toBeUndefined()
    expect(linked('file:../shared.tgz').resolved).toBeUndefined()
  })
})

describe('a file: package copied into node_modules', () => {
  const copied = (spec: string, extra: Record<string, string> = {}) => {
    const {at} = project({
      'ext/package.json': JSON.stringify({
        name: 'ext',
        private: true,
        dependencies: {'@probe/shared': spec, plain: 'file:../plain'}
      }),
      'ext/background.js': '',
      'shared/package.json': '{"name": "@probe/shared", "main": "index.js"}',
      'shared/index.js': 'export {start} from "./register.js"\n',
      'shared/register.js': 'export function start() {}\n',
      'plain/package.json': '{"name": "plain", "main": "main.js"}',
      'plain/main.js': 'export const plain = 1\n',
      'ext/node_modules/@probe/shared/package.json':
        '{"name": "@probe/shared", "main": "index.js"}',
      'ext/node_modules/@probe/shared/index.js':
        'export {start} from "./register.js"\n',
      'ext/node_modules/@probe/shared/register.js':
        'export function start() {}\n',
      'ext/node_modules/@probe/shared/only-installed.js': '',
      'ext/node_modules/plain/package.json':
        '{"name": "plain", "main": "main.js"}',
      'ext/node_modules/plain/main.js': 'export const plain = 1\n',
      ...extra
    })

    return {at, resolve: createLocalImportResolver(at('ext'))}
  }

  it('follows the copy when the project names the package with file:', () => {
    const {at, resolve} = copied('file:../shared')
    const index = at('ext', 'node_modules', '@probe', 'shared', 'index.js')

    expect(resolve(at('ext', 'background.js'), '@probe/shared')).toBe(index)
    expect(resolve(at('ext', 'background.js'), 'plain')).toBe(
      at('ext', 'node_modules', 'plain', 'main.js')
    )

    // The copy's own imports are followed the same way.
    expect(resolve(index, './register.js')).toBe(
      at('ext', 'node_modules', '@probe', 'shared', 'register.js')
    )
  })

  it('leaves a copy alone under any other spec, or with no such file in the folder', () => {
    for (const spec of ['^1.0.0', 'link:../shared', 'file:../missing']) {
      const {at, resolve} = copied(spec)

      expect(
        resolve(at('ext', 'background.js'), '@probe/shared')
      ).toBeUndefined()
    }

    const {at, resolve} = copied('file:../shared')

    expect(
      resolve(at('ext', 'background.js'), '@probe/shared/only-installed.js')
    ).toBeUndefined()
  })
})
