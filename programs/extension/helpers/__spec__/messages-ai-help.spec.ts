import {describe, it, expect} from 'vitest'
import {
  programAIHelp,
  programAIHelpJSON,
  commandDescriptions
} from '../messages'

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
      'uninstall',
      'telemetry'
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

  it('does not drift from the registered command descriptions', () => {
    const help = programAIHelpJSON('3.5.0')
    const helpCommands = help.commands.map((command) => command.name).sort()
    const describedCommands = Object.keys(commandDescriptions).sort()

    // Adding/removing a CLI command without updating the AI-help JSON would
    // hand consumers an inaccurate manifest. Keep these in lockstep.
    expect(helpCommands).toEqual(describedCommands)
  })

  it('exposes the ready/events machine contracts', () => {
    const {readyContract} = programAIHelpJSON('3.5.0').capabilities

    expect(readyContract.readyPath).toBe(
      'dist/extension-js/<browser>/ready.json'
    )
    expect(readyContract.eventsPath).toBe(
      'dist/extension-js/<browser>/events.ndjson'
    )
    expect(readyContract.statuses).toEqual(['starting', 'ready', 'error'])
    expect(readyContract.readyFields).toContain('pid')
    expect(readyContract.readyFields).toContain('compiledAt')
    expect(readyContract.eventTypes).toEqual([
      'compile_start',
      'compile_success',
      'compile_error',
      'shutdown'
    ])
  })
})
