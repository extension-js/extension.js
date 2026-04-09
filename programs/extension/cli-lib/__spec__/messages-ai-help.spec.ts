import {describe, it, expect} from 'vitest'
import {programAIHelp, programAIHelpJSON} from '../messages'

describe('programAIHelp', () => {
  it('includes Managed Dependencies guidance', () => {
    const help = programAIHelp()
    expect(help).toMatch(/Managed Dependencies \(Important\)/)
    expect(help).toMatch(/do not add/i)
    expect(help).toMatch(/print an error and abort/i)
  })

  it('exposes stable machine-readable schema', () => {
    const help = programAIHelpJSON('3.5.0')
    expect(help.version).toBe('3.5.0')
    expect(Array.isArray(help.commands)).toBe(true)
    expect(Array.isArray(help.globalOptions)).toBe(true)
    expect(Array.isArray(help.examples)).toBe(true)

    expect(help.commands.map((command) => command.name)).toEqual([
      'create',
      'dev',
      'start',
      'preview',
      'build',
      'install',
      'uninstall'
    ])
    expect(help.capabilities.sourceInspection.supportedIn).toEqual(['dev'])
    expect(help.capabilities.sourceInspection.unsupportedIn).toContain(
      'preview'
    )
    expect(help.capabilities.logger.formats).toEqual([
      'pretty',
      'json',
      'ndjson'
    ])
  })
})
