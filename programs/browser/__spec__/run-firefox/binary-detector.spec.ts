import {describe, it, expect, afterEach} from 'vitest'
import {FirefoxBinaryDetector} from '../../run-firefox/firefox-launch/binary-detector'

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
})
