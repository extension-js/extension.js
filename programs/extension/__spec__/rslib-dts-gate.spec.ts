import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {DTS_PARSERS, findDtsParser, resolveDtsGeneration} from '../rslib.config'

const require = createRequire(import.meta.url)
const roots: string[] = []

// A project whose declaration plugin depends on the given packages. Each
// installed package is a module that only an `import` condition reaches.
function projectWithPlugin(
  dependencies: Record<string, string>,
  installed: string[] = Object.keys(dependencies)
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dts-gate-'))
  )
  roots.push(root)

  const write = (name: string, manifest: object, files = {}) => {
    const dir = path.join(root, 'node_modules', name)
    fs.mkdirSync(path.join(dir, 'dist'), {recursive: true})
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest))

    for (const [file, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, file), String(text))
    }
  }

  write('@rslib/core', {name: '@rslib/core', version: '0.0.0'})
  write('rsbuild-plugin-dts', {name: 'rsbuild-plugin-dts', dependencies})

  for (const name of installed) {
    write(
      name,
      {name, type: 'module', exports: {'.': {import: './dist/index.js'}}},
      {'dist/index.js': `export const parser = ${JSON.stringify(name)}\n`}
    )
  }

  return root
}

const broken = () => {
  throw new Error('Cannot find native binding.\nRequire stack: ...')
}

describe('the build writes type declarations or stops', () => {
  afterAll(() => {
    for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
  })

  it('probes the parser the installed declaration plugin depends on', () => {
    const found = findDtsParser()
    const plugin = require.resolve('rsbuild-plugin-dts', {
      paths: [path.dirname(require.resolve('@rslib/core/package.json'))]
    })
    const manifest = JSON.parse(
      fs.readFileSync(path.join(plugin, '../../package.json'), 'utf8')
    )

    expect(DTS_PARSERS).toContain(found?.name)
    expect(Object.keys(manifest.dependencies)).toContain(found?.name)
    expect(Object.keys(require(found?.entry as string))).not.toEqual([])
  })

  it('follows the plugin to a parser it moved to, one only import reaches', () => {
    const root = projectWithPlugin({
      '@swc-next/parser': '~0.7.0',
      '@swc-next/walker': '~0.7.0'
    })
    const found = findDtsParser(root)

    expect(found?.name).toBe('@swc-next/parser')
    expect(require(found?.entry as string).parser).toBe('@swc-next/parser')
    expect(
      resolveDtsGeneration(() => require(found?.entry as string), {})
    ).toBe(true)
  })

  it('names the parser the plugin asks for when it is not installed', () => {
    const root = projectWithPlugin({'@swc-next/parser': '~0.7.0'}, [])
    const found = findDtsParser(root)

    expect(() =>
      resolveDtsGeneration(
        () => require(found?.entry as string),
        {},
        found?.name
      )
    ).toThrow(
      /Type declarations cannot be generated: @swc-next\/parser failed to load\.\nCannot find module '[^'\n]*@swc-next[\\/]parser'/
    )
  })

  it('has nothing to probe when the plugin names no known parser', () => {
    expect(
      findDtsParser(projectWithPlugin({'some-other-parser': '1.0.0'}))
    ).toBe(undefined)
  })

  it('generates them when the native parser loads', () => {
    expect(resolveDtsGeneration(() => ({}), {})).toBe(true)
  })

  it('stops the build when the native parser cannot load', () => {
    expect(() => resolveDtsGeneration(broken, {})).toThrow(
      /Type declarations cannot be generated: @ast-grep\/napi failed to load\.\nCannot find native binding\.\nReinstall the dependencies, or set EXTENSION_SKIP_DTS=1/
    )
  })

  it('builds without them only when asked to, and never tries the parser then', () => {
    expect(resolveDtsGeneration(broken, {EXTENSION_SKIP_DTS: '1'})).toBe(false)
    expect(() =>
      resolveDtsGeneration(broken, {EXTENSION_SKIP_DTS: 'true'})
    ).toThrow()
  })
})
