import {Command} from 'commander'
import {describe, expect, it} from 'vitest'
import {registerDevCommand} from '../commands/dev'
import {registerPreviewCommand} from '../commands/preview'
import {registerStartCommand} from '../commands/start'
import {
  BROWSER_LAUNCH_HELP_FOOTER,
  NO_OPEN_FLAG_DESCRIPTION
} from '../helpers/no-browser'

// A reader who wants to stop the browser from starting has two flags in front
// of them. These pin the wording that tells them apart, on every command that
// takes both, so a copy edit can never collapse them back into one sentence.
const COMMANDS_WITH_BOTH_FLAGS = ['dev', 'start', 'preview'] as const

function helpFor(name: (typeof COMMANDS_WITH_BOTH_FLAGS)[number]): string {
  const program = new Command()
  program.exitOverride()
  registerDevCommand(program)
  registerStartCommand(program)
  registerPreviewCommand(program)

  const command = program.commands.find((entry) => entry.name() === name)
  if (!command) throw new Error(`no such command: ${name}`)

  // helpInformation() renders declared options only. addHelpText copy, where
  // --no-browser lives, reaches the reader through outputHelp.
  let captured = ''
  command.configureOutput({
    writeOut: (chunk) => {
      captured += chunk
    },
    writeErr: (chunk) => {
      captured += chunk
    }
  })
  command.outputHelp()
  return captured
}

describe('--no-open and --no-browser read as different flags', () => {
  it.each(COMMANDS_WITH_BOTH_FLAGS)('%s declares --no-open', (name) => {
    const help = helpFor(name)
    expect(help).toContain('--no-open')
    expect(help).toContain(NO_OPEN_FLAG_DESCRIPTION)
  })

  it.each(COMMANDS_WITH_BOTH_FLAGS)('%s documents --no-browser', (name) => {
    expect(helpFor(name)).toContain('--no-browser')
  })

  it.each(
    COMMANDS_WITH_BOTH_FLAGS
  )('%s help carries the disambiguation footer', (name) => {
    const help = helpFor(name)
    for (const line of BROWSER_LAUNCH_HELP_FOOTER.split('\n')) {
      if (!line.trim()) continue
      expect(help).toContain(line)
    }
  })

  it.each(
    COMMANDS_WITH_BOTH_FLAGS
  )('%s says --no-browser stops the launch, in the words a searcher uses', (name) => {
    // The docs-search log that produced this fix reads "stop browser launch".
    expect(helpFor(name)).toContain('stop the browser launch')
  })

  it('describes --no-open as a launch that still happens', () => {
    expect(NO_OPEN_FLAG_DESCRIPTION).toContain('launch the browser but')
    expect(NO_OPEN_FLAG_DESCRIPTION).toContain('--no-browser')
    // The old copy said "do not open the browser automatically", which is what
    // --no-browser does. That sentence must not come back.
    expect(NO_OPEN_FLAG_DESCRIPTION).not.toContain(
      'do not open the browser automatically'
    )
  })

  it('keeps the house style out of the shared copy', () => {
    const copy = `${NO_OPEN_FLAG_DESCRIPTION}${BROWSER_LAUNCH_HELP_FOOTER}`
    expect(copy).not.toContain(';')
    // Built from its code point so the literal character never appears in
    // this file, which the repo prose check scans like any other source.
    expect(copy).not.toContain(String.fromCharCode(0x2014))
  })
})
