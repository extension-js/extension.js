import {afterEach, describe, expect, it} from 'vitest'
import {
  FirefoxBinaryDetector,
  isFirefoxHeadlessRequested
} from '../../run-firefox/firefox-launch/binary-detector'

// The published ExtensionEnv augmentation makes the bundler-injected keys
// required, and a unit env object carries none of them.
const env = (vars: Record<string, string> = {}) => vars as NodeJS.ProcessEnv

const originalPlatform = process.platform

const setPlatform = (value: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true
  })
}

afterEach(() => {
  setPlatform(originalPlatform)
})

describe('FirefoxBinaryDetector.generateFirefoxArgs', () => {
  it('includes -wait-for-browser on Windows', () => {
    setPlatform('win32')

    const {args} = FirefoxBinaryDetector.generateFirefoxArgs(
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\tmp\\profile',
      6000
    )

    expect(args).toContain('-wait-for-browser')
  })

  it('does not include -wait-for-browser on non-Windows', () => {
    setPlatform('linux')

    const {args} = FirefoxBinaryDetector.generateFirefoxArgs(
      '/usr/bin/firefox',
      '/tmp/profile',
      6000
    )

    expect(args).not.toContain('-wait-for-browser')
  })

  it('adds -headless when requested (before -profile), omits it otherwise', () => {
    setPlatform('linux')

    const headless = FirefoxBinaryDetector.generateFirefoxArgs(
      '/usr/bin/firefox',
      '/tmp/profile',
      6000,
      [],
      true
    ).args
    expect(headless).toContain('-headless')
    expect(headless.indexOf('-headless')).toBeLessThan(
      headless.indexOf('-profile')
    )

    const headed = FirefoxBinaryDetector.generateFirefoxArgs(
      '/usr/bin/firefox',
      '/tmp/profile',
      6000,
      [],
      false
    ).args
    expect(headed).not.toContain('-headless')
  })

  it('drops the window-raising --foreground when headless (focus-steal guard)', () => {
    setPlatform('darwin')

    const headless = FirefoxBinaryDetector.generateFirefoxArgs(
      '/usr/bin/firefox',
      '/tmp/profile',
      6000,
      [],
      true
    ).args
    expect(headless).not.toContain('--foreground')

    const headed = FirefoxBinaryDetector.generateFirefoxArgs(
      '/usr/bin/firefox',
      '/tmp/profile',
      6000,
      [],
      false
    ).args
    expect(headed).toContain('--foreground')
  })

  it('adds -headless to the Flatpak arg form too', () => {
    setPlatform('linux')
    const {binary, args} = FirefoxBinaryDetector.generateFirefoxArgs(
      'flatpak:org.mozilla.firefox',
      '/tmp/profile',
      6000,
      [],
      true
    )
    expect(binary).toBe('flatpak')
    expect(args).toContain('-headless')
  })
})

describe('isFirefoxHeadlessRequested', () => {
  it('is true for MOZ_HEADLESS=1 / true (case-insensitive), false otherwise', () => {
    expect(isFirefoxHeadlessRequested(env({MOZ_HEADLESS: '1'}))).toBe(true)
    expect(isFirefoxHeadlessRequested(env({MOZ_HEADLESS: 'true'}))).toBe(true)
    expect(isFirefoxHeadlessRequested(env({MOZ_HEADLESS: 'TRUE'}))).toBe(true)
    expect(isFirefoxHeadlessRequested(env({MOZ_HEADLESS: '0'}))).toBe(false)
    expect(isFirefoxHeadlessRequested(env({MOZ_HEADLESS: ''}))).toBe(false)
    expect(isFirefoxHeadlessRequested(env({}))).toBe(false)
  })

  it('honors the cross-browser EXTENSION_HEADLESS focus-steal guard', () => {
    expect(isFirefoxHeadlessRequested(env({EXTENSION_HEADLESS: '1'}))).toBe(
      true
    )

    expect(isFirefoxHeadlessRequested(env({EXTENSION_HEADLESS: 'true'}))).toBe(
      true
    )

    expect(isFirefoxHeadlessRequested(env({EXTENSION_HEADLESS: '0'}))).toBe(
      false
    )
  })
})
