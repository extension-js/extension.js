import {beforeEach, describe, expect, it, vi} from 'vitest'

const detectors = vi.hoisted(() => ({
  react: false,
  preact: false,
  vue: false,
  solid: false
}))

vi.mock('../../js-tools/react', () => ({
  isUsingReact: () => detectors.react
}))
vi.mock('../../js-tools/preact', () => ({
  isUsingPreact: () => detectors.preact
}))
vi.mock('../../js-tools/vue', () => ({
  isUsingVue: () => detectors.vue
}))
vi.mock('../../js-tools/solid', () => ({
  isUsingSolid: () => detectors.solid
}))

import {
  getJsxImportSource,
  isUsingJsxFramework,
  swcParserForFile
} from '../jsx-transform'

describe('getJsxImportSource', () => {
  beforeEach(() => {
    detectors.react = false
    detectors.preact = false
    detectors.vue = false
    detectors.solid = false
  })

  it('follows the installed framework and falls back to react', () => {
    expect(getJsxImportSource('/p')).toBe('react')
    detectors.vue = true
    expect(getJsxImportSource('/p')).toBe('vue')
    detectors.preact = true
    expect(getJsxImportSource('/p')).toBe('preact')
    detectors.react = true
    expect(getJsxImportSource('/p')).toBe('react')
    detectors.solid = true
    expect(getJsxImportSource('/p')).toBe('solid-js')
  })

  it('reports any JSX framework', () => {
    expect(isUsingJsxFramework('/p')).toBe(false)
    detectors.solid = true
    expect(isUsingJsxFramework('/p')).toBe(true)
  })
})

describe('swcParserForFile', () => {
  it('picks the parser from the extension', () => {
    expect(swcParserForFile('/p/a.tsx', false)).toMatchObject({
      syntax: 'typescript',
      tsx: true
    })
    expect(swcParserForFile('/p/a.ts?query', false)).toMatchObject({
      syntax: 'typescript',
      tsx: false
    })
    expect(swcParserForFile('/p/a.jsx', false)).toMatchObject({
      syntax: 'ecmascript',
      jsx: true
    })
    expect(swcParserForFile('/p/a.js', false)).toMatchObject({
      syntax: 'ecmascript',
      jsx: false
    })
    expect(swcParserForFile('/p/a.mjs', true)).toMatchObject({jsx: true})
  })
})
