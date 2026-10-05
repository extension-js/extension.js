import {describe, expect, it} from 'vitest'

import {buildAssetsTree} from '../messages'

const makeStats = (assets: {name: string; size: number}[]) =>
  ({
    toJson: () => ({assets, time: 10}),
    hasErrors: () => false,
    compilation: {outputOptions: {path: '/abs/out/chrome'}}
  }) as any

const strip = (value: string) => value.replace(/\[[0-9;]*m/g, '')

describe('build assets tree', () => {
  it('prints a 0-byte asset as a file, not a folder holding "size"', () => {
    const out = strip(
      buildAssetsTree(
        makeStats([{name: 'theme/images/theme_frame.png', size: 0}])
      )
    )

    expect(out).toMatch(/theme_frame\.png \(0\.00KB\)/)
    expect(out).not.toMatch(/size/)
  })

  it('still nests real directories', () => {
    const out = strip(
      buildAssetsTree(
        makeStats([
          {name: 'theme/images/a.png', size: 70},
          {name: 'manifest.json', size: 440}
        ])
      )
    )

    expect(out).toMatch(/theme/)
    expect(out).toMatch(/images/)
    expect(out).toMatch(/a\.png \(0\.07KB\)/)
    expect(out).toMatch(/manifest\.json \(0\.43KB\)/)
  })

  it('prints nothing at all for an empty asset list', () => {
    expect(buildAssetsTree(makeStats([]))).toBe('')
    expect(buildAssetsTree(undefined)).toBe('')
  })

  it('names the source maps the tree left out in one closing line', () => {
    const out = strip(
      buildAssetsTree(
        makeStats([
          {name: 'action/index.js', size: 40},
          {name: 'manifest.json', size: 440}
        ]),
        [
          {name: 'action/index.js', size: 40},
          {name: 'action/index.js.map', size: 1024},
          {name: 'action/index.css.map', size: 512},
          {name: 'manifest.json', size: 440}
        ]
      )
    )

    expect(out.trimEnd().split('\n').at(-1)).toContain(
      '+ 2 source maps not shown (1.50KB)'
    )

    expect(out.match(/not shown/g)).toHaveLength(1)
    expect(out).not.toMatch(/index\.js\.map/)
  })

  it('calls them files when the tree left out more than source maps', () => {
    const out = strip(
      buildAssetsTree(makeStats([{name: 'manifest.json', size: 440}]), [
        {name: 'manifest.json', size: 440},
        {name: 'vendor.LICENSE.txt', size: 2048}
      ])
    )

    expect(out.trimEnd().split('\n').at(-1)).toContain(
      '+ 1 file not shown (2.00KB)'
    )
  })

  it('adds no line when the tree already lists every file', () => {
    const assets = [
      {name: 'action/index.js', size: 40},
      {name: 'manifest.json', size: 440}
    ]

    expect(buildAssetsTree(makeStats(assets), assets)).toBe(
      buildAssetsTree(makeStats(assets))
    )
  })
})
