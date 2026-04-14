import {describe, it, expect, afterEach} from 'vitest'
import {
  parseFlatpakBinary,
  FirefoxBinaryDetector
} from '../../run-firefox/firefox-launch/binary-detector'

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

describe('FirefoxBinaryDetector.generateFirefoxArgs with Flatpak', () => {
  it('rewrites binary to "flatpak" and prepends run + filesystem args', () => {
    setPlatform('linux')

    const {binary, args} = FirefoxBinaryDetector.generateFirefoxArgs(
      'flatpak:org.mozilla.firefox',
      '/tmp/test-profile',
      6000
    )

    expect(binary).toBe('flatpak')
    expect(args[0]).toBe('run')
    expect(args[1]).toBe('--filesystem=/tmp/test-profile')
    expect(args[2]).toBe('org.mozilla.firefox')
    expect(args).toContain('--no-remote')
    expect(args).toContain('-start-debugger-server')
    expect(args).toContain('6000')
  })

  it('omits debug server args when port is 0', () => {
    setPlatform('linux')

    const {binary, args} = FirefoxBinaryDetector.generateFirefoxArgs(
      'flatpak:org.mozilla.firefox',
      '/tmp/profile',
      0
    )

    expect(binary).toBe('flatpak')
    expect(args).not.toContain('-start-debugger-server')
  })

  it('passes additional args through in Flatpak mode', () => {
    setPlatform('linux')

    const {args} = FirefoxBinaryDetector.generateFirefoxArgs(
      'flatpak:org.mozilla.firefox',
      '/tmp/profile',
      6000,
      ['--safe-mode']
    )

    expect(args).toContain('--safe-mode')
  })

  it('does not use Flatpak for a normal binary path', () => {
    setPlatform('linux')

    const {binary, args} = FirefoxBinaryDetector.generateFirefoxArgs(
      '/usr/bin/firefox',
      '/tmp/profile',
      6000
    )

    expect(binary).toBe('/usr/bin/firefox')
    expect(args).not.toContain('run')
    expect(args).not.toContain('flatpak')
  })
})
