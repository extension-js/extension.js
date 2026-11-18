import {describe, expect, it} from 'vitest'
import {makeProject} from '../../__spec__/project-fixture'
import {
  getJsxImportSource,
  isUsingJsxFramework,
  swcParserForFile
} from '../jsx-transform'

// Detection reads the project's package.json, so each case is one on disk.
function projectWith(dependencies: Record<string, string>) {
  return makeProject({'package.json': {dependencies}})
}

describe('getJsxImportSource', () => {
  it.each([
    [{}, 'react'],
    [{vue: '3'}, 'vue'],
    [{vue: '3', preact: '10'}, 'preact'],
    [{vue: '3', preact: '10', react: '19'}, 'react'],
    [{vue: '3', preact: '10', react: '19', 'solid-js': '1'}, 'solid-js'],
    [{'solid-js': '1', react: '19'}, 'solid-js'],
    [{react: '19', vue: '3'}, 'react']
  ])('names the runtime for %j as %s', (dependencies, importSource) => {
    expect(getJsxImportSource(projectWith(dependencies))).toBe(importSource)
  })

  it('reads devDependencies too', () => {
    const root = makeProject({
      'package.json': {devDependencies: {preact: '10'}}
    })

    expect(getJsxImportSource(root)).toBe('preact')
  })
})

describe('isUsingJsxFramework', () => {
  it.each([
    [{}, false],
    [{svelte: '5'}, false],
    [{react: '19'}, true],
    [{preact: '10'}, true],
    [{'solid-js': '1'}, true],
    [{vue: '3'}, true]
  ])('answers %j with %s', (dependencies, expected) => {
    expect(isUsingJsxFramework(projectWith(dependencies))).toBe(expected)
  })
})

describe('swcParserForFile', () => {
  it('picks the parser from the extension', () => {
    expect(swcParserForFile('/p/a.tsx', false)).toEqual({
      syntax: 'typescript',
      tsx: true,
      dynamicImport: true
    })

    expect(swcParserForFile('/p/a.ts?query', false)).toEqual({
      syntax: 'typescript',
      tsx: false,
      dynamicImport: true
    })

    expect(swcParserForFile('/p/a.jsx', false)).toEqual({
      syntax: 'ecmascript',
      jsx: true,
      dynamicImport: true
    })

    expect(swcParserForFile('/p/a.js', false)).toEqual({
      syntax: 'ecmascript',
      jsx: false,
      dynamicImport: true
    })

    expect(swcParserForFile('/p/a.mjs', true)).toEqual({
      syntax: 'ecmascript',
      jsx: true,
      dynamicImport: true
    })
  })
})
