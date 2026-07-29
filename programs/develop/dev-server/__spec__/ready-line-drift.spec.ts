import {describe, expect, it} from 'vitest'
import {ready as browserReady} from '../../../extension/browsers/browsers-lib/ready-message'
import {ready as devServerReady} from '../messages'

const MODES = ['development', 'production'] as const
const BROWSERS = [
  'chrome',
  'chromium',
  'chromium-based',
  'edge',
  'firefox',
  'firefox-based',
  'gecko-based',
  'brave',
  ''
]

describe('ready line drift guard', () => {
  it('renders the same line from both bundles for every input', () => {
    for (const mode of MODES) {
      for (const browser of BROWSERS) {
        expect(browserReady(mode, browser)).toBe(devServerReady(mode, browser))
      }
    }
  })

  it('states the watch state and names no browser', () => {
    const line = devServerReady('development', 'chrome').replace(
      /\[[0-9;]*m/g,
      ''
    )
    expect(line).toContain(
      'Extension ready for development. Watching for file changes.'
    )
    expect(line).not.toContain('Chrome')
  })
})
