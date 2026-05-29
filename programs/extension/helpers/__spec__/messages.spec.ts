import {describe, it, expect} from 'vitest'
import {
  checkUpdates as formatUpdateMessage,
  noURLWithoutStart,
  notImplemented,
  unsupportedBrowserFlag,
  programUserHelp
} from '../messages'

describe('messages helpers', () => {
  it('formats update available message for stable versions', () => {
    const msg = formatUpdateMessage({version: '2.0.0'}, {latest: '2.1.0'})
    expect(msg).toBeTruthy()
    expect(msg.message).toMatch(/Extension.js update available\./)
    expect(msg.message).toMatch(/2.0.0/)
    expect(msg.message).toMatch(/2.1.0/)
    expect(msg.suffix).toMatch(/2.1.0/)
    // Surfaces the release notes for the new version so "what's new" is one click away.
    expect(msg.message).toContain(
      'https://github.com/extension-js/extension.js/releases/tag/v2.1.0'
    )
  })

  it('suggests start when URL passed to create', () => {
    const msg = noURLWithoutStart('https://example.com')
    expect(msg).toMatch(/create/) // mentions create command
    expect(msg).toMatch(/start/) // suggests start command
    expect(msg).toMatch(/https:\/\/example\.com/)
  })

  it('prints not implemented error with command name', () => {
    const msg = notImplemented('foo')
    expect(msg).toMatch(/foo/)
    expect(msg).toMatch(/NOT IMPLEMENTED/)
  })

  it('renders unsupported browser flag message', () => {
    const msg = unsupportedBrowserFlag('opera', ['chrome', 'edge', 'firefox'])
    expect(msg).toMatch(/Unsupported --browser value: opera/)
    expect(msg).toMatch(/chrome, edge, firefox|chrome,edge,firefox/)
  })

  it('program user help mentions key sections and commands', () => {
    const help = programUserHelp()
    expect(help).toMatch(/Usage:/)
    expect(help).toMatch(/Available Commands/)
    expect(help).toMatch(/extension create/)
    expect(help).toMatch(/extension dev/)
    expect(help).toMatch(/Common Options/)
  })
})
