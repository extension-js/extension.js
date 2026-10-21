import {describe, expect, it} from 'vitest'
import {mergeChromiumFeatureSwitches} from '../browsers-lib/shared-utils'

describe('mergeChromiumFeatureSwitches', () => {
  it('merges repeated switches into one of each', () => {
    expect(
      mergeChromiumFeatureSwitches([
        '--enable-features=A,B',
        '--mute-audio',
        '--enable-features=B,C'
      ])
    ).toEqual(['--mute-audio', '--enable-features=A,B,C'])
  })

  it('lets a later layer move a feature from disable to enable', () => {
    expect(
      mergeChromiumFeatureSwitches([
        '--disable-features=TranslateUI,Foo',
        '--enable-features=TranslateUI'
      ])
    ).toEqual(['--enable-features=TranslateUI', '--disable-features=Foo'])
  })

  it('lets a later layer move a feature from enable to disable', () => {
    expect(
      mergeChromiumFeatureSwitches([
        '--enable-features=Bar',
        '--disable-features=Bar'
      ])
    ).toEqual(['--disable-features=Bar'])
  })

  it('matches a feature by name across trial and param suffixes', () => {
    expect(
      mergeChromiumFeatureSwitches([
        '--enable-features=Baz<Trial,Qux:mode/fast',
        '--disable-features=Baz,Qux'
      ])
    ).toEqual(['--disable-features=Baz,Qux'])
  })
})
