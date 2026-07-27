import {describe, expect, it} from 'vitest'
import {
  availableCommandsBlock,
  commandSpec,
  checkUpdates as formatUpdateMessage,
  notImplemented,
  noURLWithoutStart,
  programUserHelp,
  unsupportedBrowserFlag
} from '../messages'

function stripAnsi(input: string): string {
  return input.replace(/\[[0-9;]*m/g, '')
}

describe('messages helpers', () => {
  it('formats update available message for stable versions', () => {
    const msg = formatUpdateMessage({version: '2.0.0'}, {latest: '2.1.0'})
    expect(msg).toBeTruthy()
    expect(msg.message).toMatch(/Extension.js update available\./)
    expect(msg.message).toMatch(/2.0.0/)
    expect(msg.message).toMatch(/2.1.0/)
    expect(msg.suffix).toMatch(/2.1.0/)
    expect(msg.message).toContain(
      'https://github.com/extension-js/extension.js/releases/tag/v2.1.0'
    )
  })

  it('suggests start when URL passed to create', () => {
    const msg = noURLWithoutStart('https://example.com')
    expect(msg).toMatch(/create/)
    expect(msg).toMatch(/start/)
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
    expect(help).toMatch(/extension doctor/)
    expect(help).toMatch(/Common Options/)
  })

  it('prints the corrected argument signatures', () => {
    const block = stripAnsi(availableCommandsBlock())

    // --key/--value are options, never positionals.
    expect(block).toContain('- extension storage <get|set> [project-path]')
    expect(block).not.toContain('[key] [value]')
    // --tab is optional, so it is not part of the syntax.
    expect(block).toContain('- extension inspect [project-path]')
    expect(block).not.toContain('inspect [project-path] --tab')
    // All five surfaces the open handler accepts.
    expect(block).toContain(
      '- extension open <popup|options|sidebar|action|command> [project-path]'
    )
    // The browser name is optional and defaults to chromium.
    expect(block).toContain('- extension install [browser-name]')
    expect(block).toContain('Defaults to chromium when no browser is named.')
    // One name for one argument across dev, start, preview and build.
    for (const name of ['dev', 'start', 'preview', 'build']) {
      expect(block).toContain(`- extension ${name} [project-path|remote-url]`)
    }
    expect(block).not.toContain('project-name]')
    expect(block).not.toContain('path-to-remote-extension')
  })

  it('keeps the option-shaped help rows out of the command list', () => {
    const block = stripAnsi(availableCommandsBlock())

    expect(block).toContain('- extension install --browser <')
    expect(block).toContain('- extension install --where')
    expect(block).toContain('- extension uninstall --where')
    // Notes hang off their command, so they add no COMMANDS entry.
    expect(commandSpec('install').notes).toHaveLength(2)
    expect(
      commandSpec('install').notes?.some((note) => note.usage === '--where')
    ).toBe(true)
  })
})
