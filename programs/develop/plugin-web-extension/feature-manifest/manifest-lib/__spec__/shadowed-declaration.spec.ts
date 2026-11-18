import {describe, expect, it} from 'vitest'
import {
  filterKeysForThisBrowser,
  winningPrefixedKey
} from '../../../../lib/manifest-utils'
import type {DevOptions, Manifest} from '../../../../types'
import {
  findReplacedHostList,
  findShadowedPermission
} from '../shadowed-declaration'

type Browser = DevOptions['browser']

const PREFIXES = [
  'chrome',
  'chromium',
  'edge',
  'firefox',
  'gecko',
  'safari',
  'webkit'
]
const BROWSERS = ['chrome', 'edge', 'chromium', 'firefox', 'safari']

function manifest(keys: Record<string, unknown>) {
  return keys as unknown as Manifest
}

describe('winningPrefixedKey', () => {
  it('names the key whose value the resolver ships, in either source order', () => {
    for (const browser of BROWSERS) {
      for (const first of PREFIXES) {
        for (const second of PREFIXES) {
          const source = manifest({
            permissions: ['plain'],
            [`${first}:permissions`]: [first],
            [`${second}:permissions`]: [second]
          })
          const winner = winningPrefixedKey(
            source,
            'permissions',
            browser as Browser
          )
          const shipped = filterKeysForThisBrowser(source, browser as Browser)

          expect(
            (source as unknown as Record<string, unknown>)[
              winner ?? 'permissions'
            ]
          ).toEqual(shipped.permissions)
        }
      }
    }
  })

  it('answers nothing when only the plain key or another key is there', () => {
    expect(
      winningPrefixedKey(
        manifest({permissions: [], 'firefox:permissions': []}),
        'permissions',
        'chrome'
      )
    ).toBeUndefined()

    expect(
      winningPrefixedKey(
        manifest({'chromium:optional_permissions': []}),
        'permissions',
        'chrome'
      )
    ).toBeUndefined()
  })
})

describe('findShadowedPermission', () => {
  it('finds the plain list a prefixed key replaced', () => {
    expect(
      findShadowedPermission(
        manifest({
          permissions: ['storage'],
          'chromium:permissions': ['sidePanel']
        }),
        'chrome',
        'storage'
      )
    ).toEqual({
      kind: 'replaced',
      listedUnder: 'permissions',
      readKey: 'chromium:permissions',
      browser: 'chrome'
    })
  })

  it('names the more specific key when two prefixed keys apply', () => {
    expect(
      findShadowedPermission(
        manifest({
          permissions: ['storage'],
          'chrome:permissions': ['alarms'],
          'chromium:permissions': ['sidePanel']
        }),
        'chrome',
        'storage'
      )?.readKey
    ).toBe('chrome:permissions')
  })

  it('finds a key this build skips and the key it reads instead', () => {
    expect(
      findShadowedPermission(
        manifest({'firefox:permissions': ['storage']}),
        'chrome',
        'storage'
      )
    ).toEqual({
      kind: 'elsewhere',
      listedUnder: 'firefox:permissions',
      readKey: 'permissions',
      browser: 'chrome'
    })

    expect(
      findShadowedPermission(
        manifest({
          'chromium:permissions': ['storage'],
          'chrome:permissions': ['alarms']
        }),
        'chrome',
        'storage'
      )
    ).toEqual({
      kind: 'elsewhere',
      listedUnder: 'chromium:permissions',
      readKey: 'chrome:permissions',
      browser: 'chrome'
    })
  })

  it('answers nothing when no key holds it or no manifest was kept', () => {
    expect(
      findShadowedPermission(
        manifest({
          permissions: ['alarms'],
          'chromium:permissions': ['sidePanel']
        }),
        'chrome',
        'storage'
      )
    ).toBeUndefined()

    expect(
      findShadowedPermission(
        manifest({permissions: ['alarms']}),
        'chrome',
        'storage'
      )
    ).toBeUndefined()

    expect(
      findShadowedPermission(undefined, 'chrome', 'storage')
    ).toBeUndefined()
  })

  it('leaves a prefixed key for another browser out of a replaced verdict', () => {
    expect(
      findShadowedPermission(
        manifest({
          permissions: ['storage'],
          'firefox:permissions': ['menus']
        }),
        'chrome',
        'storage'
      )
    ).toBeUndefined()
  })
})

describe('findReplacedHostList', () => {
  it('finds hosts an empty prefixed list replaced, and nothing else', () => {
    expect(
      findReplacedHostList(
        manifest({
          host_permissions: ['https://example.com/*'],
          'chromium:host_permissions': []
        }),
        'chrome'
      )
    ).toEqual({
      kind: 'replaced',
      listedUnder: 'host_permissions',
      readKey: 'chromium:host_permissions',
      browser: 'chrome'
    })

    expect(
      findReplacedHostList(
        manifest({'chromium:host_permissions': []}),
        'chrome'
      )
    ).toBeUndefined()

    expect(
      findReplacedHostList(
        manifest({
          host_permissions: ['https://example.com/*'],
          'firefox:host_permissions': []
        }),
        'chrome'
      )
    ).toBeUndefined()
  })
})
