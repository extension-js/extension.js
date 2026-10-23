import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {Command} from 'commander'
import {describe, expect, it} from 'vitest'
import * as messages from '../../browsers/browsers-lib/messages'
import {registerBuildCommand} from '../build'
import {registerDevCommand} from '../dev'

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

function developmentTeamHelp(register: (program: Command) => void) {
  const program = new Command()
  register(program)
  const option = program.commands
    .flatMap((command) => command.options)
    .find((opt) => opt.long === '--development-team')

  return String(option?.description || '')
}

describe('the --development-team help and the Safari setup summary agree', () => {
  const summary = stripAnsi(messages.safariNextSteps('My App'))
  const helps = [
    developmentTeamHelp(registerBuildCommand),
    developmentTeamHelp(registerDevCommand)
  ]

  it('gives build and dev the same help text', () => {
    expect(helps[0]).toBe(messages.SAFARI_DEVELOPMENT_TEAM_HELP)
    expect(helps[1]).toBe(messages.SAFARI_DEVELOPMENT_TEAM_HELP)
  })

  it('says in both places that an ad-hoc build needs the toggle on each launch', () => {
    for (const text of [...helps, summary]) {
      expect(text).toContain(messages.SAFARI_AD_HOC_LOADING)
      expect(text).toContain(messages.SAFARI_TEAM_SIGNED_LOADING)
    }

    expect(messages.SAFARI_AD_HOC_LOADING).toMatch(/off at quit/)
    expect(messages.SAFARI_TEAM_SIGNED_LOADING).toMatch(/no toggle/)
    expect(messages.SAFARI_TEAM_SIGNED_LOADING).toMatch(/no Developer ID/)
  })

  it('never says an ad-hoc build loads with no per-launch toggle', () => {
    for (const text of [...helps, summary]) {
      expect(text).not.toMatch(/ad-hoc signed, which Safari loads/i)
    }

    expect(helps[0]).toMatch(
      /team id .*so Safari loads it with no per-launch toggle/
    )
  })

  it('keeps the help as one shared constant in both command files', () => {
    for (const file of ['build.ts', 'dev.ts']) {
      const src = readFileSync(join(__dirname, '..', file), 'utf-8')
      expect(src).toContain('SAFARI_DEVELOPMENT_TEAM_HELP')
    }
  })
})
