import {describe, expect, it} from 'vitest'

import {buildWebpack} from '../messages'

const makeStats = (assets: {name: string; size: number}[]) =>
  ({
    toJson: () => ({assets, time: 10}),
    hasErrors: () => false,
    compilation: {outputOptions: {path: '/abs/out/chrome'}}
  }) as any

const strip = (value: string) => value.replace(/\[[0-9;]*m/g, '')

describe('build assets tree', () => {
  it('prints a 0-byte asset as a file, not a folder holding "size"', () => {
    const out = strip(
      buildWebpack(
        '/abs/project',
        makeStats([{name: 'theme/images/theme_frame.png', size: 0}]),
        'chrome'
      )
    )

    expect(out).toMatch(/theme_frame\.png \(0\.00KB\)/)
    expect(out).not.toMatch(/size/)
  })

  it('still nests real directories', () => {
    const out = strip(
      buildWebpack(
        '/abs/project',
        makeStats([
          {name: 'theme/images/a.png', size: 70},
          {name: 'manifest.json', size: 440}
        ]),
        'chrome'
      )
    )

    expect(out).toMatch(/theme/)
    expect(out).toMatch(/images/)
    expect(out).toMatch(/a\.png \(0\.07KB\)/)
    expect(out).toMatch(/manifest\.json \(0\.43KB\)/)
  })
})
