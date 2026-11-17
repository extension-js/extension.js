import {describe, expect, it} from 'vitest'
import {ready} from '../../browsers-lib/ready-message'

const stripAnsi = (s: string) => s.replace(/\[[0-9;]*m/g, '')

describe('ready() banner message', () => {
  it('labels Chromium-family browsers an "Extension" and names no browser', () => {
    const msg = stripAnsi(ready('development', 'chrome'))
    expect(msg).toContain(
      'Extension ready for development. Watching for file changes.'
    )

    expect(msg).not.toContain('Chrome')
  })

  it('labels Firefox-family browsers an "Add-on" and names no browser', () => {
    for (const browser of ['firefox', 'gecko-based', 'firefox-based']) {
      const msg = stripAnsi(ready('production', browser))
      expect(msg).toContain('Add-on ready for production.')
      expect(msg).not.toContain('Firefox')
      expect(msg).not.toContain('Watching for file changes')
    }
  })

  it('calls the edge artifact an Extension, matching the build output', () => {
    const msg = stripAnsi(ready('development', 'edge'))
    expect(msg).toContain('Extension')
    expect(msg).not.toContain('Add-on')
  })

  it('does not throw for an unknown browser', () => {
    const msg = stripAnsi(ready('development', 'brave'))
    expect(msg).toContain('Extension ready for development')
  })

  it('calls the artifact of an empty browser string an Extension', () => {
    expect(stripAnsi(ready('development', ''))).toMatch(
      /Extension ready for development\. Watching for file changes\.$/
    )
  })
})
