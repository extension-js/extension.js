import {afterEach, describe, expect, it} from 'vitest'
import {
  FirefoxBinaryDetector,
  isFirefoxHeadlessRequested,
  parseFlatpakBinary
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
  const FLATPAK = 'flatpak:org.mozilla.firefox'
  const BINARY = '/usr/bin/firefox'
  const PROFILE = '/tmp/profile'

  it.each<{
    title: string
    platform: NodeJS.Platform
    binary: string
    port: number
    extra?: string[]
    headless?: boolean
    plan: {binary: string; args: string[]}
  }>([
    {
      title: 'a binary path off Windows',
      platform: 'linux',
      binary: BINARY,
      port: 6000,
      plan: {
        binary: BINARY,
        args: [
          '--no-remote',
          '--new-instance',
          '-profile',
          PROFILE,
          '-start-debugger-server',
          '6000',
          '--foreground'
        ]
      }
    },
    {
      title: 'a binary path on Windows, which waits for the browser',
      platform: 'win32',
      binary: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      port: 6000,
      plan: {
        binary: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
        args: [
          '--no-remote',
          '--new-instance',
          '-wait-for-browser',
          '-profile',
          PROFILE,
          '-start-debugger-server',
          '6000',
          '--foreground'
        ]
      }
    },
    {
      title: 'a headless run, which never raises a window',
      platform: 'darwin',
      binary: BINARY,
      port: 6000,
      headless: true,
      plan: {
        binary: BINARY,
        args: [
          '--no-remote',
          '--new-instance',
          '-headless',
          '-profile',
          PROFILE,
          '-start-debugger-server',
          '6000'
        ]
      }
    },
    {
      title: 'a Flatpak reference, run through flatpak with the profile shared',
      platform: 'linux',
      binary: FLATPAK,
      port: 6000,
      extra: ['--safe-mode'],
      plan: {
        binary: 'flatpak',
        args: [
          'run',
          `--filesystem=${PROFILE}`,
          'org.mozilla.firefox',
          '--no-remote',
          '--new-instance',
          '-profile',
          PROFILE,
          '-start-debugger-server',
          '6000',
          '--foreground',
          '--safe-mode'
        ]
      }
    },
    {
      title: 'a headless Flatpak run with no debugger port',
      platform: 'linux',
      binary: FLATPAK,
      port: 0,
      headless: true,
      plan: {
        binary: 'flatpak',
        args: [
          'run',
          `--filesystem=${PROFILE}`,
          'org.mozilla.firefox',
          '--no-remote',
          '--new-instance',
          '-headless',
          '-profile',
          PROFILE
        ]
      }
    }
  ])('plans $title', ({platform, binary, port, extra, headless, plan}) => {
    setPlatform(platform)

    expect(
      FirefoxBinaryDetector.generateFirefoxArgs(
        binary,
        PROFILE,
        port,
        extra,
        headless
      )
    ).toEqual(plan)
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

describe('parseFlatpakBinary', () => {
  it('parses a valid Flatpak reference', () => {
    const result = parseFlatpakBinary('flatpak:org.mozilla.firefox')
    expect(result).toEqual({appId: 'org.mozilla.firefox'})
  })

  it('parses Flatpak reference with extra whitespace', () => {
    const result = parseFlatpakBinary('flatpak:  org.mozilla.firefox ')
    expect(result).toEqual({appId: 'org.mozilla.firefox'})
  })

  it('returns null for a normal binary path', () => {
    expect(parseFlatpakBinary('/usr/bin/firefox')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseFlatpakBinary('')).toBeNull()
  })

  it('returns null when prefix is present but appId is empty', () => {
    expect(parseFlatpakBinary('flatpak:')).toBeNull()
    expect(parseFlatpakBinary('flatpak:   ')).toBeNull()
  })
})
