import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  chooseSvelteRoot,
  isOlderThan,
  resolveCompilerSvelte
} from '../js-tools/svelte'

const PROJECT = '/project/node_modules/svelte'
const COMPILER = '/cli/node_modules/svelte'

describe('which svelte compiles, and which one the bundle links', () => {
  it('keeps the project copy when both sides agree', () => {
    expect(
      chooseSvelteRoot({
        projectRoot: PROJECT,
        projectVersion: '5.57.0',
        compilerRoot: COMPILER,
        compilerVersion: '5.57.0'
      })
    ).toMatchObject({root: PROJECT, mismatch: false})
  })

  it('follows the compiler when the project pins an older svelte', () => {
    // The compiled component imports what the compiler emitted, so an older
    // runtime cannot link it. 5.51.0 has no only_child; 5.57.0 does.
    expect(
      chooseSvelteRoot({
        projectRoot: PROJECT,
        projectVersion: '5.51.0',
        compilerRoot: COMPILER,
        compilerVersion: '5.57.0'
      })
    ).toMatchObject({
      root: COMPILER,
      mismatch: true,
      projectVersion: '5.51.0',
      compilerVersion: '5.57.0'
    })
  })

  it('keeps a project that pins a NEWER svelte than the compiler', () => {
    // Only one direction breaks. Svelte adds internals rather than removing
    // them, so a newer runtime links what an older compiler emitted, and that
    // project keeps the version it asked for with nothing printed.
    expect(
      chooseSvelteRoot({
        projectRoot: PROJECT,
        projectVersion: '5.57.0',
        compilerRoot: COMPILER,
        compilerVersion: '5.51.0'
      })
    ).toMatchObject({root: PROJECT, mismatch: false})
  })

  it('compares releases numerically, not as strings', () => {
    expect(isOlderThan('5.9.0', '5.51.0')).toBe(true)
    expect(isOlderThan('5.51.0', '5.9.0')).toBe(false)
    expect(isOlderThan('5.51.0', '5.51.0')).toBe(false)
    expect(isOlderThan('5.51.0-next.1', '5.51.0')).toBe(false)
    expect(isOlderThan('4.2.19', '5.0.0')).toBe(true)
  })

  it('uses whichever side it could resolve, and calls that no mismatch', () => {
    expect(
      chooseSvelteRoot({projectRoot: PROJECT, projectVersion: '5.57.0'})
    ).toMatchObject({root: PROJECT, mismatch: false})

    expect(
      chooseSvelteRoot({compilerRoot: COMPILER, compilerVersion: '5.57.0'})
    ).toMatchObject({root: COMPILER, mismatch: false})

    expect(chooseSvelteRoot({})).toMatchObject({
      root: undefined,
      mismatch: false
    })
  })

  it('never claims a mismatch on a version it could not read', () => {
    expect(
      chooseSvelteRoot({
        projectRoot: PROJECT,
        compilerRoot: COMPILER,
        compilerVersion: '5.57.0'
      })
    ).toMatchObject({root: PROJECT, mismatch: false})
  })
})

describe('reading the version beside the loader', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('reads the svelte that sits next to svelte-loader, not the project one', () => {
    // realpath: macOS hands out /var paths that resolve to /private/var, and
    // require.resolve answers with the resolved one.
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'svelte-compiler-'))
    )
    dirs.push(root)

    const loaderDir = path.join(root, 'node_modules', 'svelte-loader')
    const svelteDir = path.join(root, 'node_modules', 'svelte')
    fs.mkdirSync(loaderDir, {recursive: true})
    fs.mkdirSync(svelteDir, {recursive: true})
    fs.writeFileSync(
      path.join(loaderDir, 'package.json'),
      JSON.stringify({
        name: 'svelte-loader',
        version: '3.2.4',
        main: 'index.js'
      })
    )

    fs.writeFileSync(path.join(loaderDir, 'index.js'), 'module.exports = {}')
    fs.writeFileSync(
      path.join(svelteDir, 'package.json'),
      JSON.stringify({
        name: 'svelte',
        version: '5.57.0',
        exports: {'./package.json': './package.json'}
      })
    )

    expect(
      resolveCompilerSvelte(path.join(loaderDir, 'index.js'))
    ).toMatchObject({root: svelteDir, version: '5.57.0'})
  })

  it('answers empty when the loader has no svelte beside it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svelte-compiler-'))
    dirs.push(root)
    const loader = path.join(root, 'index.js')
    fs.writeFileSync(loader, 'module.exports = {}')

    expect(resolveCompilerSvelte(loader)).toEqual({})
  })
})
