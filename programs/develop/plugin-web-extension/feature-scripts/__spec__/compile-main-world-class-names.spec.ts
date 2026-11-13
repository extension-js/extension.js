import {describe, expect, it} from 'vitest'
import {withOwnClassNames} from '../steps/compile-main-world-scripts'

const DEV_NAME = '[uniqueName]-[id]-[local]'

describe('the class names of a MAIN world bundle compiled apart in dev', () => {
  it('carry the bundle they belong to', () => {
    const named = withOwnClassNames(undefined, 'scripts/deep/hook')

    expect(named['css/module'].localIdentName).toBe(
      '[uniqueName]-scripts-deep-hook-[id]-[local]'
    )

    expect(named['css/auto'].localIdentName).toBe(
      named['css/module'].localIdentName
    )
  })

  it('differ between two bundles whose modules took the same id', () => {
    const one = withOwnClassNames(undefined, 'scripts/one')
    const two = withOwnClassNames(undefined, 'content_scripts/content-1')

    expect(one['css/module'].localIdentName).not.toBe(
      two['css/module'].localIdentName
    )
  })

  it('replace the name the bundler defaults to and keep every other setting', () => {
    const named = withOwnClassNames(
      {
        'css/module': {localIdentName: DEV_NAME, exportsOnly: false},
        css: {exportsOnly: true}
      },
      'scripts/hook'
    )

    expect(named['css/module']).toEqual({
      localIdentName: '[uniqueName]-scripts-hook-[id]-[local]',
      exportsOnly: false
    })

    expect(named.css).toEqual({exportsOnly: true})
  })

  it('leave a name the author configured alone', () => {
    const named = withOwnClassNames(
      {'css/module': {localIdentName: '[path][name]__[local]'}},
      'scripts/hook'
    )

    expect(named['css/module'].localIdentName).toBe('[path][name]__[local]')
  })

  it('do not change the settings they were given', () => {
    const given = {'css/module': {localIdentName: DEV_NAME}}

    withOwnClassNames(given, 'scripts/hook')

    expect(given['css/module'].localIdentName).toBe(DEV_NAME)
  })
})
