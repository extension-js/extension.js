import {describe, expect, it} from 'vitest'
import {
  BrowserInstallPrivilegeError,
  BrowserNotInstallableError,
  isBrowserInstallPrivilegeError,
  isBrowserNotInstallableError,
  normalizeBrowserName
} from '../lib/browser-target'

function captured(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }

  return undefined
}

describe('browser target normalization', () => {
  it('maps engine aliases to concrete targets', () => {
    expect(normalizeBrowserName('chromium-based')).toBe('chromium')
    expect(normalizeBrowserName('gecko-based')).toBe('firefox')
    expect(normalizeBrowserName('firefox-based')).toBe('firefox')
  })

  it('accepts canonical names', () => {
    expect(normalizeBrowserName('chrome')).toBe('chrome')
    expect(normalizeBrowserName('chromium')).toBe('chromium')
    expect(normalizeBrowserName('edge')).toBe('edge')
    expect(normalizeBrowserName('firefox')).toBe('firefox')
  })

  it('throws BrowserNotInstallableError for system-located forks', () => {
    expect(() => normalizeBrowserName('brave')).toThrow(/never downloads/)
    expect(() => normalizeBrowserName('chrome,edge')).toThrow(/never downloads/)

    const error = captured(() => normalizeBrowserName('brave'))

    expect(isBrowserNotInstallableError(error)).toBe(true)
    expect(error).toBeInstanceOf(BrowserNotInstallableError)
  })

  it('explains that Safari needs Xcode, not a browser install', () => {
    expect(() => normalizeBrowserName('safari')).toThrow(/ships with macOS/)
    expect(() => normalizeBrowserName('webkit-based')).toThrow(/Xcode/)
    expect(() => normalizeBrowserName('acme-webkit')).toThrow(
      /ships with macOS/
    )

    const error = captured(() => normalizeBrowserName('safari'))

    expect(isBrowserNotInstallableError(error)).toBe(true)
    expect(error).toBeInstanceOf(BrowserNotInstallableError)
  })
})

describe('the error checks, which must hold across two copies of this package', () => {
  const checks = [
    {
      check: isBrowserNotInstallableError,
      thrown: new BrowserNotInstallableError('no'),
      name: 'BrowserNotInstallableError',
      code: 'BROWSER_NOT_INSTALLABLE'
    },
    {
      check: isBrowserInstallPrivilegeError,
      thrown: new BrowserInstallPrivilegeError('no'),
      name: 'BrowserInstallPrivilegeError',
      code: 'BROWSER_INSTALL_PRIVILEGE'
    }
  ]

  it.each(checks)('$name is known by its class, its name or its code', ({
    check,
    thrown,
    name,
    code
  }) => {
    expect(thrown).toBeInstanceOf(Error)
    expect({
      name: thrown.name,
      code: thrown.code,
      message: thrown.message
    }).toEqual({name, code, message: 'no'})

    expect(check(thrown)).toBe(true)
    expect(check({name})).toBe(true)
    expect(check({code})).toBe(true)
  })

  it.each(checks)('$name is not seen in anything else', ({check}) => {
    expect(check(new Error('no'))).toBe(false)
    expect(check({name: 'Error', code: 'ENOENT'})).toBe(false)
    expect(check('BROWSER_NOT_INSTALLABLE')).toBe(false)
    expect(check(null)).toBe(false)
    expect(check(undefined)).toBe(false)
  })

  it('neither check answers for the other error', () => {
    expect(
      isBrowserNotInstallableError(new BrowserInstallPrivilegeError('no'))
    ).toBe(false)

    expect(
      isBrowserInstallPrivilegeError(new BrowserNotInstallableError('no'))
    ).toBe(false)
  })
})
